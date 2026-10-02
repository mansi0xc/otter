// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";

contract RejectingLPRecipient {
    receive() external payable {
        revert("no ETH");
    }
}

contract OddVaultToken is MockERC20 {
    bool public tax;
    bool public falseReturn;
    bool public noReturn;
    constructor() MockERC20("Odd", "ODD", 18) {}

    function configure(bool tax_, bool false_, bool noReturn_) external {
        tax = tax_;
        falseReturn = false_;
        noReturn = noReturn_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (falseReturn) return false;
        bool ok = super.transferFrom(from, to, amount);
        if (tax) {
            uint256 fee = amount / 100;
            balanceOf[to] -= fee;
            totalSupply -= fee;
            emit Transfer(to, address(0), fee);
        }
        if (noReturn) assembly ("memory-safe") { return(0, 0) }
        return ok;
    }
}

contract CallbackVaultToken is MockERC20 {
    OtterLiquidityVault public target;
    uint256 public lpId;
    bool public attack;
    bytes public lastError;
    constructor() MockERC20("Callback", "CB", 18) {}

    function seed(OtterLiquidityVault vault, PoolKey calldata poolKey) external {
        IFixtureToken(Currency.unwrap(poolKey.currency0)).approve(address(vault), type(uint256).max);
        IFixtureToken(Currency.unwrap(poolKey.currency1)).approve(address(vault), type(uint256).max);
        target = vault;
        lpId = vault.createPosition(
            poolKey,
            TickMath.minUsableTick(poolKey.tickSpacing),
            TickMath.maxUsableTick(poolKey.tickSpacing),
            1e18,
            type(uint256).max,
            type(uint256).max
        );
    }

    function enableAttack() external {
        attack = true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (attack) {
            (bool ok, bytes memory reason) =
                address(target).call(abi.encodeCall(target.removeLiquidity, (lpId, uint128(1), 0, 0)));
            require(!ok, "unexpected LP mutation");
            lastError = reason;
        }
        return super.transferFrom(from, to, amount);
    }
}

