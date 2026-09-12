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
        book = new OtterOrderBook(WINDOW);
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

    function _submit(uint256 nonce) internal returns (uint256) {
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
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        bytes[] memory sigs = new bytes[](1);
        os[0] = o;
        sigs[0] = abi.encodePacked(r, s, v);
        return book.submit(os, sigs);
    }

    function test_predictsTheFirstBatch() public {
        (uint256 predicted, uint64 closesAt) = book.openBatchId(POOL);
        assertEq(closesAt, uint64(block.timestamp) + WINDOW, "window should close one length out");
        assertEq(_submit(0), predicted, "openBatchId must name the batch submit writes to");
    }

    function test_predictsWithinAnOpenWindow() public {
        uint256 first = _submit(0);
        vm.warp(block.timestamp + WINDOW / 2); // still open

        (uint256 predicted, uint64 closesAt) = book.openBatchId(POOL);
        assertEq(predicted, first, "an open window should not roll");
        assertEq(_submit(1), predicted);
        assertGt(closesAt, block.timestamp, "an open window closes in the future");
    }

    function test_predictsTheRollover() public {
        uint256 first = _submit(0);
        vm.warp(block.timestamp + WINDOW); // closed

        (uint256 predicted,) = book.openBatchId(POOL);
        assertEq(predicted, first + 1, "a closed window should roll to the next batch");
        assertEq(_submit(1), predicted, "prediction must match what submit does");
    }

    /// The two implementations must agree across an arbitrary walk through time,
    /// not just at the boundaries someone thought to write a case for.
    function testFuzz_predictionMatchesSubmit(uint32[6] memory jumps) public {
        for (uint256 i; i < jumps.length; ++i) {
            vm.warp(block.timestamp + bound(uint256(jumps[i]), 0, WINDOW * 3));
            (uint256 predicted,) = book.openBatchId(POOL);
            assertEq(_submit(i), predicted, "openBatchId drifted from _rollover");
        }
    }
}
