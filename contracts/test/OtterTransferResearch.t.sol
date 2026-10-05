// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterExecutionOracle} from "../src/OtterExecutionOracle.sol";
import {OtterExecutionFixture} from "./utils/OtterExecutionFixture.sol";

/// @notice Anchor ALL raw input choices for the transfer-constraint witness.
/// No allocation mechanism, payment verifier or new lot policy is implemented.
contract OtterTransferResearchTest is OtterExecutionFixture {
    function test_everyRawFillStartsFromSameStateAndFourIsTheActualCapacity() public {
        uint160 price = SQRT_PRICE_1_1 * 3 / 2;
        PoolKey memory k = _pool(60, price);
        _fullRange(k, 1000);
        OtterExecutionOracle.Quote memory end =
            oracle.quoteExactInput(k, true, 4, TickMath.getSqrtPriceAtTick(TickMath.getTickAtSqrtPrice(price) - 1000));
        assertEq(uint8(end.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(end.sqrtPriceX96, 118_133_443_112_720_185_278_644_061_138);
        uint256 opening = vm.snapshotState();
        uint160[5] memory prices = [
            price,
            uint160(118_664_247_400_296_062_296_870_619_575),
            uint160(118_486_783_421_133_107_069_108_599_705),
            uint160(118_309_849_448_876_561_861_937_208_068),
            end.sqrtPriceX96
        ];
        for (uint256 q = 0; q <= 4; q++) {
            OtterExecutionOracle.Quote memory actual = _quoteAndSwap(k, true, q, end.sqrtPriceX96);
            assertEq(uint8(actual.status), uint8(OtterExecutionOracle.Status.Complete));
            assertEq(actual.consumedInput, q);
            assertEq(actual.output, 2 * q);
            assertEq(actual.sqrtPriceX96, prices[q]);
            assertTrue(vm.revertToState(opening));
        }
        OtterExecutionOracle.Quote memory excess = _quoteAndSwap(k, true, 5, end.sqrtPriceX96);
        assertEq(uint8(excess.status), uint8(OtterExecutionOracle.Status.PriceLimit));
        assertEq(excess.consumedInput, 4);
        assertEq(excess.output, 8);
        assertEq(excess.sqrtPriceX96, end.sqrtPriceX96);
        assertTrue(vm.revertToStateAndDelete(opening));
    }
}
