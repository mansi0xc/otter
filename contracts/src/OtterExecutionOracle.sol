// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickBitmap} from "@uniswap/v4-core/src/libraries/TickBitmap.sol";
import {BitMath} from "@uniswap/v4-core/src/libraries/BitMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";

/// @notice Bounded, read-only simulation of exact-input, zero-fee Pool.swap.
/// @dev Targets the repository's pinned v4.0.0 core and its storage layout.
/// Models core deltas, not arbitrary hook callbacks, token delivery or an auction.
/// Only Complete and PriceLimit are usable quotes. Every other status describes
/// an unsupported request/trace; amounts then describe only a diagnostic prefix.
contract OtterExecutionOracle {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant MAX_INPUT = type(uint96).max;
    uint256 public constant MAX_OUTPUT = (1 << 120) - 1;
    uint128 public constant MAX_LIQUIDITY = (1 << 88) - 1;
    uint160 public constant MIN_SQRT_PRICE = 1 << 64;
    uint160 public constant MAX_SQRT_PRICE_EXCLUSIVE = 1 << 128;
    uint8 public constant MAX_BITMAP_WORDS = 16;
    uint8 public constant MAX_TICK_CROSSINGS = 64;
    uint16 public constant MAX_STEPS = 80;

    enum Status {
        UnsupportedPool,
        UnsupportedFees,
        UnsupportedPrice,
        UnsupportedAmount,
        InvalidPriceLimit,
        LiquidityLimit,
        OutputLimit,
        WordLimit,
        TickLimit,
        StepLimit,
        Complete,
        PriceLimit
    }

    struct Quote {
        Status status;
        uint256 requestedInput;
        uint256 consumedInput;
        uint256 output;
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        uint8 bitmapWords;
        uint8 initializedTicksCrossed;
        uint16 steps;
    }

    struct BitmapCache {
        bool loaded;
        int16 wordPosition;
        uint256 word;
    }

    IPoolManager public immutable poolManager;

    error InvalidManager();

    constructor(IPoolManager manager_) {
        if (address(manager_).code.length == 0) revert InvalidManager();
        poolManager = manager_;
    }

    /// @param amountIn Raw input units. Zero is a model no-op matching Pool.swap;
    /// PoolManager.swap itself rejects zero, so execution must skip that call.
    /// @param sqrtPriceLimitX96 Must be in the supported interval and in the swap
    /// direction for nonzero input. PriceLimit can consume less than requested,
    /// including zero through an empty-liquidity interval.
    /// @dev Reads the live snapshot. It does not reserve liquidity or authenticate
    /// an epoch snapshot. Callers must bind/revalidate that snapshot at execution.
    /// No caller-supplied ticks, bitmap words, fees or liquidity are accepted.
    function quoteExactInput(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint160 sqrtPriceLimitX96)
        external
        view
        returns (Quote memory q)
    {
        q.requestedInput = amountIn;
        if (key.tickSpacing < 1 || key.tickSpacing > 32767) return q;
        PoolId id = key.toId();
        uint24 protocolFee;
        uint24 lpFee;
        (q.sqrtPriceX96, q.tick, protocolFee, lpFee) = poolManager.getSlot0(id);
        if (q.sqrtPriceX96 == 0) return q;
        q.liquidity = poolManager.getLiquidity(id);
        // Also reject dynamic-fee keys: a hook could override a zero stored fee.
        if (key.fee != 0 || protocolFee != 0 || lpFee != 0) {
            q.status = Status.UnsupportedFees;
            return q;
        }
        if (!_priceSupported(q.sqrtPriceX96)) {
            q.status = Status.UnsupportedPrice;
            return q;
        }
        if (q.liquidity > MAX_LIQUIDITY) {
            q.status = Status.LiquidityLimit;
            return q;
        }
        if (amountIn > MAX_INPUT) {
            q.status = Status.UnsupportedAmount;
            return q;
        }
        // Pool.swap ignores the price limit when amountSpecified == 0.
        if (amountIn == 0) {
            q.status = Status.Complete;
            return q;
        }
        if (!_priceSupported(sqrtPriceLimitX96)) {
            q.status = Status.UnsupportedPrice;
            return q;
        }
        if (zeroForOne ? sqrtPriceLimitX96 >= q.sqrtPriceX96 : sqrtPriceLimitX96 <= q.sqrtPriceX96) {
            q.status = Status.InvalidPriceLimit;
            return q;
        }

        BitmapCache memory cache;
        while (q.consumedInput < amountIn && q.sqrtPriceX96 != sqrtPriceLimitX96) {
            if (q.steps == MAX_STEPS) {
                q.status = Status.StepLimit;
                return q;
            }
            int24 compressed = TickBitmap.compress(q.tick, key.tickSpacing);
            if (!zeroForOne) ++compressed;
            (int16 wordPosition, uint8 bitPosition) = TickBitmap.position(compressed);
            // Traversal is monotone: a word cannot be revisited after leaving it.
            if (!cache.loaded || cache.wordPosition != wordPosition) {
                if (q.bitmapWords == MAX_BITMAP_WORDS) {
                    q.status = Status.WordLimit;
                    return q;
                }
                cache.loaded = true;
                cache.wordPosition = wordPosition;
                cache.word = poolManager.getTickBitmap(id, wordPosition);
                ++q.bitmapWords;
            }
            (int24 tickNext, bool initialized) =
                _nextTick(cache.word, compressed, bitPosition, key.tickSpacing, zeroForOne);
            if (tickNext < TickMath.MIN_TICK) tickNext = TickMath.MIN_TICK;
            else if (tickNext > TickMath.MAX_TICK) tickNext = TickMath.MAX_TICK;
            uint160 tickPrice = TickMath.getSqrtPriceAtTick(tickNext);
            (uint160 nextPrice, uint256 stepIn, uint256 stepOut,) = SwapMath.computeSwapStep(
                q.sqrtPriceX96,
                SwapMath.getSqrtPriceTarget(zeroForOne, tickPrice, sqrtPriceLimitX96),
                q.liquidity,
                -int256(amountIn - q.consumedInput),
                0
            );
            if (stepOut > MAX_OUTPUT - q.output) {
                q.status = Status.OutputLimit;
                return q;
            }
            int24 nextTick = q.tick;
            uint128 nextLiquidity = q.liquidity;
            if (nextPrice == tickPrice) {
                if (initialized) {
                    if (q.initializedTicksCrossed == MAX_TICK_CROSSINGS) {
                        q.status = Status.TickLimit;
                        return q;
                    }
                    (uint128 gross, int128 net) = poolManager.getTickLiquidity(id, tickNext);
                    int256 crossedLiquidity = int256(uint256(q.liquidity)) + (zeroForOne ? -int256(net) : int256(net));
                    if (
                        gross > MAX_LIQUIDITY || crossedLiquidity < 0
                            || crossedLiquidity > int256(uint256(MAX_LIQUIDITY))
                    ) {
                        q.status = Status.LiquidityLimit;
                        return q;
                    }
                    nextLiquidity = uint128(uint256(crossedLiquidity));
                    ++q.initializedTicksCrossed;
                }
                // Includes the core's zero-amount leftward boundary transition.
                nextTick = zeroForOne ? tickNext - 1 : tickNext;
            } else if (nextPrice != q.sqrtPriceX96) {
                nextTick = TickMath.getTickAtSqrtPrice(nextPrice);
            }
            q.sqrtPriceX96 = nextPrice;
            q.tick = nextTick;
            q.liquidity = nextLiquidity;
            q.consumedInput += stepIn;
            q.output += stepOut;
            ++q.steps;
        }
        q.status = q.consumedInput == amountIn ? Status.Complete : Status.PriceLimit;
    }

    function _priceSupported(uint160 price) private pure returns (bool) {
        return price >= MIN_SQRT_PRICE && price < MAX_SQRT_PRICE_EXCLUSIVE;
    }

    /// @dev Same masks and empty-word endpoints as core TickBitmap, using an
    /// authenticated cached word instead of a storage mapping.
    function _nextTick(uint256 word, int24 compressed, uint8 bitPosition, int24 spacing, bool zeroForOne)
        private
        pure
        returns (int24 next, bool initialized)
    {
        unchecked {
            if (zeroForOne) {
                uint256 masked = word & (type(uint256).max >> (255 - bitPosition));
                initialized = masked != 0;
                next =
                    (compressed
                            - int24(
                                uint24(initialized ? bitPosition - BitMath.mostSignificantBit(masked) : bitPosition)
                            )) * spacing;
            } else {
                uint256 masked = word & ~((uint256(1) << bitPosition) - 1);
                initialized = masked != 0;
                next =
                    (compressed
                            + int24(
                                uint24(
                                    initialized ? BitMath.leastSignificantBit(masked) - bitPosition : 255 - bitPosition
                                )
                            )) * spacing;
            }
        }
    }
}
