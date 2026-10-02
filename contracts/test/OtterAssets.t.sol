// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {MockLiquidityGuard} from "./utils/MockLiquidityGuard.sol";

contract AssetToken is MockERC20 {
    bool public noReturn;
    bool public fail;
    bool public tax;
    bool public senderFee;
    address public taxedSender;

    function configureTaxedSender(address account) external {
        taxedSender = account;
    }

    function configureSenderFee(bool enabled) external {
        senderFee = enabled;
    }
    constructor() MockERC20("Asset", "AST", 18) {}

    function configure(bool noReturn_, bool fail_, bool tax_) external {
        noReturn = noReturn_;
        fail = fail_;
        tax = tax_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (fail) return false;
        super.transferFrom(from, to, amount);
        if (senderFee && amount != 0 && (taxedSender == address(0) || taxedSender == from)) {
            balanceOf[from] -= 1;
            totalSupply -= 1;
        }
        if (tax && amount != 0 && (taxedSender == address(0) || taxedSender == from)) {
            balanceOf[to] -= 1;
            totalSupply -= 1;
        }
        if (noReturn) assembly ("memory-safe") { return(0, 0) }
        return true;
    }

    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        if (fail) return false;
        super.transfer(to, amount);
        if (senderFee && amount != 0 && (taxedSender == address(0) || taxedSender == msg.sender)) {
            balanceOf[msg.sender] -= 1;
            totalSupply -= 1;
        }
        if (tax && amount != 0 && (taxedSender == address(0) || taxedSender == msg.sender)) {
            balanceOf[to] -= 1;
            totalSupply -= 1;
        }
        if (noReturn) assembly ("memory-safe") { return(0, 0) }
        return true;
    }
}

contract RejectingAssetReceiver {
    receive() external payable {
        revert("reject ETH");
    }
}

contract ReentrantAssetReceiver {
    OtterOrderBook immutable book;
    bytes4 public rejectedWith;

    constructor(OtterOrderBook book_) {
        book = book_;
    }

    receive() external payable {
        try book.claim(address(0), 1, address(this)) {
            revert("reentry accepted");
        } catch (bytes memory reason) {
            rejectedWith = bytes4(reason);
        }
    }
}

