// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";

contract OtterOrderBookTest is Test {
    OtterOrderBook book;

    bytes32 constant POOL = bytes32(uint256(0xB0));
    bytes32 constant OTHER_POOL = bytes32(uint256(0xB1));
    uint64 constant WINDOW = 60;

    address settlement = address(0x5E77);
    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    address alice;
    address bob;

    function setUp() public {
        book = new OtterOrderBook(WINDOW);
        book.setSettlement(settlement);
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _order(address trader, uint256 nonce, bool sellingCurrency0)
        internal
        view
        returns (OtterOrderBook.Order memory)
    {
        return OtterOrderBook.Order({
            trader: trader,
            poolId: POOL,
            sellingCurrency0: sellingCurrency0,
            ask: 1e18,
            budget: 100e18,
            deadline: block.timestamp + 1 days,
            nonce: nonce
        });
    }

    function _sign(uint256 pk, OtterOrderBook.Order memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(o));
        return abi.encodePacked(r, s, v);
    }

    function _one(OtterOrderBook.Order memory o, bytes memory sig)
        internal
        pure
        returns (OtterOrderBook.Order[] memory os, bytes[] memory sigs)
    {
        os = new OtterOrderBook.Order[](1);
        sigs = new bytes[](1);
        os[0] = o;
        sigs[0] = sig;
    }

    // ------------------------------------------------------------------
    // constants
    // ------------------------------------------------------------------

    /// A wrong digit in the malleability bound does not fail loudly, it silently
    /// rejects valid signatures. Recompute it rather than trust it.
    function test_malleabilityBoundIsHalfCurveOrder() public view {
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        assertEq(book.MAX_S(), n / 2, "MAX_S must equal half the secp256k1 group order");
    }

    // ------------------------------------------------------------------
    // submission
    // ------------------------------------------------------------------

    function test_submitAndReplay() public {
        OtterOrderBook.Order memory a = _order(alice, 0, true);
        OtterOrderBook.Order memory b = _order(bob, 0, false);

        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        os[0] = a;
        os[1] = b;
        sigs[0] = _sign(alicePk, a);
        sigs[1] = _sign(bobPk, b);

        uint256 batchId = book.submit(os, sigs);
        (, uint32 count,) = book.batches(POOL, batchId);
        assertEq(count, 2);

        book.replay(POOL, batchId, os); // must not revert
    }

    function test_relayerMaySubmitOnBehalf() public {
        OtterOrderBook.Order memory a = _order(alice, 0, true);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(a, _sign(alicePk, a));

        vm.prank(address(0xDEADBEEF)); // not alice
        uint256 batchId = book.submit(os, sigs);
        book.replay(POOL, batchId, os);
    }

    function test_rejectsWrongSigner() public {
        OtterOrderBook.Order memory a = _order(alice, 0, true);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(a, _sign(bobPk, a));

        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BadSignature.selector, 0));
        book.submit(os, sigs);
    }

    /// Changing any signed field must invalidate the signature.
    function test_rejectsTamperedBudget() public {
        OtterOrderBook.Order memory a = _order(alice, 0, true);
        bytes memory sig = _sign(alicePk, a);
        a.budget = 999e18;
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(a, sig);

        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BadSignature.selector, 0));
        book.submit(os, sigs);
    }

    function test_rejectsNonceReuse() public {
        OtterOrderBook.Order memory a = _order(alice, 7, true);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(a, _sign(alicePk, a));
        book.submit(os, sigs);

        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.NonceUsed.selector, 0));
        book.submit(os, sigs);
    }

    function test_noncesAreIndependentPerTrader() public {
        OtterOrderBook.Order memory a = _order(alice, 7, true);
        OtterOrderBook.Order memory b = _order(bob, 7, true); // same nonce, different trader

        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        os[0] = a;
        os[1] = b;
        sigs[0] = _sign(alicePk, a);
        sigs[1] = _sign(bobPk, b);

        book.submit(os, sigs); // must not revert
    }

    function test_rejectsExpired() public {
        OtterOrderBook.Order memory a = _order(alice, 0, true);
        a.deadline = block.timestamp;
        bytes memory sig = _sign(alicePk, a);
        vm.warp(block.timestamp + 1);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(a, sig);

        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.OrderExpired.selector, 0));
        book.submit(os, sigs);
    }

    function test_rejectsMixedPools() public {
        OtterOrderBook.Order memory a = _order(alice, 0, true);
        OtterOrderBook.Order memory b = _order(bob, 0, true);
        b.poolId = OTHER_POOL;

        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        os[0] = a;
        os[1] = b;
        sigs[0] = _sign(alicePk, a);
        sigs[1] = _sign(bobPk, b);

        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.WrongPool.selector, 1));
        book.submit(os, sigs);
    }

    // ------------------------------------------------------------------
    // the inclusion guarantee
    // ------------------------------------------------------------------

    function _submitTwo() internal returns (uint256 batchId, OtterOrderBook.Order[] memory os) {
        OtterOrderBook.Order memory a = _order(alice, 0, true);
        OtterOrderBook.Order memory b = _order(bob, 0, false);
        os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        os[0] = a;
        os[1] = b;
        sigs[0] = _sign(alicePk, a);
        sigs[1] = _sign(bobPk, b);
        batchId = book.submit(os, sigs);
    }

    /// A settlement that drops a submitted order cannot pass replay.
    function test_replayRejectsOmittedOrder() public {
        (uint256 batchId, OtterOrderBook.Order[] memory os) = _submitTwo();

        OtterOrderBook.Order[] memory trimmed = new OtterOrderBook.Order[](1);
        trimmed[0] = os[0];

        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.CountMismatch.selector, 1, uint32(2)));
        book.replay(POOL, batchId, trimmed);
    }

    /// Nor one that reorders them, since the digest commits to a sequence.
    function test_replayRejectsReordering() public {
        (uint256 batchId, OtterOrderBook.Order[] memory os) = _submitTwo();

        OtterOrderBook.Order[] memory swapped = new OtterOrderBook.Order[](2);
        swapped[0] = os[1];
        swapped[1] = os[0];

        vm.expectRevert(OtterOrderBook.DigestMismatch.selector);
        book.replay(POOL, batchId, swapped);
    }

    /// Nor one that substitutes an order that was never signed or submitted.
    function test_replayRejectsInsertedOrder() public {
        (uint256 batchId, OtterOrderBook.Order[] memory os) = _submitTwo();

        OtterOrderBook.Order[] memory forged = new OtterOrderBook.Order[](2);
        forged[0] = os[0];
        forged[1] = os[1];
        forged[1].budget = 1_000_000e18; // solver invents a better order for itself

        vm.expectRevert(OtterOrderBook.DigestMismatch.selector);
        book.replay(POOL, batchId, forged);
    }

    // ------------------------------------------------------------------
    // windows and settlement
    // ------------------------------------------------------------------

    function test_windowRollsOver() public {
        OtterOrderBook.Order memory a = _order(alice, 0, true);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(a, _sign(alicePk, a));
        uint256 first = book.submit(os, sigs);

        vm.warp(block.timestamp + WINDOW);

        OtterOrderBook.Order memory b = _order(bob, 0, true);
        (OtterOrderBook.Order[] memory os2, bytes[] memory sigs2) = _one(b, _sign(bobPk, b));
        uint256 second = book.submit(os2, sigs2);

        assertEq(second, first + 1, "window should roll");
        (, uint32 c1,) = book.batches(POOL, first);
        (, uint32 c2,) = book.batches(POOL, second);
        assertEq(c1, 1);
        assertEq(c2, 1);
    }

    function test_consumeRequiresClosedWindow() public {
        (uint256 batchId, OtterOrderBook.Order[] memory os) = _submitTwo();

        vm.prank(settlement);
        vm.expectRevert(OtterOrderBook.WindowStillOpen.selector);
        book.consume(POOL, batchId, os);
    }

    function test_consumeOnlyBySettlement() public {
        (uint256 batchId, OtterOrderBook.Order[] memory os) = _submitTwo();
        vm.warp(block.timestamp + WINDOW);

        vm.expectRevert(OtterOrderBook.NotSettlement.selector);
        book.consume(POOL, batchId, os);
    }

    function test_consumeIsOneShot() public {
        (uint256 batchId, OtterOrderBook.Order[] memory os) = _submitTwo();
        vm.warp(block.timestamp + WINDOW);

        vm.prank(settlement);
        book.consume(POOL, batchId, os);

        vm.prank(settlement);
        vm.expectRevert(OtterOrderBook.AlreadySettled.selector);
        book.consume(POOL, batchId, os);
    }

    // ------------------------------------------------------------------
    // cost
    // ------------------------------------------------------------------

    /// Not an assertion, a measurement. This is the per-order submission cost that
    /// feeds the settlement gas curve; recording it here keeps it honest.
    function test_gas_submissionScaling() public {
        uint256[4] memory sizes = [uint256(1), 5, 25, 100];
        for (uint256 s; s < 4; ++s) {
            uint256 n = sizes[s];
            OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](n);
            bytes[] memory sigs = new bytes[](n);
            for (uint256 i; i < n; ++i) {
                uint256 pk = uint256(keccak256(abi.encode(s, i)));
                address t = vm.addr(pk);
                OtterOrderBook.Order memory o = _order(t, i, i % 2 == 0);
                os[i] = o;
                sigs[i] = _sign(pk, o);
            }
            uint256 before = gasleft();
            book.submit(os, sigs);
            uint256 used = before - gasleft();
            console2.log("orders", n);
            console2.log("  gas total   ", used);
            console2.log("  gas / order ", used / n);
            vm.warp(block.timestamp + WINDOW); // fresh batch each round
        }
    }
}
