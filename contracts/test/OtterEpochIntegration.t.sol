// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";

contract AdmissionCallbackToken is MockERC20 {
    address private target;
    bytes private payload;
    bytes public lastError;
    constructor() MockERC20("Admission callback", "ACB", 18) {}

    function configure(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (target != address(0)) {
            (bool ok, bytes memory reason) = target.call{value: 1e18}(payload);
            require(!ok, "admission during LP mutation");
            lastError = reason;
        }
        return super.transferFrom(from, to, amount);
    }
}

contract OtterEpochIntegrationTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    function test_realFeeDriftExpiresImmediatelyAndOldRefundSurvivesNextEpoch() public {
        uint256 id = _submitActiveOrder();
        bytes32 pool = PoolId.unwrap(otterId);
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(otterKey, 1000);
        book.expireUnsupportedFees(pool, id);
        assertFalse(book.isBatchActive(pool));
        // Principal can leave before the old trader recovers or claims anything.
        vault.removeLiquidity(1, 1e18, 0, 0);
        manager.setProtocolFee(otterKey, 0);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        os[0].nonce = 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
        assertEq(book.submit(os, sigs), id + 1);
        book.refundOrder(pool, id, 0);
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 1e18);
        assertEq(book.claimable(os[0].trader, Currency.unwrap(currency0)), 1e18);
        assertTrue(book.isBatchActive(pool));
        vm.prank(os[0].trader);
        book.claim(Currency.unwrap(currency0), 1e18, os[0].trader);
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 1e18);
    }

    function test_realFeeAndZeroLiquidityRejectBeforeEscrow() public {
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(otterKey, 1000);
        vm.expectRevert(OtterLiquidityVault.UnsupportedPoolState.selector);
        book.submit(os, sigs);
        manager.setProtocolFee(otterKey, 0);
        vault.removeLiquidity(1, 1e21, 0, 0);
        vm.expectRevert(OtterLiquidityVault.UnsupportedPoolState.selector);
        book.submit(os, sigs);
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 0);
        assertEq(book.nonceBitmap(os[0].trader, 0), 0);
        assertEq(book.executionDeadline(PoolId.unwrap(otterId), 0), 0);
    }

    function test_zeroIntegerReserveIsUnsupportedBeforeEscrow() public {
        (PoolKey memory key, PoolId id) = initPool(currency0, currency1, IHooks(address(hook)), 0, 2, uint160(1) << 127);
        settlement.registerPool(key);
        IFixtureToken(Currency.unwrap(currency0)).approve(address(vault), type(uint256).max);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        vault.createPosition(
            key, TickMath.minUsableTick(2), TickMath.maxUsableTick(2), 1, type(uint256).max, type(uint256).max
        );
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        os[0].poolId = PoolId.unwrap(id);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
        vm.expectRevert(OtterLiquidityVault.UnsupportedPoolState.selector);
        book.submit(os, sigs);
        assertEq(book.nonceBitmap(os[0].trader, 0), 0);
    }

    function test_LPTokenCallbackCannotOpenAnEpochDuringPoolMutation() public {
        AdmissionCallbackToken asset = new AdmissionCallbackToken();
        (PoolKey memory key, PoolId id) = initPool(
            Currency.wrap(address(0)), Currency.wrap(address(asset)), IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1
        );
        settlement.registerPool(key);
        asset.mint(address(this), 2e18);
        asset.approve(address(vault), type(uint256).max);
        OtterOrderBook.Order[] memory os = new OtterOrderBook.Order[](1);
        bytes[] memory sigs = new bytes[](1);
        os[0] = OtterOrderBook.Order(
            vm.addr(0xA11CE),
            PoolId.unwrap(id),
            true,
            0,
            1e18,
            block.timestamp + 1 days,
            0,
            1,
            0,
            block.timestamp + 1 days
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(os[0]));
        sigs[0] = abi.encodePacked(r, s, v);
        asset.configure(address(book), abi.encodeCall(book.submit, (os, sigs)));
        vm.deal(address(asset), 1e18);
        vm.deal(address(this), 2e18);
        vault.createPosition{value: 1e18}(key, TICK_LOWER, TICK_UPPER, 1e18, type(uint256).max, type(uint256).max);
        assertEq(asset.lastError(), abi.encodeWithSelector(OtterLiquidityVault.InFlightLiquidity.selector));
        assertEq(book.executionDeadline(PoolId.unwrap(id), 0), 0);
        assertEq(book.nonceBitmap(os[0].trader, 0), 0);
        assertEq(book.totalEscrow(address(0)), 0);
        book.submit{value: 1e18}(os, sigs);
        assertTrue(book.isBatchActive(PoolId.unwrap(id)));
    }

    function test_exclusivityCannotCoverTheEntireExecutionWindow() public {
        uint64 duration = book.executionWindow();
        vm.expectRevert(OtterSettlement.InvalidExecutionWindow.selector);
        new OtterSettlement(manager, book, address(this), duration);
    }
}
