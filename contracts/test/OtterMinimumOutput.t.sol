// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {OtterMath} from "../src/OtterMath.sol";
import {OtterPoolMath} from "../src/OtterHook.sol";

/// @notice Signed-minimum safety regressions, not a discrete mechanism proof.
/// Uses real book/vault/hook/settlement with 18/6-decimal ERC20s or native/6-decimal
/// pairs. Raw spot gives the minority one output unit per four input units.
contract OtterMinimumOutputTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 private constant WAD = 1e18;
    uint256 private constant DOM_PK = 0xA11CE;
    uint256 private constant MIN_PK = 0xB0B;

    struct Case {
        PoolKey key;
        bytes32 pool;
        uint256 epoch;
        uint256 minorityIndex;
        OtterOrderBook.Order[] orders;
        OtterSettlement.Outcome outcome;
    }

    struct CheckVerdict {
        uint256 code;
        uint256 index;
        uint256 arg0;
        uint256 arg1;
        uint256 totalIn;
        uint256 totalPaid;
        uint256 modelBurn;
    }

    /// Actual pool reserves go into the offline checker, never solver metadata.
    function _crossCheck(Case memory c, uint256 code, uint256 index) private returns (CheckVerdict memory v) {
        (uint160 price,,,) = manager.getSlot0(c.key.toId());
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(price, manager.getLiquidity(c.key.toId()));
        string[] memory args = new string[](6 + 5 * c.orders.length);
        args[0] = "node";
        args[1] = "--experimental-strip-types";
        args[2] = "../solver/src/settlement-check-cli.ts";
        args[3] = vm.toString(r0);
        args[4] = vm.toString(r1);
        args[5] = c.outcome.dominantSellsCurrency0 ? "1" : "0";
        for (uint256 i; i < c.orders.length; ++i) {
            uint256 p = 6 + 5 * i;
            args[p] = c.orders[i].sellingCurrency0 ? "1" : "0";
            args[p + 1] = vm.toString(c.orders[i].ask);
            args[p + 2] = vm.toString(c.orders[i].budget);
            args[p + 3] = vm.toString(c.outcome.y[i]);
            args[p + 4] = vm.toString(c.outcome.x[i]);
        }
        v = abi.decode(vm.ffi(args), (CheckVerdict));
        assertEq(v.code, code, "offline arithmetic code");
        assertEq(v.index, code == 0 ? 0 : index, "original record index");
        if (code == 0) {
            uint256 input;
            uint256 paid;
            for (uint256 i; i < c.orders.length; ++i) {
                if (c.orders[i].sellingCurrency0 != c.outcome.dominantSellsCurrency0) continue;
                input += c.outcome.y[i];
                paid += c.outcome.x[i];
            }
            assertEq(v.totalIn, input);
            assertEq(v.totalPaid, paid);
            // All successful cases here are exactly crossed, with no residual.
            assertEq(v.modelBurn, 0);
        }
    }

    function _open(bool dominant0, bool nativePair, uint256 budget, uint256 ask, bool minorityFirst, uint256 domAsk)
        private
        returns (Case memory c)
    {
        MockERC20 six = new MockERC20("Six decimals", "SIX", 6);
        six.mint(address(this), 1 << 200);
        Currency first = nativePair ? Currency.wrap(address(0)) : currency0;
        Currency second = Currency.wrap(address(six));
        if (Currency.unwrap(first) > Currency.unwrap(second)) (first, second) = (second, first);
        uint160 price = dominant0 ? SQRT_PRICE_1_1 * 2 : SQRT_PRICE_1_1 / 2;
        PoolId id;
        (c.key, id) = initPool(first, second, IHooks(address(hook)), 0, 2, price);
        c.pool = PoolId.unwrap(id);
        settlement.registerPool(c.key);
        vm.deal(address(this), uint256(type(uint96).max) + 1e25);
        for (uint256 i; i < 2; ++i) {
            address token = Currency.unwrap(i == 0 ? first : second);
            if (token != address(0)) IFixtureToken(token).approve(address(vault), type(uint256).max);
        }
        uint256 nativeDebt =
            nativePair ? SqrtPriceMath.getAmount0Delta(price, TickMath.getSqrtPriceAtTick(TICK_UPPER), 1e21, true) : 0;
        vault.createPosition{value: nativeDebt}(
            c.key, TICK_LOWER, TICK_UPPER, 1e21, type(uint256).max, type(uint256).max
        );

        c.minorityIndex = minorityFirst ? 0 : 1;
        c.orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        c.outcome = OtterSettlement.Outcome(dominant0, new uint256[](2), new uint256[](2));
        uint256 owed = budget / 4;
        uint256 nativeEscrow;
        for (uint256 i; i < 2; ++i) {
            bool minority = i == c.minorityIndex;
            uint256 pk = minority ? MIN_PK : DOM_PK;
            address trader = vm.addr(pk);
            bool sells0 = minority ? !dominant0 : dominant0;
            uint256 amount = minority ? budget : (owed == 0 ? 1 : owed);
            c.orders[i] = OtterOrderBook.Order(
                trader,
                c.pool,
                sells0,
                minority ? ask : domAsk,
                amount,
                block.timestamp + 1 days,
                0,
                1,
                book.nextEpochId(c.pool),
                block.timestamp + 1 days
            );
            address token = Currency.unwrap(sells0 ? first : second);
            if (token == address(0)) {
                nativeEscrow += amount;
            } else {
                deal(token, trader, amount);
                vm.prank(trader);
                IFixtureToken(token).approve(address(book), amount);
            }
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(c.orders[i]));
            sigs[i] = abi.encodePacked(r, s, v);
            c.outcome.y[i] = minority ? budget : owed;
            c.outcome.x[i] = minority ? owed : owed * 4;
        }
        c.epoch = book.submit{value: nativeEscrow}(c.orders, sigs);
        vm.warp(block.timestamp + 60);
    }

    function _balance(address currency, address account) private view returns (uint256) {
        return currency == address(0) ? account.balance : MockERC20(currency).balanceOf(account);
    }

    function _rejectAndRecover(Case memory c, uint256 rejectedIndex) private {
        _rejectAndRecoverWith(c, abi.encodeWithSelector(OtterMath.IndividualRationality.selector, rejectedIndex));
    }

    function _rejectAndRecoverWith(Case memory c, bytes memory expected) private {
        address c0 = Currency.unwrap(c.key.currency0);
        address c1 = Currency.unwrap(c.key.currency1);
        uint256 escrow0 = book.totalEscrow(c0);
        uint256 escrow1 = book.totalEscrow(c1);
        (uint160 price, int24 tick,,) = manager.getSlot0(c.key.toId());
        uint128 liquidity = manager.getLiquidity(c.key.toId());
        bytes32 snapshot = book.snapshotHash(c.pool, c.epoch);
        vm.expectRevert(expected);
        settlement.settle(c.key, c.epoch, c.orders, c.outcome);
        assertEq(uint8(book.batchState(c.pool, c.epoch)), uint8(OtterOrderBook.State.Closed));
        assertFalse(book.executionInProgress(c.pool));
        assertFalse(book.payoutsCredited(c.pool, c.epoch));
        assertFalse(settlement.rewardLedger().credited(c.pool, c.epoch));
        assertEq(book.snapshotHash(c.pool, c.epoch), snapshot);
        assertEq(book.totalEscrow(c0), escrow0);
        assertEq(book.totalEscrow(c1), escrow1);
        assertEq(_balance(c0, address(book)), escrow0);
        assertEq(_balance(c1, address(book)), escrow1);
        assertEq(_balance(c0, address(settlement)), 0);
        assertEq(_balance(c1, address(settlement)), 0);
        (uint160 afterPrice, int24 afterTick,,) = manager.getSlot0(c.key.toId());
        assertEq(afterPrice, price);
        assertEq(afterTick, tick);
        assertEq(manager.getLiquidity(c.key.toId()), liquidity);
        for (uint256 i; i < 2; ++i) {
            assertFalse(book.orderRecovered(c.pool, c.epoch, i));
            assertEq(book.nonceBitmap(c.orders[i].trader, 0), 1); // Admission remains valid.
            assertEq(book.claimable(c.orders[i].trader, c0), 0);
            assertEq(book.claimable(c.orders[i].trader, c1), 0);
        }

        vm.warp(book.executionDeadline(c.pool, c.epoch));
        book.expire(c.pool, c.epoch);
        // Stored record recovery needs neither the outcome nor the full batch.
        for (uint256 i; i < 2; ++i) {
            book.refundOrder(c.pool, c.epoch, i);
            vm.expectRevert(OtterOrderBook.AlreadyRecovered.selector);
            book.refundOrder(c.pool, c.epoch, i);
            OtterOrderBook.Order memory o = c.orders[i];
            address sold = o.sellingCurrency0 ? c0 : c1;
            uint256 before = _balance(sold, o.trader);
            assertEq(book.claimable(o.trader, sold), o.budget);
            vm.prank(o.trader);
            book.claim(sold, o.budget, o.trader);
            assertEq(_balance(sold, o.trader), before + o.budget);
            assertEq(book.claimable(o.trader, sold), 0);
        }
        assertEq(book.totalEscrow(c0), 0);
        assertEq(book.totalEscrow(c1), 0);
        assertFalse(book.isBatchActive(c.pool));
    }

    function _accept(Case memory c) private {
        settlement.settle(c.key, c.epoch, c.orders, c.outcome);
        assertEq(uint8(book.batchState(c.pool, c.epoch)), uint8(OtterOrderBook.State.Settled));
        for (uint256 i; i < 2; ++i) {
            OtterOrderBook.Order memory o = c.orders[i];
            // Independent exact product comparison, without a ceil helper.
            assertGe(c.outcome.x[i] * WAD, o.ask * c.outcome.y[i]);
            address output = Currency.unwrap(o.sellingCurrency0 ? c.key.currency1 : c.key.currency0);
            assertEq(book.claimable(o.trader, output), c.outcome.x[i]);
        }
        _claimAllTraders(book, c.key, c.orders);
        assertEq(book.totalEscrow(Currency.unwrap(c.key.currency0)), 0);
        assertEq(book.totalEscrow(Currency.unwrap(c.key.currency1)), 0);
    }

    function _matrix(uint256 budget, uint256 ask, bool rejected) private {
        for (uint256 flags; flags < 4; ++flags) {
            uint256 checkpoint = vm.snapshotState();
            Case memory c = _open(flags & 1 != 0, flags & 2 != 0, budget, ask, false, 0);
            _crossCheck(c, rejected ? 4 : 0, c.minorityIndex);
            if (rejected) _rejectAndRecover(c, c.minorityIndex);
            else _accept(c);
            assertTrue(vm.revertToState(checkpoint));
        }
    }

    function test_zeroMinorityPaymentRejectedInBothDirectionsAndAssetPairs() public {
        _matrix(1, WAD / 4, true);
    }

    function test_nonzeroMinorityPaymentBelowSignedCeilingRejected() public {
        _matrix(5, WAD / 4, true); // Paid 1, signed minimum ceil(5/4) = 2.
    }

    function test_oneWadPriceStepAcrossFloorBoundary() public {
        _matrix(5, WAD / 5, false); // Paid 1, signed minimum exactly 1.
        _matrix(5, WAD / 5 + 1, true); // Same floor, signed minimum now 2.
    }

    function test_exactWholeMinorityPaymentCanSettle() public {
        _matrix(4, WAD / 4, false);
    }

    function test_zeroAskStillAllowsZeroMinorityPayment() public {
        _matrix(1, 0, false); // Preserve the existing raw-unit signature domain.
    }

    function test_maximumBudgetBoundaryRejectsOrSettlesWithoutOverflow() public {
        _matrix(type(uint96).max, WAD / 4, true);
        _matrix(uint256(type(uint96).max) - 3, WAD / 4, false); // Exact multiple of four.
    }

    function test_minorityAtStoredIndexZeroRetainsCorrectErrorAndRecovery() public {
        _rejectAndRecover(_open(false, true, 5, WAD / 4, true, 0), 0);
    }

    function test_dominantMinimumStillRejectsAndPreservesRecovery() public {
        Case memory c = _open(true, false, 4, WAD / 4, false, 4 * WAD);
        c.outcome.x[0] = 3; // Sold 1 with signed minimum 4.
        _crossCheck(c, 4, 0);
        _rejectAndRecover(c, 0);
    }

    function test_offlineCheckMatchesWrongMinorityFillAndPayment() public {
        for (uint256 flags; flags < 8; ++flags) {
            for (uint256 mutation; mutation < 3; ++mutation) {
                uint256 checkpoint = vm.snapshotState();
                Case memory c = _open(flags & 1 != 0, flags & 2 != 0, 4, WAD / 4, flags & 4 != 0, 0);
                uint256 i = c.minorityIndex;
                if (mutation == 0) c.outcome.y[i] = 3;
                else c.outcome.x[i] = mutation == 1 ? 0 : 2;
                _crossCheck(c, 10, i);
                _rejectAndRecoverWith(c, abi.encodeWithSelector(OtterSettlement.MinorityFillWrong.selector, i));
                assertTrue(vm.revertToState(checkpoint));
            }
        }
    }

    function test_offlineCheckMatchesIneligibleMinorityAndAllowsZeroProposal() public {
        for (uint256 flags; flags < 8; ++flags) {
            uint256 checkpoint = vm.snapshotState();
            Case memory c = _open(flags & 1 != 0, flags & 2 != 0, 4, WAD / 4 + 1, flags & 4 != 0, 0);
            uint256 opened = vm.snapshotState();
            _crossCheck(c, 9, c.minorityIndex);
            _rejectAndRecoverWith(
                c, abi.encodeWithSelector(OtterSettlement.IneligibleMustBeUnfilled.selector, c.minorityIndex)
            );
            assertTrue(vm.revertToStateAndDelete(opened));
            // Current feasibility checks permit this inefficient zero proposal.
            // Matching that behavior does not solve canonical allocation (R2).
            c.outcome.y = new uint256[](2);
            c.outcome.x = new uint256[](2);
            _crossCheck(c, 0, 0);
            _accept(c);
            assertTrue(vm.revertToState(checkpoint));
        }
    }

    function test_offlineCheckDerivesCrossingWithoutDiagnosticTotals() public {
        Case memory c = _open(true, true, 4, WAD / 4, true, 0);
        c.outcome.y[1] = 0;
        c.outcome.x[1] = 0;
        CheckVerdict memory v = _crossCheck(c, 5, 0);
        assertEq(v.arg0, 0);
        assertEq(v.arg1, 1);
        _rejectAndRecoverWith(c, abi.encodeWithSelector(OtterMath.DominanceViolated.selector, 0, 1));
    }

    function test_offlineCheckMatchesClassificationBeforeDominantIR() public {
        Case memory c = _open(true, false, 4, WAD / 4, false, 4 * WAD);
        c.outcome.x[0] = 3;
        c.outcome.x[1] = 0;
        _crossCheck(c, 10, 1);
        _rejectAndRecoverWith(c, abi.encodeWithSelector(OtterSettlement.MinorityFillWrong.selector, 1));
    }

    function test_offlineCheckMatchesDominantBudgetSpotAndMarginalErrors() public {
        for (uint256 mutation; mutation < 3; ++mutation) {
            uint256 checkpoint = vm.snapshotState();
            Case memory c = _open(true, false, 4, mutation == 2 ? WAD / 4 + 1 : WAD / 4, false, 0);
            bytes4 selector;
            uint256 code;
            if (mutation == 0) {
                c.outcome.y[0] = 2;
                selector = OtterMath.BudgetExceeded.selector;
                code = 1;
            } else if (mutation == 1) {
                c.outcome.x[0] = 5;
                selector = OtterMath.PaymentExceedsSpot.selector;
                code = 2;
            } else {
                c.outcome.y[1] = 0;
                c.outcome.x[1] = 0;
                selector = OtterMath.PaymentExceedsMarginal.selector;
                code = 3;
            }
            _crossCheck(c, code, 0);
            _rejectAndRecoverWith(c, abi.encodeWithSelector(selector, 0));
            assertTrue(vm.revertToState(checkpoint));
        }
    }

    function testFuzz_signedMinorityBoundaryAndRecovery(
        uint96 rawBudget,
        bool violatesMinimum,
        bool dominant0,
        bool nativePair,
        bool minorityFirst
    ) public {
        // Force budget % 4 == 1; the spot floor always leaves a fractional unit.
        uint256 budget = (bound(rawBudget, 1, type(uint96).max) & ~uint256(3)) | 1;
        uint256 ask = (budget / 4) * WAD / budget;
        if (violatesMinimum) ++ask;
        assertLe(ask, WAD / 4); // Still eligible; not the ineligibility branch.
        Case memory c = _open(dominant0, nativePair, budget, ask, minorityFirst, 0);
        uint256 i = c.minorityIndex;
        if (violatesMinimum) {
            assertLt(c.outcome.x[i] * WAD, ask * budget);
            _rejectAndRecover(c, i);
        } else {
            _accept(c);
        }
    }
}
