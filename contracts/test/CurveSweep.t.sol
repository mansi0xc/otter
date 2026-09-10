// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {OtterPoolMath} from "../src/OtterHook.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
}

/// @notice Measures how far v4's discrete swap math falls short of the paper's
///         continuous curve, as a function of PRICE IMPACT.
///
/// F(y) = x0 - k/(y0 + y) is evaluated once and rounded once. v4 derives the new
/// sqrtPrice from the input and then the output from the price delta, rounding in
/// the pool's favour at each, on a Q64.96 grid. The further a swap moves the
/// price, the more of that grid it crosses and the more the two roundings
/// compound — so the gap tracks impact, not trade size.
///
/// An earlier version of this sweep varied trade size at fixed liquidity, which
/// held impact near-constant at ~0.1% and reported a 2 wei maximum. The settlement
/// fuzz then failed by 14 wei at 10% impact. Hence this: three pools spanning four
/// orders of magnitude of liquidity, so impact sweeps rather than staying fixed.
///
/// Deployers already declares `key`, `manager`, `swapRouter`, `SWAP_PARAMS` and
/// more; anything inheriting it must not reuse those names.
contract CurveSweepTest is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolKey[3] sweepKeys;
    PoolId[3] sweepIds;
    uint128[3] sweepLiquidity = [uint128(1e20), uint128(1e21), uint128(1e22)];

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        for (uint256 p; p < 3; ++p) {
            int24 spacing = int24(uint24(p + 1));
            (sweepKeys[p], sweepIds[p]) =
                initPool(currency0, currency1, IHooks(address(0)), 0, spacing, SQRT_PRICE_1_1);
            int24 lo = -(887272 / spacing) * spacing;
            int24 hi = (887272 / spacing) * spacing;
            modifyLiquidityRouter.modifyLiquidity(
                sweepKeys[p],
                IPoolManager.ModifyLiquidityParams({
                    tickLower: lo,
                    tickUpper: hi,
                    liquidityDelta: int256(uint256(sweepLiquidity[p])),
                    salt: 0
                }),
                ZERO_BYTES
            );
        }
    }

    function _measure(uint256 p, uint256 amountIn, bool zeroForOne)
        internal
        returns (uint256 model, uint256 actual, uint256 impactPpm)
    {
        (uint160 px,,,) = manager.getSlot0(sweepIds[p]);
        uint128 liq = manager.getLiquidity(sweepIds[p]);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(px, liq);

        (uint256 supplied, uint256 received) = zeroForOne ? (r0, r1) : (r1, r0);
        impactPpm = (amountIn * 1e6) / supplied;

        uint256 rem = FixedPointMathLib.mulDivUp(received, supplied, supplied + amountIn);
        model = rem >= received ? 0 : received - rem;

        Currency outC = zeroForOne ? currency1 : currency0;
        uint256 before = IERC20Min(Currency.unwrap(outC)).balanceOf(address(this));
        swapRouter.swap(
            sweepKeys[p],
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
        actual = IERC20Min(Currency.unwrap(outC)).balanceOf(address(this)) - before;
    }

    function test_curveGapVersusImpact() public {
        uint256[6] memory sizes = [uint256(1e15), 1e16, 1e17, 1e18, 5e18, 1e19];

        uint256 maxAbs;
        uint256 maxAbsImpact;

        console2.log("impact(ppm) / amountIn / gap(wei)");
        for (uint256 p; p < 3; ++p) {
            for (uint256 round; round < 2; ++round) {
                for (uint256 i; i < sizes.length; ++i) {
                    bool dir = (round + i) % 2 == 0;
                    (uint256 model, uint256 actual, uint256 impactPpm) = _measure(p, sizes[i], dir);

                    assertGe(model, actual, "v4 paid MORE than the curve: a buffer would not help");
                    uint256 gap = model - actual;
                    console2.log(impactPpm, sizes[i], gap);

                    if (gap > maxAbs) {
                        maxAbs = gap;
                        maxAbsImpact = impactPpm;
                    }
                }
            }
        }

        console2.log("----------------------------------------");
        console2.log("max gap (wei)     ", maxAbs);
        console2.log("  at impact (ppm) ", maxAbsImpact);
    }
}