contract OtterAssetsTest is Test {
    OtterOrderBook book;
    AssetToken token;
    address guard;
    address alice;
    address bob;
    uint256 constant ALICE_PK = 0xA11CE;
    uint256 constant BOB_PK = 0xB0B;
    bytes32 constant POOL = bytes32(uint256(1));
    bytes32 constant OTHER_POOL = bytes32(uint256(2));

    function setUp() public {
        book = new OtterOrderBook(60, 300);
        book.setSettlement(address(this));
        token = new AssetToken();
        guard = address(new MockLiquidityGuard());
        book.registerPoolCurrencies(POOL, address(0), address(token), guard);
        book.registerPoolCurrencies(OTHER_POOL, address(0), address(token), guard);
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        token.mint(alice, 100e18);
        token.mint(bob, 100e18);
        vm.prank(alice);
        token.approve(address(book), type(uint256).max);
        vm.prank(bob);
        token.approve(address(book), type(uint256).max);
        vm.deal(address(this), 100e18);
    }

    function _order(bool nativeInput, bytes32 pool, uint256 nonce, uint256 budget)
        internal
        view
        returns (OtterOrderBook.Order[] memory os, bytes[] memory sigs)
    {
        os = new OtterOrderBook.Order[](1);
        sigs = new bytes[](1);
        os[0] = OtterOrderBook.Order(alice, pool, nativeInput, 0, budget, block.timestamp + 1 days, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_PK, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
    }

    function _expire(OtterOrderBook.Order[] memory os) internal {
        vm.warp(block.timestamp + 360);
        book.refundExpired(os[0].poolId, book.currentBatchId(os[0].poolId), os);
    }

    function _consume(OtterOrderBook.Order[] memory os) internal {
        vm.warp(block.timestamp + 60);
        book.consume(os[0].poolId, book.currentBatchId(os[0].poolId), os);
    }

    function _assertBacked(address c) internal view {
        uint256 balance = c == address(0) ? address(book).balance : token.balanceOf(address(book));
        assertGe(balance, book.totalEscrow(c) + book.totalClaimable(c));
    }

    function test_nativeRegistrationUsesExplicitFlag() public {
        assertTrue(book.registered(POOL));
        assertEq(book.currency0Of(POOL), address(0));
        vm.expectRevert(OtterOrderBook.PoolAlreadyRegistered.selector);
        book.registerPoolCurrencies(POOL, address(0), address(token), guard);
        vm.expectRevert(OtterOrderBook.InvalidCurrencies.selector);
        book.registerPoolCurrencies(bytes32(uint256(3)), address(token), address(token), guard);
        vm.expectRevert(OtterOrderBook.InvalidCurrencies.selector);
        book.registerPoolCurrencies(bytes32(uint256(4)), address(0), address(0xBAD), guard);
    }

    function test_nativeValueMustBeExactAndForcedFundsDoNotFundOrders() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(true, POOL, 0, 2e18);
        vm.deal(address(book), 7e18); // models unsolicited/forced ETH
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.NativeValueMismatch.selector, 0, 2e18));
        book.submit(os, sigs);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.NativeValueMismatch.selector, 3e18, 2e18));
        book.submit{value: 3e18}(os, sigs);
        assertEq(book.nonceBitmap(alice, 0), 0);
        assertEq(book.totalEscrow(address(0)), 0);
        book.submit{value: 2e18}(os, sigs);
        _expire(os);
        assertEq(book.claimable(alice, address(0)), 2e18);
        assertEq(book.totalClaimable(address(0)), 2e18);
    }

    function test_nativeRelayRefundBelongsToSignedTrader() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(true, POOL, 0, 2e18);
        address relayer = address(0xF00D);
        vm.deal(relayer, 2e18);
        vm.prank(relayer);
        book.submit{value: 2e18}(os, sigs);
        _expire(os);
        assertEq(book.claimable(relayer, address(0)), 0);
        assertEq(book.claimable(alice, address(0)), 2e18);
        vm.expectRevert(OtterOrderBook.InvalidClaim.selector);
        book.claim(address(0), 2e18, relayer);
        vm.prank(alice);
        book.claim(address(0), 2e18, alice);
        assertEq(alice.balance, 2e18);
        vm.prank(alice);
        vm.expectRevert(OtterOrderBook.InvalidClaim.selector);
        book.claim(address(0), 1, alice);
    }

    function test_mixedNativeAndERC20SubmissionFundsBothExactly() public {
        (OtterOrderBook.Order[] memory nativeOrder, bytes[] memory nativeSig) = _order(true, POOL, 0, 2e18);
        (OtterOrderBook.Order[] memory ercOrder, bytes[] memory ercSig) = _order(false, POOL, 1, 3e18);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        os[0] = nativeOrder[0];
        os[1] = ercOrder[0];
        sigs[0] = nativeSig[0];
        sigs[1] = ercSig[0];
        book.submit{value: 2e18}(os, sigs);
        assertEq(book.totalEscrow(address(0)), 2e18);
        assertEq(book.totalEscrow(address(token)), 3e18);
        _expire(os);
        assertEq(book.totalEscrow(address(0)), 0);
        assertEq(book.totalEscrow(address(token)), 0);
        assertEq(book.claimable(alice, address(0)), 2e18);
        assertEq(book.claimable(alice, address(token)), 3e18);
        _assertBacked(address(0));
        _assertBacked(address(token));
    }

    function test_zeroTraderCannotMatchFailedRecovery() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(true, POOL, 0, 2e18);
        os[0].trader = address(0);
        sigs[0] = "";
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.InvalidTrader.selector, 0));
        book.submit{value: 2e18}(os, sigs);
    }

    function test_optionalReturnTokenRoundTrip() public {
        token.configure(true, false, false);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(false, POOL, 0, 2e18);
        book.submit(os, sigs);
        _expire(os);
        vm.prank(alice);
        book.claim(address(token), 2e18, alice);
        assertEq(token.balanceOf(alice), 100e18);
    }

    function test_taxedAndFalseReturnDepositsRollBackNonceAndCommitment() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(false, POOL, 0, 2e18);
        token.configure(false, false, true);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.InexactTransfer.selector, address(token), 2e18));
        book.submit(os, sigs);
        token.configure(false, true, false);
        vm.expectRevert(bytes("TRANSFER_FROM_FAILED"));
        book.submit(os, sigs);
        assertEq(book.nonceBitmap(alice, 0), 0);
        (, uint32 count,) = book.batches(POOL, 0);
        assertEq(count, 0);
        assertEq(book.batchDigest(POOL, 0), 0);
        assertEq(book.totalEscrow(address(token)), 0);
        assertEq(token.balanceOf(alice), 100e18);
    }

    function test_senderFeeWithExactReceiptIsRejectedBeforeAdmission() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(false, POOL, 0, 2e18);
        token.configureSenderFee(true);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.InexactTransfer.selector, address(token), 2e18));
        book.submit(os, sigs);
        assertEq(token.balanceOf(alice), 100e18);
        assertEq(book.totalEscrow(address(token)), 0);
        assertEq(book.nonceBitmap(alice, 0), 0);
    }

    function test_lateTokenTaxOnlyBlocksItsOwnWithdrawalAndCannotSpendNativeClaims() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(false, POOL, 0, 2e18);
        book.submit(os, sigs);
        (OtterOrderBook.Order[] memory nativeOs, bytes[] memory nativeSigs) = _order(true, OTHER_POOL, 1, 3e18);
        book.submit{value: 3e18}(nativeOs, nativeSigs);
        _expire(os);
        book.refundExpired(OTHER_POOL, 0, nativeOs);
        token.configure(false, false, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.InexactTransfer.selector, address(token), 2e18));
        book.claim(address(token), 2e18, alice);
        assertEq(book.claimable(alice, address(token)), 2e18);
        vm.prank(alice);
        book.claim(address(0), 3e18, alice);
        assertEq(alice.balance, 3e18);
        token.configure(false, false, false);
        vm.prank(alice);
        book.claim(address(token), 2e18, alice);
        _assertBacked(address(0));
        _assertBacked(address(token));
    }

    function test_failedNativeReceiverKeepsClaimAndAnotherOwnerCanWithdraw() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(true, POOL, 0, 2e18);
        (OtterOrderBook.Order[] memory bobOs, bytes[] memory bobSigs) = _order(true, OTHER_POOL, 0, 3e18);
        bobOs[0].trader = bob;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BOB_PK, book.digestOf(bobOs[0]));
        bobSigs[0] = abi.encodePacked(r, s, v);
        book.submit{value: 2e18}(os, sigs);
        book.submit{value: 3e18}(bobOs, bobSigs);
        _expire(os);
        book.refundExpired(OTHER_POOL, 0, bobOs);
        address rejector = address(new RejectingAssetReceiver());
        vm.prank(alice);
        vm.expectRevert(OtterOrderBook.NativeTransferFailed.selector);
        book.claim(address(0), 2e18, rejector);
        assertEq(book.claimable(alice, address(0)), 2e18);
        vm.prank(bob);
        book.claim(address(0), 3e18, bob);
        vm.prank(alice);
        book.claim(address(0), 2e18, address(0xCAFE));
        assertEq(bob.balance, 3e18);
        assertEq(address(0xCAFE).balance, 2e18);
        assertEq(book.totalClaimable(address(0)), 0);
    }

    function test_nativeClaimCallbackCannotReenter() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(true, POOL, 0, 2e18);
        book.submit{value: 2e18}(os, sigs);
        _expire(os);
        ReentrantAssetReceiver receiver = new ReentrantAssetReceiver(book);
        vm.prank(alice);
        book.claim(address(0), 2e18, address(receiver));
        assertEq(receiver.rejectedWith(), OtterOrderBook.ReentrantCall.selector);
        assertEq(book.totalClaimable(address(0)), 0);
    }

    function test_releaseAndPayoutAreOneShotAndCompletionRequiresFundedOutputs() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(false, POOL, 0, 2e18);
        book.submit(os, sigs);
        uint256[] memory filled = new uint256[](1);
        filled[0] = 1e18;
        vm.expectRevert(OtterOrderBook.NotExecuting.selector);
        book.releaseFilled(POOL, os, filled);
        _consume(os);
        vm.expectRevert(OtterOrderBook.NotExecuting.selector);
        book.completeExecution(POOL);
        filled[0] = 3e18;
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BudgetExceeded.selector, 0));
        book.releaseFilled(POOL, os, filled);
        filled[0] = 1e18;
        book.releaseFilled(POOL, os, filled);
        vm.expectRevert(OtterOrderBook.AlreadyReleased.selector);
        book.releaseFilled(POOL, os, filled);
        assertEq(book.claimable(alice, address(token)), 1e18);
        assertEq(token.balanceOf(address(this)), 1e18);
        assertEq(book.totalEscrow(address(token)), 0);
        uint256[] memory outputs = new uint256[](1);
        outputs[0] = 4e17;
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.NativeValueMismatch.selector, 0, 4e17));
        book.creditPayouts(POOL, os, outputs);
        book.creditPayouts{value: 4e17}(POOL, os, outputs);
        vm.expectRevert(OtterOrderBook.AlreadyCredited.selector);
        book.creditPayouts(POOL, os, outputs);
        book.completeExecution(POOL);
        assertFalse(book.isBatchActive(POOL));
        assertEq(book.claimable(alice, address(0)), 4e17);
        _assertBacked(address(0));
        _assertBacked(address(token));
    }

    function test_payoutPullRequiresExactERC20Receipt() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(true, POOL, 0, 2e18);
        book.submit{value: 2e18}(os, sigs);
        _consume(os);
        uint256[] memory filled = new uint256[](1);
        filled[0] = 2e18;
        book.releaseFilled(POOL, os, filled);
        token.mint(address(this), 2e18);
        token.approve(address(book), 2e18);
        uint256[] memory outputs = new uint256[](1);
        outputs[0] = 2e18;
        token.configure(false, false, true);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.InexactTransfer.selector, address(token), 2e18));
        book.creditPayouts(POOL, os, outputs);
        assertFalse(book.payoutsCredited(POOL, 0));
        assertEq(book.claimable(alice, address(token)), 0);
        token.configure(true, false, false);
        book.creditPayouts(POOL, os, outputs);
        book.completeExecution(POOL);
        assertEq(book.claimable(alice, address(token)), 2e18);
    }

    function testFuzz_crossPoolEscrowAndClaimConservation(uint96 rawA, uint96 rawB, uint96 rawClaim) public {
        uint256 a = bound(rawA, 1, 10e18);
        uint256 b = bound(rawB, 1, 10e18);
        uint256 withdrawn = bound(rawClaim, 1, a);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _order(true, POOL, 0, a);
        (OtterOrderBook.Order[] memory other, bytes[] memory otherSigs) = _order(true, OTHER_POOL, 1, b);
        book.submit{value: a}(os, sigs);
        book.submit{value: b}(other, otherSigs);
        _expire(os);
        vm.prank(alice);
        book.claim(address(0), withdrawn, alice);
        assertEq(book.totalEscrow(address(0)), b);
        assertEq(book.totalClaimable(address(0)), a - withdrawn);
        assertEq(address(book).balance, b + a - withdrawn);
        book.refundExpired(OTHER_POOL, 0, other);
        vm.prank(alice);
        book.claim(address(0), a - withdrawn + b, alice);
        assertEq(address(book).balance, 0);
        _assertBacked(address(0));
    }
    receive() external payable {}
}
