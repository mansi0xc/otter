// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterExecutionFixture} from "./utils/OtterExecutionFixture.sol";
import {OtterExecutionOracle} from "../src/OtterExecutionOracle.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickBitmap} from "@uniswap/v4-core/src/libraries/TickBitmap.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";

/// @dev Local FFI testing only. The on-chain oracle has no Node/FFI dependency.
contract OtterExecutionReferenceTest is OtterExecutionFixture {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    struct Word {
        int16 position;
        uint256 bitmap;
    }

    struct Tick {
        int24 index;
        uint128 gross;
        int128 net;
    }

    // Layout matches execution-abi.ts; all snapshot values come from real core.
    struct Request {
        uint24 keyFee;
        int24 spacing;
        uint160 price;
        int24 tick;
        uint128 liquidity;
        uint24 protocolFee;
        uint24 lpFee;
        bool down;
        uint256 amount;
        uint160 limit;
        Word[] words;
        Tick[] ticks;
    }

    function _snapshot(PoolKey memory k, bool down, uint256 amount, uint160 limit)
        internal
        view
        returns (Request memory r)
    {
        r.keyFee = k.fee;
        r.spacing = k.tickSpacing;
        r.down = down;
        r.amount = amount;
        r.limit = limit;
        r.words = new Word[](0);
        r.ticks = new Tick[](0);
        if (r.spacing < 1 || r.spacing > 32767) return r;
        PoolId id = k.toId();
        (r.price, r.tick, r.protocolFee, r.lpFee) = manager.getSlot0(id);
        r.liquidity = manager.getLiquidity(id);
        if (r.price == 0) return r;
        int24 compressed = TickBitmap.compress(r.tick, r.spacing) + (down ? int24(0) : int24(1));
        (int16 first,) = TickBitmap.position(compressed);
        r.words = new Word[](16);
        uint256 tickCount;
        for (uint256 i; i < 16; ++i) {
            int16 position = first + (down ? -int16(int256(i)) : int16(int256(i)));
            uint256 bits = manager.getTickBitmap(id, position);
            r.words[i] = Word(position, bits);
            while (bits != 0) {
                bits &= bits - 1;
                ++tickCount;
            }
        }
        r.ticks = new Tick[](tickCount);
        uint256 cursor;
        for (uint256 i; i < 16; ++i) {
            for (uint256 bit; bit < 256; ++bit) {
                if (r.words[i].bitmap & (uint256(1) << bit) == 0) continue;
                // Actual initialized core ticks are legal and fit int24. Widen
                // before multiplying because empty distant words can be outside
                // the core tick range, especially at maximum tick spacing.
                int24 tick = int24((int256(r.words[i].position) * 256 + int256(bit)) * int256(r.spacing));
                (uint128 gross, int128 net) = manager.getTickLiquidity(id, tick);
                r.ticks[cursor++] = Tick(tick, gross, net);
            }
        }
    }

    function _againstReference(PoolKey memory k, bool down, uint256 amount, uint160 limit)
        internal
        returns (OtterExecutionOracle.Quote memory actual)
    {
        actual = oracle.quoteExactInput(k, down, amount, limit);
        Request memory r = _snapshot(k, down, amount, limit);
        string[] memory argv = new string[](4);
        argv[0] = "node";
        argv[1] = "--experimental-strip-types";
        argv[2] = "../solver/src/execution-cli.ts";
        argv[3] = vm.toString(abi.encode(r));
        OtterExecutionOracle.Quote memory expected = abi.decode(vm.ffi(argv), (OtterExecutionOracle.Quote));
        // Covers every field, including unsupported prefixes and work counters.
        assertEq(abi.encode(actual), abi.encode(expected), "Solidity/BigInt quote mismatch");
    }

    function _threeWay(PoolKey memory k, bool down, uint256 amount, uint160 limit)
        internal
        returns (OtterExecutionOracle.Quote memory q)
    {
        q = _againstReference(k, down, amount, limit);
        if (q.status == OtterExecutionOracle.Status.Complete || q.status == OtterExecutionOracle.Status.PriceLimit) {
            OtterExecutionOracle.Quote memory core = _quoteAndSwap(k, down, amount, limit);
            assertEq(abi.encode(q), abi.encode(core));
        }
    }

    function test_referenceMatchesBothDirectionsAndEmptyWordRounding() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1e6);
        _threeWay(k, true, type(uint96).max, TickMath.getSqrtPriceAtTick(-1200));
        _threeWay(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(1200));
    }

    function test_referenceMatchesExactTickEndingAndPredecrementedSnapshot() public {
        PoolKey memory k = _pool(60, SQRT_PRICE_1_1);
        _add(k, -60, 60, 1e18, 0);
        uint160 lower = TickMath.getSqrtPriceAtTick(-60);
        uint256 amount = SqrtPriceMath.getAmount0Delta(lower, SQRT_PRICE_1_1, 1e18, true);
        OtterExecutionOracle.Quote memory q = _threeWay(k, true, amount, lower);
        assertEq(q.tick, -61);
        // The next snapshot must retain -61, not normalize it to inverse(price).
        q = _threeWay(k, false, 1, TickMath.getSqrtPriceAtTick(100));
        assertEq(q.initializedTicksCrossed, 1);
        assertEq(q.liquidity, 1e18);
    }

    function test_referenceMatchesOverlapsAndEmptyLiquidityGaps() public {
        PoolKey memory k = _pool(1, TickMath.getSqrtPriceAtTick(-61));
        _add(k, -120, 120, 1e12, 0);
        _add(k, -120, 0, 2e12, 1);
        _add(k, -1000, -800, 3e12, 2);
        _add(k, 800, 1000, 4e12, 3);
        _threeWay(k, true, type(uint96).max, TickMath.getSqrtPriceAtTick(-900));
        _threeWay(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(900));
    }

    function test_referenceMatchesNativeInputAndOutput() public {
        PoolKey memory k;
        (k,) = initPool(Currency.wrap(address(0)), currency1, IHooks(address(0)), 0, 60, SQRT_PRICE_1_1);
        _add(k, -600, 600, 1e18, 0);
        _threeWay(k, true, 1e15, TickMath.getSqrtPriceAtTick(-500));
        _threeWay(k, false, 1e15, TickMath.getSqrtPriceAtTick(500));
    }

    function test_referenceMatchesRawPriceAndLiquidityEndpoints() public {
        for (uint256 i; i < 2; ++i) {
            bool down = i == 0;
            uint160 price = down ? oracle.MIN_SQRT_PRICE() + 1 : oracle.MAX_SQRT_PRICE_EXCLUSIVE() - 2;
            PoolKey memory k = _pool(int24(int256(32767 - i)), price);
            _fullRange(k, oracle.MAX_LIQUIDITY());
            _threeWay(k, down, type(uint96).max, down ? oracle.MIN_SQRT_PRICE() : oracle.MAX_SQRT_PRICE_EXCLUSIVE() - 1);
        }
    }

    function test_referenceMatchesUninitializedKeysAndDomainPrecedence() public {
        PoolKey memory k = PoolKey(currency0, currency1, 0, 1, IHooks(address(0)));
        _againstReference(k, true, 1, 1 << 64);
        k.tickSpacing = 0;
        _againstReference(k, true, type(uint256).max, 0);
        k.tickSpacing = 32768;
        _againstReference(k, false, 0, 0);
        k = _pool(1, SQRT_PRICE_1_1);
        _againstReference(k, true, type(uint256).max, 0);
        _againstReference(k, true, 1, 0);
        _againstReference(k, true, 1, SQRT_PRICE_1_1);
        _againstReference(k, false, 1, SQRT_PRICE_1_1 - 1);
        _threeWay(k, true, 0, 0);
        _threeWay(k, false, 0, type(uint160).max);
    }

    function test_referenceMatchesZeroFeePolicy() public {
        PoolKey memory k;
        (k,) = initPool(currency0, currency1, IHooks(address(0)), 100, 1, SQRT_PRICE_1_1);
        _againstReference(k, true, 1, 1 << 64);
        (k,) = initPool(currency0, currency1, IHooks(address(0x100000)), 0x800000, 1, SQRT_PRICE_1_1);
        _againstReference(k, true, 1, 1 << 64);
        k = _pool(1, SQRT_PRICE_1_1);
        vm.prank(feeController);
        manager.setProtocolFee(k, 1000);
        _againstReference(k, true, type(uint256).max, 0);
        _againstReference(k, false, 0, 0);
    }

    function test_referenceMatchesUnsupportedStartingPricesAndLiquidity() public {
        PoolKey memory k = _pool(1, oracle.MIN_SQRT_PRICE() - 1);
        _againstReference(k, false, 1, SQRT_PRICE_1_1);
        k = _pool(2, oracle.MAX_SQRT_PRICE_EXCLUSIVE());
        _againstReference(k, true, 1, SQRT_PRICE_1_1);
        k = _pool(3, SQRT_PRICE_1_1);
        _add(k, -120, 120, uint128(1 << 88), 0);
        _againstReference(k, true, type(uint256).max, 0);
    }

    function test_referenceMatchesCrossingLiquidityRejections() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _add(k, -120, 0, uint128(1 << 88), 0);
        _againstReference(k, true, 1, TickMath.getSqrtPriceAtTick(-100));
        k = _pool(2, SQRT_PRICE_1_1);
        _add(k, -600, 600, uint128(1 << 87), 0);
        _add(k, 60, 120, uint128(1 << 87), 1);
        _againstReference(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(100));
    }

    function test_referenceMatchesWordLimitAndSupportedPartialConsumption() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _againstReference(k, true, 1, TickMath.getSqrtPriceAtTick(-3841));
        _threeWay(k, true, 1, TickMath.getSqrtPriceAtTick(-3840));
        _threeWay(k, false, 1, SQRT_PRICE_1_1);
        _againstReference(k, false, 1, TickMath.getSqrtPriceAtTick(4096));
        _threeWay(k, false, 1, TickMath.getSqrtPriceAtTick(4095));
    }

    function test_referenceMatchesSixtyFifthTickRejection() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        for (uint256 i; i < 33; ++i) {
            int24 lower = int24(int256(1 + i * 3));
            _add(k, lower, lower + 1, 1e12, i);
        }
        _againstReference(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(110));
    }

    function test_referenceMatchesEightyStepsAndUnfinishedStepRejection() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        for (uint256 i; i < 32; ++i) {
            int24 lower = int24(int256(1 + i * 128));
            _add(k, lower, lower + 63, 1e12, i);
        }
        _againstReference(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(4096));
        _threeWay(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(4095));
        _threeWay(k, true, type(uint96).max, SQRT_PRICE_1_1);
    }

    function test_referenceAndRealCoreShowIntegerConcavityCounterexample() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1000);
        uint160 limit = TickMath.getSqrtPriceAtTick(-100);
        assertEq(_againstReference(k, true, 0, limit).output, 0);
        assertEq(_againstReference(k, true, 1, limit).output, 0);
        assertEq(_threeWay(k, true, 2, limit).output, 1);
    }

    function testFuzz_threeWayTopologyAndEntireRawDomain(
        bool down,
        bool rawDomain,
        uint160 rawPrice,
        uint128 rawLiquidity,
        uint96 amount
    ) public {
        PoolKey memory k;
        uint160 limit;
        if (rawDomain) {
            uint160 price = uint160(bound(rawPrice, uint256(1 << 64) + 1, uint256(1 << 128) - 2));
            uint128 liquidity = uint128(bound(rawLiquidity, 1, oracle.MAX_LIQUIDITY()));
            k = _pool(32767, price);
            _fullRange(k, liquidity);
            limit = down ? oracle.MIN_SQRT_PRICE() : oracle.MAX_SQRT_PRICE_EXCLUSIVE() - 1;
        } else {
            int24 start = int24(int256(bound(rawPrice, 0, 1000)) - 500);
            uint128 liquidity = uint128(bound(rawLiquidity, 1, oracle.MAX_LIQUIDITY() / 6));
            k = _pool(down ? int24(1) : int24(60), TickMath.getSqrtPriceAtTick(start));
            _add(k, -6000, 6000, liquidity, 0);
            _add(k, -1200, 1200, liquidity * 2, 1);
            _add(k, -120, 120, liquidity * 3, 2);
            limit = TickMath.getSqrtPriceAtTick(down ? int24(-3000) : int24(3000));
        }
        _threeWay(k, down, amount, limit);
    }
}
