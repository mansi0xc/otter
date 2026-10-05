// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// R1, R3, R4, R5, R8 and fee policy now assert prevention. R2/R6/R7 remain open. Other review reproductions still assert
// unsafe behavior and remain open until their owning remediation step lands.
import {OtterSettlementTest, IERC20Minimal} from "./OtterSettlement.t.sol";
import {OtterOrderBookTest} from "./OtterOrderBook.t.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {OtterMath} from "../src/OtterMath.sol";
import {OtterHook} from "../src/OtterHook.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolIdLibrary, PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

contract GrantReviewSettlementTest is OtterSettlementTest {
    using PoolIdLibrary for *;
    using StateLibrary for IPoolManager;

    function test_review_UnauthorizedRouterWithdrawalIsRejected() public {
        address attacker = address(0xBAD);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeRemoveLiquidity.selector,
                abi.encodeWithSelector(OtterHook.VaultOnly.selector, address(modifyLiquidityRouter)),
                abi.encodePacked(Hooks.HookCallFailed.selector)
            )
        );
        vm.prank(attacker);
        modifyLiquidityRouter.modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: -int256(1e21), salt: 0
            }),
            ZERO_BYTES
        );
        assertEq(IERC20Minimal(Currency.unwrap(currency0)).balanceOf(attacker), 0);
        assertEq(IERC20Minimal(Currency.unwrap(currency1)).balanceOf(attacker), 0);
        assertEq(manager.getLiquidity(otterId), 1e21);
    }

    function test_review_ExpiredExecutionCannotSettleAndStoredOrdersRefund() public {
        (uint256 id, OtterOrderBook.Order[] memory os) = _openBatch();
        uint256 until = book.executionDeadline(PoolId.unwrap(otterId), id);
        vm.warp(until);
        OtterSettlement.Outcome memory out = _outcome(_curve(), 1e15);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.ExecutionExpired.selector, until));
        settlement.settle(otterKey, id, os, out);
        book.expire(PoolId.unwrap(otterId), id);
        book.refundOrder(PoolId.unwrap(otterId), id, 0);
        book.refundOrder(PoolId.unwrap(otterId), id, 1);
        assertEq(book.claimable(dom, Currency.unwrap(currency0)), DOM_BUDGET);
        assertEq(book.claimable(min, Currency.unwrap(currency1)), MIN_BUDGET);
    }

    function test_review_SolverCanPayAskAndCaptureSurplusAsLP() public {
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        bytes[] memory sigs = new bytes[](1);
        (os[0],) = _order(dom, domPk, true, DOM_BUDGET, 0);
        os[0].ask = 1e17;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(domPk, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
        uint256 id = book.submit(os, sigs);
        vm.warp(block.timestamp + WINDOW + 300);
        uint256[] memory y = new uint256[](1);
        uint256[] memory x = new uint256[](1);
        y[0] = DOM_BUDGET;
        x[0] = 1e18;
        settlement.settle(otterKey, id, os, OtterSettlement.Outcome(true, y, x));
        _claimAllTraders(book, otterKey, os);
        assertEq(IERC20Minimal(Currency.unwrap(currency1)).balanceOf(dom), 1e18);
        uint256 pot = settlement.rewardLedger()
            .epochSurplus(
                PoolId.unwrap(otterId), book.currentBatchId(PoolId.unwrap(otterId)), Currency.unwrap(currency1)
            );
        assertGt(pot, 8e18);
        uint256 before = IERC20Minimal(Currency.unwrap(currency1)).balanceOf(address(this));
        settlement.rewardLedger().claim(Currency.unwrap(currency1), pot, address(this));
        uint256 collected = IERC20Minimal(Currency.unwrap(currency1)).balanceOf(address(this)) - before;
        assertEq(collected, pot);
    }

    function test_review_ExtremeAskRejectedBeforeEscrowAndBoundedAskClassifies() public {
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        (os[0], sigs[0]) = _order(dom, domPk, true, DOM_BUDGET, 0);
        (os[1],) = _order(min, minPk, false, 1, 0);
        os[1].ask = type(uint256).max;
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(minPk, book.digestOf(os[1]));
        sigs[1] = abi.encodePacked(r, sigS, v);
        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.AmountOutOfDomain.selector, 1));
        book.submit(os, sigs);
        assertEq(book.nonceBitmap(dom, 0), 0);
        assertEq(book.nonceBitmap(min, 0), 0);
        os[1].ask = type(uint128).max;
        (v, r, sigS) = vm.sign(minPk, book.digestOf(os[1]));
        sigs[1] = abi.encodePacked(r, sigS, v);
        uint256 id = book.submit(os, sigs);
        vm.warp(block.timestamp + WINDOW);
        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = DOM_BUDGET;
        x[0] = 9e18;
        settlement.settle(otterKey, id, os, OtterSettlement.Outcome(true, y, x));
        assertEq(book.claimable(min, Currency.unwrap(currency1)), 1);
        assertEq(uint8(book.batchState(PoolId.unwrap(otterId), id)), uint8(OtterOrderBook.State.Settled));
    }

    function test_review_MinorityCanReceiveZeroBelowItsAsk() public {
        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 2, SQRT_PRICE_1_1 * 2);
        settlement.registerPool(otterKey);
        _modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: 1e21, salt: 0
            }),
            ZERO_BYTES
        );
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        (os[0], sigs[0]) = _order(dom, domPk, true, DOM_BUDGET, 0);
        (os[1],) = _order(min, minPk, false, 1, 0);
        os[1].ask = 25e16;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(minPk, book.digestOf(os[1]));
        sigs[1] = abi.encodePacked(r, s, v);
        uint256 id = book.submit(os, sigs);
        vm.warp(block.timestamp + WINDOW);
        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[1] = 1;
        settlement.settle(otterKey, id, os, OtterSettlement.Outcome(true, y, x));
        _claimAllTraders(book, otterKey, os);
        assertEq(IERC20Minimal(Currency.unwrap(currency0)).balanceOf(min), 0);
        assertEq(
            settlement.rewardLedger()
                .epochSurplus(
                    PoolId.unwrap(otterId), book.currentBatchId(PoolId.unwrap(otterId)), Currency.unwrap(currency1)
                ),
            1
        );
    }

    function test_review_ProtocolFeeChangeRejectsSettlementAndAllowsRefund() public {
        (uint256 id, OtterOrderBook.Order[] memory os) = _openBatch();
        OtterSettlement.Outcome memory outcome = _outcome(_curve(), 0);
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(otterKey, uint24(1000 | (1000 << 12)));
        vm.expectRevert(
            abi.encodeWithSelector(OtterSettlement.UnsupportedProtocolFee.selector, uint24(1000 | (1000 << 12)))
        );
        settlement.settle(otterKey, id, os, outcome);
        _claimAllTraders(book, otterKey, os);
        (,, bool spent) = book.batches(PoolId.unwrap(otterId), id);
        assertFalse(spent);
        vm.warp(block.timestamp + 900);
        book.refundExpired(PoolId.unwrap(otterId), id, os);
        assertEq(book.claimable(dom, Currency.unwrap(currency0)), DOM_BUDGET);
        assertEq(book.claimable(min, Currency.unwrap(currency1)), MIN_BUDGET);
    }

    function test_review_LaterLPReceivesNoPreviousTradersSurplus() public {
        (uint256 id, OtterOrderBook.Order[] memory os) = _openBatch();
        settlement.settle(otterKey, id, os, _outcome(_curve(), 1e15));
        _claimAllTraders(book, otterKey, os);
        uint256 pot = settlement.rewardLedger()
            .epochSurplus(
                PoolId.unwrap(otterId), book.currentBatchId(PoolId.unwrap(otterId)), Currency.unwrap(currency1)
            );
        address attacker = address(0xBADE);
        _fund(currency0, attacker, 20000e18);
        _fund(currency1, attacker, 20000e18);
        OtterLiquidityVault vault = hook.liquidityVault();
        vm.startPrank(attacker);
        IERC20Minimal(Currency.unwrap(currency0)).approve(address(vault), type(uint256).max);
        IERC20Minimal(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        uint256 lpId =
            vault.createPosition(otterKey, TICK_LOWER, TICK_UPPER, 9e21, type(uint256).max, type(uint256).max);
        vault.collectFees(lpId);
        assertEq(vault.claims(attacker, currency1), 0);
        assertEq(settlement.rewardLedger().claimable(attacker, Currency.unwrap(currency1)), 0);
        assertEq(settlement.rewardLedger().claimable(address(this), Currency.unwrap(currency1)), pot);
        vault.removeLiquidity(lpId, 9e21, 0, 0);
        vm.stopPrank();
    }
}

