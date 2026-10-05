// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IOtterLiquidityGuard} from "./interfaces/IOtterLiquidityGuard.sol";

/// @notice Opening principal value in currency1 raw units. Fees/rewards are
/// excluded. This prototype policy is not a proof of LP incentive compatibility.
library OtterRewardMath {
    error UnsupportedRewardPrice();

    function weight(uint160 price, IOtterLiquidityGuard.PositionSnapshot memory p) internal pure returns (uint256) {
        if (price < uint160(1) << 64 || price >= uint160(1) << 128) revert UnsupportedRewardPrice();
        uint160 lower = TickMath.getSqrtPriceAtTick(p.tickLower);
        uint160 upper = TickMath.getSqrtPriceAtTick(p.tickUpper);
        require(lower < upper, "reward range");
        uint256 amount0;
        uint256 amount1;
        // Rounded-down removable principal, not rounded-up deposit debt or
        // virtual reserves. Clamping handles inactive ranges without raw-L weights.
        if (price < upper) {
            amount0 = SqrtPriceMath.getAmount0Delta(price > lower ? price : lower, upper, p.liquidity, false);
        }
        if (price > lower) {
            amount1 = SqrtPriceMath.getAmount1Delta(lower, price < upper ? price : upper, p.liquidity, false);
        }
        // Selected price domain makes its square representable; mulDiv retains
        // the wide amount0 * price^2 product rather than prematurely rounding spot.
        return amount1 + FullMath.mulDiv(amount0, uint256(price) * price, uint256(1) << 192);
    }
}
