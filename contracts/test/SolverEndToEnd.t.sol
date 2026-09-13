// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {OtterHook, OtterPoolMath} from "../src/OtterHook.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {HookMiner} from "./utils/HookMiner.sol";

interface IERC20E {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Settles an outcome produced by the TypeScript solver, unmodified.
///
/// Every other settlement test builds its outcome in Solidity with every bidder at
/// ask = 0, which makes the allocation trivial and collapses the Clarke pivot to a
/// closed form. That exercises the contracts but never the solver. This is the only
/// test where the sorted-ask walk, partial fills, eligibility filtering, and
/// leave-one-out pivots produce numbers that a contract then accepts.
///
/// The fixture batch is chosen to hit every branch the ask = 0 tests skip:
///   order 0  fills in full
///   order 1  PARTIALLY fills at the crossing point
///   order 2  priced out by competition, though eligible
///   order 3  ineligible, ask above spot
///   order 4  minority side, fills in full at spot
///   order 5  minority side, ineligible
///
/// Regenerate with `cd solver && npm run demo`.
contract SolverEndToEndTest is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using stdJson for string;

    OtterOrderBook book;
    OtterSettlement settlement;
    OtterHook hook;
    uint64 constant WINDOW = 60;

    PoolKey otterKey;
    PoolId otterId;

    string json;

    function setUp() public {
        json = vm.readFile("../fixtures/demo-batch.json");

        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        book = new OtterOrderBook(WINDOW, 900);
        settlement = new OtterSettlement(manager, book, address(this), 300);
        book.setSettlement(address(settlement));

        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG),
            type(OtterHook).creationCode,
            abi.encode(manager, address(settlement))
        );
        hook = new OtterHook{salt: salt}(manager, address(settlement));
        assertEq(address(hook), predicted);
        settlement.setApprovedHook(address(hook));

        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(otterKey);
        modifyLiquidityRouter.modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -887272,
                tickUpper: 887272,
                liquidityDelta: int256(json.readUint(".liquidity")),
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _pkFor(uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("otter-demo-trader", i)));
    }

    /// The solver worked from r0/r1 in the fixture. If the pool disagrees, every
    /// number downstream is solving a different problem, so check it first.
    function test_poolMatchesSolverView() public view {
        (uint160 p,,,) = manager.getSlot0(otterId);
        uint128 liq = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, liq);
        assertEq(r0, json.readUint(".r0"), "pool r0 differs from the solver's view");
        assertEq(r1, json.readUint(".r1"), "pool r1 differs from the solver's view");
    }

    function test_settlesSolverOutcome() public {
        uint256 n = json.readUint(".orderCount");
        uint256[] memory side = json.readUintArray(".sellingCurrency0");
        uint256[] memory ask = json.readUintArray(".ask");
        uint256[] memory budget = json.readUintArray(".budget");
        uint256[] memory y = json.readUintArray(".y");
        uint256[] memory x = json.readUintArray(".x");
        bool domSellsC0 = json.readUint(".dominantSellsCurrency0") == 1;

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](n);
        bytes[] memory sigs = new bytes[](n);
        address[] memory traders = new address[](n);

        for (uint256 i; i < n; ++i) {
            uint256 pk = _pkFor(i);
            traders[i] = vm.addr(pk);
            bool sellsC0 = side[i] == 1;

            Currency sold = sellsC0 ? currency0 : currency1;
            deal(Currency.unwrap(sold), traders[i], budget[i]);
            vm.prank(traders[i]);
            IERC20E(Currency.unwrap(sold)).approve(address(book), type(uint256).max);

            orders[i] = OtterOrderBook.Order({
                trader: traders[i],
                poolId: PoolId.unwrap(otterId),
                sellingCurrency0: sellsC0,
                ask: ask[i],
                budget: budget[i],
                deadline: block.timestamp + 1 days,
                nonce: i
            });
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(orders[i]));
            sigs[i] = abi.encodePacked(r, s, v);
        }

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        settlement.settle(
            otterKey,
            batchId,
            orders,
            OtterSettlement.Outcome({dominantSellsCurrency0: domSellsC0, y: y, x: x})
        );

        // every trader received exactly what the solver said they would
        for (uint256 i; i < n; ++i) {
            bool sellsC0 = side[i] == 1;
            Currency received = sellsC0 ? currency1 : currency0;
            assertEq(
                IERC20E(Currency.unwrap(received)).balanceOf(traders[i]),
                x[i],
                "trader payout differs from the solver's outcome"
            );
            // unsold budget is returned by never being pulled
            Currency sold = sellsC0 ? currency0 : currency1;
            assertEq(
                IERC20E(Currency.unwrap(sold)).balanceOf(traders[i]),
                budget[i] - y[i],
                "unfilled remainder should stay with the trader"
            );
        }

        Currency burnCurrency = domSellsC0 ? currency1 : currency0;
        uint256 burn = settlement.pendingSurplus(otterId, burnCurrency);
        uint256 expected = json.readUint(".burn");

        console2.log("solver burn ", expected);
        console2.log("on-chain    ", burn);

        // The solver models the burn as F~s(Y) - sum x*_i. On-chain it is what v4
        // actually paid minus the same sum, so the unused discretisation allowance
        // (CORRECTIONS.md C10) falls through on top. Realised burn is therefore at
        // least the modelled one, never less.
        assertGe(burn, expected, "realised burn cannot fall below the solver's model");
        assertLe(burn - expected, 1000, "residue should be a handful of wei, not a divergence");
    }

    /// Order 1 partially fills at the crossing point and order 2 is priced out
    /// despite being eligible. Neither happens in any ask = 0 batch, so assert the
    /// fixture still contains them — a regenerated fixture that lost these would
    /// silently stop testing the thing this file exists for.
    function test_fixtureExercisesTheInterestingBranches() public view {
        uint256[] memory budget = json.readUintArray(".budget");
        uint256[] memory y = json.readUintArray(".y");

        assertEq(y[0], budget[0], "order 0 should fill in full");
        assertGt(y[1], 0, "order 1 should be partially filled");
        assertLt(y[1], budget[1], "order 1 should be PARTIALLY filled, not full");
        assertEq(y[2], 0, "order 2 should be priced out");
        assertEq(y[3], 0, "order 3 should be ineligible");
        assertEq(y[4], budget[4], "order 4 is minority: fills in full at spot");
        assertEq(y[5], 0, "order 5 should be ineligible");
    }
}
