// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOtterLiquidityGuard} from "../../src/interfaces/IOtterLiquidityGuard.sol";

/// @dev Book-only tests do not have a pool or LP state. Integrated tests use the
/// real vault's admission guard instead.
contract MockLiquidityGuard is IOtterLiquidityGuard {
    bool public unsupportedFees;

    function setUnsupportedFees(bool value) external {
        unsupportedFees = value;
    }
    function assertBatchSupported(bytes32) external pure {}
    function assertAdmissionSupported(bytes32) external pure {}

    function hasUnsupportedFees(bytes32) external view returns (bool) {
        return unsupportedFees;
    }

    function openingSnapshot(bytes32)
        external
        view
        returns (PoolSnapshot memory pool, PositionSnapshot[] memory roster)
    {
        // Book-only unit tests do not claim real pool authentication.
        roster = new PositionSnapshot[](1);
        roster[0] = PositionSnapshot(1, address(this), -887272, 887272, 1e18);
        pool.sqrtPriceX96 = uint160(1) << 96;
        pool.positionsHash = keccak256(abi.encode(roster));
    }

    function assertSnapshot(bytes32, PoolSnapshot calldata) external pure {}
}
