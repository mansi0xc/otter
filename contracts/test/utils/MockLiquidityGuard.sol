// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Book-only tests do not have a pool or LP state. Integrated tests use the
/// real vault's admission guard instead.
contract MockLiquidityGuard {
    function assertBatchSupported(bytes32) external pure {}
}
