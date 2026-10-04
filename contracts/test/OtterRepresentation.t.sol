// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterExecutionFixture} from "./utils/OtterExecutionFixture.sol";

/// @notice Real-core neighboring integer quotes for rational-input diagnostics.
/// No fractional swap, compensation ledger or on-chain auction is implemented.
contract OtterRepresentationTest is OtterExecutionFixture {
    function test_neighboringWholeSwapsAtNineFourthsSpot() public {
        PoolKey memory k = _pool(60, SQRT_PRICE_1_1 * 3 / 2);
        _fullRange(k, 1000);
        uint160 downLimit = TickMath.getSqrtPriceAtTick(7000);
        uint160 upLimit = TickMath.getSqrtPriceAtTick(9000);
        // Dominant sells currency0: Q=1, minority supplies one currency1,
        // requiring 4/9 currency0. The residual 5/9 cannot be a core amount.
        assertEq(_quoteAndSwap(k, true, 0, downLimit).output, 0);
        uint256 opening = vm.snapshotState();
        assertEq(_quoteAndSwap(k, true, 1, downLimit).output, 2);
        assertTrue(vm.revertToStateAndDelete(opening));
        // Symmetric matching: Q=3 currency1, minority supplies one currency0,
        // requiring 9/4 currency1. Residual 3/4 is also fractional.
        assertEq(_quoteAndSwap(k, false, 0, upLimit).output, 0);
        assertEq(_quoteAndSwap(k, false, 1, upLimit).output, 0);
    }

    function test_neighboringWholeSwapsAtOrdinaryTickPrice() public {
        PoolKey memory k = _pool(60, TickMath.getSqrtPriceAtTick(1));
        _fullRange(k, 1000);
        uint160 limit = TickMath.getSqrtPriceAtTick(-1000);
        // Ten currency0 units minus the exact spot compensation for one
        // currency1 unit leaves a residual strictly between nine and ten.
        uint256 opening = vm.snapshotState();
        assertEq(_quoteAndSwap(k, true, 9, limit).output, 7);
        assertTrue(vm.revertToStateAndDelete(opening));
        assertEq(_quoteAndSwap(k, true, 10, limit).output, 8);
    }
}
