// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterExecutionOracle} from "../src/OtterExecutionOracle.sol";
import {OtterExecutionFixture} from "./utils/OtterExecutionFixture.sol";

/// @notice Actual core evidence for the two-sided offline lot candidate.
/// This does not implement or validate an on-chain auction or fractional claims.
contract OtterLotCandidateTest is OtterExecutionFixture {
    function test_bothLotCurvesHaveRealOneLotCapacity() public {
        uint160 price = SQRT_PRICE_1_1 * 3 / 2;
        int24 tick = TickMath.getTickAtSqrtPrice(price);
        PoolKey memory k = _pool(60, price);
        _fullRange(k, 1000);
        // Exact opening spot is 9/4: four currency0 units exchange for nine
        // currency1 units internally. The residual AMM exchange is worse.
        OtterExecutionOracle.Quote memory down =
            oracle.quoteExactInput(k, true, 4, TickMath.getSqrtPriceAtTick(tick - 1000));
        OtterExecutionOracle.Quote memory up =
            oracle.quoteExactInput(k, false, 9, TickMath.getSqrtPriceAtTick(tick + 1000));
        assertEq(uint8(down.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(uint8(up.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(down.output, 8);
        assertEq(up.output, 3);
        uint256 opening = vm.snapshotState();
        assertEq(_quoteAndSwap(k, true, 4, down.sqrtPriceX96).output, 8);
        assertTrue(vm.revertToState(opening));
        OtterExecutionOracle.Quote memory downExcess = _quoteAndSwap(k, true, 8, down.sqrtPriceX96);
        assertEq(uint8(downExcess.status), uint8(OtterExecutionOracle.Status.PriceLimit));
        assertEq(downExcess.consumedInput, 4);
        assertEq(downExcess.output, 8);
        assertTrue(vm.revertToState(opening));
        assertEq(_quoteAndSwap(k, false, 9, up.sqrtPriceX96).output, 3);
        assertTrue(vm.revertToStateAndDelete(opening));
        OtterExecutionOracle.Quote memory upExcess = _quoteAndSwap(k, false, 18, up.sqrtPriceX96);
        assertEq(uint8(upExcess.status), uint8(OtterExecutionOracle.Status.PriceLimit));
        assertEq(upExcess.consumedInput, 9);
        assertEq(upExcess.output, 3);
    }
}
