// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {OtterLiquidityVault} from "./OtterLiquidityVault.sol";
import {IOtterBatchStatus} from "./interfaces/IOtterLiquidityGuard.sol";

/// @title OtterPoolMath
/// @notice Recovers the constant-product reserves the paper's `F` is defined on
///         from a v4 pool's price and liquidity.
///
/// The paper models the AMM as `F(y) = x0 - k/(y0 + y)` with `k = x0*y0`. A v4
/// pool is concentrated liquidity, not constant product — but inside any range
/// where liquidity is constant, v3/v4 math IS constant product on the virtual
/// reserves:
///
///     r0 = L / sqrt(P)     r1 = L * sqrt(P)     r0 * r1 = L^2
///
/// **This equality is exact only while `L` does not change across the swap.** The
/// legacy auction is therefore gated to full-range liquidity at admission and
/// swap time. The authenticated vault may hold concentrated positions, but this
/// library must not price batches against them; tick-aware settlement is a
/// separate remediation step. Integer reserve/step rounding also remains part
/// of the reviewed mechanism's numerical limitations.
///
/// The pool fee is also set to zero. A non-zero LP fee would make the realised
/// swap differ from `F`, breaking curve conservation. LPs are compensated from
/// the redistributed surplus `B_X` instead, which the paper explicitly permits
/// as a burn destination (§3.6).
library OtterPoolMath {
    /// @param sqrtPriceX96 current pool price, Q64.96
    /// @param liquidity current in-range liquidity
    /// @return r0 virtual reserve of currency0
    /// @return r1 virtual reserve of currency1
    function virtualReserves(uint160 sqrtPriceX96, uint128 liquidity) internal pure returns (uint256 r0, uint256 r1) {
        r0 = FullMath.mulDiv(liquidity, FixedPoint96.Q96, sqrtPriceX96);
        r1 = FullMath.mulDiv(liquidity, sqrtPriceX96, FixedPoint96.Q96);
    }
}

interface IOtterSettlementView {
    function orderBook() external view returns (address);
}

/// @notice Batch-only swaps and exclusive authenticated LP custody. The vault
/// supports range positions; the legacy auction remains gated to full-range
/// pools until tick-aware settlement is implemented.
contract OtterHook is IHooks {
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;
    address public immutable settlement;
    IOtterBatchStatus public immutable orderBook;
    OtterLiquidityVault public immutable liquidityVault;

    error NotPoolManager();
    error BatchOnly(address sender);
    error VaultOnly(address sender);
    error ActiveBatch(bytes32 poolId, uint256 batchId);
    error HookNotImplemented();

    constructor(IPoolManager poolManager_, address settlement_) {
        poolManager = poolManager_;
        settlement = settlement_;
        orderBook = IOtterBatchStatus(IOtterSettlementView(settlement_).orderBook());
        liquidityVault = new OtterLiquidityVault(poolManager_, orderBook, address(this));
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != settlement) revert BatchOnly(sender);
        liquidityVault.assertBatchSupported(PoolId.unwrap(key.toId()));
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4) {
        _checkLiquidity(sender, key);
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4) {
        // Includes zero-delta fee collection, which is also owner-authenticated.
        _checkLiquidity(sender, key);
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function _checkLiquidity(address sender, PoolKey calldata key) private view {
        if (sender != address(liquidityVault)) revert VaultOnly(sender);
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (orderBook.isBatchActive(poolId)) revert ActiveBatch(poolId, orderBook.currentBatchId(poolId));
    }

    // ------------------------------------------------------------------
    // Unused permissions. The hook address does not carry these flags, so the
    // PoolManager never calls them; they revert rather than silently succeed.
    // ------------------------------------------------------------------

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
