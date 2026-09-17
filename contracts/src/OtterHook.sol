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
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

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

/// @dev Narrow view of the order book used by the hook to freeze a pool's
/// liquidity while a committed batch is outstanding. Kept as an interface to
/// avoid coupling the hook to order-book implementation details.
interface IOtterBatchStatus {
    function currentBatchId(bytes32 poolId) external view returns (uint256);
    function batches(bytes32 poolId, uint256 batchId)
        external
        view
        returns (uint64 closesAt, uint32 count, bool settled);
}

interface IOtterSettlementView {
    function orderBook() external view returns (address);
}

/// @title OtterHook
/// @notice Makes a v4 pool batch-only by rejecting every swap that does not come
///         from the Otter settlement contract, and restricts liquidity to a
///         single full-range position so `OtterPoolMath`'s constant-liquidity
///         assumption is enforced rather than merely documented.
///
/// This is not decoration. Otter's guarantees come from settling a whole batch as
/// an order-independent set; if anyone can slip an ordinary sequential swap into
/// the same block, the pool state the batch was solved against moves underneath
/// it and order-independence is meaningless. The `beforeSwap`,
/// `beforeAddLiquidity`, and `beforeRemoveLiquidity` callbacks are enabled, so
/// the hook address must carry their flags in its low 14 bits — mine the CREATE2
/// salt with HookMiner against all three.
///
/// LIQUIDITY GATE. `beforeAddLiquidity` requires `tickLower`/`tickUpper` to equal
/// the pool's full range at its own tick spacing (`TickMath.minUsableTick` /
/// `maxUsableTick`). This is the enforcement side of the assumption
/// `OtterPoolMath` already documents: liquidity concentrated in a narrower range
/// makes `L` change mid-swap if a batch crosses that range's boundary, and the
/// settled outcome would then diverge from the curve the mechanism was solved
/// against. Gating only ADDS is sufficient — v4 only invokes this hook for
/// `liquidityDelta > 0` (Hooks.sol), never for removes or the zero-delta calls
/// LPs use to collect fees — because a position can only exist if it was
/// admitted through this same check when it was created; there is no way to
/// remove liquidity from a range that was never allowed to be added.
///
/// LPs otherwise come and go freely between batches — the gate gives them one
/// shape to add in, not permission to add at all. Settlement still reads the
/// pool's price and liquidity at execution time, so a change in the AMOUNT of
/// full-range liquidity between solving and settling shows up as a
/// curve-conservation failure rather than a silent mispricing; the gate's job is
/// only to keep the SHAPE of that liquidity from ever being anything but
/// full-range.
///
/// ACTIVE-BATCH FREEZE, a separate and later mechanism from the shape gate
/// above: both `beforeAddLiquidity` and `beforeRemoveLiquidity` also reject any
/// AMOUNT change — add or genuine remove — while a batch is open or closed-but-
/// unsettled for that pool (`_revertIfBatchActive`), because the "curve-
/// conservation failure rather than a silent mispricing" outcome mentioned above
/// is a REVERTED SETTLEMENT, not a free pass — repeatable griefing if left
/// possible. This still deliberately excludes `liquidityDelta == 0` fee
/// collection (see `beforeRemoveLiquidity`'s own note): that changes nothing the
/// mechanism depends on, so freezing it would only cost LPs their rewards for no
/// safety reason.
contract OtterHook is IHooks {
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;
    address public immutable settlement;
    IOtterBatchStatus public immutable orderBook;

    error NotPoolManager();
    error BatchOnly(address sender);
    error ActiveBatch(bytes32 poolId, uint256 batchId);
    error NotFullRange(int24 tickLower, int24 tickUpper, int24 requiredLower, int24 requiredUpper);
    error HookNotImplemented();

    constructor(IPoolManager poolManager_, address settlement_) {
        poolManager = poolManager_;
        settlement = settlement_;
        orderBook = IOtterBatchStatus(IOtterSettlementView(settlement_).orderBook());
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

    /// @dev Only called for `liquidityDelta > 0` — see the LIQUIDITY GATE note
    ///      above. Reads `key.tickSpacing` rather than trusting a caller-supplied
    ///      value, so the required range always matches the pool this add is
    ///      actually against.
    function beforeAddLiquidity(
        address,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4) {
        _revertIfBatchActive(key);
        int24 lo = TickMath.minUsableTick(key.tickSpacing);
        int24 hi = TickMath.maxUsableTick(key.tickSpacing);
        if (params.tickLower != lo || params.tickUpper != hi) {
            revert NotFullRange(params.tickLower, params.tickUpper, lo, hi);
        }
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @notice Liquidity must remain fixed from the first accepted order until
    ///         the batch has either settled or been refunded. Otherwise a solver
    ///         can price against one curve and find a different curve at execution.
    ///
    /// @dev Gated on `liquidityDelta < 0` specifically, not on which callback v4
    ///      routed to. v4 calls `beforeRemoveLiquidity` for every
    ///      `liquidityDelta <= 0` (Hooks.sol), and `liquidityDelta == 0` is the
    ///      standard way an LP collects accrued fees — including the `donate()`
    ///      surplus from OtterSettlement — without touching their position size.
    ///      That collection changes no on-chain state this hook or the mechanism
    ///      cares about: it does not move price, liquidity, or the curve a batch
    ///      was solved against. Gating it too would block LPs from claiming
    ///      rewards for as long as any batch is outstanding on the pool, for no
    ///      safety benefit — so it is deliberately let through.
    function beforeRemoveLiquidity(
        address,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4) {
        if (params.liquidityDelta < 0) _revertIfBatchActive(key);
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function _revertIfBatchActive(PoolKey calldata key) private view {
        bytes32 poolId = PoolId.unwrap(key.toId());
        uint256 batchId = orderBook.currentBatchId(poolId);
        (uint64 closesAt, uint32 count, bool settled) = orderBook.batches(poolId, batchId);
        if (closesAt != 0 && count != 0 && !settled) revert ActiveBatch(poolId, batchId);
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
