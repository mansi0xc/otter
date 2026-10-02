// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Book-only tests do not have a pool or LP state. Integrated tests use the
/// real vault's admission guard instead.
contract MockLiquidityGuard {
    bool public unsupportedFees;

    function setUnsupportedFees(bool value) external {
        unsupportedFees = value;
    }
    function assertBatchSupported(bytes32) external pure {}
    function assertAdmissionSupported(bytes32) external pure {}

    function hasUnsupportedFees(bytes32) external view returns (bool) {
        return unsupportedFees;
    }
}
