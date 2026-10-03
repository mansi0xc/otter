// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {OtterExecutionOracle} from "../src/OtterExecutionOracle.sol";
import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {OtterExecutionFixture} from "./utils/OtterExecutionFixture.sol";

contract OtterExecutionOracleTest is OtterExecutionFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function test_fullRangeBothDirectionsWithinOneTick() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1e18);
        _quoteAndSwap(k, true, 1e12, TickMath.getSqrtPriceAtTick(-100));
        _quoteAndSwap(k, false, 1e12, TickMath.getSqrtPriceAtTick(100));
    }

    function test_zeroModelInputIgnoresLimitButManagerRejectsZeroSwap() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1e18);
        OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, true, 0, 0);
        assertEq(q.bitmapWords, 0);
        assertEq(q.steps, 0);
        _quoteAndSwap(k, false, 0, type(uint160).max);
    }

    function test_leftwardZeroAmountCrossingActivatesInactiveRange() public {
        PoolKey memory k = _pool(60, SQRT_PRICE_1_1);
        _add(k, -120, 0, 1e18, 0);
        assertEq(manager.getLiquidity(k.toId()), 0);
        OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, true, 1, TickMath.getSqrtPriceAtTick(-100));
        assertEq(q.initializedTicksCrossed, 1);
        assertEq(q.liquidity, 1e18);
        assertEq(q.steps, 2);
    }

    function test_exactInputEndsOnInitializedLowerTick() public {
        PoolKey memory k = _pool(60, SQRT_PRICE_1_1);
        _add(k, -60, 60, 1e18, 0);
        uint160 limit = TickMath.getSqrtPriceAtTick(-60);
        uint256 input = SqrtPriceMath.getAmount0Delta(limit, SQRT_PRICE_1_1, 1e18, true);
        OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, true, input, limit);
        assertEq(q.tick, -61);
        assertEq(q.liquidity, 0);
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.Complete));
    }

    function test_exactInputEndsOnInitializedUpperTick() public {
        PoolKey memory k = _pool(60, SQRT_PRICE_1_1);
        _add(k, -60, 60, 1e18, 0);
        uint160 limit = TickMath.getSqrtPriceAtTick(60);
        uint256 input = SqrtPriceMath.getAmount1Delta(SQRT_PRICE_1_1, limit, 1e18, true);
        OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, false, input, limit);
        assertEq(q.tick, 60);
        assertEq(q.liquidity, 0);
    }

    function test_overlappingLiquidityCrossingsBothDirections() public {
        for (uint256 i; i < 2; ++i) {
            PoolKey memory k = _pool(int24(int256(i + 1)), SQRT_PRICE_1_1);
            _add(k, -600, 600, 1e12, 0);
            _add(k, -120, 120, 2e12, 1);
            _add(k, -60, 60, 3e12, 2);
            OtterExecutionOracle.Quote memory q = _quoteAndSwap(
                k, i == 0, type(uint96).max, TickMath.getSqrtPriceAtTick(i == 0 ? int24(-500) : int24(500))
            );
            assertEq(q.initializedTicksCrossed, 2);
            assertEq(q.liquidity, 1e12);
            assertLt(q.consumedInput, q.requestedInput);
        }
    }

    function test_emptyLiquidityGapHasNoInventedOutputBothDirections() public {
        for (uint256 i; i < 2; ++i) {
            bool down = i == 0;
            PoolKey memory k = _pool(int24(int256(i + 1)), SQRT_PRICE_1_1);
            _add(k, -120, 120, 1e12, 0);
            _add(k, down ? int24(-1000) : int24(800), down ? int24(-800) : int24(1000), 2e12, 1);
            OtterExecutionOracle.Quote memory q =
                _quoteAndSwap(k, down, type(uint96).max, TickMath.getSqrtPriceAtTick(down ? int24(-900) : int24(900)));
            assertEq(q.initializedTicksCrossed, 2);
            assertEq(q.liquidity, 2e12);
            assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.PriceLimit));
            // Omitting the gap from the independent amount sum yields the same
            // output except for per-word downward rounding (at most one per step).
            uint160 edge = TickMath.getSqrtPriceAtTick(down ? int24(-120) : int24(120));
            uint160 entrance = TickMath.getSqrtPriceAtTick(down ? int24(-800) : int24(800));
            uint256 expected = down
                ? SqrtPriceMath.getAmount1Delta(edge, SQRT_PRICE_1_1, 1e12, false)
                    + SqrtPriceMath.getAmount1Delta(q.sqrtPriceX96, entrance, 2e12, false)
                : SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, edge, 1e12, false)
                    + SqrtPriceMath.getAmount0Delta(entrance, q.sqrtPriceX96, 2e12, false);
            assertLe(q.output, expected);
            assertLe(expected - q.output, q.steps);
        }
    }

    function test_emptyBitmapBoundariesAffectStepRounding() public {
        for (uint256 i; i < 2; ++i) {
            bool down = i == 0;
            PoolKey memory k = _pool(int24(int256(i + 1)), SQRT_PRICE_1_1);
            _fullRange(k, 1e6);
            uint160 limit = TickMath.getSqrtPriceAtTick(down ? int24(-1200) : int24(1200));
            (, uint256 naiveIn, uint256 naiveOut,) =
                SwapMath.computeSwapStep(SQRT_PRICE_1_1, limit, 1e6, -int256(uint256(type(uint96).max)), 0);
            OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, down, type(uint96).max, limit);
            assertGt(q.bitmapWords, 1);
            assertEq(q.initializedTicksCrossed, 0);
            assertTrue(q.output != naiveOut || q.consumedInput != naiveIn, "fixture must detect omitted boundaries");
        }
    }

    function test_negativeNonAlignedTickUsesFloorCompression() public {
        PoolKey memory k = _pool(60, TickMath.getSqrtPriceAtTick(-61));
        _add(k, -600, 600, 1e15, 0);
        _add(k, -120, 0, 2e15, 1);
        _quoteAndSwap(k, true, type(uint96).max, TickMath.getSqrtPriceAtTick(-500));
        _quoteAndSwap(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(500));
    }

    function test_maxTickSpacingClampsEmptyWordEndpoints() public {
        PoolKey memory k = _pool(32767, SQRT_PRICE_1_1);
        _fullRange(k, 1e18);
        _quoteAndSwap(k, true, type(uint96).max, oracle.MIN_SQRT_PRICE());
        _quoteAndSwap(k, false, type(uint96).max, oracle.MAX_SQRT_PRICE_EXCLUSIVE() - 1);
    }

    function test_emptyPoolTraversesWithoutConsumingEitherAsset() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, true, 100, TickMath.getSqrtPriceAtTick(-800));
        assertEq(q.consumedInput, 0);
        assertEq(q.output, 0);
        q = _quoteAndSwap(k, false, 100, TickMath.getSqrtPriceAtTick(800));
        assertEq(q.consumedInput, 0);
        assertEq(q.output, 0);
    }

    function test_nativeInputAndOutputMatchCore() public {
        PoolKey memory k;
        (k,) = initPool(Currency.wrap(address(0)), currency1, IHooks(address(0)), 0, 60, SQRT_PRICE_1_1);
        _add(k, -600, 600, 1e18, 0);
        _quoteAndSwap(k, true, 1e15, TickMath.getSqrtPriceAtTick(-500));
        _quoteAndSwap(k, false, 1e15, TickMath.getSqrtPriceAtTick(500));
    }

    function test_unequalDecimalsAreQuotedInRawUnits() public {
        MockERC20 a = new MockERC20("Six", "SIX", 6);
        MockERC20 b = new MockERC20("Eighteen", "EIGHTEEN", 18);
        Currency c0 = Currency.wrap(address(a) < address(b) ? address(a) : address(b));
        Currency c1 = Currency.wrap(address(a) < address(b) ? address(b) : address(a));
        a.mint(address(this), 1e35);
        b.mint(address(this), 1e35);
        a.approve(address(modifyLiquidityRouter), type(uint256).max);
        b.approve(address(modifyLiquidityRouter), type(uint256).max);
        a.approve(address(swapRouter), type(uint256).max);
        b.approve(address(swapRouter), type(uint256).max);
        // Equal human token prices, including either deterministic address order.
        uint160 price = address(a) < address(b) ? SQRT_PRICE_1_1 * 1e6 : SQRT_PRICE_1_1 / 1e6;
        PoolKey memory k;
        (k,) = initPool(c0, c1, IHooks(address(0)), 0, 60, price);
        _fullRange(k, 1e18);
        int24 tick = TickMath.getTickAtSqrtPrice(price);
        _quoteAndSwap(k, true, 1e6, TickMath.getSqrtPriceAtTick(tick - 1000));
        _quoteAndSwap(k, false, 1e18, TickMath.getSqrtPriceAtTick(tick + 1000));
    }

    function test_supportedPriceEndpointsAndMaximumInput() public {
        PoolKey memory low = _pool(1, oracle.MIN_SQRT_PRICE() + 1);
        _fullRange(low, oracle.MAX_LIQUIDITY());
        _quoteAndSwap(low, true, type(uint96).max, oracle.MIN_SQRT_PRICE());
        PoolKey memory high = _pool(2, oracle.MAX_SQRT_PRICE_EXCLUSIVE() - 2);
        _fullRange(high, oracle.MAX_LIQUIDITY());
        _quoteAndSwap(high, false, type(uint96).max, oracle.MAX_SQRT_PRICE_EXCLUSIVE() - 1);
    }

    function test_uninitializedPoolAndInvalidSpacingAreUnsupported() public {
        PoolKey memory k = PoolKey(currency0, currency1, 0, 1, IHooks(address(0)));
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, 1 << 64).status),
            uint8(OtterExecutionOracle.Status.UnsupportedPool)
        );
        k.tickSpacing = 0;
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, 1 << 64).status),
            uint8(OtterExecutionOracle.Status.UnsupportedPool)
        );
        k.tickSpacing = 32768;
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, 1 << 64).status),
            uint8(OtterExecutionOracle.Status.UnsupportedPool)
        );
    }

    function test_feesRejectedIncludingOppositeDirectionProtocolFee() public {
        PoolKey memory k;
        (k,) = initPool(currency0, currency1, IHooks(address(0)), 100, 1, SQRT_PRICE_1_1);
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, 1 << 64).status),
            uint8(OtterExecutionOracle.Status.UnsupportedFees)
        );
        k = _pool(1, SQRT_PRICE_1_1);
        vm.prank(feeController);
        manager.setProtocolFee(k, 1000);
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, 1 << 64).status),
            uint8(OtterExecutionOracle.Status.UnsupportedFees)
        );
        assertEq(
            uint8(oracle.quoteExactInput(k, false, 1, (1 << 128) - 1).status),
            uint8(OtterExecutionOracle.Status.UnsupportedFees)
        );
        assertEq(
            uint8(oracle.quoteExactInput(k, false, 0, 0).status), uint8(OtterExecutionOracle.Status.UnsupportedFees)
        );
    }

    function test_dynamicFeeKeyWithZeroStoredFeeIsUnsupported() public {
        PoolKey memory k;
        (k,) = initPool(currency0, currency1, IHooks(address(0x100000)), 0x800000, 1, SQRT_PRICE_1_1);
        (,,, uint24 fee) = manager.getSlot0(k.toId());
        assertEq(fee, 0);
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, 1 << 64).status),
            uint8(OtterExecutionOracle.Status.UnsupportedFees)
        );
    }

    function test_priceOutsideDomainIsUnsupported() public {
        PoolKey memory low = _pool(1, oracle.MIN_SQRT_PRICE() - 1);
        assertEq(
            uint8(oracle.quoteExactInput(low, false, 1, SQRT_PRICE_1_1).status),
            uint8(OtterExecutionOracle.Status.UnsupportedPrice)
        );
        PoolKey memory high = _pool(2, oracle.MAX_SQRT_PRICE_EXCLUSIVE());
        assertEq(
            uint8(oracle.quoteExactInput(high, true, 1, SQRT_PRICE_1_1).status),
            uint8(OtterExecutionOracle.Status.UnsupportedPrice)
        );
    }

    function test_invalidPriceLimitsAreNotUsableQuotes() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, SQRT_PRICE_1_1).status),
            uint8(OtterExecutionOracle.Status.InvalidPriceLimit)
        );
        assertEq(
            uint8(oracle.quoteExactInput(k, false, 1, SQRT_PRICE_1_1 - 1).status),
            uint8(OtterExecutionOracle.Status.InvalidPriceLimit)
        );
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, TickMath.MIN_SQRT_PRICE).status),
            uint8(OtterExecutionOracle.Status.UnsupportedPrice)
        );
        assertEq(
            uint8(oracle.quoteExactInput(k, false, 1, TickMath.MAX_SQRT_PRICE).status),
            uint8(OtterExecutionOracle.Status.UnsupportedPrice)
        );
    }

    function test_activeLiquidityBeyondDomainIsUnsupported() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _add(k, -120, 120, uint128(1 << 88), 0);
        assertEq(
            uint8(oracle.quoteExactInput(k, true, 1, 1 << 64).status), uint8(OtterExecutionOracle.Status.LiquidityLimit)
        );
    }

    function test_inactiveCrossingGrossBeyondDomainIsUnsupported() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _add(k, -120, 0, uint128(1 << 88), 0);
        OtterExecutionOracle.Quote memory q = oracle.quoteExactInput(k, true, 1, TickMath.getSqrtPriceAtTick(-100));
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.LiquidityLimit));
        assertEq(q.consumedInput, 0);
    }

    function test_crossedActiveLiquidityBeyondDomainIsUnsupported() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _add(k, -600, 600, uint128(1 << 87), 0);
        _add(k, 60, 120, uint128(1 << 87), 1);
        OtterExecutionOracle.Quote memory q =
            oracle.quoteExactInput(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(100));
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.LiquidityLimit));
        assertEq(q.liquidity, uint128(1 << 87));
        assertEq(q.initializedTicksCrossed, 0);
    }

    function test_sixteenEmptyWordsAllowedSeventeenthUnsupportedBothDirections() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        for (uint256 i; i < 2; ++i) {
            bool down = i == 0;
            int24 endpoint = down ? int24(-3840) : int24(4095);
            OtterExecutionOracle.Quote memory q = oracle.quoteExactInput(
                k, down, 1, TickMath.getSqrtPriceAtTick(endpoint + (down ? int24(-1) : int24(1)))
            );
            assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.WordLimit));
            assertEq(q.bitmapWords, 16);
            assertEq(q.consumedInput, 0);
            assertEq(q.output, 0);
            assertEq(q.sqrtPriceX96, TickMath.getSqrtPriceAtTick(endpoint));
            q = _quoteAndSwap(k, down, 1, TickMath.getSqrtPriceAtTick(endpoint));
            assertEq(q.bitmapWords, 16);
            assertEq(q.steps, 16);
            // The empty PoolKey is reused only after resetting to its opening state.
            if (i == 0) {
                _quoteAndSwap(k, false, 1, SQRT_PRICE_1_1);
            }
        }
    }

    function test_sixtyFifthInitializedCrossingIsUnsupported() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        for (uint256 i; i < 33; ++i) {
            int24 lower = int24(int256(1 + i * 3));
            _add(k, lower, lower + 1, 1e12, i);
        }
        OtterExecutionOracle.Quote memory q =
            oracle.quoteExactInput(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(110));
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.TickLimit));
        assertEq(q.initializedTicksCrossed, 64);
        assertEq(q.bitmapWords, 1);
        assertEq(q.tick, 95);
        assertEq(q.liquidity, 0);
    }

    function test_coldMaximumTraceHasBoundedGasAndMatchesCore() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        for (uint256 i; i < 32; ++i) {
            int24 lower = int24(int256(1 + i * 128));
            _add(k, lower, lower + 63, 1e12, i);
        }
        vm.cool(address(manager));
        vm.cool(address(oracle));
        uint256 before = gasleft();
        OtterExecutionOracle.Quote memory q =
            oracle.quoteExactInput{gas: 750_000}(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(4095));
        uint256 used = before - gasleft();
        emit log_named_uint("cold oracle: 16 words, 64 crossings, 80 steps", used);
        assertLt(used, 750_000);
        assertEq(q.bitmapWords, 16);
        assertEq(q.initializedTicksCrossed, 64);
        assertEq(q.steps, 80);
        OtterExecutionOracle.Quote memory tooFar =
            oracle.quoteExactInput(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(4096));
        assertEq(uint8(tooFar.status), uint8(OtterExecutionOracle.Status.StepLimit));
        assertEq(tooFar.steps, 80);
        assertEq(tooFar.sqrtPriceX96, q.sqrtPriceX96);
        _quoteAndSwap(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(4095));
        vm.cool(address(manager));
        vm.cool(address(oracle));
        before = gasleft();
        q = oracle.quoteExactInput{gas: 750_000}(k, true, type(uint96).max, SQRT_PRICE_1_1);
        used = before - gasleft();
        emit log_named_uint("cold downward oracle: 16 words, 64 crossings, 80 steps", used);
        assertLt(used, 750_000);
        assertEq(q.bitmapWords, 16);
        assertEq(q.initializedTicksCrossed, 64);
        assertEq(q.steps, 80);
        _quoteAndSwap(k, true, type(uint96).max, SQRT_PRICE_1_1);
    }

    function test_invalidManagerRejected() public {
        vm.expectRevert(OtterExecutionOracle.InvalidManager.selector);
        new OtterExecutionOracle(IPoolManager(address(0)));
    }

    function testFuzz_concentratedTopologyMatchesCore(
        bool direction,
        uint32 rawStart,
        uint128 rawLiquidity,
        uint96 rawInput
    ) public {
        int24 spacing = direction ? int24(1) : int24(60);
        int24 start = int24(int256(bound(rawStart, 0, 1000)) - 500);
        uint128 liquidity = uint128(bound(rawLiquidity, 1, 1e20));
        PoolKey memory k = _pool(spacing, TickMath.getSqrtPriceAtTick(start));
        _add(k, -6000, 6000, liquidity, 0);
        _add(k, -1200, 1200, liquidity * 2, 1);
        _add(k, -120, 120, liquidity * 3, 2);
        _quoteAndSwap(k, direction, rawInput, TickMath.getSqrtPriceAtTick(direction ? int24(-3000) : int24(3000)));
    }

    function testFuzz_dustAndNegativeTickMatchCore(bool direction, uint8 rawTick, uint16 rawLiquidity, uint8 rawInput)
        public
    {
        int24 start = -int24(int256(bound(rawTick, 1, 59)));
        PoolKey memory k = _pool(60, TickMath.getSqrtPriceAtTick(start));
        _add(k, -600, 600, uint128(bound(rawLiquidity, 1, 5000)), 0);
        _quoteAndSwap(k, direction, rawInput, TickMath.getSqrtPriceAtTick(direction ? int24(-500) : int24(500)));
    }

    function testFuzz_entireRawPriceLiquidityInputDomainMatchesCore(
        bool direction,
        uint160 rawPrice,
        uint128 rawLiquidity,
        uint96 input
    ) public {
        uint160 price = uint160(bound(rawPrice, uint256(1 << 64) + 1, uint256(1 << 128) - 2));
        uint128 liquidity = uint128(bound(rawLiquidity, 1, oracle.MAX_LIQUIDITY()));
        PoolKey memory k = _pool(32767, price);
        _fullRange(k, liquidity);
        _quoteAndSwap(k, direction, input, direction ? oracle.MIN_SQRT_PRICE() : oracle.MAX_SQRT_PRICE_EXCLUSIVE() - 1);
    }

    function testFuzz_oversizedInputIsUnsupportedWithoutNarrowing(uint256 rawInput) public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        uint256 input = bound(rawInput, uint256(type(uint96).max) + 1, type(uint256).max);
        OtterExecutionOracle.Quote memory q = oracle.quoteExactInput(k, true, input, 1 << 64);
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.UnsupportedAmount));
        assertEq(q.requestedInput, input);
        assertEq(q.consumedInput, 0);
        assertEq(q.steps, 0);
    }
}

contract OtterExecutionOracleIntegrationTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function test_quoteMatchesAuthenticatedOtterFullRangeSettlement() public {
        OtterExecutionOracle oracle = new OtterExecutionOracle(manager);
        uint256 id = _submitActiveOrder();
        OtterOrderBook.Order[] memory orders = book.getOrders(PoolId.unwrap(otterId), id);
        OtterExecutionOracle.Quote memory q =
            oracle.quoteExactInput(otterKey, true, orders[0].budget, TickMath.getSqrtPriceAtTick(-3000));
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.Complete));
        vm.warp(block.timestamp + 60);
        OtterSettlement.Outcome memory outcome = OtterSettlement.Outcome(true, new uint256[](1), new uint256[](1));
        outcome.y[0] = orders[0].budget;
        outcome.x[0] = 1e17;
        settlement.settle(otterKey, id, orders, outcome);
        (uint160 price, int24 tick,,) = manager.getSlot0(otterId);
        assertEq(price, q.sqrtPriceX96);
        assertEq(tick, q.tick);
        assertEq(manager.getLiquidity(otterId), q.liquidity);
        assertEq(settlement.pendingSurplus(otterId, currency1), q.output - outcome.x[0]);
    }

    function test_authenticConcentratedQuoteDoesNotLiftAuctionAdmissionGate() public {
        IFixtureToken(Currency.unwrap(currency0)).approve(address(vault), type(uint256).max);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        vault.createPosition(otterKey, -120, 120, 1e18, type(uint256).max, type(uint256).max);
        OtterExecutionOracle oracle = new OtterExecutionOracle(manager);
        OtterExecutionOracle.Quote memory q =
            oracle.quoteExactInput(otterKey, true, 1e18, TickMath.getSqrtPriceAtTick(-3000));
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(q.liquidity, uint128(1e21 + 1e18));
        (OtterOrderBook.Order[] memory orders, bytes[] memory signatures) = _prepareActiveOrder();
        vm.expectRevert(OtterLiquidityVault.ConcentratedExecutionUnavailable.selector);
        book.submit(orders, signatures);
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 0);
    }
}