contract GrantReviewRefundTest is OtterOrderBookTest {
    function test_review_BlockedRecipientOnlyPreventsItsOwnClaim() public {
        (uint256 id, OtterOrderBook.Order[] memory os) = _submitTwo();
        vm.warp(block.timestamp + WINDOW + REFUND_DELAY);
        vm.mockCall(
            address(currency1),
            abi.encodeWithSelector(currency1.transfer.selector, bob, os[1].budget),
            abi.encode(false)
        );
        uint256 aliceBefore = currency0.balanceOf(alice);
        book.refundExpired(POOL, id, os);
        (,, bool spent) = book.batches(POOL, id);
        assertTrue(spent);
        vm.prank(alice);
        book.claim(address(currency0), os[0].budget, alice);
        assertEq(currency0.balanceOf(alice), aliceBefore + os[0].budget);
        vm.prank(bob);
        vm.expectRevert(bytes("TRANSFER_FAILED"));
        book.claim(address(currency1), os[1].budget, bob);
        assertEq(book.claimable(bob, address(currency1)), os[1].budget);
        vm.prank(bob);
        book.claim(address(currency1), os[1].budget, address(0xCAFE));
        assertEq(currency1.balanceOf(address(0xCAFE)), os[1].budget);
    }

    function test_review_BatchBoundAndIndependentRecoveryFitFixedGas() public {
        for (uint256 i; i < 32; ++i) {
            OtterOrderBook.Order memory o = _order(alice, i, true);
            o.budget = 1;
            (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _one(o, _sign(alicePk, o));
            book.submit(os, sigs);
        }
        OtterOrderBook.Order memory extra = _order(alice, 32, true);
        (OtterOrderBook.Order[] memory extraOs, bytes[] memory extraSigs) = _one(extra, _sign(alicePk, extra));
        vm.expectRevert(OtterOrderBook.BatchFull.selector);
        book.submit(extraOs, extraSigs);
        assertEq(book.nonceBitmap(alice, 0), type(uint32).max);
        vm.warp(book.executionDeadline(POOL, 0));
        book.expire{gas: 100_000}(POOL, 0);
        assertFalse(book.isBatchActive(POOL));
        book.refundOrder{gas: 150_000}(POOL, 0, 31);
        assertEq(book.claimable(alice, address(currency0)), 1);
        assertFalse(book.orderRecovered(POOL, 0, 0));
        assertTrue(book.orderRecovered(POOL, 0, 31));
    }
}
