// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {OtterHook, OtterPoolMath} from "../src/OtterHook.sol";
import {HookMiner} from "./utils/HookMiner.sol";

contract OtterHookTest is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    OtterHook hook;
    address settlement = address(0x5E77);

    PoolKey otterKey;
    PoolId otterId;

    /// full range for tickSpacing 1
    int24 constant TICK_LOWER = -887272;
    int24 constant TICK_UPPER = 887272;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        // Mine a CREATE2 salt whose low 14 bits carry only BEFORE_SWAP_FLAG.
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this), flags, type(OtterHook).creationCode, abi.encode(manager, settlement)
        );
        hook = new OtterHook{salt: salt}(manager, settlement);
        assertEq(address(hook), predicted, "mined address mismatch");

        // fee 0 and tickSpacing 1: see the note in OtterPoolMath
        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);

        modifyLiquidityRouter.modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 1e21,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    // ------------------------------------------------------------------
    // permissions
    // ------------------------------------------------------------------

    /// plan.md standing rule: verify the flag against v4-core, never a table.
    function test_hookAddressCarriesOnlyBeforeSwap() public view {
        uint160 bits = uint160(address(hook)) & Hooks.ALL_HOOK_MASK;
        assertEq(bits, uint160(Hooks.BEFORE_SWAP_FLAG), "hook address must encode exactly BEFORE_SWAP");
        console2.log("hook address", address(hook));
        console2.log("permission bits", uint256(bits));
    }

    function test_hookRejectsDirectCalls() public {
        vm.expectRevert(OtterHook.NotPoolManager.selector);
        hook.beforeSwap(settlement, otterKey, SWAP_PARAMS, ZERO_BYTES);
    }

    // ------------------------------------------------------------------
    // batch-only gating — this is the reason the hook exists
    // ------------------------------------------------------------------

    /// A searcher cannot sandwich a pool it cannot swap against.
    function test_ordinarySwapIsRejected() public {
        vm.expectRevert();
        swapRouter.swap(
            otterKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
    }

    /// The same swap through a control pool with no hook succeeds, so the
    /// rejection above is the hook and not a broken test setup.
    function test_controlPoolWithoutHookAcceptsSwap() public {
        (PoolKey memory plainKey,) = initPool(currency0, currency1, IHooks(address(0)), 0, 1, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(
            plainKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 1e21,
                salt: 0
            }),
            ZERO_BYTES
        );

        swapRouter.swap(
            plainKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
    }

    /// Liquidity is deliberately not gated: LPs move freely between batches.
    function test_liquidityIsNotGated() public {
        modifyLiquidityRouter.modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 1e20,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    // ------------------------------------------------------------------
    // virtual reserves
    // ------------------------------------------------------------------

    function test_virtualReservesSatisfyConstantProduct() public view {
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(otterId);
        uint128 L = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(sqrtPriceX96, L);

        console2.log("sqrtPriceX96", uint256(sqrtPriceX96));
        console2.log("liquidity   ", uint256(L));
        console2.log("r0          ", r0);
        console2.log("r1          ", r1);

        // at 1:1 the two virtual reserves coincide
        assertApproxEqRel(r0, r1, 1e12, "1:1 price should give equal reserves");

        // r0 * r1 == L^2, within rounding
        uint256 k = r0 * r1;
        uint256 lSquared = uint256(L) * uint256(L);
        assertApproxEqRel(k, lSquared, 1e12, "r0*r1 must equal L^2");
    }

    function testFuzz_virtualReservesTrackPrice(uint96 rawLiquidity) public pure {
        uint128 L = uint128(bound(uint256(rawLiquidity), 1e12, type(uint96).max));
        uint160 p = uint160(1 << 96); // 1:1
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, L);
        assertEq(r0, uint256(L));
        assertEq(r1, uint256(L));
    }
}
