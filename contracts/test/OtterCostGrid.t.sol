// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterExecutionOracle} from "../src/OtterExecutionOracle.sol";
import {OtterExecutionFixture} from "./utils/OtterExecutionFixture.sol";

/// @notice Real-core evidence for the WAD-preserving lot diagnostic only.
/// No integer-cost auction, production lot policy or new order format exists.
contract OtterCostGridTest is OtterExecutionFixture {
    function test_firstScaledResidualDestroysNextEpochLotAdmissibility() public {
        uint160 price = SQRT_PRICE_1_1 * 3 / 2;
        PoolKey memory k = _pool(60, price);
        _fullRange(k, 1000 * 1e18);
        // At exact spot 9/4, the minimum reciprocal lots whose cost is integer
        // for EVERY raw WAD ask are 4e18 and 9e18 underlying raw units.
        uint256 denominator = uint256(1) << 192;
        uint256 numerator = uint256(price) * price;
        uint256 divisor = _gcd(numerator, denominator);
        assertEq(denominator / divisor * 1e18, 4e18);
        assertEq(numerator / divisor * 1e18, 9e18);
        OtterExecutionOracle.Quote memory q =
            _quoteAndSwap(k, true, 4e18, TickMath.getSqrtPriceAtTick(TickMath.getTickAtSqrtPrice(price) - 1000));
        assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.Complete));
        assertEq(q.consumedInput, 4e18);
        assertEq(q.output, 8_946_322_067_594_433_399);
        // Independent BigInt fixture's exact ending price, rather than only
        // its integer output (neighboring prices could round to the same out).
        assertEq(q.sqrtPriceX96, 118_133_443_112_720_185_278_644_061_138);
        // _quoteAndSwap compared actual core deltas and final price/tick/L.
        // At that actual ending price, both smallest WAD-preserving exchange
        // lots exceed the entire uint96 input domain. A larger multiple cannot
        // restore admissibility. Values fit uint256 at this fixture price.
        numerator = uint256(q.sqrtPriceX96) * q.sqrtPriceX96;
        divisor = _gcd(numerator, denominator);
        assertEq(denominator / divisor, uint256(1) << 190);
        assertGt(denominator / divisor, type(uint96).max);
        assertGt(numerator / divisor, type(uint96).max);
        assertGt(denominator / divisor * 1e18, type(uint96).max);
        assertGt(numerator / divisor * 1e18, type(uint96).max);
    }

    function _gcd(uint256 a, uint256 b) private pure returns (uint256) {
        while (b != 0) {
            uint256 remainder = a % b;
            a = b;
            b = remainder;
        }
        return a;
    }
}
