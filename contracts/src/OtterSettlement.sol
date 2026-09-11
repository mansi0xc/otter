// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {OtterMath} from "./OtterMath.sol";
import {OtterPoolMath} from "./OtterHook.sol";
import {OtterOrderBook} from "./OtterOrderBook.sol";

/// @title OtterSettlement
/// @notice Settles one Otter batch: validates the solver's proposed outcome, runs
///         the residual imbalance through the v4 pool, and distributes.
///
/// TRUST MODEL — read this before believing anything about the guarantees.
///
/// The solver computes the allocation and the Clarke pivots off-chain. This
/// contract verifies feasibility, individual rationality, budget bounds, minority
/// pricing, dominance, and that the pool actually yielded enough to cover every
/// obligation. It does NOT verify that the allocation maximises welfare — that is
/// asserted by the solver. A dishonest solver cannot steal funds or pay a user
/// less than their reported value, but it can propose a suboptimal allocation.
/// Recomputation on-chain, fraud proofs, or a TEE would close this; none are
/// implemented. Stated in the README as a limitation, not buried.
///
/// SCOPE
/// - ERC20 pairs only. Native ETH is not supported; `Currency.isAddressZero()`
///   pools will revert on the pull, which is deliberate rather than silent.
/// - Traders must approve this contract for the token they are selling.
/// - The pool must be a zero-fee, single full-range position — see OtterPoolMath.
contract OtterSettlement is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    OtterOrderBook public immutable orderBook;

    /// Where redistributed surplus goes. Must not depend on any bidder's report
    /// (Theorem 22 and §3.6) — so it is immutable, not a per-batch parameter.
    address public immutable burnSink;

    /// @param dominantSellsCurrency0 which side of the book is the dominant side
    /// @param y per-order amount sold, in that order's input token
    /// @param x per-order amount received, in that order's output token
    struct Outcome {
        bool dominantSellsCurrency0;
        uint256[] y;
        uint256[] x;
    }

    struct SwapArgs {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
    }

    error LengthMismatch();
    error NotPoolManager();
    error EmptyBatch();
    error MinorityFillWrong(uint256 i);
    error IneligibleMustBeUnfilled(uint256 i);
    error PoolOutputShortfall(uint256 have, uint256 owed);
    error NoLiquidity();

    /// @notice The modelled burn (F~s(Y) - sum x*_i) alongside what was actually
    ///         realised. They differ by the part of the discretisation allowance
    ///         v4 did not consume — see CORRECTIONS.md C10. Emitting both turns
    ///         every settlement into a live re-measurement of that gap; a realised
    ///         burn far above the model would mean the allowance is mis-sized.
    event BurnBreakdown(PoolId indexed poolId, uint256 indexed batchId, uint256 modelled, uint256 realised);

    event Settled(
        PoolId indexed poolId,
        uint256 indexed batchId,
        bool dominantSellsCurrency0,
        uint256 totalIn,
        uint256 totalPaid,
        uint256 burn
    );

    constructor(IPoolManager poolManager_, OtterOrderBook orderBook_, address burnSink_) {
        poolManager = poolManager_;
        orderBook = orderBook_;
        burnSink = burnSink_;
    }

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    function settle(
        PoolKey calldata key,
        uint256 batchId,
        OtterOrderBook.Order[] calldata orders,
        Outcome calldata outcome
    ) external {
        uint256 n = orders.length;
        if (n == 0) revert EmptyBatch();
        if (outcome.y.length != n || outcome.x.length != n) revert LengthMismatch();

        // (1) Inclusion. Reverts unless `orders` is exactly the committed batch,
        // the window has closed, and the batch has not already been settled.
        orderBook.consume(PoolId.unwrap(key.toId()), batchId, orders);

        // (2) The curve, read from the pool at execution time rather than trusted
        // from the solver. If liquidity moved since the batch was solved, the
        // shortfall check in (6) is what catches it.
        OtterMath.Curve memory curve = _curveFor(key, outcome.dominantSellsCurrency0);

        // (3) Classify, price the minority side, and size the dominant side.
        (OtterMath.Fill[] memory fills, uint256 dMinority, uint256 minorityPaid) =
            _classify(curve, orders, outcome);

        curve.M = FixedPointMathLib.mulDivDown(curve.y0, dMinority, curve.x0); // rho0 * D_X

        // (4) Theorem 12 invariants on the dominant side.
        (uint256 totalIn, uint256 totalPaid, uint256 modelBurn) = OtterMath.verify(curve, fills);

        // (5) Move tokens. Pulls first so the contract is never paying out funds
        // it has not yet received.
        _collectAndPayMinority(key, orders, outcome);

        // (6) Residual through the pool, then distribute. The authoritative burn is
        // measured here, not modelled: it is what v4 actually paid minus what the
        // outcome owes, so it absorbs any unused discretisation allowance.
        uint256 realisedBurn =
            _executeAndDistribute(key, orders, outcome, totalIn, minorityPaid, dMinority, totalPaid);

        emit Settled(
            key.toId(), batchId, outcome.dominantSellsCurrency0, totalIn, totalPaid, realisedBurn
        );
        emit BurnBreakdown(key.toId(), batchId, modelBurn, realisedBurn);
    }

    /// @dev OtterMath's `x0` is the reserve of the token the dominant side
    ///      RECEIVES and `y0` the reserve of the token it SUPPLIES, so the two
    ///      swap according to which side is dominant.
    function _curveFor(PoolKey calldata key, bool dominantSellsCurrency0)
        private
        view
        returns (OtterMath.Curve memory curve)
    {
        PoolId id = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(id);
        uint128 liquidity = poolManager.getLiquidity(id);
        if (liquidity == 0 || sqrtPriceX96 == 0) revert NoLiquidity();

        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(sqrtPriceX96, liquidity);
        curve = dominantSellsCurrency0
            ? OtterMath.Curve({x0: r1, y0: r0, M: 0})
            : OtterMath.Curve({x0: r0, y0: r1, M: 0});
    }

    /// @dev Splits the book, enforces the minority rule (§3.4: every eligible
    ///      minority order fills IN FULL at the initial spot price, no auction),
    ///      and returns the dominant side shaped for OtterMath.
    function _classify(
        OtterMath.Curve memory curve,
        OtterOrderBook.Order[] calldata orders,
        Outcome calldata outcome
    ) private pure returns (OtterMath.Fill[] memory fills, uint256 dMinority, uint256 minorityPaid) {
        uint256 n = orders.length;
        fills = new OtterMath.Fill[](n);

        for (uint256 i; i < n; ++i) {
            bool isDominant = orders[i].sellingCurrency0 == outcome.dominantSellsCurrency0;

            if (isDominant) {
                // Ineligible dominant orders are handled by OtterMath: their ask
                // exceeds sigma0, so any positive payment trips the spot bound.
                fills[i] = OtterMath.Fill({
                    ask: orders[i].ask,
                    budget: orders[i].budget,
                    y: outcome.y[i],
                    x: outcome.x[i]
                });
                continue;
            }

            // minority: eligible iff ask <= rho0 = y0/x0
            fills[i] = OtterMath.Fill({ask: 0, budget: 0, y: 0, x: 0});
            bool eligible = FixedPointMathLib.mulDivUp(orders[i].ask, curve.x0, OtterMath.WAD) <= curve.y0;

            if (!eligible) {
                if (outcome.y[i] != 0 || outcome.x[i] != 0) revert IneligibleMustBeUnfilled(i);
                continue;
            }

            // sells its whole budget, receives rho0 * budget rounded down
            uint256 owed = FixedPointMathLib.mulDivDown(curve.y0, orders[i].budget, curve.x0);
            if (outcome.y[i] != orders[i].budget || outcome.x[i] != owed) revert MinorityFillWrong(i);

            dMinority += orders[i].budget;
            minorityPaid += owed;
        }
    }

    /// Pull every seller's contribution, then pay the minority side immediately —
    /// it is priced at spot and does not depend on the pool swap.
    function _collectAndPayMinority(
        PoolKey calldata key,
        OtterOrderBook.Order[] calldata orders,
        Outcome calldata outcome
    ) private {
        Currency dominantIn = outcome.dominantSellsCurrency0 ? key.currency0 : key.currency1;
        Currency dominantOut = outcome.dominantSellsCurrency0 ? key.currency1 : key.currency0;

        for (uint256 i; i < orders.length; ++i) {
            if (outcome.y[i] == 0) continue;
            bool isDominant = orders[i].sellingCurrency0 == outcome.dominantSellsCurrency0;
            Currency sold = isDominant ? dominantIn : dominantOut;
            _pull(sold, orders[i].trader, outcome.y[i]);
        }

        for (uint256 i; i < orders.length; ++i) {
            bool isDominant = orders[i].sellingCurrency0 == outcome.dominantSellsCurrency0;
            if (isDominant || outcome.x[i] == 0) continue;
            dominantIn.transfer(orders[i].trader, outcome.x[i]);
        }
    }

    function _executeAndDistribute(
        PoolKey calldata key,
        OtterOrderBook.Order[] calldata orders,
        Outcome calldata outcome,
        uint256 totalIn,
        uint256 minorityPaid,
        uint256 dMinority,
        uint256 totalPaid
    ) private returns (uint256 burn) {
        Currency dominantOut = outcome.dominantSellsCurrency0 ? key.currency1 : key.currency0;

        // Only the imbalance beyond M touches the pool. The first M units of
        // dominant input were paid straight to the minority side at spot.
        uint256 netIn = totalIn - minorityPaid;

        uint256 received;
        if (netIn > 0) {
            bytes memory result = poolManager.unlock(
                abi.encode(SwapArgs({key: key, zeroForOne: outcome.dominantSellsCurrency0, amountIn: netIn}))
            );
            received = abi.decode(result, (uint256));
        }

        // The authoritative conservation check. We hold `dMinority` of the output
        // token from the minority sellers plus `received` from the pool; that must
        // cover every dominant payment. Comparing against the modelled F~ instead
        // would trust our constant-product model over what the pool actually did.
        uint256 available = dMinority + received;
        if (available < totalPaid) revert PoolOutputShortfall(available, totalPaid);

        for (uint256 i; i < orders.length; ++i) {
            bool isDominant = orders[i].sellingCurrency0 == outcome.dominantSellsCurrency0;
            if (!isDominant || outcome.x[i] == 0) continue;
            dominantOut.transfer(orders[i].trader, outcome.x[i]);
        }

        burn = available - totalPaid;
        if (burn > 0) dominantOut.transfer(burnSink, burn);
    }

    // ------------------------------------------------------------------
    // v4 callback
    // ------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        SwapArgs memory a = abi.decode(data, (SwapArgs));

        BalanceDelta delta = poolManager.swap(
            a.key,
            IPoolManager.SwapParams({
                zeroForOne: a.zeroForOne,
                amountSpecified: -int256(a.amountIn), // negative == exact input
                sqrtPriceLimitX96: a.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        (Currency inC, Currency outC) =
            a.zeroForOne ? (a.key.currency0, a.key.currency1) : (a.key.currency1, a.key.currency0);
        int128 outDelta = a.zeroForOne ? delta.amount1() : delta.amount0();
        uint256 received = uint256(uint128(outDelta));

        // pay what we owe the pool
        poolManager.sync(inC);
        inC.transfer(address(poolManager), a.amountIn);
        poolManager.settle();

        // collect what the pool owes us
        poolManager.take(outC, address(this), received);

        return abi.encode(received);
    }

    // ------------------------------------------------------------------

    function _pull(Currency c, address from, uint256 amount) private {
        // Currency has no transferFrom; ERC20-only by design (see SCOPE).
        (bool ok, bytes memory ret) = Currency.unwrap(c).call(
            abi.encodeWithSelector(0x23b872dd, from, address(this), amount) // transferFrom
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "pull failed");
    }
}
