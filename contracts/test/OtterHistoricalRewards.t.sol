// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {AssetToken} from "./OtterAssets.t.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {OtterRewardLedger} from "../src/OtterRewardLedger.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {IOtterLiquidityGuard} from "../src/interfaces/IOtterLiquidityGuard.sol";

/// @notice Real-vault/real-manager history, rewards, expiry and exit integration.
/// Zero trader payments remain a legal legacy outcome: R2 is NOT closed here.
contract OtterHistoricalRewardsTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function _id() internal view returns (bytes32) {
        return PoolId.unwrap(otterId);
    }

    function _ledger() internal view returns (OtterRewardLedger) {
        return settlement.rewardLedger();
    }

    function _addOwner(address who, uint128 liquidity) internal returns (uint256 positionId) {
        deal(Currency.unwrap(currency0), who, 1e30);
        deal(Currency.unwrap(currency1), who, 1e30);
        vm.startPrank(who);
        IFixtureToken(Currency.unwrap(currency0)).approve(address(vault), type(uint256).max);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        positionId =
            vault.createPosition(otterKey, TICK_LOWER, TICK_UPPER, liquidity, type(uint256).max, type(uint256).max);
        vm.stopPrank();
    }

    function _submit(uint256 nonce) internal returns (uint256 epoch, OtterOrderBook.Order[] memory os) {
        bytes[] memory signatures;
        (os, signatures) = _prepareActiveOrder();
        os[0].nonce = nonce;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        signatures[0] = abi.encodePacked(r, s, v);
        epoch = book.submit(os, signatures);
    }

    function _settle(uint256 epoch, OtterOrderBook.Order[] memory os) internal returns (uint256 pot) {
        vm.warp(block.timestamp + 60);
        uint256[] memory y = new uint256[](1);
        y[0] = os[0].budget;
        settlement.settle(otterKey, epoch, os, OtterSettlement.Outcome(true, y, new uint256[](1)));
        pot = _ledger().epochSurplus(_id(), epoch, Currency.unwrap(currency1));
        assertTrue(_ledger().credited(_id(), epoch));
    }

    function test_openingCapitalWeightsAndDustExhaustActualCash() public {
        address alice = address(0xA1);
        address bob = address(0xB1);
        _addOwner(alice, 333e18);
        _addOwner(bob, 777e18);
        uint256 zero = _addOwner(address(0xC1), 1);
        (uint256 epoch, OtterOrderBook.Order[] memory os) = _submit(0);
        uint256[] memory weights = book.openingRewardWeights(_id(), epoch);
        IOtterLiquidityGuard.PositionSnapshot[] memory ps = book.openingPositions(_id(), epoch);
        assertEq(ps[3].id, zero);
        assertEq(weights[3], 0);
        uint256 total = book.openingRewardWeight(_id(), epoch);
        assertEq(total, weights[0] + weights[1] + weights[2]);
        uint256 pot = _settle(epoch, os);
        uint256 own = FullMath.mulDiv(pot, weights[0], total);
        uint256 a = FullMath.mulDiv(pot, weights[1], total);
        uint256 b = FullMath.mulDiv(pot, weights[2], total);
        uint256 dust = pot - own - a - b;
        assertEq(_ledger().claimable(alice, Currency.unwrap(currency1)), a);
        assertEq(_ledger().claimable(bob, Currency.unwrap(currency1)), b);
        assertEq(_ledger().claimable(address(0xC1), Currency.unwrap(currency1)), 0);
        assertEq(_ledger().epochDust(_id(), epoch, Currency.unwrap(currency1)), dust);
        assertEq(_ledger().claimable(address(this), Currency.unwrap(currency1)), own + dust);
        assertEq(_ledger().totalClaimable(Currency.unwrap(currency1)), pot);
        assertEq(currency1.balanceOf(address(_ledger())), pot);
        assertEq(currency1.balanceOf(address(settlement)), 0);
    }

    function test_exitingOpeningOwnerRetainsRewardsAndLaterOwnerGetsOnlyNewEpoch() public {
        (uint256 epoch, OtterOrderBook.Order[] memory os) = _submit(0);
        uint256 prior = _settle(epoch, os);
        uint256[] memory frozen = book.openingRewardWeights(_id(), epoch);
        vault.removeLiquidity(1, 1e21, 0, 0);
        address later = address(0xBEEF);
        _addOwner(later, 1e21);
        assertEq(_ledger().claimable(later, Currency.unwrap(currency1)), 0);
        assertEq(_ledger().claimable(address(this), Currency.unwrap(currency1)), prior);
        assertEq(book.openingPositions(_id(), epoch)[0].owner, address(this));
        assertEq(book.openingRewardWeights(_id(), epoch)[0], frozen[0]);
        (uint256 next, OtterOrderBook.Order[] memory ns) = _submit(1);
        uint256 current = _settle(next, ns);
        uint256 dust = _ledger().epochDust(_id(), next, Currency.unwrap(currency1));
        assertEq(_ledger().claimable(later, Currency.unwrap(currency1)), current - dust);
        assertEq(_ledger().claimable(address(this), Currency.unwrap(currency1)), prior + dust);
        _ledger().claim(Currency.unwrap(currency1), prior, address(0xCAFE));
        assertEq(currency1.balanceOf(address(0xCAFE)), prior);
    }

    function test_reservedExitReceivesOpeningRewardBeforeIndependentProcessing() public {
        (uint256 epoch, OtterOrderBook.Order[] memory os) = _submit(0);
        vault.requestExit(1, 1e21);
        uint256 pot = _settle(epoch, os);
        (OtterOrderBook.Order[] memory next, bytes[] memory sigs) = _prepareActiveOrder();
        next[0].nonce = 1;
        vm.expectRevert(OtterLiquidityVault.PendingExits.selector);
        book.submit(next, sigs);
        vault.processExit(1);
        assertEq(_ledger().claimable(address(this), Currency.unwrap(currency1)), pot);
        _ledger().claim(Currency.unwrap(currency1), pot, address(0xCAFE));
        assertEq(currency1.balanceOf(address(0xCAFE)), pot);
        assertGt(vault.claims(address(this), currency1), 0);
    }

    function test_zeroPositiveWeightRejectedBeforeEscrowWithOpeningStateRolledBack() public {
        vault.removeLiquidity(1, 1e21, 0, 0);
        _addOwner(address(0xA1), 1);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        vm.expectRevert(OtterOrderBook.NoRewardWeight.selector);
        book.submit(os, sigs);
        assertEq(book.snapshotHash(_id(), 0), bytes32(0));
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 0);
        assertEq(book.nonceBitmap(os[0].trader, 0), 0);
        assertEq(uint8(book.batchState(_id(), 0)), uint8(OtterOrderBook.State.None));
    }

    function test_expiryCreditsNoRewardAndDoesNotReadHistoricalWeightsAgain() public {
        (uint256 epoch, OtterOrderBook.Order[] memory os) = _submit(0);
        vm.warp(book.executionDeadline(_id(), epoch));
        book.expire(_id(), epoch);
        vault.removeLiquidity(1, 1e21, 0, 0);
        book.refundOrder(_id(), epoch, 0);
        assertFalse(_ledger().credited(_id(), epoch));
        assertEq(_ledger().totalClaimable(Currency.unwrap(currency1)), 0);
        assertEq(book.claimable(os[0].trader, Currency.unwrap(currency0)), os[0].budget);
    }

    function test_multipleOpeningPositionsAggregateIntoSameOwnersIndependentClaim() public {
        address alice = address(0xA1);
        _addOwner(alice, 333e18);
        _addOwner(alice, 777e18);
        (uint256 epoch, OtterOrderBook.Order[] memory os) = _submit(0);
        uint256[] memory weights = book.openingRewardWeights(_id(), epoch);
        uint256 total = book.openingRewardWeight(_id(), epoch);
        uint256 pot = _settle(epoch, os);
        uint256 expected = FullMath.mulDiv(pot, weights[1], total) + FullMath.mulDiv(pot, weights[2], total);
        OtterRewardLedger ledger = _ledger();
        assertEq(ledger.claimable(alice, Currency.unwrap(currency1)), expected);
        vm.prank(alice);
        ledger.claim(Currency.unwrap(currency1), expected, address(0xCAFE));
        assertEq(currency1.balanceOf(address(0xCAFE)), expected);
    }

    function test_communityPolicyIsDeclaredBeforeOpeningAndCannotBeReplaced() public {
        (PoolKey memory k, PoolId id) = initPool(currency0, currency1, IHooks(address(hook)), 0, 2, SQRT_PRICE_1_1);
        address treasury = address(0xD057);
        vm.prank(address(0xBAD));
        vm.expectRevert(OtterSettlement.NotOwner.selector);
        settlement.registerPool(k, treasury);
        vm.prank(address(0xBAD));
        vm.expectRevert(OtterSettlement.NotOwner.selector);
        settlement.registerPool(k);
        settlement.registerPool(k, treasury);
        assertEq(_ledger().communityRecipientOf(PoolId.unwrap(id)), treasury);
        assertEq(book.rewardPolicyHashOf(PoolId.unwrap(id)), _ledger().policyHashOf(PoolId.unwrap(id)));
        vm.expectRevert(OtterRewardLedger.InvalidPolicy.selector);
        settlement.registerPool(k, address(0xBAD));
        assertEq(_ledger().communityRecipientOf(PoolId.unwrap(id)), treasury);
        assertEq(_ledger().communityRecipientOf(_id()), address(this));
    }

    function test_rewardFundingCannotBeCalledByOutsiderOrReplayed() public {
        OtterRewardLedger ledger = _ledger();
        vm.expectRevert(OtterRewardLedger.NotSettlement.selector);
        ledger.creditEpoch(_id(), 0, 0, 0);
        vm.prank(address(settlement));
        vm.expectRevert(OtterRewardLedger.InvalidEpoch.selector);
        ledger.creditEpoch(_id(), 0, 0, 0);
        (uint256 epoch, OtterOrderBook.Order[] memory os) = _submit(0);
        _settle(epoch, os);
        vm.prank(address(settlement));
        vm.expectRevert(OtterRewardLedger.AlreadyCredited.selector);
        ledger.creditEpoch(_id(), epoch, 0, 0);
    }

    function test_externalDonationsRemainPositionFeesAndNeverBecomeHistoricalCash() public {
        uint256[] memory beforeWeights;
        (uint256 epoch, OtterOrderBook.Order[] memory os) = _submit(0);
        beforeWeights = book.openingRewardWeights(_id(), epoch);
        donateRouter.donate(otterKey, 1e18, 2e18, ZERO_BYTES);
        uint256 pot = _settle(epoch, os);
        assertEq(book.openingRewardWeights(_id(), epoch)[0], beforeWeights[0]);
        vault.collectFees(1);
        assertGt(vault.claims(address(this), currency0), 0);
        assertGt(vault.claims(address(this), currency1), 0);
        assertEq(_ledger().claimable(address(this), Currency.unwrap(currency1)), pot);
        assertEq(_ledger().claimable(address(this), Currency.unwrap(currency0)), 0);
    }

    function test_maximumOpeningOwnersReceiveBoundedRewardAllocation() public {
        for (uint256 i; i < 31; ++i) {
            _addOwner(address(uint160(0x1000 + i)), uint128(1e18 + i));
        }
        (uint256 epoch, OtterOrderBook.Order[] memory os) = _submit(0);
        assertEq(book.openingPositions(_id(), epoch).length, 32);
        vm.warp(block.timestamp + 60);
        OtterRewardLedger ledger = _ledger();
        vm.cool(address(ledger));
        vm.cool(address(book));
        vm.cool(address(settlement));
        vm.cool(address(manager));
        uint256[] memory y = new uint256[](1);
        y[0] = os[0].budget;
        uint256 beforeGas = gasleft();
        settlement.settle(otterKey, epoch, os, OtterSettlement.Outcome(true, y, new uint256[](1)));
        emit log_named_uint("32-opening-owner one-order settlement call gas", beforeGas - gasleft());
        uint256 pot = ledger.epochSurplus(_id(), epoch, Currency.unwrap(currency1));
        uint256 total = ledger.claimable(address(this), Currency.unwrap(currency1));
        for (uint256 i; i < 31; ++i) {
            uint256 reward = ledger.claimable(address(uint160(0x1000 + i)), Currency.unwrap(currency1));
            assertGt(reward, 0);
            total += reward;
        }
        assertEq(total, pot);
        assertEq(currency1.balanceOf(address(ledger)), pot);
    }

    function test_failedRewardPullRollsBackEntireSwapAndPreservesIndependentRefund() public {
        AssetToken asset = new AssetToken();
        (PoolKey memory key, PoolId id) = initPool(
            Currency.wrap(address(0)), Currency.wrap(address(asset)), IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1
        );
        settlement.registerPool(key);
        asset.mint(address(this), 2e21);
        asset.approve(address(vault), type(uint256).max);
        vm.deal(address(this), 1e25);
        uint256 debt =
            SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(TICK_UPPER), 1e21, true);
        vault.createPosition{value: debt}(key, TICK_LOWER, TICK_UPPER, 1e21, type(uint256).max, type(uint256).max);
        bytes32 pool = PoolId.unwrap(id);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        os[0] = OtterOrderBook.Order(
            vm.addr(0xA11CE), pool, true, 0, 1e18, block.timestamp + 1 days, 0, 1, 0, block.timestamp + 1 days
        );
        bytes[] memory signatures = new bytes[](1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        signatures[0] = abi.encodePacked(r, s, v);
        uint256 epoch = book.submit{value: 1e18}(os, signatures);
        vm.warp(block.timestamp + 60);
        // Only the later transfer FROM settlement is taxed. Manager output is
        // exact, and zero trader outputs make the reward pull the failing step.
        asset.configureTaxedSender(address(settlement));
        asset.configure(false, false, true);
        uint256[] memory y = new uint256[](1);
        y[0] = 1e18;
        vm.expectPartialRevert(OtterRewardLedger.InexactTransfer.selector);
        settlement.settle(key, epoch, os, OtterSettlement.Outcome(true, y, new uint256[](1)));
        (uint160 price,,,) = manager.getSlot0(id);
        assertEq(price, SQRT_PRICE_1_1);
        assertFalse(_ledger().credited(pool, epoch));
        assertFalse(book.executionInProgress(pool));
        assertFalse(book.payoutsCredited(pool, epoch));
        assertEq(book.totalEscrow(address(0)), 1e18);
        assertEq(asset.balanceOf(address(_ledger())), 0);
        vm.warp(book.executionDeadline(pool, epoch));
        book.expire(pool, epoch);
        book.refundOrder(pool, epoch, 0);
        assertEq(book.claimable(os[0].trader, address(0)), 1e18);
        vm.prank(os[0].trader);
        book.claim(address(0), 1e18, address(0xCAFE));
        assertEq(address(0xCAFE).balance, 1e18);
    }
}