contract OtterLiquidityVaultTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    function test_outsiderCannotModifyCollectOrRedirectOwnersClaim() public {
        address outsider = address(0xBAD);
        vm.startPrank(outsider);
        vm.expectRevert(OtterLiquidityVault.NotPositionOwner.selector);
        vault.removeLiquidity(1, 1e18, 0, 0);
        vm.expectRevert(OtterLiquidityVault.NotPositionOwner.selector);
        vault.collectFees(1);
        vm.expectRevert(OtterLiquidityVault.NotPositionOwner.selector);
        vault.increaseLiquidity(1, 1, type(uint256).max, type(uint256).max);
        vm.stopPrank();
        vault.removeLiquidity(1, 1e18, 0, 0);
        uint256 claim0 = vault.claims(address(this), currency0);
        vm.prank(outsider);
        vm.expectRevert(OtterLiquidityVault.InvalidClaim.selector);
        vault.claim(currency0, claim0, outsider);
        assertEq(vault.claims(address(this), currency0), claim0);
    }

    function test_removalCreditsOwnerAndClaimCannotBeRepeated() public {
        vault.removeLiquidity(1, 1e21, 0, 0);
        uint256 amount = vault.claims(address(this), currency0);
        assertGt(amount, 999e18);
        assertEq(manager.getLiquidity(otterId), 0);
        assertEq(manager.balanceOf(address(vault), currency0.toId()), vault.totalClaims(currency0));
        address recipient = address(0xBEEF);
        uint256 before = MockERC20(Currency.unwrap(currency0)).balanceOf(recipient);
        vault.claim(currency0, amount, recipient);
        assertEq(MockERC20(Currency.unwrap(currency0)).balanceOf(recipient), before + amount);
        assertEq(vault.totalClaims(currency0), 0);
        vm.expectRevert(OtterLiquidityVault.InvalidClaim.selector);
        vault.claim(currency0, amount, recipient);
    }

    function test_blockedTokenRecipientCannotVetoRemovalOrOtherCurrencyClaim() public {
        address blocked = address(0xBAD);
        vm.mockCall(Currency.unwrap(currency0), abi.encodeWithSelector(bytes4(0xa9059cbb), blocked), abi.encode(false));
        vault.removeLiquidity(1, 1e21, 0, 0);
        uint256 c0 = vault.claims(address(this), currency0);
        uint256 c1 = vault.claims(address(this), currency1);
        uint256 backing = manager.balanceOf(address(vault), currency0.toId());
        vm.expectRevert();
        vault.claim(currency0, c0, blocked);
        assertEq(vault.claims(address(this), currency0), c0);
        assertEq(manager.balanceOf(address(vault), currency0.toId()), backing);
        vault.claim(currency1, c1, address(0xBEEF));
        assertEq(vault.claims(address(this), currency1), 0);
        vault.claim(currency0, c0, address(0xBEEF));
    }

    function test_twoOwnersKeepIndependentPositionsAndClaimsInTheSameCurrency() public {
        address other = address(0xA11CE);
        deal(Currency.unwrap(currency0), other, 10e18);
        deal(Currency.unwrap(currency1), other, 10e18);
        vm.startPrank(other);
        IFixtureToken(Currency.unwrap(currency0)).approve(address(vault), type(uint256).max);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        uint256 id = vault.createPosition(otterKey, TICK_LOWER, TICK_UPPER, 1e18, 1e18, 1e18);
        vm.expectRevert(OtterLiquidityVault.NotPositionOwner.selector);
        vault.removeLiquidity(1, 1e18, 0, 0);
        vault.removeLiquidity(id, 1e18, 0, 0);
        vm.stopPrank();
        vault.removeLiquidity(1, 1e18, 0, 0);
        uint256 otherClaim = vault.claims(other, currency0);
        uint256 ownClaim = vault.claims(address(this), currency0);
        address blocked = address(0xBAD);
        vm.mockCall(Currency.unwrap(currency0), abi.encodeWithSelector(bytes4(0xa9059cbb), blocked), abi.encode(false));
        vm.prank(other);
        vm.expectRevert();
        vault.claim(currency0, otherClaim, blocked);
        vault.claim(currency0, ownClaim, address(0xBEEF));
        assertEq(vault.claims(other, currency0), otherClaim);
        assertEq(vault.claims(address(this), currency0), 0);
        assertEq(manager.balanceOf(address(vault), currency0.toId()), otherClaim);
    }

    function test_slippageBoundsUsePrincipalAndCannotBeMaskedByFees() public {
        donateRouter.donate(otterKey, 2e18, 2e18, ZERO_BYTES);
        vm.expectRevert(OtterLiquidityVault.SlippageExceeded.selector);
        vault.increaseLiquidity(1, 1e18, 0, 0);
        assertEq(manager.getLiquidity(otterId), 1e21);
        assertEq(vault.claims(address(this), currency0), 0);
        vm.expectRevert(OtterLiquidityVault.SlippageExceeded.selector);
        vault.removeLiquidity(1, 1e18, 2e18, 0);
        vault.increaseLiquidity(1, 1e18, 1e18, 1e18);
        assertGt(vault.claims(address(this), currency0), 19e17);
        assertGt(vault.claims(address(this), currency1), 19e17);
    }

    function test_positionAndLiquidityBoundsAndRetainedIds() public {
        for (uint256 i; i < 31; ++i) {
            vault.createPosition(otterKey, -120, 120, 1e12, type(uint256).max, type(uint256).max);
        }
        assertEq(vault.openPositionIds(PoolId.unwrap(otterId)).length, 32);
        vm.expectRevert(OtterLiquidityVault.PositionLimit.selector);
        vault.createPosition(otterKey, -120, 120, 1e12, type(uint256).max, type(uint256).max);
        vault.removeLiquidity(2, 1e12, 0, 0);
        assertEq(vault.openPositionIds(PoolId.unwrap(otterId)).length, 31);
        vault.increaseLiquidity(2, 1e12, type(uint256).max, type(uint256).max);
        assertEq(vault.nextPositionId(), 33);
        uint128 limit = vault.MAX_POOL_LIQUIDITY();
        vm.expectRevert(OtterLiquidityVault.InvalidLiquidity.selector);
        vault.increaseLiquidity(1, limit, type(uint256).max, type(uint256).max);
    }

    function test_largeExternalFeeCreditsCannotBlockExitAndCanBeClaimedInChunks() public {
        uint256 donated = 1 << 121;
        MockERC20(Currency.unwrap(currency0)).mint(address(this), donated);
        MockERC20(Currency.unwrap(currency1)).mint(address(this), donated);
        donateRouter.donate(otterKey, donated, donated, ZERO_BYTES);
        vault.removeLiquidity(1, 1e21, 0, 0);
        assertEq(manager.getLiquidity(otterId), 0);
        assertGt(vault.claims(address(this), currency0), vault.MAX_AMOUNT());
        for (uint256 i; i < 3; ++i) {
            uint256 remaining = vault.claims(address(this), currency0);
            uint256 cap = vault.MAX_AMOUNT();
            vault.claim(currency0, remaining > cap ? cap : remaining, address(0xBEEF));
        }
        assertEq(vault.claims(address(this), currency0), 0);
        assertEq(manager.balanceOf(address(vault), currency0.toId()), 0);
    }

    function test_callbacksRequireManagerAndAnInFlightOperation() public {
        vm.expectRevert(OtterLiquidityVault.UnauthorizedCallback.selector);
        vault.unlockCallback("");
        vm.prank(address(manager));
        vm.expectRevert(OtterLiquidityVault.UnauthorizedCallback.selector);
        vault.unlockCallback("");
    }

    function _nativeKey() internal returns (PoolKey memory nativeKey) {
        (nativeKey,) = initPool(Currency.wrap(address(0)), currency1, IHooks(address(hook)), 0, 60, SQRT_PRICE_1_1);
    }

    function _nativeAmount(uint128 liquidity) internal pure returns (uint256) {
        return SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(120), liquidity, true);
    }

    function test_nativeLPFundingAndIndependentDelivery() public {
        PoolKey memory nativeKey = _nativeKey();
        uint256 amount0 = _nativeAmount(1e18);
        vm.deal(address(this), 1e18);
        uint256 id = vault.createPosition{value: amount0}(nativeKey, -120, 120, 1e18, amount0, 1e18);
        assertEq(address(vault).balance, 0);
        vault.removeLiquidity(id, 1e18, 0, 0);
        Currency native = Currency.wrap(address(0));
        uint256 claim0 = vault.claims(address(this), native);
        uint256 claim1 = vault.claims(address(this), currency1);
        assertGt(claim0, 0);
        address blocked = address(new RejectingLPRecipient());
        vm.expectRevert();
        vault.claim(native, claim0, blocked);
        assertEq(vault.claims(address(this), native), claim0);
        vault.claim(currency1, claim1, address(0xBEEF));
        uint256 before = address(0xBEEF).balance;
        vault.claim(native, claim0, address(0xBEEF));
        assertEq(address(0xBEEF).balance, before + claim0);
        assertEq(manager.balanceOf(address(vault), native.toId()), 0);
    }

    function test_nativeValueMustMatchDebtAndCannotUseForcedETH() public {
        PoolKey memory nativeKey = _nativeKey();
        uint256 owed = _nativeAmount(1e18);
        vm.deal(address(this), 1e18);
        vm.deal(address(vault), 1e18); // models unsolicited/forced ETH
        vm.expectRevert(abi.encodeWithSelector(OtterLiquidityVault.NativeValueMismatch.selector, 0, owed));
        vault.createPosition(nativeKey, -120, 120, 1e18, type(uint256).max, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(OtterLiquidityVault.NativeValueMismatch.selector, owed + 1, owed));
        vault.createPosition{value: owed + 1}(nativeKey, -120, 120, 1e18, type(uint256).max, type(uint256).max);
        assertEq(vault.nextPositionId(), 2);
        assertEq(manager.getLiquidity(nativeKey.toId()), 0);
        assertEq(vault.totalClaims(Currency.wrap(address(0))), 0);
        assertEq(address(vault).balance, 1e18);
    }

    function _tokenKey(address token) internal returns (PoolKey memory tokenKey) {
        Currency a = Currency.wrap(token);
        Currency b = currency1;
        (tokenKey,) = a < b
            ? initPool(a, b, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1)
            : initPool(b, a, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
    }

    function test_optionalReturnsWorkAndTaxOrFalseReturnsRevertAtomically() public {
        OddVaultToken token = new OddVaultToken();
        token.mint(address(this), 100e18);
        token.approve(address(vault), type(uint256).max);
        PoolKey memory tokenKey = _tokenKey(address(token));
        token.configure(false, false, true);
        uint256 id = vault.createPosition(tokenKey, TICK_LOWER, TICK_UPPER, 1e18, 1e18, 1e18);
        token.configure(true, false, true);
        vm.expectPartialRevert(OtterLiquidityVault.EscrowMismatch.selector);
        vault.increaseLiquidity(id, 1e18, 1e18, 1e18);
        assertEq(manager.getLiquidity(tokenKey.toId()), 1e18);
        token.configure(false, true, false);
        vm.expectRevert();
        vault.increaseLiquidity(id, 1e18, 1e18, 1e18);
        assertEq(manager.getLiquidity(tokenKey.toId()), 1e18);
        assertEq(vault.totalLiquidity(PoolId.unwrap(tokenKey.toId())), 1e18);
    }

    function _callbackPool() internal returns (CallbackVaultToken token, PoolKey memory tokenKey) {
        token = new CallbackVaultToken();
        tokenKey = _tokenKey(address(token));
        token.mint(address(token), 10e18);
        deal(Currency.unwrap(currency1), address(token), 10e18);
        token.seed(vault, tokenKey);
        token.enableAttack();
    }

    function test_firstEscrowCallbackCannotWithdrawBeforeCountIsWritten() public {
        (CallbackVaultToken token, PoolKey memory tokenKey) = _callbackPool();
        settlement.registerPool(tokenKey);
        uint256 pk = 0xA11CE;
        address trader = vm.addr(pk);
        token.mint(trader, 1e18);
        vm.prank(trader);
        token.approve(address(book), 1e18);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        os[0] = OtterOrderBook.Order(
            trader,
            PoolId.unwrap(tokenKey.toId()),
            Currency.unwrap(tokenKey.currency0) == address(token),
            0,
            1e18,
            block.timestamp + 1 days,
            0,
            1,
            book.nextEpochId(PoolId.unwrap(tokenKey.toId())),
            block.timestamp + 1 days
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(os[0]));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, s, v);
        book.submit(os, sigs);
        assertEq(bytes4(token.lastError()), OtterLiquidityVault.ActiveBatch.selector);
        assertEq(manager.getLiquidity(tokenKey.toId()), 1e18);
    }

    function test_depositCallbackCannotReenterOwnedPosition() public {
        (CallbackVaultToken token, PoolKey memory tokenKey) = _callbackPool();
        token.mint(address(this), 10e18);
        token.approve(address(vault), type(uint256).max);
        vault.createPosition(tokenKey, TICK_LOWER, TICK_UPPER, 1e18, 1e18, 1e18);
        assertEq(bytes4(token.lastError()), OtterLiquidityVault.ReentrantCall.selector);
        assertEq(manager.getLiquidity(tokenKey.toId()), 2e18);
    }

    function testFuzz_multipleRangesConserveClaimsAndCredits(uint64 rawLiquidity, uint24 rawWidth) public {
        uint128 liquidity = uint128(bound(uint256(rawLiquidity), 1e12, 1e18));
        int24 width = int24(uint24(bound(uint256(rawWidth), 1, 100000)));
        uint256 id = vault.createPosition(otterKey, -width, width, liquidity, type(uint256).max, type(uint256).max);
        vault.removeLiquidity(id, liquidity, 0, 0);
        assertEq(vault.concentratedPositions(PoolId.unwrap(otterId)), 0);
        assertEq(vault.totalLiquidity(PoolId.unwrap(otterId)), 1e21);
        assertEq(manager.balanceOf(address(vault), currency0.toId()), vault.totalClaims(currency0));
        assertEq(manager.balanceOf(address(vault), currency1.toId()), vault.totalClaims(currency1));
    }
}
