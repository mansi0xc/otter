// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {OtterOrderBook} from "./OtterOrderBook.sol";
import {IOtterLiquidityGuard} from "./interfaces/IOtterLiquidityGuard.sol";

/// @notice Cash-backed rewards to opening LP owners, independent of later
/// deposits/exits/fee growth. This does not verify canonical trader payments or
/// prove LP incentives. Failed recipient delivery affects only its own claim.
contract OtterRewardLedger {
    OtterOrderBook public immutable orderBook;
    address public immutable settlement;
    bytes32 public constant POLICY_TYPEHASH = keccak256("OtterCapitalRewards/v1");
    mapping(bytes32 => address) public communityRecipientOf;
    mapping(bytes32 => bytes32) public policyHashOf;
    mapping(address => mapping(address => uint256)) public claimable;
    mapping(address => uint256) public totalClaimable;
    mapping(bytes32 => mapping(uint256 => bool)) public credited;
    mapping(bytes32 => mapping(uint256 => mapping(address => uint256))) public epochSurplus;
    mapping(bytes32 => mapping(uint256 => mapping(address => uint256))) public epochDust;
    uint256 private _lock = 1;

    error NotSettlement();
    error InvalidPolicy();
    error InvalidEpoch();
    error AlreadyCredited();
    error InvalidWeights();
    error InexactTransfer(address currency, uint256 amount);
    error Insolvent(address currency);
    error InvalidClaim();
    error NativeTransferFailed();
    error ReentrantCall();

    event RewardPolicyRegistered(bytes32 indexed poolId, bytes32 policyHash, address communityRecipient);
    event RewardAllocated(
        bytes32 indexed poolId,
        uint256 indexed epoch,
        uint256 indexed positionId,
        address owner,
        uint256 weight,
        uint256 amount0,
        uint256 amount1
    );
    event EpochRewardsCredited(
        bytes32 indexed poolId,
        uint256 indexed epoch,
        bytes32 snapshotHash,
        uint256 amount0,
        uint256 amount1,
        uint256 dust0,
        uint256 dust1
    );
    event Claimed(address indexed owner, address indexed currency, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(OtterOrderBook book) {
        orderBook = book;
        settlement = msg.sender;
    }

    function registerPool(bytes32 poolId, address communityRecipient) external returns (bytes32 policyHash) {
        if (msg.sender != settlement) revert NotSettlement();
        if (
            policyHashOf[poolId] != bytes32(0) || communityRecipient == address(0)
                || communityRecipient == address(this) || communityRecipient == settlement
                || communityRecipient == address(orderBook)
        ) revert InvalidPolicy();
        communityRecipientOf[poolId] = communityRecipient;
        policyHash = keccak256(abi.encode(POLICY_TYPEHASH, block.chainid, address(this), communityRecipient));
        policyHashOf[poolId] = policyHash;
        emit RewardPolicyRegistered(poolId, policyHash, communityRecipient);
    }

    /// @notice Exactly once during the authenticated epoch's execution, after
    /// trader outputs were funded. Pull exact ERC20 cash and exact native value.
    /// No owner is called, including the community recipient of rounding dust.
    function creditEpoch(bytes32 poolId, uint256 epoch, uint256 amount0, uint256 amount1)
        external
        payable
        nonReentrant
    {
        if (msg.sender != settlement) revert NotSettlement();
        if (credited[poolId][epoch]) revert AlreadyCredited();
        if (
            !orderBook.executionInProgress(poolId) || orderBook.currentBatchId(poolId) != epoch
                || !orderBook.payoutsCredited(poolId, epoch)
        ) revert InvalidEpoch();
        bytes32 policy = policyHashOf[poolId];
        if (policy == bytes32(0) || orderBook.rewardPolicyHashOf(poolId) != policy) revert InvalidPolicy();
        address c0 = orderBook.currency0Of(poolId);
        address c1 = orderBook.currency1Of(poolId);
        uint256 requiredNative = c0 == address(0) ? amount0 : 0;
        if (msg.value != requiredNative) revert InexactTransfer(address(0), requiredNative);
        // Reserve all existing shared-currency claims before accepting new cash.
        if (_balance(c0, address(this)) - msg.value < totalClaimable[c0]) revert Insolvent(c0);
        _assertSolvent(c1);
        if (c0 != address(0)) _pullExact(c0, amount0);
        _pullExact(c1, amount1);

        IOtterLiquidityGuard.PositionSnapshot[] memory roster = orderBook.openingPositions(poolId, epoch);
        uint256[] memory weights = orderBook.openingRewardWeights(poolId, epoch);
        uint256 totalWeight = orderBook.openingRewardWeight(poolId, epoch);
        if (roster.length == 0 || roster.length > 32 || roster.length != weights.length || totalWeight == 0) {
            revert InvalidWeights();
        }
        credited[poolId][epoch] = true;
        epochSurplus[poolId][epoch][c0] = amount0;
        epochSurplus[poolId][epoch][c1] = amount1;
        uint256 allocated0;
        uint256 allocated1;
        uint256 sumWeight;
        for (uint256 i; i < roster.length; ++i) {
            if (roster[i].owner == address(0)) revert InvalidWeights();
            sumWeight += weights[i];
            uint256 reward0 = FullMath.mulDiv(amount0, weights[i], totalWeight);
            uint256 reward1 = FullMath.mulDiv(amount1, weights[i], totalWeight);
            allocated0 += reward0;
            allocated1 += reward1;
            _credit(roster[i].owner, c0, reward0);
            _credit(roster[i].owner, c1, reward1);
            emit RewardAllocated(poolId, epoch, roster[i].id, roster[i].owner, weights[i], reward0, reward1);
        }
        if (sumWeight != totalWeight) revert InvalidWeights();
        uint256 dust0 = amount0 - allocated0;
        uint256 dust1 = amount1 - allocated1;
        epochDust[poolId][epoch][c0] = dust0;
        epochDust[poolId][epoch][c1] = dust1;
        _credit(communityRecipientOf[poolId], c0, dust0);
        _credit(communityRecipientOf[poolId], c1, dust1);
        _assertSolvent(c0);
        _assertSolvent(c1);
        emit EpochRewardsCredited(poolId, epoch, orderBook.snapshotHash(poolId, epoch), amount0, amount1, dust0, dust1);
    }

    function claim(address currency, uint256 amount, address recipient) external nonReentrant {
        if (
            amount == 0 || amount > claimable[msg.sender][currency] || recipient == address(0)
                || recipient == address(this)
        ) revert InvalidClaim();
        _assertSolvent(currency);
        claimable[msg.sender][currency] -= amount;
        totalClaimable[currency] -= amount;
        if (currency == address(0)) {
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            uint256 beforeBalance = _balance(currency, address(this));
            uint256 recipientBefore = _balance(currency, recipient);
            SafeTransferLib.safeTransfer(ERC20(currency), recipient, amount);
            if (
                _balance(currency, address(this)) + amount != beforeBalance
                    || _balance(currency, recipient) != recipientBefore + amount
            ) revert InexactTransfer(currency, amount);
        }
        _assertSolvent(currency);
        emit Claimed(msg.sender, currency, recipient, amount);
    }

    function _credit(address account, address currency, uint256 amount) private {
        if (amount == 0) return;
        claimable[account][currency] += amount;
        totalClaimable[currency] += amount;
    }

    function _pullExact(address currency, uint256 amount) private {
        if (amount == 0) return;
        uint256 beforeBalance = _balance(currency, address(this));
        uint256 senderBefore = _balance(currency, settlement);
        SafeTransferLib.safeTransferFrom(ERC20(currency), settlement, address(this), amount);
        if (
            _balance(currency, address(this)) != beforeBalance + amount
                || _balance(currency, settlement) + amount != senderBefore
        ) revert InexactTransfer(currency, amount);
    }

    function _balance(address currency, address account) private view returns (uint256) {
        return currency == address(0) ? account.balance : ERC20(currency).balanceOf(account);
    }

    function _assertSolvent(address currency) private view {
        if (_balance(currency, address(this)) < totalClaimable[currency]) revert Insolvent(currency);
    }
}
