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
/// `settle` itself is exclusive to `solver` for `exclusivityWindow` seconds after
/// a batch's window closes, then permissionless. This is not a second, separate
/// trust assumption on top of the one above — it is a fix for one this contract
/// would otherwise reintroduce. `verify` bounds a proposed outcome, it does not
/// pick a unique one: an all-zero allocation, or one that fills only the minimum
/// required to pass every check, is feasible and passes every check just as
/// legitimately as an optimal one, and dumps the difference into the burn (see
/// CORRECTIONS.md). Fully permissionless settlement lets whoever is fastest
/// choose which feasible outcome executes, which is exactly the kind of race
/// this mechanism exists to remove from trading. Exclusivity does not make the
/// solver trusted with anything it doesn't already touch — `verify` still runs
/// against whatever outcome it submits — it just means the party with an
/// incentive to submit the fully-optimal one gets there first.
///
/// SCOPE
/// - ERC20 pairs only. Native ETH is not supported; `Currency.isAddressZero()`
///   pools will revert on the pull, which is deliberate rather than silent.
/// - Traders approve `orderBook`, not this contract, for the token they are
///   selling — funds are escrowed at `submit`, not pulled here. See
///   OtterOrderBook's ESCROW note.
/// - The pool must be a zero-fee, single full-range position — see OtterPoolMath.
contract OtterSettlement is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    OtterOrderBook public immutable orderBook;

    /// @notice The only address permitted to call `settle` during the exclusivity
    ///         window after a batch's window closes. After the window elapses,
    ///         `settle` is permissionless — anyone can and should call it if the
    ///         solver goes offline, so a batch can never be stuck forever.
    /// @dev EXCLUSIVITY, not gatekeeping: this address never decides an
    ///      allocation and never touches funds it isn't itself owed — `settle`
    ///      still runs every check in the TRUST MODEL note above no matter who
    ///      calls it. It only decides who gets first crack at paying the gas.
    ///      Without it, `settle` is fully permissionless from t=closesAt, and
    ///      a searcher can win the race to submit a WORSE-for-everyone-but-itself
    ///      feasible outcome — see CORRECTIONS.md. Immutable rather than
    ///      owner-rotatable: this is the hackathon-scope version of that fix, not
    ///      the production one. A single fixed key that goes offline needs a
    ///      redeploy to replace; a permissioned solver SET, or a bond-and-slash
    ///      scheme, would remove that dependency without reintroducing the race.
    ///      Neither is implemented.
    address public immutable solver;

    /// @notice Seconds after a batch's window closes during which only `solver`
    ///         may settle it.
    uint64 public immutable exclusivityWindow;

    /// @notice Surplus held back from settled batches, awaiting donation to the
    ///         pool's liquidity providers. Keyed by pool and by the token it is
    ///         denominated in, because which token the surplus lands in depends
    ///         on which side was dominant in the batch that produced it.
    ///
    /// SURPLUS REDISTRIBUTION — §3.6 lists LP rewards first among the permitted
    /// destinations, and this is the destination that makes the pool better off
    /// rather than merely making an address richer.
    ///
    /// The surplus is donated with a ONE-BATCH LAG: settling batch N donates
    /// whatever batch N-1 and earlier left behind, and batch N's own surplus is
    /// added to the pot for the next settlement to move. The lag is the whole
    /// point. Theorem 22 permits a payment out of the mechanism only if it is
    /// independent of the current batch's outcome; donating batch N's own
    /// surplus inside batch N would make an LP-bidder's payout a function of its
    /// own report, which is exactly the outcome-dependent transfer the theorem
    /// rules out. The lagged pot is fixed before batch N's reports exist.
    ///
    /// Honest limitation, stated rather than buried: the lag removes
    /// within-batch outcome dependence, not cross-batch. A bidder who is also an
    /// LP can still raise batch N's surplus by accepting less compensation, and
    /// see a share of it back at batch N+1. That deviation costs one unit of
    /// compensation to recover its liquidity share of one unit, so it is
    /// strictly unprofitable for any LP holding less than the entire pool, and
    /// break-even only for an LP that holds all of it. The paper's guarantees
    /// are stated per batch and are untouched; this is a weaker cross-batch
    /// statement that the paper does not make and neither do we.
    mapping(PoolId poolId => mapping(Currency currency => uint256)) public pendingSurplus;

    /// @param dominantSellsCurrency0 which side of the book is the dominant side
    /// @param y per-order amount sold, in that order's input token
    /// @param x per-order amount received, in that order's output token
    struct Outcome {
        bool dominantSellsCurrency0;
        uint256[] y;
        uint256[] x;
    }

    /// @param amountIn residual dominant-side input sent through the pool. Zero
    ///        when the batch cleared entirely against the minority side.
    /// @param donate0 currency0 surplus from earlier batches, paid to LPs
    /// @param donate1 currency1 surplus from earlier batches, paid to LPs
    struct CallbackArgs {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        uint256 donate0;
        uint256 donate1;
    }

    error LengthMismatch();
    error NotPoolManager();
    error EmptyBatch();
    error MinorityFillWrong(uint256 i);
    error IneligibleMustBeUnfilled(uint256 i);
    error PoolOutputShortfall(uint256 have, uint256 owed);
    error NoLiquidity();
    error NoSurplus();
    error NotExclusiveSolver(uint256 exclusiveUntil);

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

    /// @notice Surplus from earlier batches handed to this pool's LPs.
    /// @dev `donate` moves fee growth only — `slot0.sqrtPriceX96` and
    ///      `liquidity` are untouched — so the virtual reserves the mechanism
    ///      was solved against are the same before and after. That is why this
    ///      can share a settlement with the batch's own swap without perturbing
    ///      the curve the batch was priced on.
    event SurplusDonated(PoolId indexed poolId, uint256 amount0, uint256 amount1);

    constructor(IPoolManager poolManager_, OtterOrderBook orderBook_, address solver_, uint64 exclusivityWindow_) {
        poolManager = poolManager_;
        orderBook = orderBook_;
        solver = solver_;
        exclusivityWindow = exclusivityWindow_;
    }

    /// @notice One-time setup per pool: tells `orderBook` which two tokens it
    ///         may escrow against this `poolId`. Permissionless — it only ever
    ///         relays a `PoolKey`'s own currencies, so there is nothing to gain
    ///         by calling it for someone else's pool, and `orderBook` rejects a
    ///         second registration of the same pool outright.
    function registerPool(PoolKey calldata key) external {
        orderBook.registerPoolCurrencies(
            PoolId.unwrap(key.toId()), Currency.unwrap(key.currency0), Currency.unwrap(key.currency1)
        );
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

        bytes32 poolId = PoolId.unwrap(key.toId());

        // (0) Exclusivity. Only `solver` may settle within `exclusivityWindow`
        // seconds of the batch's window closing; anyone may after that. Checked
        // BEFORE `consume` so a rejected non-solver attempt cannot mark the
        // batch settled — see the TRUST MODEL note above for why this exists.
        (uint64 closesAt,,) = orderBook.batches(poolId, batchId);
        uint256 exclusiveUntil = uint256(closesAt) + exclusivityWindow;
        if (msg.sender != solver && block.timestamp < exclusiveUntil) {
            revert NotExclusiveSolver(exclusiveUntil);
        }

        // (1) Inclusion. Reverts unless `orders` is exactly the committed batch,
        // the window has closed, and the batch has not already been settled.
        orderBook.consume(poolId, batchId, orders);

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

    /// Release every seller's contribution from escrow, then pay the minority
    /// side immediately — it is priced at spot and does not depend on the pool
    /// swap.
    /// @dev Funds were pulled into `orderBook` at `submit` time, not here — see
    ///      OtterOrderBook's ESCROW note. `releaseFilled` moves exactly
    ///      `outcome.y[i]` to this contract per order and refunds
    ///      `budget[i] - y[i]` to the trader directly, in the same call.
    function _collectAndPayMinority(
        PoolKey calldata key,
        OtterOrderBook.Order[] calldata orders,
        Outcome calldata outcome
    ) private {
        Currency dominantIn = outcome.dominantSellsCurrency0 ? key.currency0 : key.currency1;

        orderBook.releaseFilled(PoolId.unwrap(key.toId()), orders, outcome.y);

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

        // Take the lagged pot BEFORE this batch's surplus is computed, so that
        // what gets donated here cannot be a function of this batch's reports.
        PoolId id = key.toId();
        uint256 donate0 = pendingSurplus[id][key.currency0];
        uint256 donate1 = pendingSurplus[id][key.currency1];
        if (donate0 > 0) pendingSurplus[id][key.currency0] = 0;
        if (donate1 > 0) pendingSurplus[id][key.currency1] = 0;

        uint256 received;
        if (netIn > 0 || donate0 > 0 || donate1 > 0) {
            bytes memory result = poolManager.unlock(
                abi.encode(
                    CallbackArgs({
                        key: key,
                        zeroForOne: outcome.dominantSellsCurrency0,
                        amountIn: netIn,
                        donate0: donate0,
                        donate1: donate1
                    })
                )
            );
            received = abi.decode(result, (uint256));
            if (donate0 > 0 || donate1 > 0) emit SurplusDonated(id, donate0, donate1);
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

        // The surplus stays in this contract and joins the pot. The next
        // settlement on this pool hands it to the LPs.
        burn = available - totalPaid;
        if (burn > 0) pendingSurplus[id][dominantOut] += burn;
    }

    // ------------------------------------------------------------------
    // Surplus
    // ------------------------------------------------------------------

    /// @notice Donate a pool's accumulated surplus to its LPs without waiting for
    ///         the next batch. Permissionless: it can only move surplus to the
    ///         pool, never out of it, and it has no access to batch funds.
    /// @dev Exists so that a pool which stops receiving batches does not strand
    ///      its last surplus forever. Reverts when there is nothing to move
    ///      rather than burning gas on a no-op unlock.
    ///
    ///      KNOWN VECTOR, stated rather than buried: `donate` splits by the
    ///      liquidity in range at the moment it lands, so an LP can add
    ///      liquidity immediately before a donation and remove it after,
    ///      capturing a share it never bore risk for. This is the standard JIT
    ///      problem and it applies to the donation inside `settle` too. It costs
    ///      the batch's traders nothing — the surplus is already theirs to give
    ///      up — but it does defeat the intent of paying LPs who actually carried
    ///      the pool. Vesting the donation over a window, or paying it into a
    ///      fixed protocol-owned position, would close it. Neither is
    ///      implemented.
    function flushSurplus(PoolKey calldata key) external {
        PoolId id = key.toId();
        uint256 donate0 = pendingSurplus[id][key.currency0];
        uint256 donate1 = pendingSurplus[id][key.currency1];
        if (donate0 == 0 && donate1 == 0) revert NoSurplus();

        pendingSurplus[id][key.currency0] = 0;
        pendingSurplus[id][key.currency1] = 0;

        poolManager.unlock(
            abi.encode(
                CallbackArgs({key: key, zeroForOne: false, amountIn: 0, donate0: donate0, donate1: donate1})
            )
        );
        emit SurplusDonated(id, donate0, donate1);
    }

    // ------------------------------------------------------------------
    // v4 callback
    // ------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        CallbackArgs memory a = abi.decode(data, (CallbackArgs));

        // Both the swap and the donation create deltas against this contract.
        // Accumulate them per currency and settle once, rather than settling the
        // swap and then discovering the donation has opened a second debt on the
        // same token.
        uint256 owed0 = a.donate0;
        uint256 owed1 = a.donate1;
        uint256 credit0;
        uint256 credit1;
        uint256 received;

        if (a.amountIn > 0) {
            BalanceDelta delta = poolManager.swap(
                a.key,
                IPoolManager.SwapParams({
                    zeroForOne: a.zeroForOne,
                    amountSpecified: -int256(a.amountIn), // negative == exact input
                    sqrtPriceLimitX96: a.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );

            int128 outDelta = a.zeroForOne ? delta.amount1() : delta.amount0();
            received = uint256(uint128(outDelta));

            if (a.zeroForOne) {
                owed0 += a.amountIn;
                credit1 = received;
            } else {
                owed1 += a.amountIn;
                credit0 = received;
            }
        }

        // Donate AFTER the swap. `donate` does not move price or liquidity, so
        // the order does not change the swap's output — doing it second just
        // keeps the swap reading against exactly the state the batch was priced
        // on, with nothing of ours in between.
        if (a.donate0 > 0 || a.donate1 > 0) {
            poolManager.donate(a.key, a.donate0, a.donate1, "");
        }

        _settleNet(a.key.currency0, owed0, credit0);
        _settleNet(a.key.currency1, owed1, credit1);

        return abi.encode(received);
    }

    /// @dev One currency's net position with the PoolManager: pay the difference
    ///      if we owe, take it if we are owed, do nothing if they cancel.
    function _settleNet(Currency c, uint256 owed, uint256 credit) private {
        if (owed > credit) {
            poolManager.sync(c);
            c.transfer(address(poolManager), owed - credit);
            poolManager.settle();
        } else if (credit > owed) {
            poolManager.take(c, address(this), credit - owed);
        }
    }

    // ------------------------------------------------------------------
}
