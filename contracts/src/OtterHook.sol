// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";

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
/// Otter pool is therefore deployed with a single full-range position and no
/// other initialised ticks, so `L` is constant everywhere and `F` holds exactly.
/// If a second, narrower position were added, a large batch could cross a tick
/// boundary, `L` would change mid-swap, and the settled outcome would no longer
/// match the curve the mechanism was solved against. That is an assumption of
/// this implementation, not of the paper, and it belongs in the README.
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
    function virtualReserves(uint160 sqrtPriceX96, uint128 liquidity)
        internal
        pure
        returns (uint256 r0, uint256 r1)
    {
        r0 = FullMath.mulDiv(liquidity, FixedPoint96.Q96, sqrtPriceX96);
        r1 = FullMath.mulDiv(liquidity, sqrtPriceX96, FixedPoint96.Q96);
    }
}

/// @title OtterHook
/// @notice Makes a v4 pool batch-only by rejecting every swap that does not come
///         from the Otter settlement contract.
///
/// This is not decoration. Otter's guarantees come from settling a whole batch as
/// an order-independent set; if anyone can slip an ordinary sequential swap into
/// the same block, the pool state the batch was solved against moves underneath
/// it and order-independence is meaningless. `beforeSwap` is the only enabled
/// permission, so the hook address must carry BEFORE_SWAP_FLAG (1 << 7) in its
/// low 14 bits — mine the CREATE2 salt with HookMiner.
///
/// Liquidity provision is deliberately NOT gated: LPs come and go freely between
/// batches. Settlement reads the pool's price and liquidity at execution time, so
/// a change between solving and settling shows up as a curve-conservation failure
/// rather than a silent mispricing.
contract OtterHook is IHooks {
    IPoolManager public immutable poolManager;
    address public immutable settlement;

    error NotPoolManager();
    error BatchOnly(address sender);
    error HookNotImplemented();

    constructor(IPoolManager poolManager_, address settlement_) {
        poolManager = poolManager_;
        settlement = settlement_;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    /// @param sender the address that called PoolManager.swap — i.e. whoever holds
    ///        the unlock, which for a legitimate batch is OtterSettlement.
    function beforeSwap(address sender, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != settlement) revert BatchOnly(sender);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
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

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
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

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
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

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
