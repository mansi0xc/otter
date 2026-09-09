// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {OtterMath} from "../src/OtterMath.sol";

/// @title CrossCheckTest
/// @notice Asserts that OtterMath.verify agrees with solver/src/fixed.ts — the
///         BigInt mirror — on every vector under fixtures/vectors/.
///
/// This is the test that matters. OtterMath.t.sol checks cases a human wrote,
/// which means it checks the cases a human thought of. These vectors sit on the
/// boundaries: payments exactly at their ceiling, one wei under, one wei over,
/// exactly at the IR floor. A rounding direction flipped in fTildeDown or
/// fTildeUp moves a boundary by one wei and shows up here and nowhere else.
///
/// Regenerate with `cd solver && npm run vectors`, and commit the result.
///
/// Two structural notes, both learned the hard way:
///
///  1. One file per vector, not one large fixture. Every cheatcode call copies
///     the JSON string it is given into fresh memory, so re-passing a 220KB
///     fixture to ~2000 calls costs quadratic memory expansion and exhausts the
///     test's gas.
///  2. `runCase` is external and invoked through `this`. Solidity never frees
///     memory, so reading 150 vectors inside one frame accumulates all of it.
///     An external self-call gives each vector a fresh memory frame.
contract CrossCheckTest is Test {
    using stdJson for string;

    // must match the constants in solver/src/fixed.ts
    uint256 constant OK = 0;
    uint256 constant ERR_BUDGET = 1;
    uint256 constant ERR_SPOT = 2;
    uint256 constant ERR_MARGINAL = 3;
    uint256 constant ERR_IR = 4;
    uint256 constant ERR_DOMINANCE = 5;
    uint256 constant ERR_BURN = 6;

    string constant DIR = "../fixtures/vectors/";

    function test_solidityAgreesWithReferenceVerifier() public {
        string memory index = vm.readFile(string.concat(DIR, "index.json"));
        uint256 count = index.readUint(".count");
        assertGt(count, 0, "no vectors: run `cd solver && npm run vectors`");

        uint256 accepted;
        uint256 rejected;
        for (uint256 i; i < count; ++i) {
            if (this.runCase(i)) accepted++;
            else rejected++;
        }

        console2.log("vectors checked", count);
        console2.log("  accepted     ", accepted);
        console2.log("  rejected     ", rejected);

        // A fixture that drifted to all-accepts or all-rejects would otherwise
        // pass while testing nothing.
        assertGt(accepted, 0, "fixture contains no accepting vectors");
        assertGt(rejected, 0, "fixture contains no rejecting vectors");
    }

    /// @dev external on purpose — see note 2 above.
    function runCase(uint256 i) external returns (bool acceptedCase) {
        string memory j = vm.readFile(string.concat(DIR, vm.toString(i), ".json"));
        string memory name = j.readString(".name");

        OtterMath.Curve memory c =
            OtterMath.Curve({x0: j.readUint(".x0"), y0: j.readUint(".y0"), M: j.readUint(".M")});

        uint256[] memory ask = j.readUintArray(".ask");
        uint256[] memory budget = j.readUintArray(".budget");
        uint256[] memory ys = j.readUintArray(".y");
        uint256[] memory xs = j.readUintArray(".x");

        OtterMath.Fill[] memory fills = new OtterMath.Fill[](ask.length);
        for (uint256 k; k < ask.length; ++k) {
            fills[k] = OtterMath.Fill({ask: ask[k], budget: budget[k], y: ys[k], x: xs[k]});
        }

        uint256 code = j.readUint(".code");

        if (code == OK) {
            (uint256 totalIn, uint256 totalPaid, uint256 burn) = OtterMath.verify(c, fills);
            assertEq(totalIn, j.readUint(".totalIn"), name);
            assertEq(totalPaid, j.readUint(".totalPaid"), name);
            assertEq(burn, j.readUint(".burn"), name);
            return true;
        }

        _expectRevertFor(code, j.readUint(".index"), j.readUint(".arg0"), j.readUint(".arg1"));
        this.callVerify(c, fills);
        return false;
    }

    /// Every error is matched on its FULL revert payload, not just a selector:
    /// per-fill errors carry the offending index, so "right error, wrong fill"
    /// fails, and the two batch-level errors carry the arguments the mirror
    /// recorded. `vm.expectRevert(bytes4)` compares revert data exactly rather
    /// than by prefix, so a selector alone would never match a two-argument error.
    function _expectRevertFor(uint256 code, uint256 idx, uint256 a0, uint256 a1) internal {
        if (code == ERR_BUDGET) {
            vm.expectRevert(abi.encodeWithSelector(OtterMath.BudgetExceeded.selector, idx));
        } else if (code == ERR_SPOT) {
            vm.expectRevert(abi.encodeWithSelector(OtterMath.PaymentExceedsSpot.selector, idx));
        } else if (code == ERR_MARGINAL) {
            vm.expectRevert(abi.encodeWithSelector(OtterMath.PaymentExceedsMarginal.selector, idx));
        } else if (code == ERR_IR) {
            vm.expectRevert(abi.encodeWithSelector(OtterMath.IndividualRationality.selector, idx));
        } else if (code == ERR_DOMINANCE) {
            vm.expectRevert(abi.encodeWithSelector(OtterMath.DominanceViolated.selector, a0, a1));
        } else if (code == ERR_BURN) {
            vm.expectRevert(abi.encodeWithSelector(OtterMath.NegativeBurn.selector, a0, a1));
        } else {
            revert("unknown error code in fixture");
        }
    }

    function callVerify(OtterMath.Curve memory c, OtterMath.Fill[] memory f)
        external
        pure
        returns (uint256, uint256, uint256)
    {
        return OtterMath.verify(c, f);
    }
}
