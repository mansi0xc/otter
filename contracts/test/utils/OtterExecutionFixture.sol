// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterExecutionOracle} from "../../src/OtterExecutionOracle.sol";

abstract contract OtterExecutionFixture is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;

    OtterExecutionOracle internal oracle;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        oracle = new OtterExecutionOracle(manager);
        vm.deal(address(this), 1e35);
    }

    function _pool(int24 spacing, uint160 price) internal returns (PoolKey memory k) {
        (k,) = initPool(currency0, currency1, IHooks(address(0)), 0, spacing, price);
    }

    function _add(PoolKey memory k, int24 lower, int24 upper, uint128 liquidity, uint256 salt) internal {
        uint256 value = Currency.unwrap(k.currency0) == address(0) ? 1e30 : 0;
        modifyLiquidityRouter.modifyLiquidity{value: value}(
            k, IPoolManager.ModifyLiquidityParams(lower, upper, int256(uint256(liquidity)), bytes32(salt)), ZERO_BYTES
        );
    }

    function _fullRange(PoolKey memory k, uint128 liquidity) internal {
        _add(k, TickMath.minUsableTick(k.tickSpacing), TickMath.maxUsableTick(k.tickSpacing), liquidity, 0);
    }

    function _quoteAndSwap(PoolKey memory k, bool direction, uint256 amount, uint160 limit)
        internal
        returns (OtterExecutionOracle.Quote memory q)
    {
        PoolId id = k.toId();
        (uint160 beforePrice, int24 beforeTick,,) = manager.getSlot0(id);
        uint128 beforeLiquidity = manager.getLiquidity(id);
        vm.record();
        q = oracle.quoteExactInput(k, direction, amount, limit);
        (, bytes32[] memory managerWrites) = vm.accesses(address(manager));
        (, bytes32[] memory oracleWrites) = vm.accesses(address(oracle));
        assertEq(managerWrites.length, 0, "quote writes manager state");
        assertEq(oracleWrites.length, 0, "quote writes oracle state");
        (uint160 unchangedPrice, int24 unchangedTick,,) = manager.getSlot0(id);
        assertEq(unchangedPrice, beforePrice);
        assertEq(unchangedTick, beforeTick);
        assertEq(manager.getLiquidity(id), beforeLiquidity);
        assertTrue(
            q.status == OtterExecutionOracle.Status.Complete || q.status == OtterExecutionOracle.Status.PriceLimit,
            "unsupported differential fixture"
        );
        uint256 value = direction && Currency.unwrap(k.currency0) == address(0) ? amount : 0;
        // Pool.swap has a zero-input fast path, but its public PoolManager
        // entry point rejects zero. An optimizer must skip that unlock/swap.
        if (amount == 0) {
            assertEq(q.consumedInput, 0);
            assertEq(q.output, 0);
            assertEq(q.sqrtPriceX96, beforePrice);
            assertEq(q.tick, beforeTick);
            assertEq(q.liquidity, beforeLiquidity);
            vm.expectRevert(IPoolManager.SwapAmountCannotBeZero.selector);
            swapRouter.swap(
                k, IPoolManager.SwapParams(direction, 0, limit), PoolSwapTest.TestSettings(false, false), ZERO_BYTES
            );
            return q;
        }
        BalanceDelta delta = swapRouter.swap{value: value}(
            k,
            IPoolManager.SwapParams(direction, -int256(amount), limit),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
        int128 actualInput = direction ? delta.amount0() : delta.amount1();
        int128 actualOutput = direction ? delta.amount1() : delta.amount0();
        assertEq(q.requestedInput, amount);
        assertEq(q.consumedInput, uint256(-int256(actualInput)), "input delta mismatch");
        assertEq(q.output, uint256(int256(actualOutput)), "output delta mismatch");
        (uint160 price, int24 tick,,) = manager.getSlot0(id);
        assertEq(q.sqrtPriceX96, price, "final price mismatch");
        assertEq(q.tick, tick, "final tick mismatch");
        assertEq(q.liquidity, manager.getLiquidity(id), "final liquidity mismatch");
        assertLe(q.consumedInput, amount);
        assertLe(q.output, oracle.MAX_OUTPUT());
        assertLe(q.bitmapWords, 16);
        assertLe(q.initializedTicksCrossed, 64);
        assertLe(q.steps, 80);
        if (q.status == OtterExecutionOracle.Status.Complete) {
            assertEq(q.consumedInput, amount);
        } else {
            assertLt(q.consumedInput, amount);
            assertEq(q.sqrtPriceX96, limit);
        }
    }
}
