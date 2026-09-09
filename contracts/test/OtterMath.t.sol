// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OtterMath} from "../src/OtterMath.sol";

contract OtterMathTest is Test {
    using OtterMath for OtterMath.Curve;

    uint256 constant WAD = 1e18;

    function _curve(uint256 x0, uint256 y0, uint256 M) internal pure returns (OtterMath.Curve memory) {
        return OtterMath.Curve({x0: x0, y0: y0, M: M});
    }

    // --- curve shape ------------------------------------------------------

    function test_fTilde_isLinearBelowM() public pure {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 1000e18);
        // sigma0 = 2, so F~(y) = 2y on [0, M]
        assertEq(OtterMath.fTildeDown(c, 100e18), 200e18);
        assertEq(OtterMath.fTildeDown(c, 1000e18), 2000e18);
    }

    function test_fTilde_continuousAtM() public pure {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 1000e18);
        uint256 atM = OtterMath.fTildeDown(c, c.M);
        uint256 justAbove = OtterMath.fTildeDown(c, c.M + 1);
        assertGe(justAbove, atM);
        assertLe(justAbove - atM, 2); // slope is 2, so one wei of input buys ~2 wei
    }

    function test_fTilde_concave() public pure {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 0);
        uint256 a = OtterMath.fTildeDown(c, 1000e18);
        uint256 b = OtterMath.fTildeDown(c, 2000e18);
        uint256 d = OtterMath.fTildeDown(c, 3000e18);
        assertGt(b - a, d - b); // decreasing marginal
    }

    /// The whole point of having two versions.
    function testFuzz_upNeverBelowDown(uint96 x0, uint96 y0, uint96 M, uint96 y) public pure {
        vm.assume(x0 > 1e6 && y0 > 1e6);
        OtterMath.Curve memory c = _curve(x0, y0, M);
        assertGe(OtterMath.fTildeUp(c, y), OtterMath.fTildeDown(c, y));
        assertGe(OtterMath.spotUp(c, y), OtterMath.spotDown(c, y));
    }

    /// Rounding must never let F~ exceed the reserve the pool actually holds.
    function testFuzz_fTildeBoundedByReserves(uint96 x0, uint96 y0, uint96 y) public pure {
        vm.assume(x0 > 1e6 && y0 > 1e6);
        OtterMath.Curve memory c = _curve(x0, y0, 0);
        assertLe(OtterMath.fTildeUp(c, y), uint256(x0));
    }

    // --- invariants -------------------------------------------------------

    function _oneFill(uint256 ask, uint256 budget, uint256 y, uint256 x)
        internal
        pure
        returns (OtterMath.Fill[] memory f)
    {
        f = new OtterMath.Fill[](1);
        f[0] = OtterMath.Fill({ask: ask, budget: budget, y: y, x: x});
    }

    function test_verify_acceptsSpotFillAtM() public pure {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 1000e18);
        // ask 1.5 (below sigma0 = 2), sells exactly M, paid slightly under spot
        OtterMath.Fill[] memory f = _oneFill(1.5e18, 1000e18, 1000e18, 1900e18);
        (uint256 totalIn, uint256 paid, uint256 burn) = OtterMath.verify(c, f);
        assertEq(totalIn, 1000e18);
        assertEq(paid, 1900e18);
        assertEq(burn, 100e18); // F~(M) = 2000, paid 1900
    }

    function test_verify_rejectsOverBudget() public {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 0);
        OtterMath.Fill[] memory f = _oneFill(1e18, 100e18, 101e18, 150e18);
        vm.expectRevert(abi.encodeWithSelector(OtterMath.BudgetExceeded.selector, 0));
        this.callVerify(c, f);
    }

    function test_verify_rejectsPaymentAboveSpot() public {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 0);
        // sigma0 = 2, so 100 in can never pay more than 200 out
        OtterMath.Fill[] memory f = _oneFill(1e18, 100e18, 100e18, 201e18);
        vm.expectRevert(abi.encodeWithSelector(OtterMath.PaymentExceedsSpot.selector, 0));
        this.callVerify(c, f);
    }

    function test_verify_rejectsIRViolation() public {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 0);
        // asked 1.5 per unit for 100 units, paid only 140
        OtterMath.Fill[] memory f = _oneFill(1.5e18, 100e18, 100e18, 140e18);
        vm.expectRevert(abi.encodeWithSelector(OtterMath.IndividualRationality.selector, 0));
        this.callVerify(c, f);
    }

    /// Fact 13. This is the invariant that fails first when the allocation's
    /// tie rule at equality is implemented as a strict inequality.
    function test_verify_rejectsQBelowM() public {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 1000e18);
        OtterMath.Fill[] memory f = _oneFill(1e18, 500e18, 500e18, 900e18);
        vm.expectRevert(abi.encodeWithSelector(OtterMath.DominanceViolated.selector, 500e18, 1000e18));
        this.callVerify(c, f);
    }

    /// Pushing payments high enough to make the burn negative always trips the
    /// per-user marginal bound first. With x0=1e24, y0=5e23, M=1e21 and two fills
    /// of 600e18 each: F~(1200e18) = 2399.840063974410235905e18 and each bound is
    /// that minus F~(600e18) = 1200e18, so 1199.840063974410235905e18.
    function test_verify_marginalBoundFiresBeforeBurn() public {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 1000e18);
        OtterMath.Fill[] memory f = new OtterMath.Fill[](2);
        f[0] = OtterMath.Fill({ask: 1e18, budget: 600e18, y: 600e18, x: 1199.9e18});
        f[1] = OtterMath.Fill({ask: 1e18, budget: 600e18, y: 600e18, x: 1199.9e18});
        vm.expectRevert(abi.encodeWithSelector(OtterMath.PaymentExceedsMarginal.selector, 0));
        this.callVerify(c, f);
    }

    /// One wei under the bound, same shape, passes with an exact burn.
    function test_verify_acceptsJustUnderMarginalBound() public pure {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 1000e18);
        OtterMath.Fill[] memory f = new OtterMath.Fill[](2);
        f[0] = OtterMath.Fill({ask: 1e18, budget: 600e18, y: 600e18, x: 1199e18});
        f[1] = OtterMath.Fill({ask: 1e18, budget: 600e18, y: 600e18, x: 1199e18});
        (uint256 totalIn, uint256 paid, uint256 burn) = OtterMath.verify(c, f);
        assertEq(totalIn, 1200e18);
        assertEq(paid, 2398e18);
        assertEq(burn, 1_840_063_974_410_235_905); // F~(1200e18) - 2398e18
    }

    /// Thm 12(c) is implied by the 12(b) bounds: F~ is concave with F~(0)=0, so
    /// F~(t)/t is nonincreasing, giving sum F~(Y-y_i) >= (n-1) F~(Y) and hence
    /// sum [F~(Y) - F~(Y-y_i)] <= F~(Y). The NegativeBurn revert is therefore
    /// unreachable, and is retained only to catch a future rounding-direction bug.
    /// If this fuzz ever fails, that revert has become load-bearing.
    function testFuzz_marginalBoundsImplyNonNegativeBurn(uint96 x0, uint96 y0, uint96 M, uint96[3] memory ys)
        public
        pure
    {
        vm.assume(x0 > 1e9 && y0 > 1e9);
        OtterMath.Curve memory c = _curve(x0, y0, M);

        uint256 Y;
        for (uint256 i; i < 3; ++i) Y += ys[i];
        vm.assume(Y > 0);

        uint256 available = OtterMath.fTildeDown(c, Y);
        uint256 sumBounds;
        for (uint256 i; i < 3; ++i) {
            uint256 sub = OtterMath.fTildeUp(c, Y - ys[i]);
            sumBounds += sub >= available ? 0 : available - sub;
        }
        assertLe(sumBounds, available);
    }

    function test_verify_unfilledOrderPasses() public pure {
        OtterMath.Curve memory c = _curve(1_000_000e18, 500_000e18, 1000e18);
        OtterMath.Fill[] memory f = new OtterMath.Fill[](2);
        f[0] = OtterMath.Fill({ask: 1e18, budget: 1000e18, y: 1000e18, x: 1900e18});
        f[1] = OtterMath.Fill({ask: 1.99e18, budget: 500e18, y: 0, x: 0}); // priced out
        (, , uint256 burn) = OtterMath.verify(c, f);
        assertEq(burn, 100e18);
    }

    /// external wrapper so vm.expectRevert sees a call boundary
    function callVerify(OtterMath.Curve memory c, OtterMath.Fill[] memory f)
        external
        pure
        returns (uint256, uint256, uint256)
    {
        return OtterMath.verify(c, f);
    }
}
