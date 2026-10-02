// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {OtterPoolMath} from "../src/OtterHook.sol";
import {OtterMath} from "../src/OtterMath.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {AssetToken, RejectingAssetReceiver} from "./OtterAssets.t.sol";

contract FeeChangingAsset is AssetToken {
    IPoolManager immutable manager;
    PoolKey private key;
    address private triggerRecipient;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function configureFeeChange(PoolKey memory key_, address recipient) external {
        key = key_;
        triggerRecipient = recipient;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool result = super.transfer(to, amount);
        if (to == triggerRecipient) manager.setProtocolFee(key, 1000);
        return result;
    }
}

contract OtterNativeSettlementTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    PoolKey internal ethKey;
    PoolId internal nativeId;
    address internal alice;
    address internal bob;

    function setUp() public override {
        super.setUp();
        alice = vm.addr(0xA11CE);
        bob = vm.addr(0xB0B);
        (ethKey, nativeId) = initPool(Currency.wrap(address(0)), currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(ethKey);
        vm.deal(address(this), 1e25);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        uint256 nativeDebt =
            SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(TICK_UPPER), 1e21, true);
        vault.createPosition{value: nativeDebt}(
            ethKey, TICK_LOWER, TICK_UPPER, 1e21, type(uint256).max, type(uint256).max
        );
    }

    function _batch(bool dominantNative, uint256 domBudget, uint256 minBudget)
        internal
        returns (uint256 id, OtterOrderBook.Order[] memory orders, OtterSettlement.Outcome memory outcome)
    {
        orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        orders[0] = OtterOrderBook.Order(
            alice, PoolId.unwrap(nativeId), dominantNative, 0, domBudget, block.timestamp + 1 days, 0
        );
        orders[1] = OtterOrderBook.Order(
            bob, PoolId.unwrap(nativeId), !dominantNative, 0, minBudget, block.timestamp + 1 days, 0
        );
        for (uint256 i; i < 2; ++i) {
            if (!orders[i].sellingCurrency0) {
                deal(Currency.unwrap(currency1), orders[i].trader, orders[i].budget);
                vm.prank(orders[i].trader);
                IFixtureToken(Currency.unwrap(currency1)).approve(address(book), orders[i].budget);
            }
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(i == 0 ? 0xA11CE : 0xB0B, book.digestOf(orders[i]));
            sigs[i] = abi.encodePacked(r, s, v);
        }
        id = book.submit{value: dominantNative ? domBudget : minBudget}(orders, sigs);
        vm.warp(block.timestamp + 60);
        (uint160 price,,,) = manager.getSlot0(nativeId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(price, manager.getLiquidity(nativeId));
        OtterMath.Curve memory curve = dominantNative ? OtterMath.Curve(r1, r0, 0) : OtterMath.Curve(r0, r1, 0);
        curve.M = curve.y0 * minBudget / curve.x0;
        outcome = OtterSettlement.Outcome(dominantNative, new uint256[](2), new uint256[](2));
        outcome.y[0] = domBudget;
        outcome.y[1] = minBudget;
        outcome.x[0] = OtterMath.fTildeSettleable(curve, domBudget);
        outcome.x[1] = curve.M;
    }

    function _assertSettled(bool dominantNative, uint256 domBudget, uint256 minBudget) internal {
        (uint256 id, OtterOrderBook.Order[] memory os, OtterSettlement.Outcome memory out) =
            _batch(dominantNative, domBudget, minBudget);
        settlement.settle(ethKey, id, os, out);
        address domOut = dominantNative ? Currency.unwrap(currency1) : address(0);
        address minOut = dominantNative ? address(0) : Currency.unwrap(currency1);
        assertEq(book.claimable(alice, domOut), out.x[0]);
        assertEq(book.claimable(bob, minOut), out.x[1]);
        assertEq(alice.balance, 0);
        assertEq(bob.balance, 0);
        assertEq(book.totalEscrow(address(0)), 0);
        assertEq(book.totalEscrow(Currency.unwrap(currency1)), 0);
        assertFalse(book.isBatchActive(PoolId.unwrap(nativeId)));
        _claimAllTraders(book, ethKey, os);
        uint256 expectedNative = dominantNative ? out.x[1] : out.x[0];
        assertEq((dominantNative ? bob : alice).balance, expectedNative);
        Currency surplusCurrency = dominantNative ? currency1 : Currency.wrap(address(0));
        uint256 pot = settlement.pendingSurplus(nativeId, surplusCurrency);
        assertEq(settlement.totalPendingSurplus(surplusCurrency), pot);
        assertEq(dominantNative ? currency1.balanceOf(address(settlement)) : address(settlement).balance, pot);
        if (pot != 0) {
            settlement.flushSurplus(ethKey);
            assertEq(settlement.totalPendingSurplus(surplusCurrency), 0);
        }
    }

    function test_nativeDominantSwapAndClaims() public {
        _assertSettled(true, 10e18, 1e18);
    }

    function test_erc20DominantNativeOutputSwapAndClaims() public {
        _assertSettled(false, 10e18, 1e18);
    }

    function test_zeroResidualInputCreditsBothSidesWithoutUnlock() public {
        _assertSettled(true, 1e18, 1e18);
    }

    function testFuzz_nativeDirectionsAndClaims(bool nativeDominant, uint64 rawDom, uint64 rawMin) public {
        uint256 dom = bound(rawDom, 1e15, 10e18);
        uint256 min = bound(rawMin, 1, dom);
        _assertSettled(nativeDominant, dom, min);
    }

    function test_nativeOutputCannotBeBlockedByTraderReceiver() public {
        (uint256 id, OtterOrderBook.Order[] memory os, OtterSettlement.Outcome memory out) = _batch(false, 10e18, 1e18);
        // Turn the signed EOA into a rejecting receiver after admission. Neither
        // settlement nor timeout needs its receive function to succeed.
        address rejector = address(new RejectingAssetReceiver());
        vm.etch(alice, rejector.code);
        settlement.settle(ethKey, id, os, out);
        vm.prank(alice);
        vm.expectRevert(OtterOrderBook.NativeTransferFailed.selector);
        book.claim(address(0), out.x[0], alice);
        assertEq(book.claimable(alice, address(0)), out.x[0]);
        vm.prank(bob);
        book.claim(Currency.unwrap(currency1), out.x[1], bob);
        vm.prank(alice);
        book.claim(address(0), out.x[0], address(0xCAFE));
        assertEq(address(0xCAFE).balance, out.x[0]);
    }

    function test_unrequestedManagerCallbackAndNativeSenderAreRejected() public {
        vm.expectRevert(OtterSettlement.NotPoolManager.selector);
        settlement.unlockCallback("");
        vm.prank(address(manager));
        vm.expectRevert(OtterSettlement.InvalidCallback.selector);
        settlement.unlockCallback("");
        (bool ok,) = address(settlement).call{value: 1}("");
        assertFalse(ok);
    }

    function test_vaultSenderFeesAndLateClaimTaxPreserveBacking() public {
        AssetToken asset = new AssetToken();
        Currency tokenCurrency = Currency.wrap(address(asset));
        (PoolKey memory assetKey,) =
            initPool(Currency.wrap(address(0)), tokenCurrency, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        asset.mint(address(this), 10e18);
        asset.approve(address(vault), type(uint256).max);
        uint256 nativeDebt =
            SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(TICK_UPPER), 1e18, true);
        uint256 tokenDebt =
            SqrtPriceMath.getAmount1Delta(TickMath.getSqrtPriceAtTick(TICK_LOWER), SQRT_PRICE_1_1, 1e18, true);
        asset.configureSenderFee(true);
        vm.expectRevert(abi.encodeWithSelector(OtterLiquidityVault.InexactTransfer.selector, tokenCurrency, tokenDebt));
        vault.createPosition{value: nativeDebt}(
            assetKey, TICK_LOWER, TICK_UPPER, 1e18, type(uint256).max, type(uint256).max
        );
        assertEq(asset.balanceOf(address(this)), 10e18);
        asset.configureSenderFee(false);
        uint256 lpId = vault.createPosition{value: nativeDebt}(
            assetKey, TICK_LOWER, TICK_UPPER, 1e18, type(uint256).max, type(uint256).max
        );
        vault.removeLiquidity(lpId, 1e18, 0, 0);
        uint256 amount = vault.claims(address(this), tokenCurrency);
        uint256 backing = manager.balanceOf(address(vault), tokenCurrency.toId());
        // Sender-only fees must also be rejected at take: manager balances back
        // many users/pools, even if this recipient receives the requested amount.
        asset.mint(address(manager), 1);
        asset.configureSenderFee(true);
        vm.expectRevert(abi.encodeWithSelector(OtterLiquidityVault.InexactTransfer.selector, tokenCurrency, amount));
        vault.claim(tokenCurrency, amount, address(0xCAFE));
        asset.configureSenderFee(false);
        asset.configure(false, false, true);
        vm.expectRevert(abi.encodeWithSelector(OtterLiquidityVault.InexactTransfer.selector, tokenCurrency, amount));
        vault.claim(tokenCurrency, amount, address(0xCAFE));
        assertEq(vault.claims(address(this), tokenCurrency), amount);
        assertEq(manager.balanceOf(address(vault), tokenCurrency.toId()), backing);
        uint256 nativeClaim = vault.claims(address(this), Currency.wrap(address(0)));
        vault.claim(Currency.wrap(address(0)), nativeClaim, address(0xBEEF));
        asset.configure(true, false, false);
        vault.claim(tokenCurrency, amount, address(0xCAFE));
        assertEq(asset.balanceOf(address(0xCAFE)), amount);
    }

    function _taxAtManagerBoundary(bool sellsNative) internal {
        AssetToken asset = new AssetToken();
        Currency tokenCurrency = Currency.wrap(address(asset));
        (PoolKey memory key, PoolId id) =
            initPool(Currency.wrap(address(0)), tokenCurrency, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(key);
        asset.mint(address(this), 2e21);
        asset.approve(address(vault), type(uint256).max);
        uint256 nativeDebt =
            SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(TICK_UPPER), 1e21, true);
        vault.createPosition{value: nativeDebt}(key, TICK_LOWER, TICK_UPPER, 1e21, type(uint256).max, type(uint256).max);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        bytes[] memory sigs = new bytes[](1);
        os[0] = OtterOrderBook.Order(alice, PoolId.unwrap(id), sellsNative, 0, 10e18, block.timestamp + 1 days, 0);
        if (!sellsNative) {
            asset.mint(alice, 10e18);
            // Approval belongs to the funded token-input trader.
            vm.prank(alice);
            asset.approve(address(book), 10e18);
        }
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, sigS, v);
        uint256 batchId = book.submit{value: sellsNative ? 10e18 : 0}(os, sigs);
        vm.warp(block.timestamp + 60);
        uint256[] memory y = new uint256[](1);
        y[0] = 10e18;
        uint256[] memory x = new uint256[](1);
        x[0] = 5e18;
        asset.configureTaxedSender(sellsNative ? address(manager) : address(settlement));
        // A spare unit allows a sender surcharge to execute so the explicit
        // accounting check, rather than the token's balance underflow, rejects it.
        if (!sellsNative) asset.mint(address(settlement), 1);
        asset.configureSenderFee(true);
        vm.expectPartialRevert(OtterSettlement.InexactTransfer.selector);
        settlement.settle(key, batchId, os, OtterSettlement.Outcome(sellsNative, y, x));
        asset.configureSenderFee(false);
        asset.configure(false, false, true);
        vm.expectPartialRevert(OtterSettlement.InexactTransfer.selector);
        settlement.settle(key, batchId, os, OtterSettlement.Outcome(sellsNative, y, x));
        (,, bool spent) = book.batches(PoolId.unwrap(id), batchId);
        assertFalse(spent);
        vm.warp(block.timestamp + 900);
        book.refundExpired(PoolId.unwrap(id), batchId, os);
        address sold = sellsNative ? address(0) : address(asset);
        assertEq(book.claimable(alice, sold), 10e18);
        vm.prank(alice);
        book.claim(sold, 10e18, alice);
    }

    function test_poolOutputTaxCannotConsumeSharedManagerBacking() public {
        _taxAtManagerBoundary(true);
    }

    function test_poolDebtTaxCannotConsumeSettlementBacking() public {
        _taxAtManagerBoundary(false);
    }

    function _partialInputMustRevert(bool sellsNative) internal {
        // A small full-range position has finite capacity before the core's
        // extreme price limit. The requested input is deliberately larger.
        vault.removeLiquidity(2, 1e21, 0, 0);
        uint128 smallL = 1e9;
        uint256 nativeDebt =
            SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(TICK_UPPER), smallL, true);
        vault.createPosition{value: nativeDebt}(
            ethKey, TICK_LOWER, TICK_UPPER, smallL, type(uint256).max, type(uint256).max
        );
        uint256 budget = 1e30;
        vm.deal(address(this), 2e30);
        if (!sellsNative) {
            deal(Currency.unwrap(currency1), alice, budget);
            vm.prank(alice);
            IFixtureToken(Currency.unwrap(currency1)).approve(address(book), budget);
        }
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        bytes[] memory sigs = new bytes[](1);
        os[0] =
            OtterOrderBook.Order(alice, PoolId.unwrap(nativeId), sellsNative, 0, budget, block.timestamp + 1 days, 0);
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, sigS, v);
        uint256 id = book.submit{value: sellsNative ? budget : 0}(os, sigs);
        vm.warp(block.timestamp + 60);
        uint256[] memory y = new uint256[](1);
        y[0] = budget;
        uint256[] memory x = new uint256[](1);
        vm.expectPartialRevert(OtterSettlement.UnexpectedInputConsumption.selector);
        settlement.settle(ethKey, id, os, OtterSettlement.Outcome(sellsNative, y, x));
        (uint160 price,,,) = manager.getSlot0(nativeId);
        assertEq(price, SQRT_PRICE_1_1);
        assertEq(manager.getLiquidity(nativeId), smallL);
        (,, bool spent) = book.batches(PoolId.unwrap(nativeId), id);
        assertFalse(spent);
        address sold = sellsNative ? address(0) : Currency.unwrap(currency1);
        assertEq(book.totalEscrow(sold), budget);
        assertFalse(book.executionInProgress(PoolId.unwrap(nativeId)));
        vm.warp(block.timestamp + 900);
        book.refundExpired(PoolId.unwrap(nativeId), id, os);
        assertEq(book.claimable(alice, sold), budget);
        vm.prank(alice);
        book.claim(sold, budget, alice);
        assertEq(sellsNative ? alice.balance : currency1.balanceOf(alice), budget);
    }

    function test_partialNativeInputRevertsAndFullyRefunds() public {
        _partialInputMustRevert(true);
    }

    function test_partialERC20InputRevertsAndFullyRefunds() public {
        _partialInputMustRevert(false);
    }

    function test_feeChangeDuringEscrowReleaseIsCheckedAtSwapBoundary() public {
        FeeChangingAsset asset = new FeeChangingAsset(manager);
        Currency tokenCurrency = Currency.wrap(address(asset));
        (PoolKey memory key, PoolId id) =
            initPool(Currency.wrap(address(0)), tokenCurrency, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(key);
        asset.mint(address(this), 2e21);
        asset.approve(address(vault), type(uint256).max);
        uint256 nativeDebt =
            SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(TICK_UPPER), 1e21, true);
        vault.createPosition{value: nativeDebt}(key, TICK_LOWER, TICK_UPPER, 1e21, type(uint256).max, type(uint256).max);
        asset.mint(alice, 10e18);
        vm.prank(alice);
        asset.approve(address(book), 10e18);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        bytes[] memory sigs = new bytes[](1);
        os[0] = OtterOrderBook.Order(alice, PoolId.unwrap(id), false, 0, 10e18, block.timestamp + 1 days, 0);
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, sigS, v);
        uint256 batchId = book.submit(os, sigs);
        vm.warp(block.timestamp + 60);
        asset.configureFeeChange(key, address(settlement));
        manager.setProtocolFeeController(address(asset));
        uint256[] memory y = new uint256[](1);
        y[0] = 10e18;
        uint256[] memory x = new uint256[](1);
        x[0] = 5e18;
        vm.expectRevert(abi.encodeWithSelector(OtterSettlement.UnsupportedProtocolFee.selector, uint24(1000)));
        settlement.settle(key, batchId, os, OtterSettlement.Outcome(false, y, x));
        (,, bool spent) = book.batches(PoolId.unwrap(id), batchId);
        assertFalse(spent);
        assertEq(book.totalEscrow(address(asset)), 10e18);
        (,, uint24 fee,) = manager.getSlot0(id); // callback also rolled back
        assertEq(fee, 0);
        vm.warp(block.timestamp + 900);
        book.refundExpired(PoolId.unwrap(id), batchId, os);
        vm.prank(alice);
        book.claim(address(asset), 10e18, alice);
        assertEq(asset.balanceOf(alice), 10e18);
    }

    function test_protocolFeeAtRegistrationIsRejected() public {
        (PoolKey memory key,) =
            initPool(Currency.wrap(address(0)), currency1, IHooks(address(hook)), 0, 2, SQRT_PRICE_1_1);
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(key, 1000);
        vm.expectRevert(abi.encodeWithSelector(OtterSettlement.UnsupportedProtocolFee.selector, uint24(1000)));
        settlement.registerPool(key);
        assertFalse(book.registered(PoolId.unwrap(key.toId())));
    }
}
