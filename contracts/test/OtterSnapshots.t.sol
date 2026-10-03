// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {Position} from "@uniswap/v4-core/src/libraries/Position.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {IOtterLiquidityGuard} from "../src/interfaces/IOtterLiquidityGuard.sol";
import {BudgetWallet} from "./OtterEpochs.t.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

contract SnapshotFeeToken is MockERC20 {
    IPoolManager immutable manager;
    PoolKey private key;
    bool private changeOnPull;
    bool private changeOnTransfer;

    constructor(IPoolManager manager_) MockERC20("Snapshot callback", "SNP", 18) {
        manager = manager_;
    }

    function arm(PoolKey memory key_, bool pull, bool transfer_) external {
        key = key_;
        changeOnPull = pull;
        changeOnTransfer = transfer_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool ok = super.transferFrom(from, to, amount);
        if (changeOnPull) manager.setProtocolFee(key, 1000);
        return ok;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (changeOnTransfer) manager.setProtocolFee(key, 1000);
        return ok;
    }
}

/// @dev Fault injection via manager storage tests rejection/recovery boundaries;
/// no production router can bypass the real hook's pricing/ownership lock.
contract OtterSnapshotsTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function _pool() internal view returns (bytes32) {
        return PoolId.unwrap(otterId);
    }

    function _slot() internal view returns (bytes32) {
        return keccak256(abi.encode(otterId, StateLibrary.POOLS_SLOT));
    }

    function _next(uint256 nonce) internal returns (OtterOrderBook.Order[] memory os, bytes[] memory sigs) {
        (os, sigs) = _prepareActiveOrder();
        os[0].nonce = nonce;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
    }

    function _expire() internal {
        uint256 epoch = book.currentBatchId(_pool());
        vm.warp(book.executionDeadline(_pool(), epoch));
        book.expire(_pool(), epoch);
    }

    function _settle(uint256 epoch) internal {
        uint256[] memory y = new uint256[](1);
        y[0] = submittedOrders[0].budget;
        settlement.settle(otterKey, epoch, submittedOrders, OtterSettlement.Outcome(true, y, new uint256[](1)));
    }

    function _newPosition(PoolKey memory key, address who, uint128 amount) internal returns (uint256 id) {
        deal(Currency.unwrap(key.currency1), who, 1e30);
        if (Currency.unwrap(key.currency0) != address(0)) deal(Currency.unwrap(key.currency0), who, 1e30);
        (uint160 price,,,) = manager.getSlot0(key.toId());
        int24 lower = TickMath.minUsableTick(key.tickSpacing);
        int24 upper = TickMath.maxUsableTick(key.tickSpacing);
        uint256 nativeDebt = Currency.unwrap(key.currency0) == address(0)
            ? SqrtPriceMath.getAmount0Delta(price, TickMath.getSqrtPriceAtTick(upper), amount, true)
            : 0;
        vm.deal(who, nativeDebt);
        vm.startPrank(who);
        IFixtureToken(Currency.unwrap(key.currency1)).approve(address(vault), type(uint256).max);
        if (Currency.unwrap(key.currency0) != address(0)) {
            IFixtureToken(Currency.unwrap(key.currency0)).approve(address(vault), type(uint256).max);
        }
        id = vault.createPosition{value: nativeDebt}(key, lower, upper, amount, type(uint256).max, type(uint256).max);
        vm.stopPrank();
    }

    function test_openingRecordBindsRealPoolRosterClockAndDeployment() public {
        uint256 second = _newPosition(otterKey, address(0xBEEF), 1e18);
        vm.roll(1234);
        _submitActiveOrder();
        IOtterLiquidityGuard.PoolSnapshot memory s = book.openingSnapshot(_pool(), 0);
        IOtterLiquidityGuard.PositionSnapshot[] memory ps = book.openingPositions(_pool(), 0);
        assertEq(PoolId.unwrap(s.key.toId()), _pool());
        assertEq(s.manager, address(manager));
        assertEq(address(s.key.hooks), address(hook));
        assertEq(s.sqrtPriceX96, SQRT_PRICE_1_1);
        assertEq(s.tick, 0);
        assertEq(s.protocolFee, 0);
        assertEq(s.lpFee, 0);
        assertEq(s.activeLiquidity, 1e21 + 1e18);
        assertEq(s.totalLiquidity, s.activeLiquidity);
        assertEq(s.ownershipVersion, 2);
        assertEq(ps.length, 2);
        assertEq(ps[0].id, 1);
        assertEq(ps[0].owner, address(this));
        assertEq(ps[0].tickLower, TICK_LOWER);
        assertEq(ps[0].tickUpper, TICK_UPPER);
        assertEq(ps[0].liquidity, 1e21);
        assertEq(ps[1].id, second);
        assertEq(ps[1].owner, address(0xBEEF));
        assertEq(ps[1].liquidity, 1e18);
        assertEq(s.positionsHash, keccak256(abi.encode(ps)));
        (uint64 close,,) = book.batches(_pool(), 0);
        bytes32 expected = keccak256(
            abi.encode(
                book.SNAPSHOT_TYPEHASH(),
                block.chainid,
                address(book),
                _pool(),
                uint256(0),
                uint256(1),
                close,
                book.executionDeadline(_pool(), 0),
                uint256(1234),
                address(vault),
                s
            )
        );
        assertEq(book.snapshotHash(_pool(), 0), expected);
        assertEq(book.openingBlock(_pool(), 0), 1234);
        book.assertSnapshot(_pool(), 0);
    }

    function test_failedFirstSignatureRollsBackSnapshotClockAndNonce() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        sigs[0] = "";
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.BadSignature.selector, 0));
        book.submit(os, sigs);
        _assertUnopened(os[0].trader);
    }

    function test_failedFirstEscrowRollsBackSnapshotClockAndNonce() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        vm.mockCall(Currency.unwrap(currency0), abi.encodeWithSelector(bytes4(0x23b872dd)), abi.encode(false));
        vm.expectRevert();
        book.submit(os, sigs);
        _assertUnopened(os[0].trader);
    }

    function _assertUnopened(address trader) internal view {
        assertEq(book.snapshotHash(_pool(), 0), bytes32(0));
        assertEq(book.openingBlock(_pool(), 0), 0);
        assertEq(book.executionDeadline(_pool(), 0), 0);
        assertEq(uint8(book.batchState(_pool(), 0)), uint8(OtterOrderBook.State.None));
        assertEq(book.nonceBitmap(trader, 0), 0);
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 0);
        assertEq(vault.ownershipVersion(_pool()), 1);
    }

    function test_appendDonationAndReservationPreserveOpeningRecord() public {
        _submitActiveOrder();
        bytes32 commitment = book.snapshotHash(_pool(), 0);
        bytes32 rosterHash = book.openingSnapshot(_pool(), 0).positionsHash;
        vault.requestExit(1, 1e20);
        donateRouter.donate(otterKey, 1e18, 1e18, ZERO_BYTES);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _next(1);
        book.submit(os, sigs);
        assertEq(book.snapshotHash(_pool(), 0), commitment);
        assertEq(book.openingSnapshot(_pool(), 0).positionsHash, rosterHash);
        assertEq(book.openingPositions(_pool(), 0)[0].liquidity, 1e21);
        assertEq(vault.ownershipVersion(_pool()), 1);
        book.assertSnapshot(_pool(), 0);
    }

    function test_terminalHistorySurvivesExitReopenAndNewOwner() public {
        _submitActiveOrder();
        bytes32 oldHash = book.snapshotHash(_pool(), 0);
        _expire();
        vault.removeLiquidity(1, 1e21, 0, 0);
        uint256 newId = _newPosition(otterKey, address(0xBEEF), 1e18);
        vault.increaseLiquidity(1, 1e18, type(uint256).max, type(uint256).max);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _next(1);
        book.submit(os, sigs);
        IOtterLiquidityGuard.PositionSnapshot[] memory old = book.openingPositions(_pool(), 0);
        IOtterLiquidityGuard.PositionSnapshot[] memory fresh = book.openingPositions(_pool(), 1);
        assertEq(old.length, 1);
        assertEq(old[0].id, 1);
        assertEq(old[0].owner, address(this));
        assertEq(old[0].liquidity, 1e21);
        assertEq(fresh.length, 2);
        assertEq(fresh[0].id, newId);
        assertEq(fresh[1].id, 1);
        assertEq(fresh[1].liquidity, 1e18);
        assertEq(book.openingSnapshot(_pool(), 1).ownershipVersion, 4);
        assertEq(book.snapshotHash(_pool(), 0), oldHash);
        assertTrue(book.snapshotHash(_pool(), 1) != oldHash);
        book.refundOrder(_pool(), 0, 0);
        assertEq(book.claimable(os[0].trader, Currency.unwrap(currency0)), 1e18);
    }

    function test_versionTracksFundedChangesButNotFeesClaimsOrReservations() public {
        donateRouter.donate(otterKey, 1e18, 1e18, ZERO_BYTES);
        vault.collectFees(1);
        assertEq(vault.ownershipVersion(_pool()), 1);
        uint256 credit = vault.claims(address(this), currency0);
        vault.claim(currency0, credit, address(0xBEEF));
        assertEq(vault.ownershipVersion(_pool()), 1);
        vault.requestExit(1, 1e18);
        assertEq(vault.ownershipVersion(_pool()), 1);
        vault.processExit(1);
        assertEq(vault.ownershipVersion(_pool()), 2);
        vm.expectRevert(OtterLiquidityVault.SlippageExceeded.selector);
        vault.increaseLiquidity(1, 1e18, 0, 0);
        assertEq(vault.ownershipVersion(_pool()), 2);
        vault.increaseLiquidity(1, 1e18, type(uint256).max, type(uint256).max);
        assertEq(vault.ownershipVersion(_pool()), 3);
    }

    function test_activeMutationCannotChangeSnapshotVersion() public {
        _submitActiveOrder();
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.removeLiquidity(1, 1, 0, 0);
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.increaseLiquidity(1, 1, type(uint256).max, type(uint256).max);
        assertEq(vault.ownershipVersion(_pool()), 1);
        book.assertSnapshot(_pool(), 0);
    }

    function test_donationAndReservedExitDoNotVetoSettlement() public {
        uint256 epoch = _submitActiveOrder();
        bytes32 original = book.snapshotHash(_pool(), epoch);
        vault.requestExit(1, 1e20);
        donateRouter.donate(otterKey, 1e18, 1e18, ZERO_BYTES);
        vm.warp(block.timestamp + 60);
        _settle(epoch);
        assertEq(uint8(book.batchState(_pool(), epoch)), uint8(OtterOrderBook.State.Settled));
        assertEq(book.snapshotHash(_pool(), epoch), original);
        assertEq(book.openingSnapshot(_pool(), epoch).sqrtPriceX96, SQRT_PRICE_1_1);
        vault.processExit(1);
        assertEq(vault.ownershipVersion(_pool()), 2);
        assertEq(book.openingPositions(_pool(), epoch)[0].liquidity, 1e21);
    }

    function testFuzz_priceTickOrLiquidityDriftRejectsAndDoesNotBlockRecovery(uint8 field, uint64 change) public {
        uint256 epoch = _submitActiveOrder();
        field = uint8(bound(field, 0, 2));
        change = uint64(bound(change, 1, type(uint64).max));
        bytes32 slot = _slot();
        if (field == 0) {
            uint256 value = uint256(vm.load(address(manager), slot));
            vm.store(address(manager), slot, bytes32(value + change));
        } else if (field == 1) {
            uint256 value = uint256(vm.load(address(manager), slot));
            vm.store(address(manager), slot, bytes32(value | (uint256(1) << 160)));
        } else {
            vm.store(
                address(manager),
                bytes32(uint256(slot) + StateLibrary.LIQUIDITY_OFFSET),
                bytes32(uint256(1e21) + change)
            );
        }
        vm.expectRevert(OtterLiquidityVault.SnapshotMismatch.selector);
        book.assertSnapshot(_pool(), epoch);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _next(1);
        vm.expectRevert(OtterLiquidityVault.SnapshotMismatch.selector);
        book.submit(os, sigs);
        assertEq(book.nonceBitmap(os[0].trader, 0), 1);
        vm.warp(block.timestamp + 60);
        vm.expectRevert(OtterLiquidityVault.SnapshotMismatch.selector);
        _settle(epoch);
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 1e18);
        _expire(); // price state is still corrupt; timeout must not query it
        book.refundOrder(_pool(), epoch, 0);
        assertEq(book.claimable(os[0].trader, Currency.unwrap(currency0)), 1e18);
    }

    function test_corePositionMismatchRejectsBeforeFirstEscrow() public {
        bytes32 coreId = Position.calculatePositionKey(address(vault), TICK_LOWER, TICK_UPPER, bytes32(uint256(1)));
        bytes32 slot = keccak256(abi.encode(coreId, bytes32(uint256(_slot()) + StateLibrary.POSITIONS_OFFSET)));
        vm.mockCall(address(manager), abi.encodeWithSignature("extsload(bytes32)", slot), abi.encode(uint256(1)));
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        vm.expectRevert(OtterLiquidityVault.SnapshotMismatch.selector);
        book.submit(os, sigs);
        _assertUnopened(os[0].trader);
    }

    function test_endpointLiquidityMismatchRejectsBeforeFirstEscrow() public {
        bytes32 slot = keccak256(abi.encode(TICK_LOWER, bytes32(uint256(_slot()) + StateLibrary.TICKS_OFFSET)));
        vm.mockCall(address(manager), abi.encodeWithSignature("extsload(bytes32)", slot), abi.encode(uint256(0)));
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        vm.expectRevert(OtterLiquidityVault.SnapshotMismatch.selector);
        book.submit(os, sigs);
        _assertUnopened(os[0].trader);
    }

    function test_missingEndpointBitRejectsBeforeFirstEscrow() public {
        int16 word = int16(TICK_LOWER >> 8);
        bytes32 slot = keccak256(abi.encode(word, bytes32(uint256(_slot()) + StateLibrary.TICK_BITMAP_OFFSET)));
        vm.mockCall(address(manager), abi.encodeWithSignature("extsload(bytes32)", slot), abi.encode(uint256(0)));
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        vm.expectRevert(OtterLiquidityVault.SnapshotMismatch.selector);
        book.submit(os, sigs);
        _assertUnopened(os[0].trader);
    }

    function test_concentratedScheduleRemainsGatedBeforeSnapshot() public {
        vault.createPosition(otterKey, -120, 120, 1e18, type(uint256).max, type(uint256).max);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        vm.expectRevert(OtterLiquidityVault.ConcentratedExecutionUnavailable.selector);
        book.submit(os, sigs);
        assertEq(book.snapshotHash(_pool(), 0), bytes32(0));
    }

    function test_nativePoolAndAlignedNegativeEndpointsAuthenticate() public {
        (PoolKey memory key, PoolId id) =
            initPool(Currency.wrap(address(0)), currency1, IHooks(address(hook)), 0, 60, SQRT_PRICE_1_1);
        settlement.registerPool(key);
        uint256 lpId = _newPosition(key, address(0xBEEF), 1e18);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        os[0].poolId = PoolId.unwrap(id);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
        vm.deal(address(this), 1e18);
        book.submit{value: 1e18}(os, sigs);
        IOtterLiquidityGuard.PoolSnapshot memory snap = book.openingSnapshot(PoolId.unwrap(id), 0);
        assertEq(Currency.unwrap(snap.key.currency0), address(0));
        assertEq(snap.key.tickSpacing, 60);
        assertEq(book.openingPositions(PoolId.unwrap(id), 0)[0].id, lpId);
        assertEq(book.openingPositions(PoolId.unwrap(id), 0)[0].tickLower, TickMath.minUsableTick(60));
        book.assertSnapshot(PoolId.unwrap(id), 0);
        assertEq(vault.ownershipVersion(_pool()), 1);
    }

    function test_missingSnapshotCannotBeMistakenForAnEmptyEpoch() public {
        vm.expectRevert(OtterOrderBook.SnapshotMissing.selector);
        book.openingSnapshot(_pool(), 0);
        vm.expectRevert(OtterOrderBook.SnapshotMissing.selector);
        book.openingPositions(_pool(), 0);
        vm.expectRevert(OtterOrderBook.SnapshotMissing.selector);
        book.assertSnapshot(_pool(), 0);
    }

    function _feePool() internal returns (SnapshotFeeToken asset, PoolKey memory key) {
        asset = new SnapshotFeeToken(manager);
        (key,) = initPool(
            Currency.wrap(address(0)), Currency.wrap(address(asset)), IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1
        );
        settlement.registerPool(key);
        _newPosition(key, address(this), 1e21);
        manager.setProtocolFeeController(address(asset));
    }

    function _feeOrder(SnapshotFeeToken asset, PoolKey memory key, uint256 nonce)
        internal
        returns (OtterOrderBook.Order[] memory os, bytes[] memory sigs)
    {
        (os, sigs) = _prepareActiveOrder();
        os[0].poolId = PoolId.unwrap(key.toId());
        os[0].sellingCurrency0 = false;
        os[0].nonce = nonce;
        asset.mint(os[0].trader, os[0].budget);
        vm.prank(os[0].trader);
        asset.approve(address(book), type(uint256).max);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
    }

    function test_firstAdmissionFeeCallbackRollsBackCapturedStateAndEscrow() public {
        (SnapshotFeeToken asset, PoolKey memory key) = _feePool();
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _feeOrder(asset, key, 0);
        asset.arm(key, true, false);
        vm.expectRevert(OtterLiquidityVault.SnapshotMismatch.selector);
        book.submit(os, sigs);
        bytes32 id = PoolId.unwrap(key.toId());
        assertEq(book.snapshotHash(id, 0), bytes32(0));
        assertEq(book.executionDeadline(id, 0), 0);
        assertEq(book.totalEscrow(address(asset)), 0);
        assertEq(book.nonceBitmap(os[0].trader, 0), 0);
        (,, uint24 fee,) = manager.getSlot0(key.toId());
        assertEq(fee, 0);
        assertEq(asset.balanceOf(os[0].trader), os[0].budget);
    }

    function test_appendFeeCallbackCannotInvalidatePriorOrdersOrSnapshot() public {
        (SnapshotFeeToken asset, PoolKey memory key) = _feePool();
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _feeOrder(asset, key, 0);
        book.submit(os, sigs);
        bytes32 id = PoolId.unwrap(key.toId());
        bytes32 oldHash = book.snapshotHash(id, 0);
        (os, sigs) = _feeOrder(asset, key, 1);
        asset.arm(key, true, false);
        vm.expectRevert(OtterLiquidityVault.SnapshotMismatch.selector);
        book.submit(os, sigs);
        assertEq(book.snapshotHash(id, 0), oldHash);
        assertEq(book.totalEscrow(address(asset)), 1e18);
        assertEq(book.getOrders(id, 0).length, 1);
        assertEq(book.nonceBitmap(os[0].trader, 0), 1);
        book.assertSnapshot(id, 0);
    }

    function test_zeroResidualSettlementStillRejectsFeeDriftAfterEscrowRelease() public {
        (SnapshotFeeToken asset, PoolKey memory key) = _feePool();
        (OtterOrderBook.Order[] memory one, bytes[] memory signature) = _feeOrder(asset, key, 0);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        os[0] = one[0];
        sigs[0] = signature[0];
        // A memory struct assignment would alias the first order and invalidate
        // its signature when changing the second order's direction/nonce.
        os[1] = abi.decode(abi.encode(one[0]), (OtterOrderBook.Order));
        os[1].sellingCurrency0 = true;
        os[1].nonce = 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[1]));
        sigs[1] = abi.encodePacked(r, s, v);
        vm.deal(address(this), 1e18);
        book.submit{value: 1e18}(os, sigs);
        vm.warp(block.timestamp + 60);
        asset.arm(key, false, true);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1e18;
        amounts[1] = 1e18;
        vm.expectRevert(abi.encodeWithSelector(OtterSettlement.UnsupportedProtocolFee.selector, uint24(1000)));
        settlement.settle(key, 0, os, OtterSettlement.Outcome(true, amounts, amounts));
        bytes32 id = PoolId.unwrap(key.toId());
        assertEq(book.totalEscrow(address(asset)), 1e18);
        assertEq(book.totalEscrow(address(0)), 1e18);
        assertEq(uint8(book.batchState(id, 0)), uint8(OtterOrderBook.State.Closed));
        assertFalse(book.executionInProgress(id));
        book.assertSnapshot(id, 0);
    }

    function test_coldMaximumRosterAndWalletBatchResourceEnvelope() public {
        for (uint256 i; i < 31; ++i) {
            _newPosition(otterKey, address(uint160(0x1000 + i)), 1e18);
        }
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](32);
        bytes[] memory sigs = new bytes[](32);
        uint256 budget = type(uint96).max / 32;
        for (uint256 i; i < 32; ++i) {
            address wallet = address(new BudgetWallet());
            deal(Currency.unwrap(currency0), wallet, budget);
            vm.prank(wallet);
            IFixtureToken(Currency.unwrap(currency0)).approve(address(book), budget);
            os[i] = OtterOrderBook.Order(
                wallet,
                _pool(),
                true,
                type(uint128).max,
                budget,
                type(uint64).max,
                type(uint256).max,
                1,
                0,
                type(uint64).max
            );
            sigs[i] = new bytes(512);
            for (uint256 j; j < 512; ++j) {
                sigs[i][j] = 0xff;
            }
            vm.cool(wallet);
        }
        bytes memory payload = abi.encodeCall(book.submit, (os, sigs));
        uint256 intrinsic = 21_000;
        for (uint256 i; i < payload.length; ++i) {
            intrinsic += payload[i] == 0 ? 4 : 16;
        }
        vm.cool(address(manager));
        vm.cool(address(vault));
        vm.cool(address(book));
        vm.cool(Currency.unwrap(currency0));
        vm.cool(Currency.unwrap(currency1));
        uint256 before = gasleft();
        book.submit{gas: 15_000_000}(os, sigs);
        uint256 used = before - gasleft();
        emit log_named_uint("cold 32-position / 32-wallet opening execution gas", used);
        emit log_named_uint("Cancun calldata/base intrinsic gas", intrinsic);
        assertLt(used + intrinsic, 15_000_000);
        assertEq(book.openingPositions(_pool(), 0).length, 32);
        _expire();
        vm.cool(address(book));
        before = gasleft();
        book.refundOrder(_pool(), 0, 0);
        used = before - gasleft();
        emit log_named_uint("cold individual recovery with retained roster", used);
        assertLt(used, 140_000);
    }
}
