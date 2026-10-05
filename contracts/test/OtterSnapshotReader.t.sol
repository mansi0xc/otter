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

/// @dev Export actual local manager storage, then serve it to the browser reader
/// through a test-only in-memory RPC. This does not exercise a real RPC provider.
contract OtterSnapshotReaderTest is OtterExecutionFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct RpcFixture {
        uint256 chainId;
        uint256 blockNumber;
        bytes32 blockHash;
        address managerAddress;
        bytes code;
        PoolKey key;
        bool down;
        uint256 amount;
        uint160 limit;
        bytes32[] slots;
        bytes32[] values;
    }

    function _fixture(PoolKey memory k, bool down, uint256 amount, uint160 limit)
        private view returns (RpcFixture memory f)
    {
        f.chainId = block.chainid;
        f.blockNumber = block.number;
        f.blockHash = keccak256(abi.encode("synthetic-local-block", block.number));
        f.managerAddress = address(manager);
        f.code = address(manager).code;
        f.key = k; f.down = down; f.amount = amount; f.limit = limit;
        PoolId id = k.toId();
        bytes32 base = keccak256(abi.encode(PoolId.unwrap(id), uint256(6)));
        (, int24 tick,,) = manager.getSlot0(id);
        int24 compressed = TickBitmap.compress(tick, k.tickSpacing) + (down ? int24(0) : int24(1));
        (int16 first,) = TickBitmap.position(compressed);
        uint256 count;
        uint256[] memory bitmaps = new uint256[](16);
        for (uint256 i; i < 16; ++i) {
            int16 position = first + (down ? -int16(int256(i)) : int16(int256(i)));
            uint256 bits = manager.getTickBitmap(id, position);
            bitmaps[i] = bits;
            while (bits != 0) { bits &= bits - 1; ++count; }
        }
        f.slots = new bytes32[](18 + count); f.values = new bytes32[](18 + count);
        f.slots[0] = base; f.slots[1] = bytes32(uint256(base) + 3);
        f.values[0] = manager.extsload(f.slots[0]); f.values[1] = manager.extsload(f.slots[1]);
        uint256 cursor = 18;
        for (uint256 i; i < 16; ++i) {
            int16 position = first + (down ? -int16(int256(i)) : int16(int256(i)));
            f.slots[2 + i] = keccak256(abi.encode(int256(position), bytes32(uint256(base) + 5)));
            f.values[2 + i] = manager.extsload(f.slots[2 + i]);
            assertEq(uint256(f.values[2 + i]), bitmaps[i], "raw bitmap slot mismatch");
            for (uint256 bit; bit < 256; ++bit) {
                if (bitmaps[i] & (uint256(1) << bit) == 0) continue;
                int256 index = (int256(position) * 256 + int256(bit)) * k.tickSpacing;
                assertGe(index, TickMath.MIN_TICK); assertLe(index, TickMath.MAX_TICK);
                f.slots[cursor] = keccak256(abi.encode(index, bytes32(uint256(base) + 4)));
                f.values[cursor] = manager.extsload(f.slots[cursor]);
                (uint128 gross, int128 net) = manager.getTickLiquidity(id, int24(index));
                assertEq(uint128(uint256(f.values[cursor])), gross, "raw tick gross mismatch");
                assertEq(int128(int256(uint256(f.values[cursor]) >> 128)), net, "raw tick net mismatch");
                ++cursor;
            }
        }
        assertEq(cursor, f.slots.length);
    }

    function _againstReader(PoolKey memory k, bool down, uint256 amount, uint160 limit)
        private returns (OtterExecutionOracle.Quote memory q)
    {
        q = oracle.quoteExactInput(k, down, amount, limit);
        string[] memory args = new string[](4);
        args[0] = "node"; args[1] = "--experimental-strip-types";
        args[2] = "../web/test/snapshot-reader-cli.ts";
        args[3] = vm.toString(abi.encode(_fixture(k, down, amount, limit)));
        (OtterExecutionOracle.Quote memory captured, uint256 reads, uint256 words, uint256 ticks) =
            abi.decode(vm.ffi(args), (OtterExecutionOracle.Quote, uint256, uint256, uint256));
        assertEq(abi.encode(q), abi.encode(captured), "raw storage/browser/Solidity mismatch");
        assertEq(reads, 2 + words + ticks);
        assertLe(reads, 82); assertLe(words, 16); assertLe(ticks, 64);
        if (q.status == OtterExecutionOracle.Status.Complete || q.status == OtterExecutionOracle.Status.PriceLimit) {
            OtterExecutionOracle.Quote memory actual = _quoteAndSwap(k, down, amount, limit);
            assertEq(abi.encode(q), abi.encode(actual), "reader/core swap mismatch");
        }
    }

    function test_readerMatchesConcentratedGapsInBothDirections() public {
        PoolKey memory k = _pool(60, SQRT_PRICE_1_1);
        _add(k, -120, 120, 1e12, 1);
        _add(k, -480, -360, 2e12, 2);
        _add(k, 360, 480, 3e12, 3);
        _againstReader(k, true, type(uint96).max, TickMath.getSqrtPriceAtTick(-600));
        _againstReader(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(600));
    }

    function test_readerMatchesNativeBothDirections() public {
        (PoolKey memory k,) = initPool(Currency.wrap(address(0)), currency1, IHooks(address(0)), 0, 60, SQRT_PRICE_1_1);
        _add(k, -120, 120, 1e12, 1);
        _add(k, -480, -360, 2e12, 2);
        _againstReader(k, true, 1e15, TickMath.getSqrtPriceAtTick(-600));
        _againstReader(k, false, 1e15, TickMath.getSqrtPriceAtTick(600));
    }

    function test_readerRetainsDownwardBoundaryAndActivatesOnReverse() public {
        PoolKey memory k = _pool(60, SQRT_PRICE_1_1);
        _add(k, -120, 120, 1e12, 1);
        _againstReader(k, true, 1e15, TickMath.getSqrtPriceAtTick(-120));
        (, int24 tick,,) = manager.getSlot0(k.toId());
        assertEq(tick, -121);
        _againstReader(k, false, 1000, TickMath.getSqrtPriceAtTick(60));
    }

    function test_readerMatchesZeroAndEmptyWordRounding() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1e6);
        _againstReader(k, true, 0, 0);
        _againstReader(k, true, type(uint96).max, TickMath.getSqrtPriceAtTick(-1200));
        _againstReader(k, false, type(uint96).max, TickMath.getSqrtPriceAtTick(1200));
    }

    function test_readerReturnsWordLimitWithoutReadingSeventeenthWord() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        _fullRange(k, 1e6);
        OtterExecutionOracle.Quote memory q = _againstReader(k, true, type(uint96).max, TickMath.getSqrtPriceAtTick(-10000));
        assertEq(uint256(q.status), uint256(OtterExecutionOracle.Status.WordLimit));
    }

    function test_readerReturnsTickLimitWithoutReadingSixtyFifthCrossing() public {
        PoolKey memory k = _pool(1, SQRT_PRICE_1_1);
        for (uint256 i; i < 70; ++i) _add(k, -int24(int256(i + 1)), 100, 1e6, i + 1);
        OtterExecutionOracle.Quote memory q = _againstReader(k, true, type(uint96).max, TickMath.getSqrtPriceAtTick(-100));
        assertEq(uint256(q.status), uint256(OtterExecutionOracle.Status.TickLimit));
    }

    function test_readerKeepsUnsupportedAmountAndLiquidityStatuses() public {
        PoolKey memory k = _pool(60, SQRT_PRICE_1_1);
        _add(k, -120, 120, 1e12, 1);
        OtterExecutionOracle.Quote memory q = _againstReader(k, true, uint256(type(uint96).max) + 1, TickMath.getSqrtPriceAtTick(-60));
        assertEq(uint256(q.status), uint256(OtterExecutionOracle.Status.UnsupportedAmount));
        _add(k, -120, 120, uint128(1 << 88), 2);
        q = _againstReader(k, true, 1, TickMath.getSqrtPriceAtTick(-60));
        assertEq(uint256(q.status), uint256(OtterExecutionOracle.Status.LiquidityLimit));
    }

    function testFuzz_readerMatchesConcentratedCore(bool down, uint64 liquiditySeed, uint32 inputSeed) public {
        uint128 l = uint128(bound(liquiditySeed, 1, 1e9));
        PoolKey memory k = _pool(60, TickMath.getSqrtPriceAtTick(-180 + int24(int256(uint256(inputSeed) % 7)) * 60));
        _add(k, -240, 0, l, 1); _add(k, 0, 240, l + 1, 2);
        _add(k, down ? int24(-900) : int24(600), down ? int24(-600) : int24(900), l / 2 + 1, 3);
        _againstReader(k, down, bound(inputSeed, 1, 1e8), TickMath.getSqrtPriceAtTick(down ? int24(-1200) : int24(1200)));
    }
}
