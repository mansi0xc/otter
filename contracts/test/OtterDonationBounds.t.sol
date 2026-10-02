// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterHookFixture} from "./utils/OtterHookFixture.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {OtterHook} from "../src/OtterHook.sol";

contract OtterDonationBoundsTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    function test_unboundedDonationsOverflowCoreFeesButCurrentHookPreventsThem() public {
        uint256 snapshot = vm.snapshotState();
        vault.requestExit(1, 1e21);
        uint256 large = 1 << 126;
        MockERC20(Currency.unwrap(currency0)).mint(address(this), large * 3);
        // Explicitly bypass only the new policy to reproduce the pinned core's
        // withdrawal failure. This is not an accepted donation in current code.
        vm.mockCall(
            address(hook),
            abi.encodeWithSelector(IHooks.beforeDonate.selector),
            abi.encode(IHooks.beforeDonate.selector)
        );
        for (uint256 i; i < 3; ++i) {
            donateRouter.donate(otterKey, large, 0, ZERO_BYTES);
        }
        vm.expectRevert(SafeCast.SafeCastOverflow.selector);
        vault.processExit(1);
        assertEq(vault.queuedLiquidity(1), 1e21);
        vm.clearMockedCalls();
        vm.revertToState(snapshot);
        MockERC20(Currency.unwrap(currency0)).mint(address(this), large);
        vm.expectRevert();
        donateRouter.donate(otterKey, large, 0, ZERO_BYTES);
        assertEq(hook.totalDonated0(otterId), 0);
        vault.requestExit(1, 1e21);
        vault.processExit(1);
        assertEq(vault.queuedLiquidity(1), 0);
    }

    function test_uncollectedLimitReopensOnlyAfterAccountedFeeCollection() public {
        uint256 cap = hook.MAX_UNCOLLECTED_DONATIONS();
        MockERC20(Currency.unwrap(currency0)).mint(address(this), cap);
        donateRouter.donate(otterKey, cap, 0, ZERO_BYTES);
        vm.expectRevert();
        donateRouter.donate(otterKey, 1, 0, ZERO_BYTES);
        assertEq(vault.totalFeesCollected0(otterId), 0);
        vault.collectFees(1);
        assertEq(hook.totalDonated0(otterId), cap);
        assertGt(vault.totalFeesCollected0(otterId), cap - 1e18);
        // Capacity returns when core accrual is harvested, even though delivery
        // is still outstanding. Depositing or withdrawing principal is not a reset.
        donateRouter.donate(otterKey, 2e18, 0, ZERO_BYTES);
        assertEq(hook.totalDonated0(otterId), cap + 2e18);
        uint256 feesBefore = vault.totalFeesCollected0(otterId);
        vault.requestExit(1, 1e21);
        (uint256 credited0,) = vault.processExit(1);
        uint256 newFees = vault.totalFeesCollected0(otterId) - feesBefore;
        assertLt(newFees, credited0);
        vault.increaseLiquidity(1, 1e18, type(uint256).max, type(uint256).max);
        assertEq(vault.totalFeesCollected0(otterId), feesBefore + newFees);
        donateRouter.donate(otterKey, 1e18, 0, ZERO_BYTES);
        assertEq(hook.totalDonated0(otterId), cap + 3e18);
    }

    function test_donationAccountingRollsBackOnFailedTransferAndCannotBeCalledDirectly() public {
        vm.expectRevert(OtterHook.NotPoolManager.selector);
        hook.beforeDonate(address(this), otterKey, 1, 0, ZERO_BYTES);
        vm.mockCall(
            Currency.unwrap(currency0),
            abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)"))),
            abi.encode(false)
        );
        vm.expectRevert();
        donateRouter.donate(otterKey, 1e18, 0, ZERO_BYTES);
        assertEq(hook.totalDonated0(otterId), 0);
        vm.clearMockedCalls();
        donateRouter.donate(otterKey, 1e18, 2e18, ZERO_BYTES);
        assertEq(hook.totalDonated0(otterId), 1e18);
        assertEq(hook.totalDonated1(otterId), 2e18);
    }
}
