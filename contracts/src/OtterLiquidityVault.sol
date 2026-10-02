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
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IOtterBatchStatus, IOtterLiquidityGuard} from "./interfaces/IOtterLiquidityGuard.sol";

/// @notice Owner-authenticated, nontransferable v4 range positions. Principal and
/// fees become individual claims backed by PoolManager ERC6909 credits; removing
/// liquidity never calls the beneficiary. Owner-reserved exits precede new
/// admission; historical Otter rewards remain a separate remediation step.
contract OtterLiquidityVault is IUnlockCallback, IOtterLiquidityGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    uint256 public constant MAX_POSITIONS = 32;
    uint128 public constant MAX_POOL_LIQUIDITY = (1 << 88) - 1;
    uint256 public constant MAX_AMOUNT = (1 << 120) - 1;

    IPoolManager public immutable poolManager;
    IOtterBatchStatus public immutable orderBook;
    address public immutable hook;

    struct Position {
        address owner;
        bytes32 poolId;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    enum Operation {
        Modify,
        Claim
    }

    struct CallbackArgs {
        Operation operation;
        PoolKey key;
        IPoolManager.ModifyLiquidityParams params;
        address owner;
        uint256 bound0;
        uint256 bound1;
        uint256 nativeValue;
        Currency claimCurrency;
        uint256 claimAmount;
        address recipient;
    }

    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) public positions;
    mapping(bytes32 => PoolKey) private _keys;
    mapping(bytes32 => uint256[]) private _openPositions;
    mapping(uint256 => uint256) private _positionIndex;
    mapping(bytes32 => uint128) public totalLiquidity;
    mapping(bytes32 => uint256) public concentratedPositions;
    mapping(address => mapping(Currency => uint256)) public claims;
    mapping(Currency => uint256) public totalClaims;
    /// @notice Cumulative fee-only credits harvested from core. Principal must
    /// never reduce the hook's uncollected-donation accounting.
    mapping(PoolId => uint256) public totalFeesCollected0;
    mapping(PoolId => uint256) public totalFeesCollected1;
    mapping(uint256 => uint128) public queuedLiquidity;
    mapping(bytes32 => uint256[]) private _queuedExits;
    mapping(uint256 => uint256) private _exitIndex;

    uint256 private _lock = 1;
    bytes32 private _callbackHash;

    error InvalidConfiguration();
    error InvalidPool();
    error InvalidRange();
    error InvalidLiquidity();
    error PositionLimit();
    error NotPositionOwner();
    error ActiveBatch();
    error ConcentratedExecutionUnavailable();
    error PriceOutOfRange();
    error SlippageExceeded();
    error NativeValueMismatch(uint256 supplied, uint256 required);
    error EscrowMismatch(uint256 received, uint256 required);
    error InexactTransfer(Currency currency, uint256 amount);
    error AmountOutOfRange();
    error InvalidDelta();
    error InvalidClaim();
    error UnauthorizedCallback();
    error ReentrantCall();
    error InFlightLiquidity();
    error UnsupportedPoolState();
    error PendingExits();
    error ExitAlreadyQueued();
    error ExitNotQueued();

    event PositionCreated(
        uint256 indexed positionId, bytes32 indexed poolId, address indexed owner, int24 lower, int24 upper
    );
    event LiquidityChanged(uint256 indexed positionId, uint128 liquidity);
    event ClaimCredited(address indexed owner, Currency indexed currency, uint256 amount);
    event Claimed(address indexed owner, Currency indexed currency, address indexed recipient, uint256 amount);
    event ExitRequested(uint256 indexed positionId, bytes32 indexed poolId, address indexed owner, uint128 liquidity);
    event ExitProcessed(
        uint256 indexed positionId,
        bytes32 indexed poolId,
        address indexed owner,
        uint128 liquidity,
        uint256 credited0,
        uint256 credited1
    );

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IPoolManager manager_, IOtterBatchStatus book_, address hook_) {
        if (address(manager_).code.length == 0 || address(book_).code.length == 0 || hook_ == address(0)) {
            revert InvalidConfiguration();
        }
        poolManager = manager_;
        orderBook = book_;
        hook = hook_;
    }

    function openPositionIds(bytes32 poolId) external view returns (uint256[] memory) {
        return _openPositions[poolId];
    }

    function queuedExitIds(bytes32 poolId) external view returns (uint256[] memory) {
        return _queuedExits[poolId];
    }

    function pendingExitCount(bytes32 poolId) external view returns (uint256) {
        return _queuedExits[poolId].length;
    }

    /// @notice Exit priority applies to admission, never to the current batch's
    /// swap. Requests change no pricing state and cannot veto settlement.
    function assertAdmissionSupported(bytes32 poolId) external view {
        _assertBatchSupported(poolId);
        _requireNoExits(poolId);
    }

    /// @dev Admission and swaps stay restricted to full-range liquidity until
    /// the tick-aware execution/auction implementation is ready. Concentrated
    /// custody is supported now, without using the old curve to price it.
    function assertBatchSupported(bytes32 poolId) external view {
        _assertBatchSupported(poolId);
    }

    function _assertBatchSupported(bytes32 poolId) private view {
        if (_lock != 1) revert InFlightLiquidity();
        if (concentratedPositions[poolId] != 0) revert ConcentratedExecutionUnavailable();
        PoolKey memory key = _keys[poolId];
        if (PoolId.unwrap(key.toId()) != poolId) revert UnsupportedPoolState();
        (uint160 price,, uint24 protocolFee, uint24 lpFee) = poolManager.getSlot0(key.toId());
        uint128 liquidity = poolManager.getLiquidity(key.toId());
        if (price < 1 << 64 || price >= 1 << 128 || liquidity == 0 || protocolFee != 0 || lpFee != 0) {
            revert UnsupportedPoolState();
        }
        // Both integer virtual reserves must be nonzero. Bounds keep each below
        // 2^120, so accepted uint128 asks cannot poison legacy classification.
        if ((uint256(liquidity) << 96) / price == 0 || (uint256(liquidity) * price) >> 96 == 0) {
            revert UnsupportedPoolState();
        }
    }

    function hasUnsupportedFees(bytes32 poolId) external view returns (bool) {
        PoolKey memory key = _keys[poolId];
        if (PoolId.unwrap(key.toId()) != poolId) return false;
        (,, uint24 protocolFee, uint24 lpFee) = poolManager.getSlot0(key.toId());
        return protocolFee != 0 || lpFee != 0;
    }

    function createPosition(
        PoolKey calldata key,
        int24 lower,
        int24 upper,
        uint128 liquidity,
        uint256 amount0Max,
        uint256 amount1Max
    ) external payable nonReentrant returns (uint256 id) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        _requireIdle(poolId);
        _requireNoExits(poolId);
        _validatePool(key);
        if (
            lower >= upper || lower < TickMath.MIN_TICK || upper > TickMath.MAX_TICK || lower % key.tickSpacing != 0
                || upper % key.tickSpacing != 0
        ) revert InvalidRange();
        if (_openPositions[poolId].length >= MAX_POSITIONS) revert PositionLimit();
        _checkAddition(poolId, liquidity);

        id = nextPositionId++;
        positions[id] = Position(msg.sender, poolId, lower, upper, liquidity);
        _keys[poolId] = key;
        _openPositions[poolId].push(id);
        _positionIndex[id] = _openPositions[poolId].length;
        totalLiquidity[poolId] += liquidity;
        if (!_isFullRange(key, lower, upper)) concentratedPositions[poolId]++;

        _modify(id, int256(uint256(liquidity)), amount0Max, amount1Max, msg.value);
        emit PositionCreated(id, poolId, msg.sender, lower, upper);
        emit LiquidityChanged(id, liquidity);
    }

    function increaseLiquidity(uint256 id, uint128 liquidity, uint256 amount0Max, uint256 amount1Max)
        external
        payable
        nonReentrant
    {
        Position storage p = _ownedPosition(id);
        _requireIdle(p.poolId);
        _requireNoExits(p.poolId);
        _validatePool(_keys[p.poolId]);
        _checkAddition(p.poolId, liquidity);
        if (p.liquidity == 0) {
            if (_openPositions[p.poolId].length >= MAX_POSITIONS) revert PositionLimit();
            _openPositions[p.poolId].push(id);
            _positionIndex[id] = _openPositions[p.poolId].length;
            if (!_isFullRange(_keys[p.poolId], p.tickLower, p.tickUpper)) concentratedPositions[p.poolId]++;
        }
        p.liquidity += liquidity;
        totalLiquidity[p.poolId] += liquidity;
        _modify(id, int256(uint256(liquidity)), amount0Max, amount1Max, msg.value);
        emit LiquidityChanged(id, p.liquidity);
    }

    /// @notice Removes liquidity into credits. A rejecting/blocked beneficiary
    /// cannot veto this operation. Minimums apply to principal, excluding fees.
    function removeLiquidity(uint256 id, uint128 liquidity, uint256 amount0Min, uint256 amount1Min)
        external
        nonReentrant
    {
        Position storage p = _ownedPosition(id);
        _requireIdle(p.poolId);
        if (liquidity == 0 || liquidity > p.liquidity - queuedLiquidity[id]) revert InvalidLiquidity();
        _removeLiquidity(id, liquidity, amount0Min, amount1Min);
    }

    /// @notice Irrevocably authorize this amount to exit at the next idle pool
    /// state. One pending request per funded position; no caller-chosen minimum
    /// or recipient can hold the rest of the pool's exit barrier hostage.
    function requestExit(uint256 id, uint128 liquidity) external nonReentrant {
        Position storage p = _ownedPosition(id);
        if (queuedLiquidity[id] != 0) revert ExitAlreadyQueued();
        if (liquidity == 0 || liquidity > p.liquidity) revert InvalidLiquidity();
        queuedLiquidity[id] = liquidity;
        _queuedExits[p.poolId].push(id);
        _exitIndex[id] = _queuedExits[p.poolId].length;
        emit ExitRequested(id, p.poolId, p.owner, liquidity);
    }

    /// @notice Anyone processes one reserved exit after economic completion.
    /// Only manager credits are minted; no asset or beneficiary is called.
    function processExit(uint256 id) external nonReentrant returns (uint256 credited0, uint256 credited1) {
        uint128 liquidity = queuedLiquidity[id];
        if (liquidity == 0) revert ExitNotQueued();
        Position storage p = positions[id];
        _requireIdle(p.poolId);
        delete queuedLiquidity[id];
        _removeQueuedExit(id, p.poolId);
        (credited0, credited1) = _removeLiquidity(id, liquidity, 0, 0);
        emit ExitProcessed(id, p.poolId, p.owner, liquidity, credited0, credited1);
    }

    function _removeLiquidity(uint256 id, uint128 liquidity, uint256 amount0Min, uint256 amount1Min)
        private
        returns (uint256 credited0, uint256 credited1)
    {
        Position storage p = positions[id];
        p.liquidity -= liquidity;
        totalLiquidity[p.poolId] -= liquidity;
        if (p.liquidity == 0) {
            _removeOpenPosition(id, p.poolId);
            if (!_isFullRange(_keys[p.poolId], p.tickLower, p.tickUpper)) concentratedPositions[p.poolId]--;
        }
        (credited0, credited1) = _modify(id, -int256(uint256(liquidity)), amount0Min, amount1Min, 0);
        emit LiquidityChanged(id, p.liquidity);
    }

    function collectFees(uint256 id) external nonReentrant {
        Position storage p = _ownedPosition(id);
        _requireIdle(p.poolId);
        _modify(id, 0, 0, 0, 0);
    }

    /// @notice Owner chooses the recipient. Claims are isolated per currency;
    /// a failed take reverts only this claim and restores its accounting.
    function claim(Currency currency, uint256 amount, address recipient) external nonReentrant {
        if (recipient == address(0) || amount == 0 || amount > claims[msg.sender][currency] || amount > MAX_AMOUNT) {
            revert InvalidClaim();
        }
        claims[msg.sender][currency] -= amount;
        totalClaims[currency] -= amount;
        CallbackArgs memory a;
        a.operation = Operation.Claim;
        a.claimCurrency = currency;
        a.claimAmount = amount;
        a.recipient = recipient;
        _unlock(a);
        emit Claimed(msg.sender, currency, recipient, amount);
    }

    function _ownedPosition(uint256 id) private view returns (Position storage p) {
        p = positions[id];
        if (p.owner != msg.sender) revert NotPositionOwner();
    }

    function _requireIdle(bytes32 poolId) private view {
        if (orderBook.isBatchActive(poolId)) revert ActiveBatch();
    }

    function _requireNoExits(bytes32 poolId) private view {
        if (_queuedExits[poolId].length != 0) revert PendingExits();
    }

    function _validatePool(PoolKey memory key) private view {
        if (address(key.hooks) != hook || key.fee != 0 || key.tickSpacing <= 0 || !(key.currency0 < key.currency1)) {
            revert InvalidPool();
        }
        if (
            (!key.currency0.isAddressZero() && Currency.unwrap(key.currency0).code.length == 0)
                || Currency.unwrap(key.currency1).code.length == 0
        ) revert InvalidPool();
        (uint160 price,,,) = poolManager.getSlot0(key.toId());
        if (price < 1 << 64 || price >= 1 << 128) revert PriceOutOfRange();
    }

    function _checkAddition(bytes32 poolId, uint128 liquidity) private view {
        if (liquidity == 0 || uint256(totalLiquidity[poolId]) + liquidity > MAX_POOL_LIQUIDITY) {
            revert InvalidLiquidity();
        }
    }

    function _isFullRange(PoolKey memory key, int24 lower, int24 upper) private pure returns (bool) {
        return lower == TickMath.minUsableTick(key.tickSpacing) && upper == TickMath.maxUsableTick(key.tickSpacing);
    }

    function _removeOpenPosition(uint256 id, bytes32 poolId) private {
        uint256 index = _positionIndex[id] - 1;
        uint256[] storage ids = _openPositions[poolId];
        uint256 last = ids[ids.length - 1];
        ids[index] = last;
        _positionIndex[last] = index + 1;
        ids.pop();
        delete _positionIndex[id];
    }

    function _removeQueuedExit(uint256 id, bytes32 poolId) private {
        uint256 index = _exitIndex[id] - 1;
        uint256[] storage ids = _queuedExits[poolId];
        uint256 last = ids[ids.length - 1];
        ids[index] = last;
        _exitIndex[last] = index + 1;
        ids.pop();
        delete _exitIndex[id];
    }

    function _modify(uint256 id, int256 delta, uint256 bound0, uint256 bound1, uint256 nativeValue)
        private
        returns (uint256 credited0, uint256 credited1)
    {
        Position storage p = positions[id];
        CallbackArgs memory a;
        a.key = _keys[p.poolId];
        a.params = IPoolManager.ModifyLiquidityParams(p.tickLower, p.tickUpper, delta, bytes32(id));
        a.owner = p.owner;
        a.bound0 = bound0;
        a.bound1 = bound1;
        a.nativeValue = nativeValue;
        return abi.decode(_unlock(a), (uint256, uint256));
    }

    function _unlock(CallbackArgs memory a) private returns (bytes memory result) {
        bytes memory data = abi.encode(a);
        _callbackHash = keccak256(data);
        result = poolManager.unlock(data);
        if (_callbackHash != bytes32(0)) revert UnauthorizedCallback();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || _lock != 2 || _callbackHash != keccak256(data)) {
            revert UnauthorizedCallback();
        }
        delete _callbackHash;
        CallbackArgs memory a = abi.decode(data, (CallbackArgs));
        if (a.operation == Operation.Claim) {
            poolManager.burn(address(this), a.claimCurrency.toId(), a.claimAmount);
            uint256 managerBefore;
            uint256 recipientBefore;
            if (!a.claimCurrency.isAddressZero()) {
                managerBefore = a.claimCurrency.balanceOf(address(poolManager));
                recipientBefore = a.claimCurrency.balanceOf(a.recipient);
            }
            poolManager.take(a.claimCurrency, a.recipient, a.claimAmount);
            if (
                !a.claimCurrency.isAddressZero()
                    && (a.claimCurrency.balanceOf(address(poolManager)) + a.claimAmount != managerBefore
                        || a.claimCurrency.balanceOf(a.recipient) != recipientBefore + a.claimAmount)
            ) {
                revert InexactTransfer(a.claimCurrency, a.claimAmount);
            }
            return "";
        }

        (BalanceDelta delta, BalanceDelta fees) = poolManager.modifyLiquidity(a.key, a.params, "");
        BalanceDelta principal = delta - fees;
        int128 p0 = principal.amount0();
        int128 p1 = principal.amount1();
        bool adding = a.params.liquidityDelta > 0;
        if (
            fees.amount0() < 0 || fees.amount1() < 0 || (adding && (p0 > 0 || p1 > 0))
                || (!adding && (p0 < 0 || p1 < 0))
        ) revert InvalidDelta();

        uint256 amount0 = _magnitude(p0, adding);
        uint256 amount1 = _magnitude(p1, adding);
        if (adding ? amount0 > a.bound0 || amount1 > a.bound1 : amount0 < a.bound0 || amount1 < a.bound1) {
            revert SlippageExceeded();
        }
        uint256 nativeRequired = adding && a.key.currency0.isAddressZero() ? amount0 : 0;
        if (a.nativeValue != nativeRequired) revert NativeValueMismatch(a.nativeValue, nativeRequired);

        // Fund principal independently of fee credits: fees cannot mask the
        // caller's deposit maximum, or be silently consumed to fund an increase.
        if (adding) {
            _settleDebt(a.key.currency0, a.owner, amount0);
            _settleDebt(a.key.currency1, a.owner, amount1);
        }
        uint256 credited0 = (adding ? 0 : amount0) + uint128(fees.amount0());
        uint256 credited1 = (adding ? 0 : amount1) + uint128(fees.amount1());
        PoolId id = a.key.toId();
        totalFeesCollected0[id] += uint128(fees.amount0());
        totalFeesCollected1[id] += uint128(fees.amount1());
        _credit(a.owner, a.key.currency0, credited0);
        _credit(a.owner, a.key.currency1, credited1);
        return abi.encode(credited0, credited1);
    }

    function _magnitude(int128 delta, bool adding) private pure returns (uint256 amount) {
        amount = uint256(delta < 0 ? -int256(delta) : int256(delta));
        // An exit must preserve every principal credit representable by core,
        // even if a final price move exceeded the ordinary deposit domain.
        if (adding && amount > MAX_AMOUNT) revert AmountOutOfRange();
    }

    function _settleDebt(Currency currency, address payer, uint256 amount) private {
        if (amount == 0) return;
        poolManager.sync(currency);
        uint256 paid;
        if (currency.isAddressZero()) {
            paid = poolManager.settle{value: amount}();
        } else {
            uint256 payerBefore = currency.balanceOf(payer);
            SafeTransferLib.safeTransferFrom(ERC20(Currency.unwrap(currency)), payer, address(poolManager), amount);
            if (currency.balanceOf(payer) + amount != payerBefore) revert InexactTransfer(currency, amount);
            paid = poolManager.settle();
        }
        if (paid != amount) revert EscrowMismatch(paid, amount);
    }

    function _credit(address owner, Currency currency, uint256 amount) private {
        if (amount == 0) return;
        // External donations can earn fees beyond the ordinary operation cap.
        // Preserve those credits so they cannot veto exits; owners take large
        // balances through bounded claims. Never cap a pool's exit by another
        // owner's outstanding claims in the same currency.
        if (amount > uint128(type(int128).max)) revert AmountOutOfRange();
        claims[owner][currency] += amount;
        totalClaims[currency] += amount;
        poolManager.mint(address(this), currency.toId(), amount);
        emit ClaimCredited(owner, currency, amount);
    }
}
