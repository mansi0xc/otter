// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {OtterHookFixture, IFixtureToken} from "./utils/OtterHookFixture.sol";
import {IOtterLiquidityGuard} from "../src/interfaces/IOtterLiquidityGuard.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterExecutionOracle} from "../src/OtterExecutionOracle.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickBitmap} from "@uniswap/v4-core/src/libraries/TickBitmap.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";

/// Actual book/vault records and manager storage. The FFI transport/block hash
/// are synthetic; no RPC authentication, canonical auction or wallet is tested.
contract OtterOpeningExecutionTest is OtterHookFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    struct OpeningRecord {
        uint256 chainId; address bookAddress; bytes32 poolId; uint256 epoch; uint256 configVersion;
        uint64 closesAt; uint64 executeUntil; uint256 openingBlock; address guard;
        IOtterLiquidityGuard.PoolSnapshot pool; bytes32 rewardPolicyHash; uint256 totalWeight;
        IOtterLiquidityGuard.PositionSnapshot[] positions; uint256[] weights;
    }
    struct Fixture {
        OpeningRecord record; bytes32 snapshotHash; uint256 blockNumber; bytes32 blockHash;
        bytes code; bytes32[] slots; bytes32[] values; uint256 cap; uint160 downLimit; uint160 upLimit;
    }
    struct Curve { bool down; uint256 maxInput; uint160 limit; OtterExecutionOracle.Quote[] points; }
    struct Fingerprint { address target; bytes32 runtimeHash; }
    struct EpochContracts { Fingerprint book; Fingerprint guard; Fingerprint hook; Fingerprint settlement; Fingerprint manager; }
    struct EpochSourceRecord { uint256 chainId; uint256 configVersion; bytes32 rewardPolicyHash; PoolKey key; EpochContracts contracts; }
    struct EpochRead { string id; address target; bytes data; }
    struct EpochReply { string id; address target; bytes data; bool ok; bytes result; }
    struct EpochFixture {
        EpochSourceRecord source; uint256 epoch; address caller; uint256 blockNumber; bytes32 blockHash; uint256 timestamp;
        bytes[] codes; EpochReply[] replies; bytes32[] slots; bytes32[] values; uint256 cap; uint160 downLimit; uint160 upLimit;
    }
    struct EpochResult {
        bytes32 positionsHash; bytes32 weightsHash; bytes32 snapshotHash; bytes32 curvesHash;
        uint256 pointCount; uint256 timestamp; uint256 count; uint256 executeUntil;
        bytes32 batchDigest; address solver; uint256 exclusiveUntil;
    }

    function _record(PoolKey memory k, uint256 epoch) private view returns (OpeningRecord memory r) {
        bytes32 id = PoolId.unwrap(k.toId());
        r.chainId = block.chainid; r.bookAddress = address(book); r.poolId = id; r.epoch = epoch;
        r.configVersion = book.configVersionOf(id); (r.closesAt,,) = book.batches(id, epoch);
        r.executeUntil = book.executionDeadline(id, epoch); r.openingBlock = book.openingBlock(id, epoch);
        r.guard = book.liquidityGuardOf(id); r.pool = book.openingSnapshot(id, epoch);
        r.rewardPolicyHash = book.rewardPolicyHashOf(id); r.totalWeight = book.openingRewardWeight(id, epoch);
        r.positions = book.openingPositions(id, epoch); r.weights = book.openingRewardWeights(id, epoch);
    }

    function _fixture(PoolKey memory k, uint256 epoch, uint256 cap) private view returns (Fixture memory f) {
        f.record = _record(k, epoch); f.snapshotHash = book.snapshotHash(f.record.poolId, epoch);
        f.blockNumber = block.number; f.blockHash = keccak256(abi.encode("4M/synthetic-block", block.number));
        f.code = address(manager).code; f.cap = cap;
        f.downLimit = TickMath.getSqrtPriceAtTick(f.record.pool.tick - 1200);
        f.upLimit = TickMath.getSqrtPriceAtTick(f.record.pool.tick + 1200);
        bytes32 base = keccak256(abi.encode(f.record.poolId, uint256(6)));
        PoolId id = k.toId(); (, int24 liveTick,,) = manager.getSlot0(id);
        int24 compressed = TickBitmap.compress(liveTick, k.tickSpacing);
        (int16 downWord,) = TickBitmap.position(compressed); (int16 upWord,) = TickBitmap.position(compressed + 1);
        uint256 count = downWord == upWord ? 35 : 36;
        f.slots = new bytes32[](count); f.values = new bytes32[](count);
        f.slots[0] = base; f.slots[1] = bytes32(uint256(base) + 3);
        f.values[0] = manager.extsload(f.slots[0]); f.values[1] = manager.extsload(f.slots[1]);
        uint256 cursor = 2;
        for (uint256 side; side < 2; ++side) for (uint256 i; i < 16; ++i) {
            if (side == 1 && i == 0 && downWord == upWord) continue;
            int16 word = side == 0 ? downWord - int16(int256(i)) : upWord + int16(int256(i));
            f.slots[cursor] = keccak256(abi.encode(int256(word), bytes32(uint256(base) + 5)));
            f.values[cursor] = manager.extsload(f.slots[cursor]);
            assertEq(uint256(f.values[cursor]), manager.getTickBitmap(id, word)); ++cursor;
        }
        for (uint256 side; side < 2; ++side) {
            int24 tick = side == 0 ? f.record.positions[0].tickLower : f.record.positions[0].tickUpper;
            f.slots[cursor] = keccak256(abi.encode(int256(tick), bytes32(uint256(base) + 4)));
            f.values[cursor] = manager.extsload(f.slots[cursor]);
            (uint128 gross, int128 net) = manager.getTickLiquidity(id, tick);
            assertEq(uint128(uint256(f.values[cursor])), gross);
            assertEq(int128(int256(uint256(f.values[cursor]) >> 128)), net); ++cursor;
        }
        assertEq(cursor, count);
    }

    function _command(Fixture memory f) private pure returns (string[] memory args) {
        args = new string[](4); args[0] = "node"; args[1] = "--experimental-strip-types";
        args[2] = "../web/test/opening-execution-cli.ts"; args[3] = vm.toString(abi.encode(f));
    }

    function _check(PoolKey memory k, uint256 epoch, uint256 cap) private {
        book.assertSnapshot(PoolId.unwrap(k.toId()), epoch);
        Fixture memory f = _fixture(k, epoch, cap);
        (bytes32 positionsHash, bytes32 weightsHash, bytes32 snapshot, bytes32 curvesHash, uint256 points) =
            abi.decode(vm.ffi(_command(f)), (bytes32, bytes32, bytes32, bytes32, uint256));
        assertEq(positionsHash, keccak256(abi.encode(f.record.positions)));
        assertEq(weightsHash, keccak256(abi.encode(f.record.weights))); assertEq(snapshot, f.snapshotHash);
        OtterExecutionOracle oracle = new OtterExecutionOracle(manager);
        Curve[] memory curves = new Curve[](2);
        for (uint256 side; side < 2; ++side) {
            curves[side].down = side == 0; curves[side].maxInput = cap;
            curves[side].limit = side == 0 ? f.downLimit : f.upLimit;
            curves[side].points = new OtterExecutionOracle.Quote[](cap + 1);
            for (uint256 amount; amount <= cap; ++amount) {
                curves[side].points[amount] = oracle.quoteExactInput(k, side == 0, amount, curves[side].limit);
            }
        }
        assertEq(curvesHash, keccak256(abi.encode(curves))); assertEq(points, 2 * (cap + 1));
        book.assertSnapshot(PoolId.unwrap(k.toId()), epoch);
    }

    function _addOwner(address who, uint128 liquidity) private {
        deal(Currency.unwrap(currency0), who, 1e30); deal(Currency.unwrap(currency1), who, 1e30);
        vm.startPrank(who);
        IFixtureToken(Currency.unwrap(currency0)).approve(address(vault), type(uint256).max);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        vault.createPosition(otterKey, TICK_LOWER, TICK_UPPER, liquidity, type(uint256).max, type(uint256).max);
        vm.stopPrank();
    }

    function _epochCommand(string memory mode, bytes memory payload) private pure returns (string[] memory args) {
        args = new string[](5); args[0] = "node"; args[1] = "--experimental-strip-types";
        args[2] = "../web/test/epoch-snapshot-cli.ts"; args[3] = mode; args[4] = vm.toString(payload);
    }

    function _fingerprint(address target) private view returns (Fingerprint memory) {
        return Fingerprint(target, target.codehash);
    }

    function _epochFixture(PoolKey memory k, uint256 epoch, uint256 cap, address caller) private returns (EpochFixture memory f) {
        Fixture memory core = _fixture(k, epoch, cap);
        f.source = EpochSourceRecord(block.chainid, core.record.configVersion, core.record.rewardPolicyHash, k,
            EpochContracts(_fingerprint(address(book)), _fingerprint(address(vault)), _fingerprint(address(hook)),
                _fingerprint(address(settlement)), _fingerprint(address(manager))));
        f.epoch = epoch; f.caller = caller; f.blockNumber = block.number; f.blockHash = core.blockHash; f.timestamp = block.timestamp;
        f.slots = core.slots; f.values = core.values; f.cap = cap; f.downLimit = core.downLimit; f.upLimit = core.upLimit;
        f.codes = new bytes[](5); f.codes[0] = address(book).code; f.codes[1] = address(vault).code;
        f.codes[2] = address(hook).code; f.codes[3] = address(settlement).code; f.codes[4] = address(manager).code;
        EpochRead[] memory reads = abi.decode(vm.ffi(_epochCommand("--reads", abi.encode(f.source, epoch))), (EpochRead[]));
        assertEq(reads.length, 36); f.replies = new EpochReply[](reads.length);
        for (uint256 i; i < reads.length; ++i) {
            EpochRead memory r = reads[i];
            assertTrue(r.target == address(book) || r.target == address(vault) || r.target == address(hook) || r.target == address(settlement));
            (bool ok, bytes memory result) = r.target.staticcall(r.data);
            f.replies[i] = EpochReply(r.id, r.target, r.data, ok, result);
        }
    }

    function _captureCheck(PoolKey memory k, uint256 epoch, uint256 cap, address caller) private {
        EpochFixture memory f = _epochFixture(k, epoch, cap, caller);
        EpochResult memory r = abi.decode(vm.ffi(_epochCommand("--capture", abi.encode(f))), (EpochResult));
        OpeningRecord memory opening = _record(k, epoch); bytes32 id = PoolId.unwrap(k.toId());
        assertEq(r.positionsHash, opening.pool.positionsHash); assertEq(r.weightsHash, keccak256(abi.encode(opening.weights)));
        assertEq(r.snapshotHash, book.snapshotHash(id, epoch)); assertEq(r.timestamp, block.timestamp);
        (, uint32 count,) = book.batches(id, epoch); assertEq(r.count, count);
        assertEq(r.executeUntil, book.executionDeadline(id, epoch)); assertEq(r.batchDigest, book.batchDigest(id, epoch));
        assertEq(r.solver, settlement.solver()); assertEq(r.exclusiveUntil, uint256(opening.closesAt) + settlement.exclusivityWindow());
        Curve[] memory curves = new Curve[](2); OtterExecutionOracle oracle = new OtterExecutionOracle(manager);
        for (uint256 side; side < 2; ++side) {
            curves[side].down = side == 0; curves[side].maxInput = cap; curves[side].limit = side == 0 ? f.downLimit : f.upLimit;
            curves[side].points = new OtterExecutionOracle.Quote[](cap + 1);
            for (uint256 amount; amount <= cap; ++amount) curves[side].points[amount] = oracle.quoteExactInput(k, side == 0, amount, curves[side].limit);
        }
        assertEq(r.curvesHash, keccak256(abi.encode(curves))); assertEq(r.pointCount, 2 * (cap + 1));
        book.assertSnapshot(id, epoch);
    }

    function _captureFailure(uint256 epoch, address caller, string memory reason) private {
        Vm.FfiResult memory r = vm.tryFfi(_epochCommand("--capture", abi.encode(_epochFixture(otterKey, epoch, 8, caller))));
        assertNotEq(r.exitCode, 0); assertEq(r.stdout.length, 0);
        assertEq(string(r.stderr), string.concat("Epoch capture bridge failed: ", reason, "\n"));
    }

    function test_bindingMatchesActualBookRosterWeightsAndCurves() public {
        _addOwner(address(0xBEEF), 1000); vm.roll(1234); _submitActiveOrder(); _check(otterKey, 0, 8);
    }

    function test_bindingAcceptsMaximumRosterAndSameOwnerPositions() public {
        for (uint256 i; i < 31; ++i) _addOwner(address(0xBEEF), 1000 + uint128(i));
        _submitActiveOrder(); assertEq(book.openingPositions(PoolId.unwrap(otterId), 0).length, 32); _check(otterKey, 0, 1);
    }

    function test_bindingKeepsZeroWeightOwnerAndPendingExitInOpeningRecord() public {
        _addOwner(address(0xC1), 1); _submitActiveOrder();
        assertEq(book.openingRewardWeights(PoolId.unwrap(otterId), 0)[1], 0);
        vault.requestExit(1, 1e21); _check(otterKey, 0, 8);
    }

    function test_bindingRejectsHistoricalRecordAtChangedLivePoolAfterExpiryExit() public {
        _submitActiveOrder(); bytes32 id = PoolId.unwrap(otterId);
        vm.warp(book.executionDeadline(id, 0)); book.expire(id, 0); vault.removeLiquidity(1, 1e21, 0, 0);
        Vm.FfiResult memory result = vm.tryFfi(_command(_fixture(otterKey, 0, 8)));
        assertNotEq(result.exitCode, 0); assertEq(result.stdout.length, 0);
        assertEq(string(result.stderr), "Opening execution bridge failed: Opening execution header mismatch.\n");
    }

    function _nativeEpoch() private returns (PoolKey memory k) {
        (k,) = initPool(Currency.wrap(address(0)), currency1, IHooks(address(hook)), 0, 60, SQRT_PRICE_1_1);
        settlement.registerPool(k); vm.deal(address(this), 1e35);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        uint256 debt = SqrtPriceMath.getAmount0Delta(SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(887220), 1000, true);
        vault.createPosition{value: debt}(k, -887220, 887220, 1000, type(uint256).max, type(uint256).max);
        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](1);
        orders[0] = OtterOrderBook.Order(vm.addr(0xA11CE), PoolId.unwrap(k.toId()), true, 0, 1e18,
            block.timestamp + 1 days, 0, 1, 0, block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(orders[0]));
        bytes[] memory sigs = new bytes[](1); sigs[0] = abi.encodePacked(r, s, v);
        book.submit{value: 1e18}(orders, sigs);
    }

    function test_bindingMatchesRealNativeEpoch() public {
        _check(_nativeEpoch(), 0, 8);
    }

    function testFuzz_bindingMatchesActualWideChainBlockAndRoster(uint64 chainSeed, uint64 blockSeed, uint64 liquiditySeed, uint8 capSeed) public {
        vm.chainId(bound(chainSeed, 1, type(uint64).max)); vm.roll(bound(blockSeed, 1, type(uint64).max));
        _addOwner(address(0xBEEF), uint128(bound(liquiditySeed, 2, 1e18)));
        _submitActiveOrder(); _check(otterKey, 0, bound(capSeed, 0, 8));
    }

    function test_captureMatchesRealClosedEpochWithZeroWeightAndPendingExit() public {
        _addOwner(address(0xC1), 1); _submitActiveOrder(); vault.requestExit(1, 1e21);
        (uint64 closesAt,,) = book.batches(PoolId.unwrap(otterId), 0); vm.warp(closesAt);
        _captureCheck(otterKey, 0, 8, address(this));
    }

    function test_captureMatchesMaximumRosterAndRepeatedOwner() public {
        for (uint256 i; i < 31; ++i) _addOwner(address(0xBEEF), 1000 + uint128(i));
        _submitActiveOrder(); (uint64 closesAt,,) = book.batches(PoolId.unwrap(otterId), 0); vm.warp(closesAt);
        _captureCheck(otterKey, 0, 1, address(this));
    }

    function test_captureMatchesNativeAtPublicExclusivityBoundary() public {
        PoolKey memory k = _nativeEpoch(); (uint64 closesAt,,) = book.batches(PoolId.unwrap(k.toId()), 0);
        vm.warp(uint256(closesAt) + settlement.exclusivityWindow()); _captureCheck(k, 0, 8, address(0xBEEF));
    }

    function test_captureRejectsCollectingExpiredAndRefundableEpoch() public {
        _submitActiveOrder(); _captureFailure(0, address(this), "Epoch is outside the current closed execution window.");
        vm.warp(book.executionDeadline(PoolId.unwrap(otterId), 0));
        _captureFailure(0, address(this), "Epoch is outside the current closed execution window.");
        book.expire(PoolId.unwrap(otterId), 0);
        _captureFailure(0, address(this), "Epoch is outside the current closed execution window.");
    }

    function test_captureRejectsOtherCallerInsideSolverWindow() public {
        _submitActiveOrder(); (uint64 closesAt,,) = book.batches(PoolId.unwrap(otterId), 0); vm.warp(closesAt);
        _captureFailure(0, address(0xBEEF), "Epoch caller is inside the solver-only window.");
    }

    function test_captureRejectsChangedLiveStateThroughActualBookAssertion() public {
        _submitActiveOrder(); (uint64 closesAt,,) = book.batches(PoolId.unwrap(otterId), 0); vm.warp(closesAt);
        bytes32 base = keccak256(abi.encode(PoolId.unwrap(otterId), uint256(6)));
        vm.store(address(manager), bytes32(uint256(base) + 3), bytes32(uint256(1e21 + 1)));
        _captureFailure(0, address(this), "Epoch staticcall reverted or was not exported.");
    }

    function testFuzz_captureMatchesWideIdentityClocksAndActualReplies(uint64 chainSeed, uint64 blockSeed, uint8 capSeed, bool publicCaller) public {
        vm.chainId(bound(chainSeed, 1, type(uint64).max)); vm.roll(bound(blockSeed, 1, type(uint64).max)); _submitActiveOrder();
        (uint64 closesAt,,) = book.batches(PoolId.unwrap(otterId), 0);
        vm.warp(uint256(closesAt) + (publicCaller ? settlement.exclusivityWindow() : 0));
        _captureCheck(otterKey, 0, bound(capSeed, 0, 8), publicCaller ? address(0xBEEF) : address(this));
    }
}
