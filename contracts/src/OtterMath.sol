// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

/// @title OtterMath
/// @notice Fixed-point port of the augmented compensation curve F~ and the
///         feasibility invariants of Theorem 12(a)-(c) from eprint 2026/1877.
///
/// Everything here is raw token units. Only `ask` carries a scale: it is a price
/// of the input token denominated in the output token, WAD-scaled.
///
/// Rounding discipline (plan.md standing rule: round against the party being paid).
/// Users are paid the output token, so:
///   - anything bounding what a user MAY receive is rounded DOWN
///   - anything a user MUST have earned is rounded UP
/// Every quantity therefore exists in a Down and an Up form. Never mix them: a
/// bound computed with the wrong direction can accept an infeasible settlement
/// that the reference solver would have rejected, and nothing downstream notices.
library OtterMath {
    using FixedPointMathLib for uint256;

    uint256 internal constant WAD = 1e18;

    /// @param x0 reserve of the token the dominant side RECEIVES
    /// @param y0 reserve of the token the dominant side SUPPLIES
    /// @param M  crossing length rho0 * D_X, in input-token units
    struct Curve {
        uint256 x0;
        uint256 y0;
        uint256 M;
    }

    /// One dominant-side order and the outcome the solver proposes for it.
    struct Fill {
        uint256 ask; // v~_i, WAD-scaled
        uint256 budget; // q~_i, input units
        uint256 y; // y*_i, input sold
        uint256 x; // x*_i, output paid
    }

    /// @notice Discretisation allowance, numerator over 1e6 of price impact.
    /// @dev The paper's F~ is continuous and is evaluated once, rounded once. v4
    ///      derives the new sqrtPrice from the input and then the output from the
    ///      price delta, rounding in the pool's favour at each, on a Q64.96 grid.
    ///      v4 therefore pays slightly LESS than F~ predicts, and the shortfall
    ///      grows with price impact — measured at roughly 1 wei per 1.2% of
    ///      impact, 9 wei at 11% impact (see test/CurveSweep.t.sol).
    ///
    ///      200/1e6 gives ceil(impact_ppm * 200 / 1e6) + 2, which covers every
    ///      measured point with at least 1.5x margin. On a 10e18 trade at 10%
    ///      impact that is 22 wei, or 2e-16% of the trade.
    ///
    ///      This is a fixed function of the batch's own size, not of any bidder's
    ///      report, so it does not create an outcome-dependent transfer and leaves
    ///      incentive compatibility intact (cf. Theorem 22 on builder payments).
    ///      It does shave individual rationality at the very margin: a bidder
    ///      whose ask exactly equals its compensation could be underpaid by up to
    ///      the allowance. Stated in the README rather than buried.
    uint256 internal constant IMPACT_ALLOWANCE_NUM = 200;
    uint256 internal constant ALLOWANCE_FLOOR = 2;

    error BudgetExceeded(uint256 i);
    error PaymentExceedsSpot(uint256 i);
    error PaymentExceedsMarginal(uint256 i);
    error IndividualRationality(uint256 i);
    error DominanceViolated(uint256 totalIn, uint256 M);
    error NegativeBurn(uint256 paid, uint256 available);

    // ------------------------------------------------------------------
    // Curve
    // ------------------------------------------------------------------

    /// sigma0 * y, rounded down. sigma0 = x0 / y0.
    function spotDown(Curve memory c, uint256 y) internal pure returns (uint256) {
        return FixedPointMathLib.mulDivDown(c.x0, y, c.y0);
    }

    /// sigma0 * y, rounded up.
    function spotUp(Curve memory c, uint256 y) internal pure returns (uint256) {
        return FixedPointMathLib.mulDivUp(c.x0, y, c.y0);
    }

    /// @notice F~(y), rounded down. Eq. (12).
    ///         F~(y) = sigma0*y                        for y <= M
    ///         F~(y) = sigma0*M + (x0 - k/(y0+y-M))    for y >= M,  k = x0*y0
    /// @dev k is never materialised; mulDiv carries the 512-bit intermediate.
    function fTildeDown(Curve memory c, uint256 y) internal pure returns (uint256) {
        if (y <= c.M) return spotDown(c, y);
        uint256 z = y - c.M;
        // subtracting a term rounded UP rounds the whole expression DOWN
        uint256 rem = FixedPointMathLib.mulDivUp(c.x0, c.y0, c.y0 + z);
        if (rem > c.x0) rem = c.x0; // unreachable for z >= 0; belt and braces
        return spotDown(c, c.M) + (c.x0 - rem);
    }

    /// @notice F~(y), rounded up.
    function fTildeUp(Curve memory c, uint256 y) internal pure returns (uint256) {
        if (y <= c.M) return spotUp(c, y);
        uint256 z = y - c.M;
        uint256 rem = FixedPointMathLib.mulDivDown(c.x0, c.y0, c.y0 + z);
        if (rem > c.x0) rem = c.x0;
        return spotUp(c, c.M) + (c.x0 - rem);
    }

    /// @notice Wei that must be held back from F~(y) to stay within what v4 will
    ///         actually pay. Zero below M, where no pool swap happens at all.
    function discretisationAllowance(Curve memory c, uint256 y) internal pure returns (uint256) {
        if (y <= c.M) return 0;
        return FixedPointMathLib.mulDivUp(y - c.M, IMPACT_ALLOWANCE_NUM, c.y0) + ALLOWANCE_FLOOR;
    }

    /// @notice F~(y) rounded down and reduced by the discretisation allowance.
    ///         This — not fTildeDown — is what bounds real payments. fTildeDown
    ///         remains the faithful port of the paper's curve, for the reference
    ///         mirror and for reasoning about the mechanism itself.
    function fTildeSettleable(Curve memory c, uint256 y) internal pure returns (uint256) {
        uint256 raw = fTildeDown(c, y);
        uint256 allow = discretisationAllowance(c, y);
        return raw > allow ? raw - allow : 0;
    }

    /// @notice Eligibility: ask <= sigma0, i.e. ask*y0 <= x0*WAD.
    function eligible(Curve memory c, uint256 ask) internal pure returns (bool) {
        return FixedPointMathLib.mulDivUp(ask, c.y0, WAD) <= c.x0;
    }

    // ------------------------------------------------------------------
    // Invariants
    // ------------------------------------------------------------------

    /// @notice Verify the solver's proposed dominant-side outcome and return the burn.
    /// @dev Two passes: the marginal bound in Thm 12(b) needs the batch total Y*,
    ///      so it cannot be checked while accumulating. Both passes are O(n).
    ///
    ///      What this does NOT check: that the allocation maximises welfare. That is
    ///      asserted by the solver. Stated in the README as a known limitation.
    function verify(Curve memory c, Fill[] memory fills)
        internal
        pure
        returns (uint256 totalIn, uint256 totalPaid, uint256 burn)
    {
        uint256 n = fills.length;

        for (uint256 i; i < n; ++i) {
            Fill memory f = fills[i];

            // Thm 12(a): 0 <= y*_i <= q~_i
            if (f.y > f.budget) revert BudgetExceeded(i);

            // Thm 12(b), weaker half: x*_i <= sigma0 * y*_i
            if (f.x > spotDown(c, f.y)) revert PaymentExceedsSpot(i);

            // Individual rationality: x*_i >= v~_i * y*_i.
            // Rounded UP so IR must hold even on the pessimistic estimate of what
            // the user claimed the sale was worth.
            if (f.x < FixedPointMathLib.mulDivUp(f.ask, f.y, WAD)) {
                revert IndividualRationality(i);
            }

            totalIn += f.y;
            totalPaid += f.x;
        }

        // Fact 13: Q_Y >= M. If this fails the minority side cannot be paid in full
        // and the settlement is infeasible. Off-chain this is the invariant that
        // breaks first when the allocation's tie rule at equality is wrong.
        if (totalIn < c.M) revert DominanceViolated(totalIn, c.M);

        uint256 available = fTildeSettleable(c, totalIn);

        // Thm 12(b), sharp half: x*_i <= F~(Y*) - F~(Y* - y*_i)
        for (uint256 i; i < n; ++i) {
            Fill memory f = fills[i];
            // `available` is rounded down and the subtrahend up, so for small y*_i
            // the two can cross. Clamp rather than let 0.8 panic on underflow: a
            // bound of 0 is the correct conservative answer, and an unfilled order
            // (y*_i = 0, x*_i = 0) still passes it.
            uint256 sub = fTildeUp(c, totalIn - f.y);
            uint256 bound = sub >= available ? 0 : available - sub;
            if (f.x > bound) revert PaymentExceedsMarginal(i);
        }

        // Thm 12(c): sum x*_i <= F~(Q_Y). Equivalently B_X >= 0.
        //
        // This is implied by the 12(b) bounds above and cannot fire as written.
        // F~ is concave with F~(0) = 0, so F~(t)/t is nonincreasing and
        // F~(Y* - y*_i) >= ((Y* - y*_i)/Y*) * F~(Y*). Summing over i gives
        // sum F~(Y* - y*_i) >= (n-1) F~(Y*), hence
        // sum [F~(Y*) - F~(Y* - y*_i)] <= F~(Y*).
        // Verified against this exact fixed-point implementation over 300k random
        // batches: sum(bounds) - F~(Y*) never exceeded 0.
        //
        // Kept deliberately. It is one comparison, and it is the check that would
        // catch a rounding direction being flipped in fTildeDown/fTildeUp later.
        // See testFuzz_marginalBoundsImplyNonNegativeBurn.
        if (totalPaid > available) revert NegativeBurn(totalPaid, available);

        burn = available - totalPaid;
    }
}
