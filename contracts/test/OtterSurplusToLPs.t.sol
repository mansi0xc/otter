// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {OtterTestDeployers as Deployers} from "./utils/OtterTestDeployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {OtterHook, OtterPoolMath} from "../src/OtterHook.sol";
import {OtterMath} from "../src/OtterMath.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {HookMiner} from "./utils/HookMiner.sol";

interface IERC20S {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Residual cash credits the opening LP owners in the same settlement.
/// This validates historical eligibility/backing, not canonical trader payments
/// or LP incentives. Deliberately underpaid legacy outcomes keep R2 visible.
contract OtterSurplusToLPsTest is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    OtterOrderBook book;
    OtterSettlement settlement;
    OtterHook hook;

    uint64 constant WINDOW = 60;

    uint256 domPk = 0xD0;
    uint256 minPk = 0xD1;
    address dom;
    address min;

    PoolKey otterKey;
    PoolId otterId;

    int24 constant TICK_LOWER = -887272;
    int24 constant TICK_UPPER = 887272;
    int256 constant LIQUIDITY = 1e21;

    uint256 constant DOM_BUDGET = 10e18;
    uint256 constant MIN_BUDGET = 2e18;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        book = new OtterOrderBook(WINDOW, 900);
        settlement = new OtterSettlement(manager, book, address(this), 300);
        book.setSettlement(address(settlement));

        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            uint160(
                Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                    | Hooks.BEFORE_DONATE_FLAG
            ),
            type(OtterHook).creationCode,
            abi.encode(manager, address(settlement))
        );
        hook = new OtterHook{salt: salt}(manager, address(settlement));
        assertEq(address(hook), predicted);
        settlement.setApprovedHook(address(hook));

        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(otterKey);
        _modifyLiquidity(LIQUIDITY);

        dom = vm.addr(domPk);
        min = vm.addr(minPk);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _modifyLiquidity(int256 delta) internal {
        _modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: delta, salt: 0
            }),
            ZERO_BYTES
        );
    }

    /// @dev A zero-delta `modifyLiquidity` collects accrued fees without touching
    ///      the position, so the balance change it produces is exactly what the
    ///      LP has earned. This is how the donation is observed.
    function _collectFees() internal returns (uint256 got0, uint256 got1) {
        uint256 b0 = IERC20S(Currency.unwrap(currency0)).balanceOf(address(this));
        uint256 b1 = IERC20S(Currency.unwrap(currency1)).balanceOf(address(this));
        _modifyLiquidity(0);
        got0 = IERC20S(Currency.unwrap(currency0)).balanceOf(address(this)) - b0;
        got1 = IERC20S(Currency.unwrap(currency1)).balanceOf(address(this)) - b1;
    }

    function _fund(Currency c, address who, uint256 amount) internal {
        address token = Currency.unwrap(c);
        deal(token, who, amount);
        vm.prank(who);
        IERC20S(token).approve(address(book), type(uint256).max);
    }

    function _curve() internal view returns (OtterMath.Curve memory c) {
        (uint160 p,,,) = manager.getSlot0(otterId);
        uint128 L = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, L);
        c = OtterMath.Curve({x0: r1, y0: r0, M: 0});
        c.M = (c.y0 * MIN_BUDGET) / c.x0;
    }

    function _order(address trader, uint256 pk, bool sellsC0, uint256 budget, uint256 nonce)
        internal
        view
        returns (OtterOrderBook.Order memory o, bytes memory sig)
    {
        o = OtterOrderBook.Order({
            trader: trader,
            poolId: PoolId.unwrap(otterId),
            sellingCurrency0: sellsC0,
            ask: 0,
            budget: budget,
            deadline: block.timestamp + 1 days,
            nonce: nonce,
            configVersion: 1,
            epoch: book.nextEpochId(PoolId.unwrap(otterId)),
            maxExecutionTime: block.timestamp + 1 days
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(o));
        sig = abi.encodePacked(r, s, v);
    }

    /// Runs one whole batch: fund, submit, close the window, settle with `slack`
    /// wei of deliberate under-payment so there is a surplus worth watching.
    function _runBatch(uint256 nonce, uint256 slack) internal returns (uint256 surplusCreated) {
        _fund(currency0, dom, DOM_BUDGET);
        _fund(currency1, min, MIN_BUDGET);

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        (orders[0], sigs[0]) = _order(dom, domPk, true, DOM_BUDGET, nonce);
        (orders[1], sigs[1]) = _order(min, minPk, false, MIN_BUDGET, nonce);

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        OtterMath.Curve memory c = _curve();
        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = DOM_BUDGET;
        x[0] = OtterMath.fTildeSettleable(c, DOM_BUDGET) - slack;
        y[1] = MIN_BUDGET;
        x[1] = (c.y0 * MIN_BUDGET) / c.x0;

        settlement.settle(
            otterKey, batchId, orders, OtterSettlement.Outcome({dominantSellsCurrency0: true, y: y, x: x})
        );
        surplusCreated = settlement.rewardLedger()
            .epochSurplus(
                PoolId.unwrap(otterId), book.currentBatchId(PoolId.unwrap(otterId)), Currency.unwrap(currency1)
            );
    }

    function test_settlementCreditsOpeningLPWithoutDonation() public {
        uint256 surplus = _runBatch(0, 1e15);
        assertGt(surplus, 0);
        assertEq(settlement.rewardLedger().claimable(address(this), Currency.unwrap(currency1)), surplus);
        assertEq(IERC20S(Currency.unwrap(currency1)).balanceOf(address(settlement.rewardLedger())), surplus);
        (, uint256 fees) = _collectFees();
        assertEq(fees, 0, "historical rewards are separate from position fees");
        uint256 beforeBalance = IERC20S(Currency.unwrap(currency1)).balanceOf(address(this));
        settlement.rewardLedger().claim(Currency.unwrap(currency1), surplus, address(this));
        assertEq(IERC20S(Currency.unwrap(currency1)).balanceOf(address(this)) - beforeBalance, surplus);
    }

    function test_legacyFlushSelectorHasNoRoute() public {
        _runBatch(0, 1e15);
        (bool ok,) = address(settlement)
            .call(abi.encodeWithSignature("flushSurplus((address,address,uint24,int24,address))", otterKey));
        assertFalse(ok);
    }

    function test_repeatedEpochsRetainHistoricalCashUntilOwnersClaim() public {
        uint256 s1 = _runBatch(0, 1e15);
        uint256 s2 = _runBatch(1, 1e15);
        assertEq(settlement.rewardLedger().epochSurplus(PoolId.unwrap(otterId), 0, Currency.unwrap(currency1)), s1);
        assertEq(settlement.rewardLedger().epochSurplus(PoolId.unwrap(otterId), 1, Currency.unwrap(currency1)), s2);
        assertEq(settlement.rewardLedger().claimable(address(this), Currency.unwrap(currency1)), s1 + s2);
        assertEq(IERC20S(Currency.unwrap(currency1)).balanceOf(address(settlement.rewardLedger())), s1 + s2);
        (, uint256 fees) = _collectFees();
        assertEq(fees, 0);
    }

    function test_rewardClaimLeavesPoolPriceAndLiquidityUntouched() public {
        uint256 reward = _runBatch(0, 1e15);
        (uint160 beforePrice,,,) = manager.getSlot0(otterId);
        uint128 beforeLiquidity = manager.getLiquidity(otterId);
        settlement.rewardLedger().claim(Currency.unwrap(currency1), reward, address(this));
        (uint160 afterPrice,,,) = manager.getSlot0(otterId);
        assertEq(afterPrice, beforePrice);
        assertEq(manager.getLiquidity(otterId), beforeLiquidity);
    }
}
