// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";

contract ExitReceiver {
    OtterLiquidityVault immutable vault;
    uint256 immutable target;
    bool immutable reject;
    bytes4 public rejectedWith;

    constructor(OtterLiquidityVault vault_, uint256 id, bool reject_) {
        vault = vault_;
        target = id;
        reject = reject_;
    }

    receive() external payable {
        require(!reject, "reject ETH");
        try vault.processExit(target) {}
        catch (bytes memory reason) {
            rejectedWith = bytes4(reason);
        }
    }
}

contract OtterExitsTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    function _liquidity(uint256 id) internal view returns (uint128 amount) {
        (,,,, amount) = vault.positions(id);
    }

    function _expire() internal {
        uint256 id = book.currentBatchId(PoolId.unwrap(otterId));
        vm.warp(book.executionDeadline(PoolId.unwrap(otterId), id));
        book.expire(PoolId.unwrap(otterId), id);
    }

    function _newOwned(PoolKey memory key, int24 lower, int24 upper, uint128 amount, address who)
        internal
        returns (uint256 id)
    {
        deal(Currency.unwrap(key.currency1), who, 1e30);
        if (!key.currency0.isAddressZero()) deal(Currency.unwrap(key.currency0), who, 1e30);
        (uint160 price,,,) = manager.getSlot0(key.toId());
        uint256 nativeDebt = key.currency0.isAddressZero()
            ? SqrtPriceMath.getAmount0Delta(price, TickMath.getSqrtPriceAtTick(upper), amount, true)
            : 0;
        vm.deal(who, nativeDebt);
        vm.startPrank(who);
        IFixtureToken(Currency.unwrap(key.currency1)).approve(address(vault), type(uint256).max);
        if (!key.currency0.isAddressZero()) {
            IFixtureToken(Currency.unwrap(key.currency0)).approve(address(vault), type(uint256).max);
        }
        id = vault.createPosition{value: nativeDebt}(key, lower, upper, amount, type(uint256).max, type(uint256).max);
        vm.stopPrank();
    }

    function _nextOrder() internal returns (OtterOrderBook.Order[] memory os, bytes[] memory sigs) {
        (os, sigs) = _prepareActiveOrder();
        os[0].nonce = 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
    }

    function _settleCurrent(uint256 id) internal {
        uint256[] memory y = new uint256[](1);
        y[0] = submittedOrders[0].budget;
        settlement.settle(otterKey, id, submittedOrders, OtterSettlement.Outcome(true, y, new uint256[](1)));
    }

    function test_exitRequestsAuthenticateReserveAndDoNotMutatePool() public {
        _submitActiveOrder();
        bytes32 pool = PoolId.unwrap(otterId);
        vm.prank(address(0xBAD));
        vm.expectRevert(OtterLiquidityVault.NotPositionOwner.selector);
        vault.requestExit(1, 1);
        vm.expectRevert(OtterLiquidityVault.NotPositionOwner.selector);
        vault.requestExit(99, 1);
        vm.expectRevert(OtterLiquidityVault.InvalidLiquidity.selector);
        vault.requestExit(1, 0);
        vm.expectRevert(OtterLiquidityVault.InvalidLiquidity.selector);
        vault.requestExit(1, 1e21 + 1);
        vault.requestExit(1, 4e20);
        assertEq(vault.queuedLiquidity(1), 4e20);
        assertEq(vault.pendingExitCount(pool), 1);
        assertEq(vault.queuedExitIds(pool)[0], 1);
        assertEq(manager.getLiquidity(otterId), 1e21);
        vm.expectRevert(OtterLiquidityVault.ExitAlreadyQueued.selector);
        vault.requestExit(1, 1);
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.processExit(1);
        vm.expectRevert(OtterOrderBook.FeesStillSupported.selector);
        book.expireUnsupportedFees(pool, 0);
    }

    function test_expiryExitBarrierPrecedesNextAdmissionAndKeepsRefundBacking() public {
        _submitActiveOrder();
        vault.requestExit(1, 1e18);
        _expire();
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _nextOrder();
        vm.expectRevert(OtterLiquidityVault.PendingExits.selector);
        book.submit(os, sigs);
        vm.expectRevert(OtterLiquidityVault.PendingExits.selector);
        vault.increaseLiquidity(1, 1, 1, 1);
        vm.expectRevert(OtterLiquidityVault.PendingExits.selector);
        vault.createPosition(otterKey, -120, 120, 1, 1, 1);
        assertEq(book.nonceBitmap(os[0].trader, 0), 1);
        vm.prank(address(0xBEEF));
        (uint256 c0, uint256 c1) = vault.processExit(1);
        assertGt(c0, 0);
        assertGt(c1, 0);
        assertEq(vault.claims(address(0xBEEF), currency0), 0);
        assertEq(vault.claims(address(this), currency0), c0);
        assertEq(vault.pendingExitCount(PoolId.unwrap(otterId)), 0);
        assertEq(book.submit(os, sigs), 1);
        book.refundOrder(PoolId.unwrap(otterId), 0, 0);
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 1e18);
        assertEq(book.claimable(os[0].trader, Currency.unwrap(currency0)), 1e18);
        vm.expectRevert(OtterLiquidityVault.ExitNotQueued.selector);
        vault.processExit(1);
    }

    function test_reservedExitCannotTruncateCurrentCollectionWindow() public {
        _submitActiveOrder();
        vault.requestExit(1, 1e18);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _nextOrder();
        assertEq(book.submit(os, sigs), 0);
        (, uint32 count,) = book.batches(PoolId.unwrap(otterId), 0);
        assertEq(count, 2);
        _expire();
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 2e18);
        vault.processExit(1);
        book.refundOrder(PoolId.unwrap(otterId), 0, 0);
        book.refundOrder(PoolId.unwrap(otterId), 0, 1);
        assertEq(book.claimable(os[0].trader, Currency.unwrap(currency0)), 2e18);
    }

    function test_queuedExitCannotVetoSwapAndUsesResultingPrincipal() public {
        uint256 id = _submitActiveOrder();
        uint128 reserved = 4e20;
        vault.requestExit(1, reserved);
        vm.warp(block.timestamp + 60);
        _settleCurrent(id);
        (uint160 price,,,) = manager.getSlot0(otterId);
        assertLt(price, SQRT_PRICE_1_1);
        uint256 expected0 =
            SqrtPriceMath.getAmount0Delta(price, TickMath.getSqrtPriceAtTick(TICK_UPPER), reserved, false);
        uint256 expected1 =
            SqrtPriceMath.getAmount1Delta(TickMath.getSqrtPriceAtTick(TICK_LOWER), price, reserved, false);
        (uint256 c0, uint256 c1) = vault.processExit{gas: 500_000}(1);
        assertEq(c0, expected0);
        assertEq(c1, expected1);
        assertEq(manager.getLiquidity(otterId), 1e21 - reserved);
        assertEq(vault.totalLiquidity(PoolId.unwrap(otterId)), 1e21 - reserved);
        assertEq(uint8(book.batchState(PoolId.unwrap(otterId), id)), uint8(OtterOrderBook.State.Settled));
    }

    function test_executionAndBookCallbacksKeepExitFrozenUntilCompletion() public {
        uint256 id = _submitActiveOrder();
        vm.warp(block.timestamp + 60);
        vm.prank(address(settlement));
        book.consume(PoolId.unwrap(otterId), id, submittedOrders);
        vault.requestExit(1, 1e18);
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.processExit(1);
        vm.prank(address(settlement));
        book.releaseFilled(PoolId.unwrap(otterId), submittedOrders, new uint256[](1));
        vm.prank(address(settlement));
        book.creditPayouts(PoolId.unwrap(otterId), submittedOrders, new uint256[](1));
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.processExit(1);
        vm.prank(address(settlement));
        book.completeExecution(PoolId.unwrap(otterId));
        vault.processExit(1);
        assertEq(vault.queuedLiquidity(1), 0);
    }

    function test_immediateRemovalCannotSpendReservedLiquidityAndIdsRemainOwned() public {
        vault.requestExit(1, 4e20);
        vm.expectRevert(OtterLiquidityVault.InvalidLiquidity.selector);
        vault.removeLiquidity(1, 6e20 + 1, 0, 0);
        vault.removeLiquidity(1, 6e20, 0, 0);
        assertEq(_liquidity(1), 4e20);
        vault.processExit(1);
        assertEq(_liquidity(1), 0);
        assertEq(vault.openPositionIds(PoolId.unwrap(otterId)).length, 0);
        vm.expectRevert(OtterLiquidityVault.InvalidLiquidity.selector);
        vault.requestExit(1, 1);
        vm.expectRevert(OtterLiquidityVault.InvalidLiquidity.selector);
        vault.requestExit(1, 0);
        vault.increaseLiquidity(1, 1e18, type(uint256).max, type(uint256).max);
        vault.requestExit(1, 1);
        vault.processExit(1);
        assertEq(vault.nextPositionId(), 2);
        assertEq(_liquidity(1), 1e18 - 1);
    }

    function test_blockedTokenCannotVetoProcessingOrOtherCurrencyClaim() public {
        _submitActiveOrder();
        vault.requestExit(1, 1e18);
        _expire();
        vm.mockCallRevert(
            Currency.unwrap(currency0), abi.encodeWithSelector(bytes4(keccak256("balanceOf(address)"))), "blocked token"
        );
        vm.mockCallRevert(
            Currency.unwrap(currency0),
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)"))),
            "blocked token"
        );
        vault.processExit(1);
        uint256 c0 = vault.claims(address(this), currency0);
        uint256 c1 = vault.claims(address(this), currency1);
        vm.expectRevert(bytes("blocked token"));
        vault.claim(currency0, c0, address(0xCAFE));
        assertEq(vault.claims(address(this), currency0), c0);
        vault.claim(currency1, c1, address(0xCAFE));
        assertEq(vault.claims(address(this), currency1), 0);
        assertEq(manager.balanceOf(address(vault), currency0.toId()), c0);
        book.refundOrder(PoolId.unwrap(otterId), 0, 0);
    }

    function test_failedExitRollsBackAndDoesNotForceHeadOfLineProcessing() public {
        uint256 other = _newOwned(otterKey, TICK_LOWER, TICK_UPPER, 1e18, address(0xA1));
        vault.requestExit(1, 1e18);
        vm.prank(address(0xA1));
        vault.requestExit(other, 1e18);
        bytes memory exact = abi.encodeCall(
            manager.modifyLiquidity,
            (
                otterKey,
                IPoolManager.ModifyLiquidityParams(TICK_LOWER, TICK_UPPER, -int256(1e18), bytes32(uint256(1))),
                bytes("")
            )
        );
        vm.mockCallRevert(address(manager), exact, "manager failure");
        vm.expectRevert(bytes("manager failure"));
        vault.processExit(1);
        assertEq(_liquidity(1), 1e21);
        assertEq(vault.queuedLiquidity(1), 1e18);
        assertEq(vault.pendingExitCount(PoolId.unwrap(otterId)), 2);
        vault.processExit(other);
        assertEq(vault.pendingExitCount(PoolId.unwrap(otterId)), 1);
        assertEq(vault.claims(address(0xA1), currency0), manager.balanceOf(address(vault), currency0.toId()));
        vm.clearMockedCalls();
        vault.processExit(1);
        assertEq(vault.pendingExitCount(PoolId.unwrap(otterId)), 0);
    }

    function test_pauseAndUnsupportedFeesCannotStopAuthorizedExitProcessing() public {
        _submitActiveOrder();
        vault.requestExit(1, 1e18);
        book.setAdmissionPaused(true);
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(otterKey, 1000);
        book.expireUnsupportedFees(PoolId.unwrap(otterId), 0);
        vault.processExit(1);
        assertEq(vault.queuedLiquidity(1), 0);
        uint256 amount = vault.claims(address(this), currency0);
        vault.claim(currency0, amount, address(0xCAFE));
        assertEq(vault.claims(address(this), currency0), 0);
    }

    function test_nativeClaimsAndCrossPoolQueueAreIndependentAndRejectReentry() public {
        (PoolKey memory key, PoolId id) =
            initPool(Currency.wrap(address(0)), currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(key);
        address first = address(0xA1);
        address second = address(0xA2);
        uint256 a = _newOwned(key, TICK_LOWER, TICK_UPPER, 1e18, first);
        uint256 b = _newOwned(key, TICK_LOWER, TICK_UPPER, 1e18, second);
        vm.prank(first);
        vault.requestExit(a, 1e18);
        vm.prank(second);
        vault.requestExit(b, 1e18);
        // A pending queue in the native pool cannot lock an unrelated ERC20 pool.
        _submitActiveOrder();
        vault.processExit(a);
        assertEq(first.balance, 0);
        Currency native = Currency.wrap(address(0));
        uint256 amount = vault.claims(first, native);
        ExitReceiver rejector = new ExitReceiver(vault, b, true);
        vm.prank(first);
        vm.expectRevert();
        vault.claim(native, amount, address(rejector));
        assertEq(vault.claims(first, native), amount);
        uint256 tokenAmount = vault.claims(first, currency1);
        vm.prank(first);
        vault.claim(currency1, tokenAmount, first);
        ExitReceiver reentrant = new ExitReceiver(vault, b, false);
        vm.prank(first);
        vault.claim(native, amount, address(reentrant));
        assertEq(reentrant.rejectedWith(), OtterLiquidityVault.ReentrantCall.selector);
        assertEq(vault.queuedLiquidity(b), 1e18);
        assertEq(vault.pendingExitCount(PoolId.unwrap(id)), 1);
        vault.processExit(b);
        assertEq(vault.pendingExitCount(PoolId.unwrap(id)), 0);
        assertTrue(book.isBatchActive(PoolId.unwrap(otterId)));
    }

    function test_concentratedAndOneSidedPositionsExitWithoutLegacyQuote() public {
        uint256 a = _newOwned(otterKey, -120, 120, 1e18, address(0xA1));
        uint256 b = _newOwned(otterKey, 120, 240, 1e18, address(0xA2));
        vm.prank(address(0xA1));
        vault.requestExit(a, 1e18);
        vm.prank(address(0xA2));
        vault.requestExit(b, 1e18);
        vault.processExit(a);
        vault.processExit(b);
        assertGt(vault.claims(address(0xA1), currency0), 0);
        assertGt(vault.claims(address(0xA1), currency1), 0);
        assertGt(vault.claims(address(0xA2), currency0), 0);
        assertEq(vault.claims(address(0xA2), currency1), 0);
        assertEq(vault.concentratedPositions(PoolId.unwrap(otterId)), 0);
        _submitActiveOrder();
    }

    function test_finalPriceMoveBeyondDepositDomainCannotCapPrincipalExit() public {
        uint160 start = (uint160(1) << 128) - (uint160(1) << 96);
        (PoolKey memory key, PoolId pool) = initPool(currency0, currency1, IHooks(address(hook)), 0, 2, start);
        settlement.registerPool(key);
        MockERC20(Currency.unwrap(currency1)).mint(address(this), 1 << 122);
        IFixtureToken(Currency.unwrap(currency0)).approve(address(vault), type(uint256).max);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        uint128 liquidity = vault.MAX_POOL_LIQUIDITY();
        uint256 lp = vault.createPosition(key, TICK_LOWER, TICK_UPPER, liquidity, type(uint256).max, type(uint256).max);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        bytes[] memory sigs = new bytes[](1);
        address trader = vm.addr(0xA11CE);
        uint256 budget = book.MAX_BUDGET();
        deal(Currency.unwrap(currency1), trader, budget);
        vm.prank(trader);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(book), budget);
        os[0] = OtterOrderBook.Order(
            trader, PoolId.unwrap(pool), false, 0, budget, block.timestamp + 1 days, 0, 1, 0, block.timestamp + 1 days
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
        uint256 epoch = book.submit(os, sigs);
        vault.requestExit(lp, liquidity);
        vm.warp(block.timestamp + 60);
        uint256[] memory y = new uint256[](1);
        y[0] = budget;
        settlement.settle(key, epoch, os, OtterSettlement.Outcome(false, y, new uint256[](1)));
        (uint160 end,,,) = manager.getSlot0(pool);
        assertGe(end, uint160(1) << 128);
        (, uint256 c1) = vault.processExit(lp);
        assertGt(c1, vault.MAX_AMOUNT());
        vault.claim(currency1, vault.MAX_AMOUNT(), address(0xCAFE));
        vault.claim(currency1, c1 - vault.MAX_AMOUNT(), address(0xCAFE));
        assertEq(vault.claims(address(this), currency1), 0);
        assertEq(manager.getLiquidity(pool), 0);
    }

    function testFuzz_boundedQueuesProcessArbitraryEntriesWithColdCalls(uint8 rawCount, uint256 seed) public {
        uint256 count = bound(rawCount, 1, 32);
        uint256[] memory ids = new uint256[](count);
        address[] memory owners = new address[](count);
        ids[0] = 1;
        owners[0] = address(this);
        for (uint256 i = 1; i < count; ++i) {
            owners[i] = address(uint160(0x100 + i));
            ids[i] = _newOwned(otterKey, TICK_LOWER, TICK_UPPER, 1e18, owners[i]);
        }
        _submitActiveOrder();
        for (uint256 i; i < count; ++i) {
            vm.prank(owners[i]);
            vault.requestExit(ids[i], 1e18);
        }
        _expire();
        uint256 remaining = count;
        uint256 maximum;
        while (remaining != 0) {
            uint256 index = seed % remaining;
            uint256 id = ids[index];
            address who = owners[index];
            vm.cool(address(vault));
            vm.cool(address(book));
            vm.cool(address(manager));
            vm.cool(address(hook));
            uint256 before = gasleft();
            (uint256 c0, uint256 c1) = vault.processExit{gas: 500_000}(id);
            uint256 used = before - gasleft();
            if (used > maximum) maximum = used;
            assertEq(vault.queuedLiquidity(id), 0);
            assertEq(vault.claims(who, currency0), c0);
            assertEq(vault.claims(who, currency1), c1);
            --remaining;
            assertEq(vault.pendingExitCount(PoolId.unwrap(otterId)), remaining);
            ids[index] = ids[remaining];
            owners[index] = owners[remaining];
            seed = uint256(keccak256(abi.encode(seed)));
        }
        assertLt(maximum, 500_000);
        assertEq(vault.queuedExitIds(PoolId.unwrap(otterId)).length, 0);
        assertEq(manager.balanceOf(address(vault), currency0.toId()), vault.totalClaims(currency0));
        assertEq(manager.balanceOf(address(vault), currency1.toId()), vault.totalClaims(currency1));
        assertEq(manager.getLiquidity(otterId), 1e21 - 1e18);
    }

    function test_coldMaximalQueueExitResourceEnvelope() public {
        uint256[] memory ids = new uint256[](32);
        address[] memory owners = new address[](32);
        ids[0] = 1;
        owners[0] = address(this);
        for (uint256 i = 1; i < 32; ++i) {
            owners[i] = address(uint160(0x100 + i));
            ids[i] = _newOwned(otterKey, TICK_LOWER, TICK_UPPER, 1e18, owners[i]);
        }
        _submitActiveOrder();
        for (uint256 i; i < 32; ++i) {
            uint128 amount = _liquidity(ids[i]);
            vm.prank(owners[i]);
            vault.requestExit(ids[i], amount);
        }
        _expire();
        uint256 maximum;
        for (uint256 i = 32; i != 0; --i) {
            vm.cool(address(vault));
            vm.cool(address(book));
            vm.cool(address(manager));
            vm.cool(address(hook));
            uint256 before = gasleft();
            vault.processExit{gas: 500_000}(ids[i - 1]);
            uint256 used = before - gasleft();
            if (used > maximum) maximum = used;
        }
        emit log_named_uint("cold exit execution gas, maximum of 32", maximum);
        assertEq(manager.getLiquidity(otterId), 0);
        assertEq(vault.pendingExitCount(PoolId.unwrap(otterId)), 0);
        assertEq(vault.openPositionIds(PoolId.unwrap(otterId)).length, 0);
        assertEq(manager.balanceOf(address(vault), currency0.toId()), vault.totalClaims(currency0));
    }
}
