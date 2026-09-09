// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// Throwaway. Its only job is to prove the remappings resolve and that v4-core
/// compiles under this foundry.toml before any real work depends on it.
/// Delete once OtterHook builds.
contract CanaryTest is Test {
    function test_v4CoreCompilesAndDeploys() public {
        PoolManager pm = new PoolManager(address(this));
        assertTrue(address(pm) != address(0));
    }

    /// plan.md standing rule: verify permission bits against v4-core source,
    /// never a table. This prints them from the library itself.
    function test_printHookFlags() public pure {
        console2.log("BEFORE_SWAP_FLAG        ", uint256(Hooks.BEFORE_SWAP_FLAG));
        console2.log("BEFORE_ADD_LIQUIDITY    ", uint256(Hooks.BEFORE_ADD_LIQUIDITY_FLAG));
        console2.log("BEFORE_SWAP_RETURNS_DELTA", uint256(Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG));
        console2.log("ALL_HOOK_MASK           ", uint256(Hooks.ALL_HOOK_MASK));
    }
}
