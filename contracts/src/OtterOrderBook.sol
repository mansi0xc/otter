// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOtterLiquidityGuard} from "./interfaces/IOtterLiquidityGuard.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

/// @title OtterOrderBook
/// @notice Bounded, epoch-bound signed escrow with stored individual recovery.
/// Orders are stored before external asset calls and also committed in submission
/// order. The commitment binds membership, not canonical economic outcomes.
/// Expiry changes one epoch state without replay or token calls. Each stored
/// order can then be recovered independently into its signed trader's claim.
/// Withdrawals remain isolated by owner/currency. The legacy settlement verifier
/// and historical LP reward policy still require their separate remediation.
contract OtterOrderBook {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    struct Order {
        address trader;
        /// @dev PoolId.unwrap(key.toId()) — kept as bytes32 so this contract has
        ///      no v4 dependency.
        bytes32 poolId;
        /// true  = selling currency0, receiving currency1
        /// false = selling currency1, receiving currency0
        bool sellingCurrency0;
        /// reservation value per unit sold, denominated in the token received,
        /// WAD-scaled. `v~_i` for a sell-Y order, `u~_j` for a sell-X order.
        uint256 ask;
        /// budget in the token being sold. `q~_i` / `r~_j`.
        uint256 budget;
        uint256 deadline;
        /// unordered nonce — see `nonceBitmap`
        uint256 nonce;
        uint256 configVersion;
        uint256 epoch;
        uint256 maxExecutionTime;
    }

    enum State {
        None,
        Collecting,
        Closed,
        Executing,
        Settled,
        Refundable
    }

    struct Batch {
        uint64 closesAt;
        uint64 executeUntil;
        uint32 count;
        State state;
        uint96 budget0;
        uint96 budget1;
    }

    /// @dev Pool, epoch and immutable configuration are implied by the mapping
    /// keys. Bounds are checked before packing; getters reconstruct signed fields.
    struct StoredOrder {
        address trader;
        uint96 budget;
        uint128 ask;
        uint64 deadline;
        uint64 maxExecutionTime;
        uint256 nonce;
        bool sellingCurrency0;
        bool refunded;
    }

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    /// @notice Upper bound on a valid signature's `s`, equal to half the
    ///         secp256k1 group order. Signatures above it are the malleable
    ///         mirror of a signature below it.
    /// @dev n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    ///      This is public so the test suite can recompute n/2 and assert equality.
    ///      Getting a digit wrong here does not fail loudly — it silently rejects
    ///      almost every valid signature — so it is checked rather than trusted.
    uint256 public constant MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address trader,bytes32 poolId,bool sellingCurrency0,uint256 ask,uint256 budget,uint256 deadline,uint256 nonce,uint256 configVersion,uint256 epoch,uint256 maxExecutionTime)"
    );

    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _NAME_HASH = keccak256("OtterOrderBook");
    bytes32 private constant _VERSION_HASH = keccak256("2");

    uint256 private immutable _CACHED_CHAIN_ID;
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;

    /// length of a batch window in seconds
    uint64 public immutable windowLength;

    /// @notice Exclusive upper boundary of economic execution after collecting.
    /// At closesAt + executionWindow settlement is forbidden and expiry is public.
    uint64 public immutable executionWindow;
    uint256 public constant MAX_ORDERS = 32;
    uint256 public constant MAX_BUDGET = type(uint96).max;
    uint256 public constant MAX_ASK = type(uint128).max;
    uint256 public constant MAX_SIGNATURE_BYTES = 512;
    uint256 public constant SIGNATURE_GAS_LIMIT = 100_000;
    bytes4 private constant _ERC1271_MAGIC = 0x1626ba7e;

    /// the only address permitted to mark a batch settled
    address public settlement;
    address public owner;
    bool public admissionPaused;

    mapping(bytes32 poolId => uint256) public currentBatchId;
    mapping(bytes32 poolId => mapping(uint256 batchId => Batch)) private _batches;
    mapping(bytes32 poolId => mapping(uint256 batchId => mapping(uint256 index => StoredOrder))) private _orders;
    mapping(bytes32 poolId => uint256) public configVersionOf;
    mapping(bytes32 poolId => mapping(uint256 batchId => bytes32)) public batchDigest;

    /// @notice Zero currency0 denotes native ETH, so registration uses an
    /// explicit flag instead of an address sentinel.
    mapping(bytes32 poolId => bool) public registered;
    mapping(bytes32 poolId => address) public currency0Of;
    mapping(bytes32 poolId => address) public currency1Of;
    mapping(bytes32 poolId => address) public liquidityGuardOf;
    mapping(bytes32 poolId => bool) public executionInProgress;
    mapping(bytes32 poolId => mapping(uint256 batchId => bool)) public escrowReleased;
    mapping(bytes32 poolId => mapping(uint256 batchId => bool)) public payoutsCredited;

    /// @notice Shared-currency liabilities across all pools. Unsolicited funds
    /// never grant a claim. Supported ERC20s must have stable, exact transfers.
    mapping(address currency => uint256) public totalEscrow;
    mapping(address trader => mapping(address currency => uint256)) public claimable;
    mapping(address currency => uint256) public totalClaimable;

    /// Permit2-style unordered nonces: 256 nonces share one slot, so a trader
    /// submitting repeatedly pays one cold SSTORE per 256 orders rather than each.
    mapping(address trader => mapping(uint256 word => uint256 bits)) public nonceBitmap;

    /// @dev Guards the commitment accumulator around token transfers. A
    /// callback-capable token could otherwise submit another order while an outer
    /// `submit` has its digest only in memory, incrementing the count and then
    /// having its digest overwritten by the outer call.
    uint256 private _reentrancyLock = 1;

    // ------------------------------------------------------------------
    // Events / errors
    // ------------------------------------------------------------------

    event OrderSubmitted(
        bytes32 indexed poolId,
        uint256 indexed batchId,
        address indexed trader,
        uint32 index,
        bytes32 orderHash,
        Order order
    );
    event EpochExpired(bytes32 indexed poolId, uint256 indexed batchId);
    event OrderRecovered(bytes32 indexed poolId, uint256 indexed batchId, uint256 indexed index, address trader);
    event NoncesInvalidated(address indexed trader, uint256 word, uint256 mask);
    event BatchSettled(bytes32 indexed poolId, uint256 indexed batchId, uint32 count);
    event BatchRefunded(bytes32 indexed poolId, uint256 indexed batchId, uint32 count);
    event SettlementSet(address settlement);

    error NotOwner();
    error NotSettlement();
    error SettlementAlreadySet();
    error LengthMismatch();
    error OrderExpired(uint256 i);
    error WrongPool(uint256 i);
    error BadSignature(uint256 i);
    error NonceUsed(uint256 i);
    error ZeroBudget(uint256 i);
    error WindowClosed();
    error WindowStillOpen();
    error PreviousBatchUnsettled(uint256 batchId);
    error RefundTooEarly(uint256 refundableAt);
    error AlreadySettled();
    error DigestMismatch();
    error CountMismatch(uint256 supplied, uint32 expected);
    error PoolNotRegistered();
    error PoolAlreadyRegistered();
    error ZeroCurrency();
    error ReentrantCall();
    error InvalidLiquidityGuard();
    error NotExecuting();
    error InvalidCurrencies();
    error InvalidTrader(uint256 i);
    error NativeValueMismatch(uint256 supplied, uint256 required);
    error InexactTransfer(address currency, uint256 expected);
    error Insolvent(address currency);
    error AlreadyReleased();
    error AlreadyCredited();
    error BudgetExceeded(uint256 i);
    error InvalidClaim();
    error NativeTransferFailed();
    error BatchFull();
    error AmountOutOfDomain(uint256 i);
    error WrongEpoch(uint256 i);
    error WrongConfiguration(uint256 i);
    error InsufficientExecutionValidity(uint256 i);
    error ExecutionExpired(uint256 executeUntil);
    error InvalidOrderIndex();
    error AlreadyRecovered();
    error NotRefundable();
    error FeesStillSupported();
    error InvalidClock();
    error AdmissionPaused();
    event AdmissionPauseSet(bool paused);

    event ClaimCredited(address indexed trader, address indexed currency, uint256 amount);
    event Claimed(address indexed trader, address indexed currency, address indexed recipient, uint256 amount);

    event PoolRegistered(bytes32 indexed poolId, address currency0, address currency1);

    // ------------------------------------------------------------------

    modifier nonReentrant() {
        if (_reentrancyLock != 1) revert ReentrantCall();
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    constructor(uint64 windowLength_, uint64 executionWindow_) {
        require(windowLength_ > 0, "window");
        require(executionWindow_ > 0, "execution window");
        windowLength = windowLength_;
        executionWindow = executionWindow_;
        owner = msg.sender;
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    function setSettlement(address settlement_) external {
        if (msg.sender != owner) revert NotOwner();
        if (settlement != address(0)) revert SettlementAlreadySet();
        require(settlement_ != address(0), "zero settlement");
        settlement = settlement_;
        emit SettlementSet(settlement_);
    }

    /// @notice Emergency admission pause. It cannot pause expiry, refunds,
    /// claims or authenticated LP withdrawals, or change an outstanding clock.
    function setAdmissionPaused(bool paused) external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        admissionPaused = paused;
        emit AdmissionPauseSet(paused);
    }

    /// @notice Register the two tokens a pool trades, so `submit` can escrow
    ///         against it. Callable once per pool, only by `settlement` (which
    ///         holds the v4 `PoolKey` this `poolId` was derived from).
    function registerPoolCurrencies(bytes32 poolId, address currency0, address currency1, address liquidityGuard)
        external
    {
        if (msg.sender != settlement) revert NotSettlement();
        if (registered[poolId]) revert PoolAlreadyRegistered();
        if (currency1 == address(0)) revert ZeroCurrency();
        if (
            currency0 >= currency1 || currency1.code.length == 0
                || (currency0 != address(0) && currency0.code.length == 0)
        ) revert InvalidCurrencies();
        if (liquidityGuard.code.length == 0) revert InvalidLiquidityGuard();
        registered[poolId] = true;
        configVersionOf[poolId] = 1;
        currency0Of[poolId] = currency0;
        currency1Of[poolId] = currency1;
        liquidityGuardOf[poolId] = liquidityGuard;
        emit PoolRegistered(poolId, currency0, currency1);
    }

    // ------------------------------------------------------------------
    // EIP-712
    // ------------------------------------------------------------------

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        // rebuild on fork so signatures cannot be replayed onto a forked chain
        return block.chainid == _CACHED_CHAIN_ID ? _CACHED_DOMAIN_SEPARATOR : _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)));
    }

    function hashOrder(Order calldata o) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                o.trader,
                o.poolId,
                o.sellingCurrency0,
                o.ask,
                o.budget,
                o.deadline,
                o.nonce,
                o.configVersion,
                o.epoch,
                o.maxExecutionTime
            )
        );
    }

    function digestOf(Order calldata o) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), hashOrder(o)));
    }

    // ------------------------------------------------------------------
    // Submission
    // ------------------------------------------------------------------

    /// @notice Compatibility view: true means terminal, including Refundable.
    /// Use batchState/executionDeadline to distinguish expiry from settlement.
    function batches(bytes32 poolId, uint256 epoch)
        external
        view
        returns (uint64 closesAt, uint32 count, bool terminal)
    {
        Batch memory b = _batches[poolId][epoch];
        return (b.closesAt, b.count, _terminal(b.state));
    }

    function batchState(bytes32 poolId, uint256 epoch) public view returns (State) {
        Batch memory b = _batches[poolId][epoch];
        if (b.state == State.Collecting && block.timestamp >= b.closesAt) return State.Closed;
        return b.state;
    }

    function executionDeadline(bytes32 poolId, uint256 epoch) external view returns (uint64) {
        return _batches[poolId][epoch].executeUntil;
    }

    function nextEpochId(bytes32 poolId) public view returns (uint256 id) {
        id = currentBatchId[poolId];
        if (_terminal(_batches[poolId][id].state)) ++id;
    }

    function _terminal(State state) private pure returns (bool) {
        return state == State.Settled || state == State.Refundable;
    }

    function _clock() private view returns (uint64 closesAt, uint64 executeUntil) {
        uint256 duration = uint256(windowLength) + executionWindow;
        if (duration > type(uint64).max || block.timestamp > type(uint64).max - duration) revert InvalidClock();
        return (uint64(block.timestamp + windowLength), uint64(block.timestamp + duration));
    }

    function openBatchId(bytes32 poolId) public view returns (uint256 id, uint64 closesAt) {
        if (!registered[poolId]) revert PoolNotRegistered();
        id = currentBatchId[poolId];
        Batch memory b = _batches[poolId][id];
        if (b.state == State.Executing) revert PreviousBatchUnsettled(id);
        if (b.state == State.None || _terminal(b.state)) {
            (closesAt,) = _clock();
            return (b.state == State.None ? id : id + 1, closesAt);
        }
        if (block.timestamp >= b.closesAt) revert PreviousBatchUnsettled(id);
        return (id, b.closesAt);
    }

    function previewEpoch(bytes32 poolId)
        external
        view
        returns (uint256 id, uint64 closesAt, uint64 executeUntil, uint256 configVersion)
    {
        (id, closesAt) = openBatchId(poolId);
        uint64 storedDeadline = _batches[poolId][id].executeUntil;
        executeUntil = storedDeadline == 0 ? uint64(uint256(closesAt) + executionWindow) : storedDeadline;
        configVersion = configVersionOf[poolId];
    }

    function getOrder(bytes32 poolId, uint256 epoch, uint256 index) public view returns (Order memory o) {
        if (index >= _batches[poolId][epoch].count) revert InvalidOrderIndex();
        StoredOrder storage record = _orders[poolId][epoch][index];
        o = Order(
            record.trader,
            poolId,
            record.sellingCurrency0,
            record.ask,
            record.budget,
            record.deadline,
            record.nonce,
            configVersionOf[poolId],
            epoch,
            record.maxExecutionTime
        );
    }

    function getOrders(bytes32 poolId, uint256 epoch) external view returns (Order[] memory orders) {
        uint256 count = _batches[poolId][epoch].count;
        orders = new Order[](count);
        for (uint256 i; i < count; ++i) {
            orders[i] = getOrder(poolId, epoch, i);
        }
    }

    function orderRecovered(bytes32 poolId, uint256 epoch, uint256 index) external view returns (bool) {
        if (index >= _batches[poolId][epoch].count) revert InvalidOrderIndex();
        return _orders[poolId][epoch][index].refunded;
    }

    /// @notice Invalidate unused signatures in any nonce word. An admitted
    /// order's escrow/state is not canceled by marking its already-used bit.
    function invalidateNonces(uint256 word, uint256 mask) external nonReentrant {
        nonceBitmap[msg.sender][word] |= mask;
        emit NoncesInvalidated(msg.sender, word, mask);
    }

    /// @notice Submit signed orders into the open batch. Anyone may relay, but
    ///         ERC20 budgets are pulled from each signed trader. Native budgets
    ///         are funded by the caller's exact msg.value; refunds always belong
    ///         to the signed trader, including when a relayer supplies ETH.
    /// @dev Every order must target the same pool, which is what lets one
    ///      rollover check and one currency lookup cover the whole array.
    function submit(Order[] calldata orders, bytes[] calldata signatures)
        external
        payable
        nonReentrant
        returns (uint256 batchId)
    {
        if (admissionPaused) revert AdmissionPaused();
        uint256 n = orders.length;
        if (n == 0 || n != signatures.length) revert LengthMismatch();

        bytes32 poolId = orders[0].poolId;
        address c0 = currency0Of[poolId];
        address c1 = currency1Of[poolId];
        if (!registered[poolId]) revert PoolNotRegistered();
        IOtterLiquidityGuard(liquidityGuardOf[poolId]).assertBatchSupported(poolId);
        _assertSolvent(c0);
        _assertSolvent(c1);

        batchId = _rollover(poolId);

        Batch storage b = _batches[poolId][batchId];
        if (block.timestamp >= b.closesAt) revert WindowClosed();
        if (n > MAX_ORDERS - b.count) revert BatchFull();

        bytes32 acc = batchDigest[poolId][batchId];
        uint256 nativeRequired;

        for (uint256 i; i < n; ++i) {
            Order calldata o = orders[i];
            if (o.poolId != poolId) revert WrongPool(i);
            if (block.timestamp > o.deadline) revert OrderExpired(i);
            if (o.budget == 0) revert ZeroBudget(i);
            if (o.trader == address(0)) revert InvalidTrader(i);
            if (o.epoch != batchId) revert WrongEpoch(i);
            if (o.configVersion != configVersionOf[poolId]) revert WrongConfiguration(i);
            if (
                o.budget > MAX_BUDGET || o.ask > MAX_ASK || o.deadline > type(uint64).max
                    || o.maxExecutionTime > type(uint64).max
            ) revert AmountOutOfDomain(i);
            if (o.maxExecutionTime < b.executeUntil) revert InsufficientExecutionValidity(i);
            if (signatures[i].length > MAX_SIGNATURE_BYTES) revert BadSignature(i);
            uint256 aggregate = (o.sellingCurrency0 ? b.budget0 : b.budget1) + o.budget;
            if (aggregate > MAX_BUDGET) revert AmountOutOfDomain(i);
            if (o.sellingCurrency0) b.budget0 = uint96(aggregate);
            else b.budget1 = uint96(aggregate);

            _useNonce(o.trader, o.nonce, i);

            bytes32 h = hashOrder(o);
            bytes32 d = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), h));
            if (!_validSignature(o.trader, d, signatures[i])) revert BadSignature(i);
            uint32 index = b.count++;
            _orders[poolId][batchId][index] = StoredOrder(
                o.trader,
                uint96(o.budget),
                uint128(o.ask),
                uint64(o.deadline),
                uint64(o.maxExecutionTime),
                o.nonce,
                o.sellingCurrency0,
                false
            );

            // Escrow now, while the trader's approval and balance are known
            // good, rather than trusting they will still hold at settlement.
            address sold = o.sellingCurrency0 ? c0 : c1;
            if (sold == address(0)) nativeRequired += o.budget;
            else _pullExact(sold, o.trader, o.budget);
            totalEscrow[sold] += o.budget;

            acc = keccak256(abi.encode(acc, h));
            emit OrderSubmitted(poolId, batchId, o.trader, index, h, o);
        }

        if (msg.value != nativeRequired) revert NativeValueMismatch(msg.value, nativeRequired);
        _assertSolvent(c0);
        _assertSolvent(c1);
        batchDigest[poolId][batchId] = acc;
    }

    function _rollover(bytes32 poolId) private returns (uint256 id) {
        id = currentBatchId[poolId];
        Batch storage b = _batches[poolId][id];
        if (b.state == State.Executing) revert PreviousBatchUnsettled(id);
        if (_terminal(b.state)) {
            id += 1;
            currentBatchId[poolId] = id;
        } else if (b.state != State.None) {
            if (block.timestamp >= b.closesAt) revert PreviousBatchUnsettled(id);
            return id;
        }
        Batch storage next = _batches[poolId][id];
        (next.closesAt, next.executeUntil) = _clock();
        next.state = State.Collecting;
    }

    function _useNonce(address trader, uint256 nonce, uint256 i) private {
        uint256 word = nonce >> 8;
        uint256 bit = 1 << (nonce & 0xff);
        uint256 current = nonceBitmap[trader][word];
        if (current & bit != 0) revert NonceUsed(i);
        nonceBitmap[trader][word] = current | bit;
    }

    // ------------------------------------------------------------------
    // Settlement interface
    // ------------------------------------------------------------------

    /// @notice Check that `orders` is exactly the batch that was submitted, in
    ///         submission order. Reverts otherwise.
    /// @dev The whole inclusion guarantee lives here. A settlement that omitted a
    ///      submitted order, reordered the array, or inserted an unsigned one
    ///      cannot reproduce the digest.
    function replay(bytes32 poolId, uint256 batchId, Order[] calldata orders) public view {
        Batch memory b = _batches[poolId][batchId];
        if (orders.length != b.count) revert CountMismatch(orders.length, b.count);

        bytes32 acc;
        for (uint256 i; i < orders.length; ++i) {
            if (orders[i].poolId != poolId) revert WrongPool(i);
            acc = keccak256(abi.encode(acc, hashOrder(orders[i])));
        }
        if (acc != batchDigest[poolId][batchId]) revert DigestMismatch();
    }

    /// @notice Called by OtterSettlement once the window has closed. Validates the
    ///         supplied orders against the commitment and marks the batch spent.
    function consume(bytes32 poolId, uint256 batchId, Order[] calldata orders) external nonReentrant {
        if (msg.sender != settlement) revert NotSettlement();

        Batch storage b = _batches[poolId][batchId];
        if (b.state != State.Collecting && b.state != State.None) revert AlreadySettled();
        if (b.state == State.None || block.timestamp < b.closesAt) revert WindowStillOpen();
        if (block.timestamp >= b.executeUntil) revert ExecutionExpired(b.executeUntil);
        if (batchId != currentBatchId[poolId]) revert AlreadySettled();

        replay(poolId, batchId, orders);

        b.state = State.Executing;
        executionInProgress[poolId] = true;
    }

    /// @dev Keep LP custody frozen through all settlement token callbacks, even
    /// after consume has marked the batch spent. Completion itself transfers no
    /// tokens and is called only after the complete settlement succeeds.
    function completeExecution(bytes32 poolId) external nonReentrant {
        if (msg.sender != settlement) revert NotSettlement();
        if (!executionInProgress[poolId]) revert NotExecuting();
        if (!payoutsCredited[poolId][currentBatchId[poolId]]) revert NotExecuting();
        executionInProgress[poolId] = false;
        uint256 epoch = currentBatchId[poolId];
        _batches[poolId][epoch].state = State.Settled;
        emit BatchSettled(poolId, epoch, _batches[poolId][epoch].count);
    }

    function isBatchActive(bytes32 poolId) external view returns (bool) {
        State state = _batches[poolId][currentBatchId[poolId]].state;
        return _reentrancyLock != 1 || state == State.Collecting || state == State.Executing;
    }

    /// @notice Constant-work timeout. No order replay, asset query, or transfer.
    /// Full budgets stay recorded as escrow until each record is recovered.
    function expire(bytes32 poolId, uint256 epoch) external nonReentrant {
        _expire(poolId, epoch);
    }

    function _expire(bytes32 poolId, uint256 epoch) private {
        Batch storage b = _batches[poolId][epoch];
        if (b.state != State.Collecting) revert AlreadySettled();
        if (block.timestamp < b.executeUntil) revert RefundTooEarly(b.executeUntil);
        b.state = State.Refundable;
        emit EpochExpired(poolId, epoch);
    }

    /// @notice Fee drift permits early recovery, authenticated against the
    /// registered vault's real pool key. A queued exit is not a fee invalidation.
    function expireUnsupportedFees(bytes32 poolId, uint256 epoch) external nonReentrant {
        Batch storage b = _batches[poolId][epoch];
        if (b.state != State.Collecting) revert AlreadySettled();
        if (!IOtterLiquidityGuard(liquidityGuardOf[poolId]).hasUnsupportedFees(poolId)) revert FeesStillSupported();
        b.state = State.Refundable;
        emit EpochExpired(poolId, epoch);
    }

    /// @notice Anyone can recover one stored record; ownership is fixed. The
    /// credit step makes no token call and works after later epochs have opened.
    function refundOrder(bytes32 poolId, uint256 epoch, uint256 index) external nonReentrant {
        if (_batches[poolId][epoch].state == State.Collecting) _expire(poolId, epoch);
        if (_batches[poolId][epoch].state != State.Refundable) revert NotRefundable();
        _refundOrder(poolId, epoch, index);
    }

    function _refundOrder(bytes32 poolId, uint256 epoch, uint256 index) private {
        if (index >= _batches[poolId][epoch].count) revert InvalidOrderIndex();
        StoredOrder storage record = _orders[poolId][epoch][index];
        if (record.refunded) revert AlreadyRecovered();
        record.refunded = true;
        address sold = record.sellingCurrency0 ? currency0Of[poolId] : currency1Of[poolId];
        totalEscrow[sold] -= record.budget;
        _credit(record.trader, sold, record.budget);
        emit OrderRecovered(poolId, epoch, index, record.trader);
    }

    /// @notice Bounded convenience wrapper for existing integration fixtures.
    /// Primary recovery is expire/refundOrder and never requires this array.
    function refundExpired(bytes32 poolId, uint256 epoch, Order[] calldata orders) external nonReentrant {
        replay(poolId, epoch, orders);
        if (_batches[poolId][epoch].state != State.Refundable) _expire(poolId, epoch);
        bool any;
        for (uint256 i; i < orders.length; ++i) {
            if (_orders[poolId][epoch][i].refunded) continue;
            _refundOrder(poolId, epoch, i);
            any = true;
        }
        if (!any) revert AlreadySettled();
        emit BatchRefunded(poolId, epoch, _batches[poolId][epoch].count);
    }

    /// @notice Release filled input exactly once for the currently executing
    /// committed batch. Unfilled input becomes a claim; no trader is called.
    function releaseFilled(bytes32 poolId, Order[] calldata orders, uint256[] calldata filled) external nonReentrant {
        if (msg.sender != settlement) revert NotSettlement();
        uint256 batchId = _executingBatch(poolId, orders);
        if (escrowReleased[poolId][batchId]) revert AlreadyReleased();
        if (filled.length != orders.length) revert LengthMismatch();
        escrowReleased[poolId][batchId] = true;

        address c0 = currency0Of[poolId];
        address c1 = currency1Of[poolId];
        _assertSolvent(c0);
        _assertSolvent(c1);
        uint256 amount0;
        uint256 amount1;
        for (uint256 i; i < orders.length; ++i) {
            if (filled[i] > orders[i].budget) revert BudgetExceeded(i);
            address sold = orders[i].sellingCurrency0 ? c0 : c1;
            totalEscrow[sold] -= orders[i].budget;
            _credit(orders[i].trader, sold, orders[i].budget - filled[i]);
            if (orders[i].sellingCurrency0) amount0 += filled[i];
            else amount1 += filled[i];
        }
        _sendExact(c0, settlement, amount0);
        _sendExact(c1, settlement, amount1);
        _assertSolvent(c0);
        _assertSolvent(c1);
    }

    /// @notice Fund outputs exactly once and credit the committed traders.
    /// ERC20 funds are pulled from settlement; native outputs need exact value.
    function creditPayouts(bytes32 poolId, Order[] calldata orders, uint256[] calldata outputs)
        external
        payable
        nonReentrant
    {
        if (msg.sender != settlement) revert NotSettlement();
        uint256 batchId = _executingBatch(poolId, orders);
        if (!escrowReleased[poolId][batchId]) revert NotExecuting();
        if (payoutsCredited[poolId][batchId]) revert AlreadyCredited();
        if (outputs.length != orders.length) revert LengthMismatch();
        payoutsCredited[poolId][batchId] = true;

        address c0 = currency0Of[poolId];
        address c1 = currency1Of[poolId];
        _assertSolvent(c0);
        _assertSolvent(c1);
        uint256 amount0;
        uint256 amount1;
        for (uint256 i; i < orders.length; ++i) {
            address received = orders[i].sellingCurrency0 ? c1 : c0;
            _credit(orders[i].trader, received, outputs[i]);
            if (orders[i].sellingCurrency0) amount1 += outputs[i];
            else amount0 += outputs[i];
        }
        uint256 nativeRequired = c0 == address(0) ? amount0 : 0;
        if (msg.value != nativeRequired) revert NativeValueMismatch(msg.value, nativeRequired);
        if (c0 != address(0)) _pullExact(c0, settlement, amount0);
        _pullExact(c1, settlement, amount1);
        _assertSolvent(c0);
        _assertSolvent(c1);
    }

    /// @notice Withdraw your own credit, in whole or part, to a chosen receiver.
    /// A failed token transfer or rejecting ETH receiver rolls back only this
    /// call. It cannot veto settlement, expiry, or another owner's claim.
    function claim(address currency, uint256 amount, address recipient) external nonReentrant {
        if (
            amount == 0 || amount > claimable[msg.sender][currency] || recipient == address(0)
                || recipient == address(this)
        ) revert InvalidClaim();
        _assertSolvent(currency);
        claimable[msg.sender][currency] -= amount;
        totalClaimable[currency] -= amount;
        _sendExact(currency, recipient, amount);
        _assertSolvent(currency);
        emit Claimed(msg.sender, currency, recipient, amount);
    }

    function _executingBatch(bytes32 poolId, Order[] calldata orders) private view returns (uint256 batchId) {
        if (!executionInProgress[poolId]) revert NotExecuting();
        batchId = currentBatchId[poolId];
        replay(poolId, batchId, orders);
    }

    function _credit(address trader, address currency, uint256 amount) private {
        if (amount == 0) return;
        claimable[trader][currency] += amount;
        totalClaimable[currency] += amount;
        emit ClaimCredited(trader, currency, amount);
    }

    function _balance(address currency, address account) private view returns (uint256) {
        return currency == address(0) ? account.balance : ERC20(currency).balanceOf(account);
    }

    function _assertSolvent(address currency) private view {
        if (_balance(currency, address(this)) < totalEscrow[currency] + totalClaimable[currency]) {
            revert Insolvent(currency);
        }
    }

    function _pullExact(address currency, address from, uint256 amount) private {
        if (amount == 0) return;
        uint256 beforeBalance = _balance(currency, address(this));
        uint256 senderBefore = _balance(currency, from);
        SafeTransferLib.safeTransferFrom(ERC20(currency), from, address(this), amount);
        if (
            _balance(currency, address(this)) != beforeBalance + amount
                || _balance(currency, from) + amount != senderBefore
        ) revert InexactTransfer(currency, amount);
    }

    function _sendExact(address currency, address recipient, uint256 amount) private {
        if (amount == 0) return;
        if (currency == address(0)) {
            (bool success,) = recipient.call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            uint256 beforeBalance = _balance(currency, address(this));
            uint256 recipientBefore = _balance(currency, recipient);
            SafeTransferLib.safeTransfer(ERC20(currency), recipient, amount);
            if (
                _balance(currency, address(this)) + amount != beforeBalance
                    || _balance(currency, recipient) != recipientBefore + amount
            ) revert InexactTransfer(currency, amount);
        }
    }

    // ------------------------------------------------------------------
    // ECDSA
    // ------------------------------------------------------------------

    function _validSignature(address trader, bytes32 digest, bytes calldata signature)
        private
        view
        returns (bool valid)
    {
        if (trader.code.length == 0) return _recover(digest, signature) == trader;
        bytes memory data = abi.encodeWithSelector(_ERC1271_MAGIC, digest, signature);
        uint256 gasLimit = SIGNATURE_GAS_LIMIT;
        // Copy at most one return word: a contract wallet cannot force the book
        // to allocate arbitrarily large return data. Staticcall prevents mutation.
        assembly ("memory-safe") {
            let output := mload(0x40)
            mstore(output, 0)
            let success := staticcall(gasLimit, trader, add(data, 32), mload(data), output, 32)
            valid := and(success, and(gt(returndatasize(), 31), eq(shr(224, mload(output)), 0x1626ba7e)))
        }
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 0x20))
            v := byte(0, calldataload(add(sig.offset, 0x40)))
        }
        // reject the malleable upper half of the curve order
        if (uint256(s) > MAX_S) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
