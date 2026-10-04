// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterExecutionOracle} from "../src/OtterExecutionOracle.sol";
import {OtterExecutionFixture} from "./utils/OtterExecutionFixture.sol";

/// @notice Core-backed curve evidence for the offline discrete laboratory.
/// Passing negative controls demonstrate candidate failures, not fixed auctions.
contract OtterDiscreteMechanismTest is OtterExecutionFixture {
    uint256 internal constant WAD = 1e18;

    function test_integerCurveCannotFundTwoZeroAskPivots() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1000);
        uint160 limit = TickMath.getSqrtPriceAtTick(-100);
        // These counterfactual quotes share the opening state, not the state
        // after the first swap. Removing either one-unit seller gives F(1)=0.
        OtterExecutionOracle.Quote memory alone = oracle.quoteExactInput(k, true, 1, limit);
        assertEq(uint8(alone.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(alone.consumedInput, 1);
        assertEq(alone.output, 0);
        OtterExecutionOracle.Quote memory together = _quoteAndSwap(k, true, 2, limit);
        assertEq(together.output, 1);
        uint256 pivot = together.output - alone.output;
        assertEq(pivot, 1);
        assertGt(2 * pivot, together.output, "raw pivot deficit, without rounding");
    }

    function test_integerIRAndRoundingDeficitsAtSameOptimalFill() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1000);
        uint160 limit = TickMath.getSqrtPriceAtTick(-100);
        uint256 alone = oracle.quoteExactInput(k, true, 1, limit).output;
        uint256 together = _quoteAndSwap(k, true, 2, limit).output;
        assertEq(alone, 0);
        assertEq(together, 1);
        // Two one-unit sellers at ask 0.1 maximize linear welfare by both
        // filling. Integer IR needs >=1 each, but there is only one output.
        uint256 positiveAsk = WAD / 10;
        uint256 welfare = together * WAD - 2 * positiveAsk;
        assertEq(welfare, 8e17);
        assertGt(welfare, 0);
        uint256 minimumEach = (positiveAsk + WAD - 1) / WAD;
        assertGt(2 * minimumEach, together, "no funded integer IR vector at these fills");
        // At ask 0.5 the quantity-maximizing zero-welfare tie fills both.
        // Each raw pivot is 0.5: flooring fails IR, ceiling needs two units.
        uint256 halfAsk = WAD / 2;
        uint256 halfWelfare = together * WAD - 2 * halfAsk;
        uint256 withoutWelfare = 0; // The remaining seller chooses zero input.
        uint256 pivotNumerator = halfAsk + halfWelfare - withoutWelfare;
        assertEq(halfWelfare, 0);
        assertEq(2 * pivotNumerator, together * WAD);
        assertLt(pivotNumerator / WAD, (halfAsk + WAD - 1) / WAD);
        assertGt(2 * ((pivotNumerator + WAD - 1) / WAD), together);
    }

    function test_refundOnDeficitDeviationCurveMatchesActualCore() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1000);
        uint160 limit = TickMath.getSqrtPriceAtTick(-100);
        assertEq(oracle.quoteExactInput(k, true, 1, limit).output, 0);
        assertEq(oracle.quoteExactInput(k, true, 2, limit).output, 1);
        OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, true, 3, limit);
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(q.consumedInput, 3);
        assertEq(q.output, 2);
        // Allocation/payments and the profitable rejected-fallback example
        // are independently enumerated in solver/test/discrete-research.ts.
    }

    function test_concaveRoundingExamplesAndFiniteCapacityMatchActualCore() public {
        uint160 price = SQRT_PRICE_1_1 * 3 / 2;
        uint160 broadLimit = TickMath.getSqrtPriceAtTick(TickMath.getTickAtSqrtPrice(price) - 100);
        PoolKey memory k = _pool(60, price);
        _fullRange(k, 1000);
        OtterExecutionOracle.Quote memory one = oracle.quoteExactInput(k, true, 1, broadLimit);
        assertEq(uint8(one.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(one.output, 2);
        uint256 openingState = vm.snapshotState();
        // A finite domain with only one consumable raw unit: never label the
        // output of this partial request as F(requested input 2).
        OtterExecutionOracle.Quote memory limited = _quoteAndSwap(k, true, 2, one.sqrtPriceX96);
        assertEq(uint8(limited.status), uint8(OtterExecutionOracle.Status.PriceLimit));
        assertEq(limited.requestedInput, 2);
        assertEq(limited.consumedInput, 1);
        assertEq(limited.output, 2);
        assertEq(limited.sqrtPriceX96, one.sqrtPriceX96);
        // Restore the exact opening state, then fix the limit to the final
        // price of a two-unit quote. Capacity is really two input units, not
        // an artificial cutoff used to make identity splitting profitable.
        assertTrue(vm.revertToStateAndDelete(openingState));
        assertEq(oracle.quoteExactInput(k, true, 1, broadLimit).output, 2);
        OtterExecutionOracle.Quote memory two = oracle.quoteExactInput(k, true, 2, broadLimit);
        assertEq(uint8(two.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(two.output, 4);
        OtterExecutionOracle.Quote memory overCapacity = _quoteAndSwap(k, true, 4, two.sqrtPriceX96);
        assertEq(uint8(overCapacity.status), uint8(OtterExecutionOracle.Status.PriceLimit));
        assertEq(overCapacity.consumedInput, 2);
        assertEq(overCapacity.output, 4);
    }
}
