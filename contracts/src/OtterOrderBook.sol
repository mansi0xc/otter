// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title OtterOrderBook
/// @notice Collects signed orders into per-pool batch windows and escrows the
///         funds they sell.
///
/// Design notes, both load-bearing:
///
/// 1. Orders are not stored. The batch keeps a running commitment
///    `digest = keccak256(digest, orderHash)` plus a count. Settlement supplies the
///    full order array back as calldata and `replay` checks it reproduces the
///    digest. Storing five words per order would cost ~100k gas each and make the
///    settlement gas curve a measurement of SSTORE rather than of the mechanism.
///
/// 2. That commitment is an inclusion guarantee, not just an optimisation. If the
///    solver chose the batch membership off-chain it could exclude orders — which
///    is exactly the censorship the paper assumes away at the consensus layer
///    (Theorem 23), reintroduced inside our own system where there is no excuse
///    for it. The digest makes omitting a submitted order or inserting an unsigned
///    one detectable on-chain.
///
///    The digest commits to a sequence, not a set, so settlement must replay in
///    submission order. That is not a constraint on the outcome: the mechanism is
///    order-insensitive by construction and the solver test suite asserts it.
///
/// 3. ESCROW. `submit` pulls each order's full `budget` in the token it sells,
///    into this contract, before the order is ever eligible to be filled. This
///    is what makes the inclusion guarantee in (2) safe to keep unconditional.
///    Earlier versions of Otter pulled funds from the trader at settlement time
///    instead — which meant a trader could revoke approval, spend the funds
///    elsewhere, or simply be broke by the time settlement ran, and because the
///    digest forbids dropping a committed order, that reverted the ENTIRE batch
///    and vetoed every other trader in it. Escrowing at submission moves the
///    only point of failure to the individual `submit` call the trader's own
///    order is in: a bad pull reverts that call, not batches it never touched.
///    Settlement releases exactly the filled amount to itself and this contract
///    refunds the rest directly — see `releaseFilled`.
///
///    A pool must be registered (`registerPoolCurrencies`) before any order
///    against it can be escrowed; this contract otherwise has no way to know
///    which two tokens a `bytes32 poolId` refers to. Registration is called once
///    by `settlement`, which already depends on v4-core to decode a `PoolKey` —
///    keeping that decoding out of this contract, at the cost of one more
///    initialization step, is the trade this design makes to stay free of a
///    direct v4 dependency.
///
/// Known limitation: signatures are ECDSA only. Contract wallets (EIP-1271) cannot
/// currently trade. Noted in the README rather than silently unsupported.
///
/// Known limitation: no order cancellation. A trader who wants out before
/// settlement cannot withdraw an escrowed order early; they can only let it be
/// filled or (if ineligible) unfilled. The paper's ex-post individual
/// rationality means withdrawal would never have been strategically useful
/// (§1.1), so this is a UX gap, not a game-theoretic one — but it is a real gap,
/// and it is not fixed here.
interface IERC20Escrow {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

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
    }

    struct Batch {
        uint64 closesAt;
        uint32 count;
        bool settled;
        // remainder of the slot intentionally free
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
        "Order(address trader,bytes32 poolId,bool sellingCurrency0,uint256 ask,uint256 budget,uint256 deadline,uint256 nonce)"
    );

    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _NAME_HASH = keccak256("OtterOrderBook");
    bytes32 private constant _VERSION_HASH = keccak256("1");

    uint256 private immutable _CACHED_CHAIN_ID;
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;

    /// length of a batch window in seconds
    uint64 public immutable windowLength;

    /// the only address permitted to mark a batch settled
    address public settlement;
    address public owner;

    mapping(bytes32 poolId => uint256) public currentBatchId;
    mapping(bytes32 poolId => mapping(uint256 batchId => Batch)) public batches;
    mapping(bytes32 poolId => mapping(uint256 batchId => bytes32)) public batchDigest;

    /// @notice The two tokens a pool trades, so `submit` knows what to escrow.
    ///         Zero until `registerPoolCurrencies` is called for that pool.
    mapping(bytes32 poolId => address) public currency0Of;
    mapping(bytes32 poolId => address) public currency1Of;

    /// Permit2-style unordered nonces: 256 nonces share one slot, so a trader
    /// submitting repeatedly pays one cold SSTORE per 256 orders rather than each.
    mapping(address trader => mapping(uint256 word => uint256 bits)) public nonceBitmap;

    // ------------------------------------------------------------------
    // Events / errors
    // ------------------------------------------------------------------

    event OrderSubmitted(
        bytes32 indexed poolId, uint256 indexed batchId, address indexed trader, bytes32 orderHash
    );
    event BatchSettled(bytes32 indexed poolId, uint256 indexed batchId, uint32 count);
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
    error AlreadySettled();
    error DigestMismatch();
    error CountMismatch(uint256 supplied, uint32 expected);
    error PoolNotRegistered();
    error PoolAlreadyRegistered();
    error ZeroCurrency();
    error TransferFailed();

    event PoolRegistered(bytes32 indexed poolId, address currency0, address currency1);

    // ------------------------------------------------------------------

    constructor(uint64 windowLength_) {
        require(windowLength_ > 0, "window");
        windowLength = windowLength_;
        owner = msg.sender;
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    function setSettlement(address settlement_) external {
        if (msg.sender != owner) revert NotOwner();
        if (settlement != address(0)) revert SettlementAlreadySet();
        settlement = settlement_;
        emit SettlementSet(settlement_);
    }

    /// @notice Register the two tokens a pool trades, so `submit` can escrow
    ///         against it. Callable once per pool, only by `settlement` (which
    ///         holds the v4 `PoolKey` this `poolId` was derived from).
    function registerPoolCurrencies(bytes32 poolId, address currency0, address currency1) external {
        if (msg.sender != settlement) revert NotSettlement();
        if (currency0Of[poolId] != address(0)) revert PoolAlreadyRegistered();
        if (currency0 == address(0) || currency1 == address(0)) revert ZeroCurrency();
        currency0Of[poolId] = currency0;
        currency1Of[poolId] = currency1;
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
            abi.encode(ORDER_TYPEHASH, o.trader, o.poolId, o.sellingCurrency0, o.ask, o.budget, o.deadline, o.nonce)
        );
    }

    function digestOf(Order calldata o) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), hashOrder(o)));
    }

    // ------------------------------------------------------------------
    // Submission
    // ------------------------------------------------------------------

    /// @notice Open batch for a pool, rolling over if the previous window has closed.
    /// @dev View-only variant of the rollover in `submit`, for off-chain callers.
    function openBatchId(bytes32 poolId) public view returns (uint256 id, uint64 closesAt) {
        id = currentBatchId[poolId];
        Batch memory b = batches[poolId][id];
        if (b.closesAt == 0 || block.timestamp >= b.closesAt) {
            return (b.closesAt == 0 ? id : id + 1, uint64(block.timestamp) + windowLength);
        }
        return (id, b.closesAt);
    }

    /// @notice Submit signed orders into the open batch. Anyone may relay, but
    ///         each order's `budget` is pulled from its own trader — a relayer
    ///         cannot fund someone else's order.
    /// @dev Every order must target the same pool, which is what lets one
    ///      rollover check and one currency lookup cover the whole array.
    function submit(Order[] calldata orders, bytes[] calldata signatures) external returns (uint256 batchId) {
        uint256 n = orders.length;
        if (n == 0 || n != signatures.length) revert LengthMismatch();

        bytes32 poolId = orders[0].poolId;
        address c0 = currency0Of[poolId];
        address c1 = currency1Of[poolId];
        if (c0 == address(0)) revert PoolNotRegistered();

        batchId = _rollover(poolId);

        Batch storage b = batches[poolId][batchId];
        if (block.timestamp >= b.closesAt) revert WindowClosed();

        bytes32 acc = batchDigest[poolId][batchId];

        for (uint256 i; i < n; ++i) {
            Order calldata o = orders[i];
            if (o.poolId != poolId) revert WrongPool(i);
            if (block.timestamp > o.deadline) revert OrderExpired(i);
            if (o.budget == 0) revert ZeroBudget(i);

            _useNonce(o.trader, o.nonce, i);

            bytes32 h = hashOrder(o);
            bytes32 d = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), h));
            if (_recover(d, signatures[i]) != o.trader) revert BadSignature(i);

            // Escrow now, while the trader's approval and balance are known
            // good, rather than trusting they will still hold at settlement.
            address sold = o.sellingCurrency0 ? c0 : c1;
            if (!IERC20Escrow(sold).transferFrom(o.trader, address(this), o.budget)) revert TransferFailed();

            acc = keccak256(abi.encode(acc, h));
            emit OrderSubmitted(poolId, batchId, o.trader, h);
        }

        batchDigest[poolId][batchId] = acc;
        b.count += uint32(n);
    }

    function _rollover(bytes32 poolId) private returns (uint256 id) {
        id = currentBatchId[poolId];
        Batch storage b = batches[poolId][id];
        if (b.closesAt == 0) {
            b.closesAt = uint64(block.timestamp) + windowLength;
            return id;
        }
        if (block.timestamp >= b.closesAt) {
            id += 1;
            currentBatchId[poolId] = id;
            batches[poolId][id].closesAt = uint64(block.timestamp) + windowLength;
        }
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
        Batch memory b = batches[poolId][batchId];
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
    function consume(bytes32 poolId, uint256 batchId, Order[] calldata orders) external {
        if (msg.sender != settlement) revert NotSettlement();

        Batch storage b = batches[poolId][batchId];
        if (b.settled) revert AlreadySettled();
        if (b.closesAt == 0 || block.timestamp < b.closesAt) revert WindowStillOpen();

        replay(poolId, batchId, orders);

        b.settled = true;
        emit BatchSettled(poolId, batchId, b.count);
    }

    /// @notice Move each order's filled amount from escrow to `settlement`, and
    ///         refund the unfilled remainder straight to the trader.
    /// @dev Only callable as part of the same `settle` that already ran
    ///      `consume` on this exact batch, so `filled[i] <= orders[i].budget` has
    ///      already been checked by OtterMath (`BudgetExceeded`) before any
    ///      token here moves. This contract does not re-check it — it trusts
    ///      settlement the same way `consume` already does.
    function releaseFilled(bytes32 poolId, Order[] calldata orders, uint256[] calldata filled) external {
        if (msg.sender != settlement) revert NotSettlement();
        if (filled.length != orders.length) revert LengthMismatch();

        address c0 = currency0Of[poolId];
        address c1 = currency1Of[poolId];

        for (uint256 i; i < orders.length; ++i) {
            address sold = orders[i].sellingCurrency0 ? c0 : c1;
            uint256 refund = orders[i].budget - filled[i];

            if (filled[i] > 0) {
                if (!IERC20Escrow(sold).transfer(msg.sender, filled[i])) revert TransferFailed();
            }
            if (refund > 0) {
                if (!IERC20Escrow(sold).transfer(orders[i].trader, refund)) revert TransferFailed();
            }
        }
    }

    // ------------------------------------------------------------------
    // ECDSA
    // ------------------------------------------------------------------

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
