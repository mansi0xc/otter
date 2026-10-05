// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterRewardMath} from "../src/OtterRewardMath.sol";
import {IOtterLiquidityGuard} from "../src/interfaces/IOtterLiquidityGuard.sol";

contract RewardMathHarness {
    function weight(uint160 price, int24 lower, int24 upper, uint128 liquidity) external pure returns (uint256) {
        return
            OtterRewardMath.weight(price, IOtterLiquidityGuard.PositionSnapshot(1, address(1), lower, upper, liquidity));
    }
}

contract OtterRewardMathTest is Test {
    RewardMathHarness h = new RewardMathHarness();

    function test_principalRoundingAndRangeCapitalDifferFromRawLiquidity() public view {
        uint160 p = uint160(1) << 96;
        assertEq(h.weight(p, -887272, 887272, 1), 0);
        assertLt(h.weight(p, -60, 60, 1e21), h.weight(p, -887272, 887272, 1e21));
        assertGt(h.weight(p, 60, 120, 1e21), 0);
        assertGt(h.weight(p, -120, -60, 1e21), 0);
    }

    function test_unsupportedRewardPriceRejected() public {
        vm.expectRevert(OtterRewardMath.UnsupportedRewardPrice.selector);
        h.weight((uint160(1) << 64) - 1, -60, 60, 1);
        vm.expectRevert(OtterRewardMath.UnsupportedRewardPrice.selector);
        h.weight(uint160(1) << 128, -60, 60, 1);
    }

    function testFuzz_exactCapitalValueMatchesIndependentBigInt(int24 rawTick, int24 a, int24 b, uint88 rawL) public {
        int24 tick = int24(bound(int256(rawTick), -400000, 400000));
        int24 lower = int24(bound(int256(a), -887272, 887271));
        int24 upper = int24(bound(int256(b), int256(lower) + 1, 887272));
        uint160 price = TickMath.getSqrtPriceAtTick(tick);
        string[] memory args = new string[](7);
        args[0] = "node";
        args[1] = "--experimental-strip-types";
        args[2] = "../solver/src/rewards-cli.ts";
        args[3] = vm.toString(price);
        args[4] = vm.toString(int256(lower));
        args[5] = vm.toString(int256(upper));
        args[6] = vm.toString(rawL);
        uint256 expected = abi.decode(vm.ffi(args), (uint256));
        assertEq(h.weight(price, lower, upper, rawL), expected);
    }
}
