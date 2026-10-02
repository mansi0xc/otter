// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IOtterBatchStatus {
    function isBatchActive(bytes32 poolId) external view returns (bool);
    function currentBatchId(bytes32 poolId) external view returns (uint256);
}

interface IOtterLiquidityGuard {
    function assertAdmissionSupported(bytes32 poolId) external view;
    function assertBatchSupported(bytes32 poolId) external view;
    function hasUnsupportedFees(bytes32 poolId) external view returns (bool);
}
