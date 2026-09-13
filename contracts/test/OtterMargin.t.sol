// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {OtterHook, OtterPoolMath} from "../src/OtterHook.sol";
import {OtterMath} from "../src/OtterMath.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {HookMiner} from "./utils/HookMiner.sol";

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice The single-point test in OtterSettlement.t.sol showed the conservation
///         margin is exactly zero when the dominant side is paid its full ceiling.
///         Exact zero is a knife edge: if the margin is ever NEGATIVE, a legitimate
///         batch reverts with PoolOutputShortfall and the system does not work.
///
///         This sweeps price, liquidity, and batch sizes and asserts the margin is
///         never negative. It also records the largest positive margin seen, which
///         is the amount of surplus that leaks to the burn purely through rounding
///         rather than through the mechanism — a number worth reporting rather than
///         quietly absorbing.
contract OtterMarginTest is Deployers {
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

    function setUp() public {
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

        dom = vm.addr(domPk);
        min = vm.addr(minPk);
    }

    function _fund(Currency c, address who, uint256 amount) internal {
        address token = Currency.unwrap(c);
        deal(token, who, amount);
        vm.prank(who);
        IERC20Min(token).approve(address(book), type(uint256).max);
    }

    /// Distinct tickSpacing gives a distinct PoolKey, which is how each fuzz run
    /// gets a fresh pool at its own price without redeploying the manager.
    function _freshPool(int24 spacing, uint160 sqrtPrice, uint128 liquidity)
        internal
        returns (PoolKey memory k, PoolId id)
    {
        (k, id) = initPool(currency0, currency1, IHooks(address(hook)), 0, spacing, sqrtPrice);
        settlement.registerPool(k);
        int24 lo = -(887272 / spacing) * spacing;
        int24 hi = (887272 / spacing) * spacing;
        modifyLiquidityRouter.modifyLiquidity(
            k,
            IPoolManager.ModifyLiquidityParams({
                tickLower: lo,
                tickUpper: hi,
                liquidityDelta: int256(uint256(liquidity)),
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _sign(uint256 pk, OtterOrderBook.Order memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(o));
        return abi.encodePacked(r, s, v);
    }

    function testFuzz_conservationMarginIsNeverNegative(
        uint8 rawSpacing,
        uint96 rawLiquidity,
        uint96 rawDomBudget,
        uint96 rawMinBudget,
        uint16 rawPriceBps
    ) public {
        int24 spacing = int24(uint24(bound(uint256(rawSpacing), 1, 10)));
        uint128 L = uint128(bound(uint256(rawLiquidity), 1e20, 1e24));
        uint256 domBudget = bound(uint256(rawDomBudget), 1e15, 1e19);
        uint256 minBudget = bound(uint256(rawMinBudget), 1e15, 1e18);

        // price between roughly 0.25 and 4.0, via sqrtPriceX96
        uint256 bps = bound(uint256(rawPriceBps), 5000, 20000); // sqrt(P) in bps
        uint160 sqrtPrice = uint160((uint256(1) << 96) * bps / 10000);
        vm.assume(sqrtPrice > TickMath.MIN_SQRT_PRICE && sqrtPrice < TickMath.MAX_SQRT_PRICE);

        (PoolKey memory k, PoolId id) = _freshPool(spacing, sqrtPrice, L);

        _fund(currency0, dom, domBudget);
        _fund(currency1, min, minBudget);

        // build the curve exactly as the contract will
        (uint160 p,,,) = manager.getSlot0(id);
        uint128 liq = manager.getLiquidity(id);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, liq);
        OtterMath.Curve memory c = OtterMath.Curve({x0: r1, y0: r0, M: 0});
        c.M = (c.y0 * minBudget) / c.x0;

        // dominant side is only dominant if it out-sizes the minority side
        vm.assume(domBudget >= c.M);

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        orders[0] = OtterOrderBook.Order({
            trader: dom,
            poolId: PoolId.unwrap(id),
            sellingCurrency0: true,
            ask: 0,
            budget: domBudget,
            deadline: block.timestamp + 1 days,
            nonce: 0
        });
        orders[1] = OtterOrderBook.Order({
            trader: min,
            poolId: PoolId.unwrap(id),
            sellingCurrency0: false,
            ask: 0,
            budget: minBudget,
            deadline: block.timestamp + 1 days,
            nonce: 0
        });
        sigs[0] = _sign(domPk, orders[0]);
        sigs[1] = _sign(minPk, orders[1]);

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = domBudget;
        x[0] = OtterMath.fTildeSettleable(c, domBudget); // FULL ceiling: zero headroom
        y[1] = minBudget;
        x[1] = (c.y0 * minBudget) / c.x0;

        // If this reverts with PoolOutputShortfall the margin went negative and the
        // model is not conservative enough. Any other revert is a setup problem.
        settlement.settle(k, batchId, orders, OtterSettlement.Outcome({dominantSellsCurrency0: true, y: y, x: x}));

        uint256 burn = settlement.pendingSurplus(id, currency1);
        console2.log("rounding margin (wei)", burn);
    }
}
