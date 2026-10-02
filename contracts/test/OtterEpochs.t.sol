// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {MockLiquidityGuard} from "./utils/MockLiquidityGuard.sol";

contract EpochWallet {
    address immutable signer;
    bool public revoked;

    constructor(address signer_) {
        signer = signer_;
    }

    function revoke() external {
        require(msg.sender == signer);
        revoked = true;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        if (revoked || signature.length != 65) return 0xffffffff;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        return ecrecover(digest, v, r, s) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function claim(OtterOrderBook book, address currency, uint256 amount, address receiver) external {
        require(msg.sender == signer);
        book.claim(currency, amount, receiver);
    }
}

contract GasGriefWallet {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        while (true) {}
        return 0x1626ba7e;
    }
}

contract ReturnDataWallet {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        assembly ("memory-safe") {
            mstore(0, shl(224, 0x1626ba7e))
            return(0, 65536)
        }
    }
}

contract BudgetWallet {
    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        // Model a costly valid wallet near the 100k validation cap.
        assembly ("memory-safe") {
            let remaining := sub(gas(), 90000)
            for {} gt(gas(), remaining) {} {}
            mstore(0, shl(224, 0x1626ba7e))
            return(0, 32)
        }
    }
}

contract OtterEpochsTest is Test {
    OtterOrderBook book;
    MockERC20 token;
    MockLiquidityGuard guard;
    bytes32 constant POOL = bytes32(uint256(1));
    bytes32 constant OTHER = bytes32(uint256(2));
    uint256 constant PK = 0xA11CE;
    address alice;
    uint256 public submitGas;
    uint256 public expireGas;
    uint256 public recoverGas;

    function setUp() public {
        book = new OtterOrderBook(60, 300);
        book.setSettlement(address(this));
        token = new MockERC20("Epoch", "EPO", 18);
        guard = new MockLiquidityGuard();
        book.registerPoolCurrencies(POOL, address(0), address(token), address(guard));
        book.registerPoolCurrencies(OTHER, address(0), address(token), address(guard));
        alice = vm.addr(PK);
        token.mint(alice, 1e24);
        vm.prank(alice);
        token.approve(address(book), type(uint256).max);
        vm.deal(address(this), uint256(type(uint96).max) * 3);
    }

    function _order(bytes32 pool, bool nativeInput, uint256 nonce, uint256 budget)
        internal
        view
        returns (OtterOrderBook.Order memory)
    {
        return OtterOrderBook.Order(
            alice,
            pool,
            nativeInput,
            0,
            budget,
            block.timestamp + 1 days,
            nonce,
            1,
            book.nextEpochId(pool),
            block.timestamp + 1 days
        );
    }

    function _sign(OtterOrderBook.Order memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK, book.digestOf(o));
        return abi.encodePacked(r, s, v);
    }

    function _one(OtterOrderBook.Order memory o)
        internal
        view
        returns (OtterOrderBook.Order[] memory os, bytes[] memory sigs)
    {
        os = new OtterOrderBook.Order[](1);
        sigs = new bytes[](1);
        os[0] = o;
        sigs[0] = _sign(o);
    }

    function _submit(OtterOrderBook.Order memory o) internal returns (uint256) {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(o);
        return book.submit{value: o.sellingCurrency0 ? o.budget : 0}(os, sigs);
    }

    function _expire(bytes32 pool, uint256 id) internal {
        vm.warp(book.executionDeadline(pool, id));
        book.expire(pool, id);
    }

    function test_recordsReconstructSignedFieldsAndSurviveRelayedSubmission() public {
        OtterOrderBook.Order memory o = _order(POOL, false, 257, 12345);
        o.ask = type(uint128).max;
        uint256 id = _submit(o);
        OtterOrderBook.Order memory stored = book.getOrder(POOL, id, 0);
        assertEq(book.hashOrder(stored), book.hashOrder(o));
        assertEq(book.getOrders(POOL, id).length, 1);
        assertEq(book.nonceBitmap(alice, 1), 2);
        _expire(POOL, id);
        vm.prank(address(0xBEEF));
        book.refundOrder(POOL, id, 0);
        assertEq(book.claimable(alice, address(token)), 12345);
        assertEq(book.claimable(address(0xBEEF), address(token)), 0);
        vm.expectRevert(OtterOrderBook.AlreadyRecovered.selector);
        book.refundOrder(POOL, id, 0);
        vm.prank(alice);
        book.claim(address(token), 12345, alice);
        assertEq(token.balanceOf(alice), 1e24);
    }

    function test_staleEpochAndConfigurationCannotSpendNonceOrFunds() public {
        OtterOrderBook.Order memory old = _order(POOL, true, 0, 1e18);
        _submit(_order(POOL, true, 1, 1e18));
        _expire(POOL, 0);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(old);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.WrongEpoch.selector, 0));
        book.submit{value: 1e18}(os, sigs);
        old.epoch = 1;
        old.configVersion = 2;
        (os, sigs) = _one(old);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.WrongConfiguration.selector, 0));
        book.submit{value: 1e18}(os, sigs);
        assertEq(book.currentBatchId(POOL), 0);
        assertEq(book.nonceBitmap(alice, 0), 2);
        old.configVersion = 1;
        _submit(old);
        assertEq(book.currentBatchId(POOL), 1);
    }

    function test_previewClockCannotExtendAnExactlyBoundedSignature() public {
        (uint256 epoch, uint64 close, uint64 until, uint256 version) = book.previewEpoch(POOL);
        OtterOrderBook.Order memory o = _order(POOL, true, 0, 1e18);
        o.epoch = epoch;
        o.configVersion = version;
        o.maxExecutionTime = until;
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(o);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.InsufficientExecutionValidity.selector, 0));
        book.submit{value: 1e18}(os, sigs);
        assertEq(book.executionDeadline(POOL, 0), 0);
        o.maxExecutionTime = until + 1;
        _submit(o);
        assertEq(book.executionDeadline(POOL, 0), until + 1);
        (, uint64 actualClose,,) = book.previewEpoch(POOL);
        assertEq(actualClose, close + 1);
    }

    function test_exactBoundarySeparatesSettlementAndExpiry() public {
        OtterOrderBook.Order memory o = _order(POOL, true, 0, 1e18);
        uint256 id = _submit(o);
        OtterOrderBook.Order[] memory os = book.getOrders(POOL, id);
        uint64 until = book.executionDeadline(POOL, id);
        vm.warp(until - 1);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.RefundTooEarly.selector, until));
        book.expire(POOL, id);
        assertEq(uint8(book.batchState(POOL, id)), uint8(OtterOrderBook.State.Closed));
        vm.warp(until);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.ExecutionExpired.selector, until));
        book.consume(POOL, id, os);
        book.expire(POOL, id);
        assertEq(uint8(book.batchState(POOL, id)), uint8(OtterOrderBook.State.Refundable));
        vm.expectRevert(OtterOrderBook.AlreadySettled.selector);
        book.consume(POOL, id, os);
        vm.expectRevert(OtterOrderBook.AlreadySettled.selector);
        book.expire(POOL, id);
    }

    function test_terminalCompletionCannotOverlapRecovery() public {
        uint256 id = _submit(_order(POOL, false, 0, 1e18));
        OtterOrderBook.Order[] memory os = book.getOrders(POOL, id);
        vm.warp(block.timestamp + 60);
        book.consume(POOL, id, os);
        assertEq(uint8(book.batchState(POOL, id)), uint8(OtterOrderBook.State.Executing));
        (,, bool terminal) = book.batches(POOL, id);
        assertFalse(terminal);
        vm.expectRevert(OtterOrderBook.AlreadySettled.selector);
        book.expire(POOL, id);
        vm.expectRevert(OtterOrderBook.NotRefundable.selector);
        book.refundOrder(POOL, id, 0);
        book.releaseFilled(POOL, os, new uint256[](1));
        book.creditPayouts(POOL, os, new uint256[](1));
        book.completeExecution(POOL);
        assertEq(uint8(book.batchState(POOL, id)), uint8(OtterOrderBook.State.Settled));
        vm.expectRevert(OtterOrderBook.NotRefundable.selector);
        book.refundOrder(POOL, id, 0);
        assertEq(book.claimable(alice, address(token)), 1e18);
    }

    function test_expiryAndRecordRecoveryDoNotCallAnUnavailableToken() public {
        _submit(_order(POOL, false, 0, 1e18));
        vm.mockCallRevert(
            address(token), abi.encodeWithSelector(token.balanceOf.selector, address(book)), "blocked balance query"
        );
        vm.warp(book.executionDeadline(POOL, 0));
        book.expire{gas: 100_000}(POOL, 0);
        book.refundOrder{gas: 150_000}(POOL, 0, 0);
        assertEq(book.claimable(alice, address(token)), 1e18);
        assertFalse(book.isBatchActive(POOL));
        vm.prank(alice);
        vm.expectRevert(bytes("blocked balance query"));
        book.claim(address(token), 1e18, alice);
        assertTrue(book.orderRecovered(POOL, 0, 0));
        assertEq(book.totalEscrow(address(token)), 0);
    }

    function test_laterEpochAndPoolDoNotConsumeOldRefundBacking() public {
        _submit(_order(POOL, true, 0, 2e18));
        _submit(_order(OTHER, true, 1, 3e18));
        _expire(POOL, 0);
        _submit(_order(POOL, true, 2, 4e18));
        book.refundOrder(POOL, 0, 0);
        assertEq(book.totalEscrow(address(0)), 7e18);
        assertEq(book.totalClaimable(address(0)), 2e18);
        vm.prank(alice);
        book.claim(address(0), 2e18, alice);
        assertEq(address(book).balance, 7e18);
        _expire(POOL, 1);
        book.refundOrder(POOL, 1, 0);
        book.expire(OTHER, 0);
        book.refundOrder(OTHER, 0, 0);
        assertEq(book.claimable(alice, address(0)), 7e18);
        assertEq(book.totalEscrow(address(0)), 0);
    }

    function test_aggregateAndIndividualDomainsRejectBeforeEscrow() public {
        uint256 cap = book.MAX_BUDGET();
        _submit(_order(POOL, true, 0, cap));
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(_order(POOL, true, 1, 1));
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.AmountOutOfDomain.selector, 0));
        book.submit{value: 1}(os, sigs);
        os[0].poolId = OTHER;
        os[0].budget = cap + 1;
        sigs[0] = _sign(os[0]);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.AmountOutOfDomain.selector, 0));
        book.submit{value: cap + 1}(os, sigs);
        os[0].budget = 1;
        os[0].ask = book.MAX_ASK() + 1;
        sigs[0] = _sign(os[0]);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.AmountOutOfDomain.selector, 0));
        book.submit{value: 1}(os, sigs);
        assertEq(book.nonceBitmap(alice, 0), 1);
        assertEq(book.totalEscrow(address(0)), cap);
    }

    function test_pauseStopsOnlyAdmissionAndNoncesWorkAcrossWords() public {
        _submit(_order(POOL, true, 0, 2e18));
        vm.prank(alice);
        book.invalidateNonces(2, 1 << 7);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(_order(POOL, true, 519, 1e18));
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.NonceUsed.selector, 0));
        book.submit{value: 1e18}(os, sigs);
        book.setAdmissionPaused(true);
        vm.expectRevert(OtterOrderBook.AdmissionPaused.selector);
        book.submit{value: 1e18}(os, sigs);
        vm.prank(alice);
        vm.expectRevert(OtterOrderBook.NotOwner.selector);
        book.setAdmissionPaused(false);
        _expire(POOL, 0);
        book.refundOrder(POOL, 0, 0);
        vm.prank(alice);
        book.claim(address(0), 2e18, alice);
        assertEq(alice.balance, 2e18);
        book.setAdmissionPaused(false);
        _submit(_order(POOL, true, 520, 1e18));
        assertEq(book.nonceBitmap(alice, 2), (1 << 7) | (1 << 8));
    }

    function test_feeInvalidationUsesRegisteredGuardAndDoesNotMoveTokens() public {
        _submit(_order(POOL, true, 0, 1e18));
        vm.expectRevert(OtterOrderBook.FeesStillSupported.selector);
        book.expireUnsupportedFees(POOL, 0);
        guard.setUnsupportedFees(true);
        book.expireUnsupportedFees(POOL, 0);
        book.refundOrder(POOL, 0, 0);
        assertEq(book.claimable(alice, address(0)), 1e18);
    }

    function test_contractWalletValidationAndRevocationAfterAdmission() public {
        EpochWallet wallet = new EpochWallet(alice);
        OtterOrderBook.Order memory o = _order(POOL, true, 0, 1e18);
        o.trader = address(wallet);
        _submit(o);
        vm.prank(alice);
        wallet.revoke();
        _expire(POOL, 0);
        book.refundOrder(POOL, 0, 0);
        assertEq(book.claimable(address(wallet), address(0)), 1e18);
        vm.prank(alice);
        wallet.claim(book, address(0), 1e18, alice);
        assertEq(alice.balance, 1e18);
        o.epoch = 1;
        o.nonce = 1;
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(o);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BadSignature.selector, 0));
        book.submit{value: 1e18}(os, sigs);
    }

    function test_walletGasReturnDataAndSignatureSizeAreBounded() public {
        OtterOrderBook.Order memory o = _order(POOL, true, 0, 1e18);
        o.trader = address(new GasGriefWallet());
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(o);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BadSignature.selector, 0));
        book.submit{value: 1e18, gas: 400_000}(os, sigs);
        assertEq(book.nonceBitmap(o.trader, 0), 0);
        o.trader = address(new ReturnDataWallet());
        (os, sigs) = _one(o);
        book.submit{value: 1e18, gas: 500_000}(os, sigs);
        o.nonce = 1;
        (os, sigs) = _one(o);
        sigs[0] = new bytes(513);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BadSignature.selector, 0));
        book.submit{value: 1e18}(os, sigs);
    }

    function test_v1AndAlteredV2SignaturesAreRejected() public {
        OtterOrderBook.Order memory o = _order(POOL, true, 0, 1e18);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(o);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("OtterOrderBook"),
                keccak256("1"),
                block.chainid,
                address(book)
            )
        );
        bytes32 oldHash = keccak256(
            abi.encode(
                keccak256(
                    "Order(address trader,bytes32 poolId,bool sellingCurrency0,uint256 ask,uint256 budget,uint256 deadline,uint256 nonce)"
                ),
                o.trader,
                o.poolId,
                o.sellingCurrency0,
                o.ask,
                o.budget,
                o.deadline,
                o.nonce
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK, keccak256(abi.encodePacked("\x19\x01", domain, oldHash)));
        sigs[0] = abi.encodePacked(r, s, v);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BadSignature.selector, 0));
        book.submit{value: 1e18}(os, sigs);
        (os, sigs) = _one(o);
        os[0].maxExecutionTime++;
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BadSignature.selector, 0));
        book.submit{value: 1e18}(os, sigs);
        assertEq(book.nonceBitmap(alice, 0), 0);
        assertEq(book.executionDeadline(POOL, 0), 0);
    }

    function test_coldMaximalWalletBatchResourceEnvelope() public {
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](32);
        bytes[] memory sigs = new bytes[](32);
        for (uint256 i; i < 32; ++i) {
            os[i] = _order(POOL, true, 0, uint256(type(uint96).max) / 32);
            os[i].ask = type(uint128).max;
            os[i].trader = address(new BudgetWallet());
            sigs[i] = new bytes(512);
            for (uint256 j; j < 512; ++j) {
                sigs[i][j] = 0xff;
            }
            vm.cool(os[i].trader);
        }
        bytes memory payload = abi.encodeCall(book.submit, (os, sigs));
        uint256 intrinsic = 21_000;
        for (uint256 i; i < payload.length; ++i) {
            intrinsic += payload[i] == 0 ? 4 : 16;
        }
        vm.cool(address(book));
        vm.cool(address(token));
        vm.cool(address(guard));
        uint256 before = gasleft();
        book.submit{value: os[0].budget * 32, gas: 15_000_000}(os, sigs);
        uint256 admission = before - gasleft();
        emit log_named_uint("cold wallet admission execution gas", admission);
        emit log_named_uint("Cancun calldata/base intrinsic gas", intrinsic);
        assertLt(admission + intrinsic, 15_000_000);
        vm.warp(book.executionDeadline(POOL, 0));
        vm.cool(address(book));
        before = gasleft();
        book.expire{gas: 100_000}(POOL, 0);
        emit log_named_uint("cold expiry execution gas", before - gasleft());
        vm.cool(address(book));
        before = gasleft();
        book.refundOrder{gas: 150_000}(POOL, 0, 31);
        emit log_named_uint("cold individual recovery execution gas", before - gasleft());
        assertEq(book.claimable(os[31].trader, address(0)), os[31].budget);
    }

    function test_clockAndInvalidIndicesFailExplicitly() public {
        vm.expectRevert(OtterOrderBook.InvalidOrderIndex.selector);
        book.getOrder(POOL, 0, 0);
        vm.warp(type(uint64).max - 10);
        vm.expectRevert(OtterOrderBook.InvalidClock.selector);
        book.previewEpoch(POOL);
        vm.warp(type(uint256).max);
        vm.expectRevert(OtterOrderBook.InvalidClock.selector);
        book.previewEpoch(POOL);
    }

    function testFuzz_expiryAndIndependentRecoveryHaveFixedResourceBounds(uint8 rawCount) public {
        uint256 count = bound(rawCount, 1, 32);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](count);
        bytes[] memory sigs = new bytes[](count);
        for (uint256 i; i < count; ++i) {
            os[i] = _order(POOL, true, i, 1e18);
            sigs[i] = _sign(os[i]);
        }
        uint256 before = gasleft();
        book.submit{value: count * 1e18, gas: 15_000_000}(os, sigs);
        submitGas = before - gasleft();
        vm.warp(book.executionDeadline(POOL, 0));
        vm.cool(address(book));
        before = gasleft();
        book.expire{gas: 100_000}(POOL, 0);
        expireGas = before - gasleft();
        assertLt(expireGas, 60_000);
        assertFalse(book.isBatchActive(POOL));
        vm.cool(address(book));
        before = gasleft();
        book.refundOrder{gas: 150_000}(POOL, 0, count - 1);
        recoverGas = before - gasleft();
        assertLt(recoverGas, 140_000);
        assertEq(book.claimable(alice, address(0)), 1e18);
        for (uint256 i; i < count - 1; ++i) {
            book.refundOrder(POOL, 0, i);
        }
        assertEq(book.totalEscrow(address(0)), 0);
        assertEq(book.totalClaimable(address(0)), count * 1e18);
    }
    receive() external payable {}
}
