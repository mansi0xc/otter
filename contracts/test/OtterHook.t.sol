// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture} from "./utils/OtterHookFixture.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {OtterHook, OtterPoolMath} from "../src/OtterHook.sol";
import {OtterLiquidityVault} from "../src/OtterLiquidityVault.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";

contract OtterHookTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function test_hookAddressCarriesAllRequiredPermissions() public view {
        assertEq(
            uint160(address(hook)) & Hooks.ALL_HOOK_MASK,
            uint160(
                Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                    | Hooks.BEFORE_DONATE_FLAG
            )
        );
    }

    function test_hookRejectsDirectCalls() public {
        vm.expectRevert(OtterHook.NotPoolManager.selector);
        hook.beforeSwap(address(settlement), otterKey, SWAP_PARAMS, ZERO_BYTES);
    }

    function test_ordinarySwapIsRejected() public {
        vm.expectRevert();
        swapRouter.swap(
            otterKey,
            IPoolManager.SwapParams(true, -1e18, TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
    }

    function test_controlPoolWithoutHookAcceptsSwap() public {
        (PoolKey memory plainKey,) = initPool(currency0, currency1, IHooks(address(0)), 0, 1, SQRT_PRICE_1_1);
        _modifyLiquidity(plainKey, IPoolManager.ModifyLiquidityParams(TICK_LOWER, TICK_UPPER, 1e21, 0), ZERO_BYTES);
        swapRouter.swap(
            plainKey,
            IPoolManager.SwapParams(true, -1e18, TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            ZERO_BYTES
        );
    }

    function test_unapprovedRouterCannotAddRemoveOrCollect() public {
        int256[3] memory deltas = [int256(1e18), -int256(1e18), int256(0)];
        for (uint256 i; i < deltas.length; ++i) {
            vm.expectRevert(
                _wrappedVaultOnly(i == 0 ? IHooks.beforeAddLiquidity.selector : IHooks.beforeRemoveLiquidity.selector)
            );
            modifyLiquidityRouter.modifyLiquidity(
                otterKey, IPoolManager.ModifyLiquidityParams(TICK_LOWER, TICK_UPPER, deltas[i], 0), ZERO_BYTES
            );
        }
    }

    function test_activeBatchBlocksOwnerAddRemoveAndFeeCollection() public {
        _submitActiveOrder();
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.increaseLiquidity(1, 1e18, type(uint256).max, type(uint256).max);
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.removeLiquidity(1, 1e18, 0, 0);
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.collectFees(1);
    }

    function test_consumeDoesNotReleaseEconomicFreezeBeforeCompletion() public {
        uint256 id = _submitActiveOrder();
        vm.warp(block.timestamp + 60);
        vm.prank(address(settlement));
        book.consume(PoolId.unwrap(otterId), id, submittedOrders);
        assertTrue(book.isBatchActive(PoolId.unwrap(otterId)));
        vm.expectRevert(OtterLiquidityVault.ActiveBatch.selector);
        vault.removeLiquidity(1, 1e18, 0, 0);
        vm.prank(address(settlement));
        book.releaseFilled(PoolId.unwrap(otterId), submittedOrders, new uint256[](submittedOrders.length));
        vm.prank(address(settlement));
        book.creditPayouts(PoolId.unwrap(otterId), submittedOrders, new uint256[](submittedOrders.length));
        vm.prank(address(settlement));
        book.completeExecution(PoolId.unwrap(otterId));
        vault.removeLiquidity(1, 1e18, 0, 0);
    }

    function test_concentratedPositionCanBeCustodiedButLegacyBatchCannotOpen() public {
        vault.createPosition(otterKey, -120, 120, 1e18, type(uint256).max, type(uint256).max);
        assertEq(vault.concentratedPositions(PoolId.unwrap(otterId)), 1);
        (OtterOrderBook.Order[] memory os, bytes[] memory sigs) = _prepareActiveOrder();
        vm.expectRevert(OtterLiquidityVault.ConcentratedExecutionUnavailable.selector);
        book.submit(os, sigs);
        (uint64 closesAt, uint32 count,) = book.batches(PoolId.unwrap(otterId), 0);
        assertEq(closesAt, 0);
        assertEq(count, 0);
        assertEq(book.nonceBitmap(vm.addr(0xA11CE), 0), 0);
    }

    function test_concentratedSwapCannotUseLegacyCurveEvenForSettlementSender() public {
        vault.createPosition(otterKey, -120, 120, 1e18, type(uint256).max, type(uint256).max);
        vm.prank(address(manager));
        vm.expectRevert(OtterLiquidityVault.ConcentratedExecutionUnavailable.selector);
        hook.beforeSwap(address(settlement), otterKey, SWAP_PARAMS, ZERO_BYTES);
    }

    function test_removingConcentratedPositionRestoresLegacyAdmission() public {
        uint256 id = vault.createPosition(otterKey, 120, 240, 1e18, type(uint256).max, type(uint256).max);
        vault.removeLiquidity(id, 1e18, 0, 0);
        assertEq(vault.concentratedPositions(PoolId.unwrap(otterId)), 0);
        _submitActiveOrder();
    }

    function test_rangesMustMatchTickSpacing() public {
        (PoolKey memory key60,) = initPool(currency0, currency1, IHooks(address(hook)), 0, 60, SQRT_PRICE_1_1);
        vm.expectRevert(OtterLiquidityVault.InvalidRange.selector);
        vault.createPosition(key60, -121, 120, 1e18, type(uint256).max, type(uint256).max);
        vault.createPosition(key60, -120, 120, 1e18, type(uint256).max, type(uint256).max);
        vault.createPosition(
            key60, TickMath.minUsableTick(60), TickMath.maxUsableTick(60), 1e18, type(uint256).max, type(uint256).max
        );
    }

    function test_virtualReservesSatisfyConstantProductWithinConstantLiquidity() public view {
        (uint160 price,,,) = manager.getSlot0(otterId);
        uint128 liquidity = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(price, liquidity);
        assertApproxEqRel(r0, r1, 1e12);
        assertApproxEqRel(r0 * r1, uint256(liquidity) * liquidity, 1e12);
    }

    function testFuzz_virtualReservesTrackPrice(uint96 rawLiquidity) public pure {
        uint128 liquidity = uint128(bound(uint256(rawLiquidity), 1e12, type(uint96).max));
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(uint160(1 << 96), liquidity);
        assertEq(r0, liquidity);
        assertEq(r1, liquidity);
    }
}
