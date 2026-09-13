// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";

/// @notice Covers `openBatchId`, which nothing else calls.
///
/// It is a public view helper for relayers and UIs — "which batch am I signing
/// into?" — so it is a real API, not dead weight. But it reimplements the rollover
/// arithmetic that `submit` performs through `_rollover`, and two copies of the
/// same rule drift. These tests pin them together: whatever `openBatchId` predicts
/// must be the batch `submit` actually writes to.
contract OtterOrderBookViewTest is Test {
    OtterOrderBook book;
    MockERC20 currency0;
    MockERC20 currency1;
    bytes32 constant POOL = bytes32(uint256(0xB0));
    uint64 constant WINDOW = 60;

    uint256 alicePk = 0xA11CE;
    address alice;

    function setUp() public {
        book = new OtterOrderBook(WINDOW, 900);
        book.setSettlement(address(0x5E77));
        alice = vm.addr(alicePk);

        currency0 = new MockERC20("TEST0", "T0", 18);
        currency1 = new MockERC20("TEST1", "T1", 18);
        vm.prank(address(0x5E77));
        book.registerPoolCurrencies(POOL, address(currency0), address(currency1));

        currency0.mint(alice, 100_000_000e18);
        vm.prank(alice);
        currency0.approve(address(book), type(uint256).max);
    }

    function _submit(uint256 nonce) internal returns (uint256 batchId, OtterOrderBook.Order[] memory os) {
        OtterOrderBook.Order memory o = OtterOrderBook.Order({
            trader: alice,
            poolId: POOL,
            sellingCurrency0: true,
            ask: 1e18,
            budget: 100e18,
            deadline: block.timestamp + 1 days,
            nonce: nonce
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, book.digestOf(o));
        os = new OtterOrderBook.Order[](1);
        bytes[] memory sigs = new bytes[](1);
        os[0] = o;
        sigs[0] = abi.encodePacked(r, s, v);
        batchId = book.submit(os, sigs);
    }

    function _consume(uint256 batchId, OtterOrderBook.Order[] memory os) internal {
        vm.prank(address(0x5E77));
        book.consume(POOL, batchId, os);
    }

    function _append(OtterOrderBook.Order[] memory existing, OtterOrderBook.Order[] memory one)
        internal
        pure
        returns (OtterOrderBook.Order[] memory all)
    {
        all = new OtterOrderBook.Order[](existing.length + 1);
        for (uint256 i; i < existing.length; ++i) all[i] = existing[i];
        all[existing.length] = one[0];
    }

    function test_predictsTheFirstBatch() public {
        (uint256 predicted, uint64 closesAt) = book.openBatchId(POOL);
        assertEq(closesAt, uint64(block.timestamp) + WINDOW, "window should close one length out");
        (uint256 submitted,) = _submit(0);
        assertEq(submitted, predicted, "openBatchId must name the batch submit writes to");
    }

    function test_predictsWithinAnOpenWindow() public {
        (uint256 first,) = _submit(0);
        vm.warp(block.timestamp + WINDOW / 2); // still open

        (uint256 predicted, uint64 closesAt) = book.openBatchId(POOL);
        assertEq(predicted, first, "an open window should not roll");
        (uint256 submitted,) = _submit(1);
        assertEq(submitted, predicted);
        assertGt(closesAt, block.timestamp, "an open window closes in the future");
    }

    function test_predictsTheRollover() public {
        (uint256 first, OtterOrderBook.Order[] memory firstOrders) = _submit(0);
        vm.warp(block.timestamp + WINDOW); // closed

        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.PreviousBatchUnsettled.selector, first));
        book.openBatchId(POOL);
        _consume(first, firstOrders);

        (uint256 predicted,) = book.openBatchId(POOL);
        assertEq(predicted, first + 1, "a closed window should roll to the next batch");
        (uint256 submitted,) = _submit(1);
        assertEq(submitted, predicted, "prediction must match what submit does");
    }

    /// The two implementations must agree across an arbitrary walk through time,
    /// not just at the boundaries someone thought to write a case for.
    function testFuzz_predictionMatchesSubmit(uint32[6] memory jumps) public {
        OtterOrderBook.Order[] memory activeOrders;
        for (uint256 i; i < jumps.length; ++i) {
            vm.warp(block.timestamp + bound(uint256(jumps[i]), 0, WINDOW * 3));
            uint256 previous = book.currentBatchId(POOL);
            (uint64 closesAt,, bool settled) = book.batches(POOL, previous);
            if (closesAt != 0 && block.timestamp >= closesAt && !settled) {
                // The preceding iteration submitted exactly one order; rebuild the
                // committed order from its saved array before opening a new batch.
                // Storing it makes this an exact replay, not a test-only shortcut.
                _consume(previous, activeOrders);
                activeOrders = new OtterOrderBook.Order[](0);
            }
            (uint256 predicted,) = book.openBatchId(POOL);
            (uint256 submitted, OtterOrderBook.Order[] memory submittedOrders) = _submit(i);
            assertEq(submitted, predicted, "openBatchId drifted from _rollover");
            activeOrders = _append(activeOrders, submittedOrders);
        }
    }
}
