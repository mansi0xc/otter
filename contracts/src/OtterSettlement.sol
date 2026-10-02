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
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {OtterMath} from "./OtterMath.sol";
import {OtterHook, OtterPoolMath} from "./OtterHook.sol";
import {OtterOrderBook} from "./OtterOrderBook.sol";

/// @title OtterSettlement
/// @notice Settles one Otter batch: validates the solver's proposed outcome, runs
///         the residual imbalance through the v4 pool, and distributes.
///
/// TRUST MODEL: this remains the legacy feasibility verifier. It does not
/// enforce the canonical allocation or pivot payments, and minority dust can
/// violate integer IR. A solver can choose a lower feasible trader payment and
/// divert the residual to LPs it controls. Exclusivity selects a caller; it does
/// not resolve that economic discretion. See the review and specification gates.
///
/// SCOPE: native ETH/ERC20 settlement with zero LP/protocol fees and full-range
/// liquidity. Concentrated admission/swaps remain blocked until tick-aware
/// settlement. Outputs and refunds are withdrawable claims in the order book.
/// Traders approve the order book for escrow, not this contract.
contract OtterSettlement is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    OtterOrderBook public immutable orderBook;
    address public immutable owner;
    uint256 private _reentrancyLock = 1;
    bytes32 private _callbackHash;
    bool private _callbackPending;

    /// @notice The sole hook implementation whose pools may be registered. It is
    ///         set once after deployment because the hook constructor itself
    ///         needs this settlement address.
    address public approvedHook;

    /// @notice The only address permitted to call `settle` during the exclusivity
    ///         window after a batch's window closes. After the window elapses,
    ///         `settle` is permissionless — anyone can and should call it if the
    ///         solver goes offline, so a batch can never be stuck forever.
    /// @dev Immutable prototype caller preference. This does not prove the
    /// submitted allocation or payments are canonical; R2 remains open.
    address public immutable solver;

    /// @notice Seconds after a batch's window closes during which only `solver`
    ///         may settle it.
    uint64 public immutable exclusivityWindow;

    /// @notice Surplus held back from settled batches, awaiting donation to the
    ///         pool's liquidity providers. Keyed by pool and by the token it is
    ///         denominated in, because which token the surplus lands in depends
    ///         on which side was dominant in the batch that produced it.
    ///
    /// Legacy distribution: a subsequent settlement or flush donates this
    /// pot to the liquidity present at that time. Newly arrived LPs can capture
    /// it, and caller/LP overlap can exploit payment discretion. The vault's
    /// principal/fee claims do not supply historical batch reward eligibility;
    /// R7 remains open until the snapshot reward ledger replaces this policy.
    mapping(PoolId poolId => mapping(Currency currency => uint256)) public pendingSurplus;
    mapping(Currency currency => uint256) public totalPendingSurplus;

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
    error InvalidExecutionWindow();
    error NotOwner();
    error HookAlreadySet();
    error InvalidHook(address supplied);
    error NonZeroFee(uint24 fee);
    error UnsupportedProtocolFee(uint24 fee);
    error UnsupportedPrice(uint160 sqrtPriceX96);
    error InvalidCallback();
    error InvalidSwapDelta();
    error UnexpectedInputConsumption(uint256 requested, uint256 consumed);
    error InexactTransfer(Currency currency, uint256 expected);
    error Insolvent(Currency currency);
    error NativeSenderUnauthorized();
    error ReentrantCall();

    modifier nonReentrant() {
        if (_reentrancyLock != 1) revert ReentrantCall();
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

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
    event HookSet(address indexed hook);

    constructor(IPoolManager poolManager_, OtterOrderBook orderBook_, address solver_, uint64 exclusivityWindow_) {
        if (exclusivityWindow_ >= orderBook_.executionWindow()) revert InvalidExecutionWindow();
        poolManager = poolManager_;
        orderBook = orderBook_;
        owner = msg.sender;
        solver = solver_;
        exclusivityWindow = exclusivityWindow_;
    }

    /// @notice One-time setup per pool: tells `orderBook` which two tokens it
    ///         may escrow against this `poolId`. Every registered pool must use
    ///         the one approved Otter hook and the zero-fee curve that the solver
    ///         and settlement verify against.
    function setApprovedHook(address hook) external {
        if (msg.sender != owner) revert NotOwner();
        if (approvedHook != address(0)) revert HookAlreadySet();
        if (hook == address(0)) revert InvalidHook(hook);
        approvedHook = hook;
        emit HookSet(hook);
    }

    function registerPool(PoolKey calldata key) external {
        if (address(key.hooks) != approvedHook) revert InvalidHook(address(key.hooks));
        if (key.fee != 0) revert NonZeroFee(key.fee);
        (,, uint24 protocolFee, uint24 lpFee) = poolManager.getSlot0(key.toId());
        if (protocolFee != 0) revert UnsupportedProtocolFee(protocolFee);
        if (lpFee != 0) revert NonZeroFee(lpFee);
        orderBook.registerPoolCurrencies(
            PoolId.unwrap(key.toId()),
            Currency.unwrap(key.currency0),
            Currency.unwrap(key.currency1),
            address(OtterHook(address(key.hooks)).liquidityVault())
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
    ) external nonReentrant {
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
        (OtterMath.Fill[] memory fills, uint256 dMinority, uint256 minorityPaid) = _classify(curve, orders, outcome);

        curve.M = FixedPointMathLib.mulDivDown(curve.y0, dMinority, curve.x0); // rho0 * D_X

        // (4) Theorem 12 invariants on the dominant side.
        (uint256 totalIn, uint256 totalPaid, uint256 modelBurn) = OtterMath.verify(curve, fills);

        // (5) Move tokens. Pulls first so the contract is never paying out funds
        // it has not yet received.
        orderBook.releaseFilled(poolId, orders, outcome.y);

        // (6) Residual through the pool, then distribute. The authoritative burn is
        // measured here, not modelled: it is what v4 actually paid minus what the
        // outcome owes, so it absorbs any unused discretisation allowance.
        uint256 realisedBurn = _executeAndDistribute(key, outcome, totalIn, minorityPaid, dMinority, totalPaid);

        _fundPayouts(key, orders, outcome);
        _assertSurplusBacked(key.currency0);
        _assertSurplusBacked(key.currency1);
        orderBook.completeExecution(poolId);

        emit Settled(key.toId(), batchId, outcome.dominantSellsCurrency0, totalIn, totalPaid, realisedBurn);
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
        (uint160 sqrtPriceX96,, uint24 protocolFee, uint24 lpFee) = poolManager.getSlot0(id);
        if (key.fee != 0 || lpFee != 0) revert NonZeroFee(lpFee == 0 ? key.fee : lpFee);
        if (protocolFee != 0) revert UnsupportedProtocolFee(protocolFee);
        uint128 liquidity = poolManager.getLiquidity(id);
        if (liquidity == 0 || sqrtPriceX96 == 0) revert NoLiquidity();

        if (sqrtPriceX96 < uint160(1) << 64 || sqrtPriceX96 >= uint160(1) << 128) {
            revert UnsupportedPrice(sqrtPriceX96);
        }
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(sqrtPriceX96, liquidity);
        curve =
            dominantSellsCurrency0 ? OtterMath.Curve({x0: r1, y0: r0, M: 0}) : OtterMath.Curve({x0: r0, y0: r1, M: 0});
    }

    /// @dev Splits the book, enforces the minority rule (§3.4: every eligible
    ///      minority order fills IN FULL at the initial spot price, no auction),
    ///      and returns the dominant side shaped for OtterMath.
    function _classify(OtterMath.Curve memory curve, OtterOrderBook.Order[] calldata orders, Outcome calldata outcome)
        private
        pure
        returns (OtterMath.Fill[] memory fills, uint256 dMinority, uint256 minorityPaid)
    {
        uint256 n = orders.length;
        fills = new OtterMath.Fill[](n);

        for (uint256 i; i < n; ++i) {
            bool isDominant = orders[i].sellingCurrency0 == outcome.dominantSellsCurrency0;

            if (isDominant) {
                // Ineligible dominant orders are handled by OtterMath: their ask
                // exceeds sigma0, so any positive payment trips the spot bound.
                fills[i] =
                    OtterMath.Fill({ask: orders[i].ask, budget: orders[i].budget, y: outcome.y[i], x: outcome.x[i]});
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

    /// @dev Fund the entire output ledger after the swap has succeeded. Minority
    /// funds stay reserved here until this call; no trader receiver is invoked.
    function _fundPayouts(PoolKey calldata key, OtterOrderBook.Order[] calldata orders, Outcome calldata outcome)
        private
    {
        uint256 amount0;
        uint256 amount1;
        for (uint256 i; i < orders.length; ++i) {
            if (orders[i].sellingCurrency0) amount1 += outcome.x[i];
            else amount0 += outcome.x[i];
        }
        if (!key.currency0.isAddressZero() && amount0 != 0) {
            SafeTransferLib.safeApprove(ERC20(Currency.unwrap(key.currency0)), address(orderBook), amount0);
        }
        if (amount1 != 0) {
            SafeTransferLib.safeApprove(ERC20(Currency.unwrap(key.currency1)), address(orderBook), amount1);
        }
        orderBook.creditPayouts{value: key.currency0.isAddressZero() ? amount0 : 0}(
            PoolId.unwrap(key.toId()), orders, outcome.x
        );
    }

    function _executeAndDistribute(
        PoolKey calldata key,
        Outcome calldata outcome,
        uint256 totalIn,
        uint256 minorityPaid,
        uint256 dMinority,
        uint256 totalPaid
    ) private returns (uint256 burn) {
        Currency dominantOut = outcome.dominantSellsCurrency0 ? key.currency1 : key.currency0;

        // Only the imbalance beyond M touches the pool. The first M units of
        // dominant input are reserved for minority claims at spot.
        uint256 netIn = totalIn - minorityPaid;

        // Take the lagged pot BEFORE this batch's surplus is computed, so that
        // what gets donated here cannot be a function of this batch's reports.
        PoolId id = key.toId();
        uint256 donate0 = pendingSurplus[id][key.currency0];
        uint256 donate1 = pendingSurplus[id][key.currency1];
        pendingSurplus[id][key.currency0] = 0;
        pendingSurplus[id][key.currency1] = 0;
        totalPendingSurplus[key.currency0] -= donate0;
        totalPendingSurplus[key.currency1] -= donate1;

        uint256 received;
        if (netIn > 0 || donate0 > 0 || donate1 > 0) {
            bytes memory result = _unlock(
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

        // The surplus stays in this contract and joins the pot. The next
        // settlement on this pool hands it to the LPs.
        burn = available - totalPaid;
        if (burn > 0) {
            pendingSurplus[id][dominantOut] += burn;
            totalPendingSurplus[dominantOut] += burn;
        }
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
    ///      the pool. Historical eligibility or a specified independent
    ///      destination is needed; a delay or vesting alone does not fix it.
    function flushSurplus(PoolKey calldata key) external nonReentrant {
        PoolId id = key.toId();
        uint256 donate0 = pendingSurplus[id][key.currency0];
        uint256 donate1 = pendingSurplus[id][key.currency1];
        if (donate0 == 0 && donate1 == 0) revert NoSurplus();

        pendingSurplus[id][key.currency0] = 0;
        pendingSurplus[id][key.currency1] = 0;

        totalPendingSurplus[key.currency0] -= donate0;
        totalPendingSurplus[key.currency1] -= donate1;

        _unlock(
            abi.encode(CallbackArgs({key: key, zeroForOne: false, amountIn: 0, donate0: donate0, donate1: donate1}))
        );
        _assertSurplusBacked(key.currency0);
        _assertSurplusBacked(key.currency1);
        emit SurplusDonated(id, donate0, donate1);
    }

    // ------------------------------------------------------------------
    // v4 callback
    // ------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (_reentrancyLock != 2 || !_callbackPending || keccak256(data) != _callbackHash) revert InvalidCallback();
        _callbackPending = false;
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
            // Escrow release can invoke ERC20 callbacks after _curveFor. Read
            // fees again at the swap boundary so a controller callback cannot
            // make execution use a fee-bearing curve after verification.
            (,, uint24 protocolFee, uint24 lpFee) = poolManager.getSlot0(a.key.toId());
            if (protocolFee != 0) revert UnsupportedProtocolFee(protocolFee);
            if (lpFee != 0 || a.key.fee != 0) revert NonZeroFee(lpFee == 0 ? a.key.fee : lpFee);
            if (a.amountIn > uint256(uint128(type(int128).max))) revert InvalidSwapDelta();
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
            int128 inDelta = a.zeroForOne ? delta.amount0() : delta.amount1();
            if (inDelta > 0 || outDelta < 0) revert InvalidSwapDelta();
            uint256 consumed = uint256(-int256(inDelta));
            if (consumed != a.amountIn) revert UnexpectedInputConsumption(a.amountIn, consumed);
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
            uint256 amount = owed - credit;
            poolManager.sync(c);
            uint256 paid;
            if (c.isAddressZero()) {
                paid = poolManager.settle{value: amount}();
            } else {
                uint256 senderBefore = c.balanceOfSelf();
                c.transfer(address(poolManager), amount);
                if (c.balanceOfSelf() + amount != senderBefore) revert InexactTransfer(c, amount);
                paid = poolManager.settle();
            }
            if (paid != amount) revert InexactTransfer(c, amount);
        } else if (credit > owed) {
            uint256 amount = credit - owed;
            uint256 beforeBalance = c.balanceOfSelf();
            uint256 managerBefore = c.isAddressZero() ? 0 : c.balanceOf(address(poolManager));
            poolManager.take(c, address(this), amount);
            if (c.balanceOfSelf() != beforeBalance + amount) revert InexactTransfer(c, amount);
            if (!c.isAddressZero() && c.balanceOf(address(poolManager)) + amount != managerBefore) {
                revert InexactTransfer(c, amount);
            }
        }
    }

    function _unlock(bytes memory data) private returns (bytes memory result) {
        if (_callbackPending) revert InvalidCallback();
        _callbackHash = keccak256(data);
        _callbackPending = true;
        result = poolManager.unlock(data);
        if (_callbackPending) revert InvalidCallback();
        delete _callbackHash;
    }

    function _assertSurplusBacked(Currency c) private view {
        if (c.balanceOfSelf() < totalPendingSurplus[c]) revert Insolvent(c);
    }

    receive() external payable {
        if (msg.sender != address(orderBook) && msg.sender != address(poolManager)) revert NativeSenderUnauthorized();
    }
}
