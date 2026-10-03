// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IOtterBatchStatus {
    function isBatchActive(bytes32 poolId) external view returns (bool);
    function currentBatchId(bytes32 poolId) external view returns (uint256);
}

interface IOtterLiquidityGuard {
    struct PositionSnapshot {
        uint256 id;
        address owner;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    struct PoolSnapshot {
        PoolKey key;
        address manager;
        uint160 sqrtPriceX96;
        int24 tick;
        uint24 protocolFee;
        uint24 lpFee;
        uint128 activeLiquidity;
        uint128 totalLiquidity;
        uint256 ownershipVersion;
        bytes32 positionsHash;
    }

    function assertAdmissionSupported(bytes32 poolId) external view;
    function assertBatchSupported(bytes32 poolId) external view;
    function hasUnsupportedFees(bytes32 poolId) external view returns (bool);
    function openingSnapshot(bytes32 poolId)
        external
        view
        returns (PoolSnapshot memory pool, PositionSnapshot[] memory positions);
    function assertSnapshot(bytes32 poolId, PoolSnapshot calldata pool) external view;
}
