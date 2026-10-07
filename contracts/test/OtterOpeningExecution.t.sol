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
        uint256 nativeBalance;
    }
    struct EpochResult {
        bytes32 positionsHash; bytes32 weightsHash; bytes32 snapshotHash; bytes32 curvesHash;
        uint256 pointCount; uint256 timestamp; uint256 count; uint256 executeUntil;
        bytes32 batchDigest; address solver; uint256 exclusiveUntil;
    }
    struct BatchResult {
        EpochResult context; bytes32 ordersHash; uint256 budget0; uint256 budget1;
        uint256 balance0; uint256 balance1; uint256 escrow0; uint256 escrow1; uint256 claimable0; uint256 claimable1;
    }
    struct DirectionCoverage {
        bool down; uint256 requiredInput; bool domainPresent; uint256 maxInput; uint160 limit;
        uint256 representedInputs; uint256 missingInputs; uint256[] unsupportedAt; uint256[] partialAt;
    }
    struct CoverageCase {
        uint8 kind; address trader; uint8[] omittedIndices; bytes32 ordersHash; DirectionCoverage[] directions;
    }
    struct ResearchCase {
        uint8 kind; address trader; uint8[] omittedIndices; uint8[] indices; bytes32 ordersHash; uint256[] fill;
        uint256 totalInput; uint256 output; uint256 welfareNumerator; uint256 costNumerator;
        uint256 scanEvaluated; uint256 exhaustiveEvaluated;
    }
    struct RecordTransfer {
        uint8 index; bytes32 id; address trader; uint256 spent; uint256 unspent; uint256 withoutWelfareNumerator;
        uint256 paymentNumerator; uint256 floorPayment; uint256 ceilPayment; uint256 minimumPayment; bool floorIR;
    }
    struct AddressTransfer {
        address trader; uint8[] indices; uint256 spent; uint256 unspent; uint256 costNumerator; uint256 withoutWelfareNumerator;
        uint256 paymentNumerator; uint256 floorPayment; uint256 ceilPayment; uint256 aggregateMinimumPayment;
        uint256 sumRecordMinimumPayment; uint256 recordPaymentNumerator; uint256 recordCeilPayment;
        int256 recordVsGroupPaymentNumerator; bool groupedCeilMeetsRecordMinimums;
    }
    struct ResearchResult {
        bool down; address soldCurrency; address paymentCurrency; uint256 originalInput; uint256 vectorBound;
        ResearchCase[] cases; RecordTransfer[] records; AddressTransfer[] addresses;
        int256 recordRawDeficitNumerator; int256 recordCeilResidual; uint256 recordCeilDeficit;
        int256 addressRawDeficitNumerator; int256 addressCeilResidual; uint256 addressCeilDeficit;
    }
    struct ResearchChoice { uint256[] fill; uint256 input; uint256 output; uint256 welfare; uint256 cost; }
    struct ResearchScan { uint8[] indices; uint256[] outputs; uint256[] rank; uint256[] amounts; uint256 evaluated; ResearchChoice best; }
    struct MinimumPoint {
        uint256 totalInput; uint256 output; uint256[] fill; uint256 minimumPayment; uint256 aggregateMinimumPayment;
        uint256 costNumerator; int256 welfareNumerator; uint256 deficit; bool feasible;
    }
    struct MinimumCase {
        uint8 kind; address trader; uint8[] omittedIndices; uint8[] indices; bytes32 ordersHash; MinimumPoint[] points;
        uint256 vectorCount; uint256 dpTransitions; uint256 researchInput; uint256 researchMinimumPayment;
        uint256 researchMinimumDeficit; uint256 sameInputMinimumPayment; bool sameInputFeasible; bool positiveOutputAllocationExists;
    }
    struct MinimumResult { MinimumCase[] cases; }
    struct MinimumScan { ResearchScan allocation; MinimumPoint[] points; bool[] present; uint256 vectors; }
    uint256 private constant RESEARCH_WAD = 1e18;

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
        f.nativeBalance = address(book).balance;
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
        _assertEpoch(k, epoch, cap, f, r);
    }

    function _assertEpoch(PoolKey memory k, uint256 epoch, uint256 cap, EpochFixture memory f, EpochResult memory r) private {
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

    function _batchFixture(PoolKey memory k, uint256 epoch, uint256 cap, address caller) private returns (EpochFixture memory f) {
        f = _epochFixture(k, epoch, cap, caller);
        OtterOrderBook.Order[] memory orders = book.getOrders(PoolId.unwrap(k.toId()), epoch);
        EpochRead[] memory extra = abi.decode(vm.ffi(_epochCommand("--batch-reads", abi.encode(f.source, epoch, orders))), (EpochRead[]));
        assertLe(extra.length, 74);
        EpochReply[] memory replies = new EpochReply[](f.replies.length + extra.length);
        for (uint256 i; i < f.replies.length; ++i) replies[i] = f.replies[i];
        for (uint256 i; i < extra.length; ++i) {
            EpochRead memory r = extra[i];
            assertTrue(r.target == address(book) || (r.target != address(0)
                && (r.target == Currency.unwrap(k.currency0) || r.target == Currency.unwrap(k.currency1))));
            (bool ok, bytes memory result) = r.target.staticcall(r.data);
            replies[f.replies.length + i] = EpochReply(r.id, r.target, r.data, ok, result);
        }
        f.replies = replies;
    }

    function _bookBalance(Currency c) private view returns (uint256) {
        if (Currency.unwrap(c) == address(0)) return address(book).balance;
        (bool ok, bytes memory data) = Currency.unwrap(c).staticcall(abi.encodeWithSignature("balanceOf(address)", address(book)));
        assertTrue(ok); return abi.decode(data, (uint256));
    }

    function _batchCheck(PoolKey memory k, uint256 epoch, uint256 cap, address caller) private {
        EpochFixture memory f = _batchFixture(k, epoch, cap, caller);
        BatchResult memory r = abi.decode(vm.ffi(_epochCommand("--batch", abi.encode(f))), (BatchResult));
        _assertEpoch(k, epoch, cap, f, r.context);
        bytes32 id = PoolId.unwrap(k.toId()); OtterOrderBook.Order[] memory orders = book.getOrders(id, epoch);
        assertEq(r.ordersHash, keccak256(abi.encode(orders)));
        uint256 budget0; uint256 budget1;
        for (uint256 i; i < orders.length; ++i) {
            if (orders[i].sellingCurrency0) budget0 += orders[i].budget; else budget1 += orders[i].budget;
            assertFalse(book.orderRecovered(id, epoch, i));
        }
        assertEq(r.budget0, budget0); assertEq(r.budget1, budget1);
        assertEq(r.balance0, _bookBalance(k.currency0)); assertEq(r.balance1, _bookBalance(k.currency1));
        assertEq(r.escrow0, book.totalEscrow(Currency.unwrap(k.currency0))); assertEq(r.escrow1, book.totalEscrow(Currency.unwrap(k.currency1)));
        assertEq(r.claimable0, book.totalClaimable(Currency.unwrap(k.currency0))); assertEq(r.claimable1, book.totalClaimable(Currency.unwrap(k.currency1)));
        book.replay(id, epoch, orders);
    }

    function _submitStored(PoolKey memory k, bool side, uint256 budget, uint256 ask, uint256 nonce, uint256 pk, bool maximumTimes) private {
        address trader = vm.addr(pk); address sold = Currency.unwrap(side ? k.currency0 : k.currency1);
        uint256 value;
        if (sold == address(0)) { vm.deal(address(this), 1e35); value = budget; }
        else { deal(sold, trader, 1e30); vm.prank(trader); IFixtureToken(sold).approve(address(book), type(uint256).max); }
        bytes32 id = PoolId.unwrap(k.toId()); OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](1);
        // Admission deadline equality is valid. Once closed, only execution validity applies.
        orders[0] = OtterOrderBook.Order(trader, id, side, ask, budget, maximumTimes ? type(uint64).max : block.timestamp,
            nonce, book.configVersionOf(id), book.nextEpochId(id), maximumTimes ? type(uint64).max : block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(orders[0]));
        bytes[] memory signatures = new bytes[](1); signatures[0] = abi.encodePacked(r, s, v);
        book.submit{value: value}(orders, signatures);
    }

    function _close(PoolKey memory k, uint256 epoch) private {
        (uint64 closesAt,,) = book.batches(PoolId.unwrap(k.toId()), epoch); vm.warp(closesAt);
    }

    function _assertPrefix(DirectionCoverage memory d, uint256 budget, Curve memory curve) private pure returns (bool) {
        assertEq(d.down, curve.down); assertEq(d.requiredInput, budget); assertTrue(d.domainPresent);
        assertEq(d.maxInput, curve.maxInput); assertEq(d.limit, curve.limit);
        uint256 examined = (budget < curve.maxInput ? budget : curve.maxInput) + 1;
        assertEq(d.representedInputs, examined); assertEq(d.missingInputs, budget + 1 - examined);
        uint256[] memory unsupported = new uint256[](examined); uint256[] memory partialInputs = new uint256[](examined);
        uint256 unsupportedCount; uint256 partialCount;
        for (uint256 i; i < examined; ++i) {
            OtterExecutionOracle.Quote memory q = curve.points[i];
            bool supported = q.status == OtterExecutionOracle.Status.Complete || q.status == OtterExecutionOracle.Status.PriceLimit;
            if (!supported) unsupported[unsupportedCount++] = i;
            else if (q.consumedInput != i) partialInputs[partialCount++] = i;
        }
        assembly ("memory-safe") { mstore(unsupported, unsupportedCount) mstore(partialInputs, partialCount) }
        assertEq(d.unsupportedAt, unsupported); assertEq(d.partialAt, partialInputs);
        return d.missingInputs == 0 && unsupportedCount == 0 && partialCount == 0;
    }

    function _coverageCheck(PoolKey memory k, uint256 cap, uint160 downLimit, bool expectedAvailable) private returns (bytes32) {
        EpochFixture memory f = _batchFixture(k, 0, cap, address(this)); f.downLimit = downLimit;
        (bytes32 coverageHash, bool available, CoverageCase[] memory cases) =
            abi.decode(vm.ffi(_epochCommand("--coverage", abi.encode(f))), (bytes32, bool, CoverageCase[]));
        bytes32 id = PoolId.unwrap(k.toId()); OtterOrderBook.Order[] memory orders = book.getOrders(id, 0);
        address[] memory traders = new address[](orders.length); uint256 traderCount;
        for (uint256 i; i < orders.length; ++i) {
            bool seen; for (uint256 j; j < i; ++j) if (orders[j].trader == orders[i].trader) seen = true;
            if (!seen) traders[traderCount++] = orders[i].trader;
        }
        assertEq(cases.length, 1 + orders.length + traderCount); assertLe(cases.length, 65);
        Curve[] memory curves = new Curve[](2); OtterExecutionOracle oracle = new OtterExecutionOracle(manager);
        for (uint256 side; side < 2; ++side) {
            curves[side].down = side == 0; curves[side].maxInput = cap; curves[side].limit = side == 0 ? f.downLimit : f.upLimit;
            curves[side].points = new OtterExecutionOracle.Quote[](cap + 1);
            for (uint256 amount; amount <= cap; ++amount) curves[side].points[amount] = oracle.quoteExactInput(k, side == 0, amount, curves[side].limit);
        }
        bool allAvailable = true;
        for (uint256 c; c < cases.length; ++c) {
            CoverageCase memory current = cases[c]; uint8 kind = c == 0 ? 0 : c <= orders.length ? 1 : 2;
            address trader = kind == 0 ? address(0) : kind == 1 ? orders[c - 1].trader : traders[c - 1 - orders.length];
            assertEq(current.kind, kind); assertEq(current.trader, trader);
            uint256 omittedCount;
            for (uint256 i; i < orders.length; ++i) if ((kind == 1 && i == c - 1) || (kind == 2 && orders[i].trader == trader)) ++omittedCount;
            uint8[] memory omitted = new uint8[](omittedCount);
            OtterOrderBook.Order[] memory retained = new OtterOrderBook.Order[](orders.length - omittedCount);
            uint256 removed; uint256 kept; uint256[2] memory budgets;
            for (uint256 i; i < orders.length; ++i) {
                if ((kind == 1 && i == c - 1) || (kind == 2 && orders[i].trader == trader)) omitted[removed++] = uint8(i);
                else { retained[kept++] = orders[i]; budgets[orders[i].sellingCurrency0 ? 0 : 1] += orders[i].budget; }
            }
            assertEq(keccak256(abi.encode(current.omittedIndices)), keccak256(abi.encode(omitted)));
            assertEq(current.ordersHash, keccak256(abi.encode(retained))); assertEq(current.directions.length, 2);
            for (uint256 side; side < 2; ++side) if (!_assertPrefix(current.directions[side], budgets[side], curves[side])) allAvailable = false;
        }
        assertEq(available, allAvailable); assertEq(available, expectedAvailable);
        assertEq(coverageHash, keccak256(abi.encode(keccak256("OtterOpeningPrefixCoverage/v1"), block.chainid, address(book),
            id, uint256(0), book.configVersionOf(id), f.blockNumber, f.blockHash, book.snapshotHash(id, 0),
            keccak256(abi.encode(curves)), keccak256(abi.encode(orders)), book.batchDigest(id, 0), cases)));
        return coverageHash;
    }

    // Independent Cartesian enumeration over actual retained budgets/output.
    // No cheapest-prefix allocation or Node optimizer is used by this oracle.
    function _visitResearch(OtterOrderBook.Order[] memory orders, ResearchScan memory scan, uint256 depth, uint256 input, uint256 cost) private pure {
        if (depth < scan.indices.length) {
            OtterOrderBook.Order memory order = orders[scan.indices[depth]];
            for (uint256 take; take <= order.budget; ++take) {
                scan.amounts[depth] = take; _visitResearch(orders, scan, depth + 1, input + take, cost + order.ask * take);
            }
            return;
        }
        ++scan.evaluated;
        uint256 gross = scan.outputs[input] * RESEARCH_WAD;
        if (cost > gross) return;
        uint256 welfare = gross - cost;
        bool better = welfare > scan.best.welfare || (welfare == scan.best.welfare && input > scan.best.input);
        if (welfare == scan.best.welfare && input == scan.best.input) for (uint256 j; j < scan.rank.length; ++j) {
            uint256 i = scan.rank[j]; if (scan.amounts[i] == scan.best.fill[i]) continue;
            better = scan.amounts[i] > scan.best.fill[i]; break;
        }
        if (better) {
            uint256[] memory fill = new uint256[](scan.amounts.length);
            for (uint256 i; i < fill.length; ++i) fill[i] = scan.amounts[i];
            scan.best = ResearchChoice(fill, input, scan.outputs[input], welfare, cost);
        }
    }

    function _assertResearchChoice(OtterOrderBook.Order[] memory orders, ResearchCase memory c, uint256[] memory outputs) private view {
        uint256 n = c.indices.length; ResearchScan memory scan;
        scan.indices = c.indices; scan.outputs = outputs; scan.rank = new uint256[](n); scan.amounts = new uint256[](n);
        scan.best.fill = new uint256[](n); uint256 budget;
        for (uint256 i; i < n; ++i) { scan.rank[i] = i; budget += orders[c.indices[i]].budget; }
        for (uint256 i; i < n; ++i) for (uint256 j = i + 1; j < n; ++j) {
            OtterOrderBook.Order memory left = orders[c.indices[scan.rank[i]]]; OtterOrderBook.Order memory right = orders[c.indices[scan.rank[j]]];
            if (right.ask < left.ask || (right.ask == left.ask && book.hashOrder(right) < book.hashOrder(left)))
                (scan.rank[i], scan.rank[j]) = (scan.rank[j], scan.rank[i]);
        }
        _visitResearch(orders, scan, 0, 0, 0);
        assertEq(c.fill, scan.best.fill); assertEq(c.totalInput, scan.best.input); assertEq(c.output, scan.best.output);
        assertEq(c.welfareNumerator, scan.best.welfare); assertEq(c.costNumerator, scan.best.cost);
        assertEq(c.exhaustiveEvaluated, scan.evaluated); assertEq(c.scanEvaluated, budget + 1);
    }

    function _ceilResearch(uint256 value) private pure returns (uint256) { return (value + RESEARCH_WAD - 1) / RESEARCH_WAD; }

    function _assertResearchTransfers(OtterOrderBook.Order[] memory orders, ResearchResult memory r) private view {
        ResearchCase memory base = r.cases[0]; uint256 recordPaid; uint256 recordCeil;
        assertEq(r.records.length, orders.length);
        for (uint256 i; i < orders.length; ++i) {
            RecordTransfer memory t = r.records[i]; uint256 cost = orders[i].ask * base.fill[i];
            uint256 withoutWelfare = r.cases[i + 1].welfareNumerator;
            uint256 payment = cost + base.welfareNumerator - withoutWelfare;
            assertEq(t.index, i); assertEq(t.id, book.hashOrder(orders[i])); assertEq(t.trader, orders[i].trader);
            assertEq(t.spent, base.fill[i]); assertEq(t.unspent, orders[i].budget - base.fill[i]); assertEq(t.withoutWelfareNumerator, withoutWelfare);
            assertEq(t.paymentNumerator, payment); assertEq(t.floorPayment, payment / RESEARCH_WAD); assertEq(t.ceilPayment, _ceilResearch(payment));
            assertEq(t.minimumPayment, _ceilResearch(cost)); assertEq(t.floorIR, t.floorPayment >= t.minimumPayment);
            recordPaid += payment; recordCeil += t.ceilPayment;
        }
        uint256 addressPaid; uint256 addressCeil;
        assertEq(r.addresses.length, r.cases.length - 1 - orders.length);
        for (uint256 j; j < r.addresses.length; ++j) {
            AddressTransfer memory a = r.addresses[j]; ResearchCase memory withoutCase = r.cases[1 + orders.length + j];
            assertEq(a.trader, withoutCase.trader); assertEq(keccak256(abi.encode(a.indices)), keccak256(abi.encode(withoutCase.omittedIndices)));
            uint256 spent; uint256 unspent; uint256 cost; uint256 minimum; uint256 recordNumerator; uint256 recordWhole;
            for (uint256 k; k < a.indices.length; ++k) {
                uint256 i = a.indices[k]; spent += base.fill[i]; unspent += orders[i].budget - base.fill[i]; cost += orders[i].ask * base.fill[i];
                minimum += r.records[i].minimumPayment; recordNumerator += r.records[i].paymentNumerator; recordWhole += r.records[i].ceilPayment;
            }
            uint256 payment = cost + base.welfareNumerator - withoutCase.welfareNumerator;
            assertEq(a.spent, spent); assertEq(a.unspent, unspent); assertEq(a.costNumerator, cost);
            assertEq(a.withoutWelfareNumerator, withoutCase.welfareNumerator); assertEq(a.paymentNumerator, payment);
            assertEq(a.floorPayment, payment / RESEARCH_WAD); assertEq(a.ceilPayment, _ceilResearch(payment));
            assertEq(a.aggregateMinimumPayment, _ceilResearch(cost)); assertEq(a.sumRecordMinimumPayment, minimum);
            assertEq(a.recordPaymentNumerator, recordNumerator); assertEq(a.recordCeilPayment, recordWhole);
            assertEq(a.recordVsGroupPaymentNumerator, int256(recordNumerator) - int256(payment));
            assertEq(a.groupedCeilMeetsRecordMinimums, a.ceilPayment >= minimum);
            addressPaid += payment; addressCeil += a.ceilPayment;
        }
        assertEq(r.recordRawDeficitNumerator, int256(recordPaid) - int256(base.output * RESEARCH_WAD));
        assertEq(r.recordCeilResidual, int256(base.output) - int256(recordCeil));
        assertEq(r.recordCeilDeficit, recordCeil > base.output ? recordCeil - base.output : 0);
        assertEq(r.addressRawDeficitNumerator, int256(addressPaid) - int256(base.output * RESEARCH_WAD));
        assertEq(r.addressCeilResidual, int256(base.output) - int256(addressCeil));
        assertEq(r.addressCeilDeficit, addressCeil > base.output ? addressCeil - base.output : 0);
    }

    function _researchCheck(PoolKey memory k, uint256 cap) private returns (ResearchResult memory r, bytes32 researchHash) {
        uint160 downLimit = TickMath.getSqrtPriceAtTick(book.openingSnapshot(PoolId.unwrap(k.toId()), 0).tick - 1200);
        bytes32 expectedCoverage = _coverageCheck(k, cap, downLimit, true);
        EpochFixture memory f = _batchFixture(k, 0, cap, address(this));
        bytes32 coverage;
        (coverage, researchHash, r) = abi.decode(vm.ffi(_epochCommand("--research", abi.encode(f))), (bytes32, bytes32, ResearchResult));
        assertEq(coverage, expectedCoverage);
        OtterOrderBook.Order[] memory orders = book.getOrders(PoolId.unwrap(k.toId()), 0);
        assertEq(r.down, orders[0].sellingCurrency0); assertEq(r.soldCurrency, Currency.unwrap(r.down ? k.currency0 : k.currency1));
        assertEq(r.paymentCurrency, Currency.unwrap(r.down ? k.currency1 : k.currency0));
        uint256 input; uint256 vectors = 1; address[] memory traders = new address[](orders.length); uint256 traderCount;
        for (uint256 i; i < orders.length; ++i) {
            input += orders[i].budget; vectors *= orders[i].budget + 1;
            bool seen; for (uint256 j; j < i; ++j) if (orders[j].trader == orders[i].trader) seen = true;
            if (!seen) traders[traderCount++] = orders[i].trader;
        }
        assertEq(r.originalInput, input); assertEq(r.vectorBound, vectors); assertEq(r.cases.length, 1 + orders.length + traderCount);
        uint256[] memory outputs = new uint256[](input + 1); OtterExecutionOracle oracle = new OtterExecutionOracle(manager);
        for (uint256 i; i <= input; ++i) {
            OtterExecutionOracle.Quote memory q = oracle.quoteExactInput(k, r.down, i, r.down ? f.downLimit : f.upLimit);
            assertEq(uint8(q.status), uint8(OtterExecutionOracle.Status.Complete)); assertEq(q.consumedInput, i); outputs[i] = q.output;
        }
        for (uint256 c; c < r.cases.length; ++c) {
            ResearchCase memory current = r.cases[c]; uint8 kind = c == 0 ? 0 : c <= orders.length ? 1 : 2;
            address trader = kind == 0 ? address(0) : kind == 1 ? orders[c - 1].trader : traders[c - 1 - orders.length];
            assertEq(current.kind, kind); assertEq(current.trader, trader);
            uint256 removed;
            for (uint256 i; i < orders.length; ++i) if ((kind == 1 && i == c - 1) || (kind == 2 && orders[i].trader == trader)) ++removed;
            uint8[] memory omitted = new uint8[](removed); uint8[] memory indices = new uint8[](orders.length - removed);
            OtterOrderBook.Order[] memory retained = new OtterOrderBook.Order[](indices.length); uint256 skipped; uint256 kept;
            for (uint256 i; i < orders.length; ++i) {
                if ((kind == 1 && i == c - 1) || (kind == 2 && orders[i].trader == trader)) omitted[skipped++] = uint8(i);
                else { indices[kept] = uint8(i); retained[kept++] = orders[i]; }
            }
            assertEq(keccak256(abi.encode(current.omittedIndices)), keccak256(abi.encode(omitted)));
            assertEq(keccak256(abi.encode(current.indices)), keccak256(abi.encode(indices)));
            assertEq(current.ordersHash, keccak256(abi.encode(retained))); _assertResearchChoice(orders, current, outputs);
        }
        _assertResearchTransfers(orders, r);
        assertEq(researchHash, keccak256(abi.encode(keccak256("OtterBoundOneSidedResearch/v1"), expectedCoverage, r)));
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
        return _nativeEpoch(1e18);
    }

    function _nativeEpoch(uint256 budget) private returns (PoolKey memory k) {
        k = _nativePool(SQRT_PRICE_1_1);
        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](1);
        orders[0] = OtterOrderBook.Order(vm.addr(0xA11CE), PoolId.unwrap(k.toId()), true, 0, budget,
            block.timestamp + 1 days, 0, 1, 0, block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, book.digestOf(orders[0]));
        bytes[] memory sigs = new bytes[](1); sigs[0] = abi.encodePacked(r, s, v);
        book.submit{value: budget}(orders, sigs);
    }

    function _nativePool(uint160 sqrtPrice) private returns (PoolKey memory k) {
        (k,) = initPool(Currency.wrap(address(0)), currency1, IHooks(address(hook)), 0, 60, sqrtPrice);
        settlement.registerPool(k); vm.deal(address(this), 1e35);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        uint256 debt = SqrtPriceMath.getAmount0Delta(sqrtPrice, TickMath.getSqrtPriceAtTick(887220), 1000, true);
        vault.createPosition{value: debt}(k, -887220, 887220, 1000, type(uint256).max, type(uint256).max);
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

    function test_batchMatchesMixedOrdersMultiwordNoncesAndExpiredAdmissionDeadlines() public {
        _submitStored(otterKey, true, 10, 3, 255, 0xA11CE, false);
        _submitStored(otterKey, false, 7, 4, 256, 0xA11CE, false);
        _submitStored(otterKey, true, 5, 0, 255, 0xB0B, false);
        _close(otterKey, 0); _batchCheck(otterKey, 0, 8, address(this));
    }

    function test_batchMatches32SameTraderOrdersInOneNonceWord() public {
        for (uint256 i; i < 32; ++i) _submitStored(otterKey, i % 2 == 0, i + 1, i, i, 0xA11CE, false);
        _close(otterKey, 0); _batchCheck(otterKey, 0, 1, address(this));
    }

    function test_batchMatchesRealNativeCustodyAtPublicBoundary() public {
        PoolKey memory k = _nativeEpoch();
        _submitStored(k, false, 17, 1, 256, 0xA11CE, false);
        (uint64 closesAt,,) = book.batches(PoolId.unwrap(k.toId()), 0);
        vm.warp(uint256(closesAt) + settlement.exclusivityWindow()); _batchCheck(k, 0, 8, address(0xBEEF));
    }

    function test_batchMatchesMaximumAdmittedWidthsAndWideNonceWord() public {
        // Foundry's chain environment is uint64; the pure Node domain test also
        // checks larger uint256 chain identities without narrowing to Number.
        vm.chainId(type(uint64).max); vm.roll((uint256(1) << 200) + 2);
        _submitStored(otterKey, true, type(uint96).max, type(uint128).max, type(uint256).max, 0xA11CE, true);
        _submitStored(otterKey, false, type(uint96).max, type(uint128).max, type(uint256).max, 0xB0B, true);
        _close(otterKey, 0); _batchCheck(otterKey, 0, 0, address(this));
    }

    function test_batchCoversClaimsAndOtherPoolEscrowSharingCurrencies() public {
        (PoolKey memory other,) = initPool(currency0, currency1, IHooks(address(hook)), 0, 60, SQRT_PRICE_1_1);
        settlement.registerPool(other);
        IFixtureToken(Currency.unwrap(currency0)).approve(address(vault), type(uint256).max);
        IFixtureToken(Currency.unwrap(currency1)).approve(address(vault), type(uint256).max);
        vault.createPosition(other, -887220, 887220, 1000, type(uint256).max, type(uint256).max);
        _submitStored(other, true, 29, 0, 500, 0xA11CE, false);
        bytes32 otherId = PoolId.unwrap(other.toId()); vm.warp(book.executionDeadline(otherId, 0));
        book.refundOrder(otherId, 0, 0); assertEq(book.totalClaimable(Currency.unwrap(currency0)), 29);
        _submitStored(other, true, 31, 0, 501, 0xA11CE, false);
        _submitStored(otterKey, true, 11, 0, 0, 0xB0B, false);
        _close(otterKey, 0);
        assertEq(book.totalEscrow(Currency.unwrap(currency0)), 42);
        assertEq(_bookBalance(currency0), 71); _batchCheck(otterKey, 0, 8, address(this));
    }

    function test_batchRejectsActualBookCustodyShortfall() public {
        _submitStored(otterKey, true, 11, 0, 0, 0xA11CE, false); _close(otterKey, 0);
        deal(Currency.unwrap(currency0), address(book), 10);
        Vm.FfiResult memory r = vm.tryFfi(_epochCommand("--batch", abi.encode(_batchFixture(otterKey, 0, 8, address(this)))));
        assertNotEq(r.exitCode, 0); assertEq(r.stdout.length, 0);
        assertEq(string(r.stderr), "Epoch capture bridge failed: Stored batch escrow/liability coverage mismatch.\n");
    }

    function testFuzz_batchMatchesRealWideOrderIdentityAndCustody(uint64 chainSeed, uint64 blockSeed, uint96 budgetSeed,
        uint256 nonceSeed, uint8 capSeed, bool side) public {
        vm.chainId(bound(chainSeed, 1, type(uint64).max)); vm.roll(bound(blockSeed, 1, type(uint64).max));
        _submitStored(otterKey, side, bound(budgetSeed, 1, type(uint96).max), 123, nonceSeed, 0xA11CE, false);
        _close(otterKey, 0); _batchCheck(otterKey, 0, bound(capSeed, 0, 8), address(this));
    }

    function test_coverageMatchesCompleteSmallMixedPrefixesAndBothRemovalInventories() public {
        _submitStored(otterKey, true, 3, type(uint128).max, 0, 0xA11CE, false);
        _submitStored(otterKey, false, 2, 0, 1, 0xA11CE, false);
        _submitStored(otterKey, true, 2, 0, 0, 0xB0B, false); _close(otterKey, 0);
        _coverageCheck(otterKey, 8, TickMath.getSqrtPriceAtTick(-1200), true);
    }

    function test_coverageRejectsIncompleteAggregateDespiteCoveredIndividualBudgets() public {
        _submitStored(otterKey, true, 5, 0, 0, 0xA11CE, false);
        _submitStored(otterKey, true, 5, 0, 0, 0xB0B, false); _close(otterKey, 0);
        _coverageCheck(otterKey, 8, TickMath.getSqrtPriceAtTick(-1200), false);
    }

    function test_coveragePreservesMaximumOriginalBudgetWithBoundedWork() public {
        _submitStored(otterKey, true, type(uint96).max, type(uint128).max, type(uint256).max, 0xA11CE, true);
        _close(otterKey, 0); _coverageCheck(otterKey, 64, TickMath.getSqrtPriceAtTick(-1200), false);
    }

    function test_coverageKeepsSupportedPartialConsumptionSeparateFromMissingData() public {
        _submitStored(otterKey, true, 5, 0, 0, 0xA11CE, false); _close(otterKey, 0);
        _coverageCheck(otterKey, 8, SQRT_PRICE_1_1 - 1, false);
    }

    function test_coverageKeepsUnsupportedRowsAndTheZeroNoopExplicit() public {
        _submitStored(otterKey, true, 5, 0, 0, 0xA11CE, false); _close(otterKey, 0);
        _coverageCheck(otterKey, 8, 0, false);
    }

    function test_coverageMatchesNativeCustodyWithoutClippingItsOriginalBudget() public {
        PoolKey memory k = _nativeEpoch(); _close(k, 0);
        _coverageCheck(k, 8, TickMath.getSqrtPriceAtTick(-1200), false);
    }

    function testFuzz_coverageMatchesActualOrderRemovalsAndOriginalPrefixBounds(uint8 countSeed, uint96 budgetSeed, uint8 capSeed) public {
        uint256 n = bound(countSeed, 1, 8); uint256 cap = bound(capSeed, 0, 8);
        uint256 budget = bound(budgetSeed, 1, uint256(type(uint96).max) / n);
        for (uint256 i; i < n; ++i) _submitStored(otterKey, i % 2 == 0, budget, 123, i, i % 3 == 0 ? 0xB0B : 0xA11CE, false);
        _close(otterKey, 0); _coverageCheck(otterKey, cap, TickMath.getSqrtPriceAtTick(-1200),
            ((n + 1) / 2) * budget <= cap && (n / 2) * budget <= cap);
    }

    function test_researchSameAddressSplitExposesRecordFundingDeficit() public {
        _submitStored(otterKey, true, 1, 0, 0, 0xA11CE, false);
        _submitStored(otterKey, true, 1, 0, 1, 0xA11CE, false); _close(otterKey, 0);
        (ResearchResult memory r,) = _researchCheck(otterKey, 8);
        assertEq(r.cases[0].totalInput, 2); assertEq(r.cases[0].output, 1);
        assertEq(r.records[0].paymentNumerator, RESEARCH_WAD); assertEq(r.records[1].paymentNumerator, RESEARCH_WAD);
        assertEq(r.recordRawDeficitNumerator, int256(RESEARCH_WAD)); assertEq(r.recordCeilDeficit, 1);
        assertEq(r.addresses.length, 1); assertEq(r.addresses[0].paymentNumerator, RESEARCH_WAD);
        assertEq(r.addressRawDeficitNumerator, 0); assertEq(r.addressCeilDeficit, 0);
    }

    function test_researchMergedRecordHasDifferentPivotAtSameAggregateInput() public {
        _submitStored(otterKey, true, 2, 0, 0, 0xA11CE, false); _close(otterKey, 0);
        (ResearchResult memory r,) = _researchCheck(otterKey, 8);
        assertEq(r.cases[0].totalInput, 2); assertEq(r.cases[0].output, 1);
        assertEq(r.records[0].paymentNumerator, RESEARCH_WAD); assertEq(r.recordCeilDeficit, 0);
        assertEq(r.addressRawDeficitNumerator, 0);
    }

    function test_researchGroupingDoesNotFundDistinctTraderPivots() public {
        _submitStored(otterKey, true, 1, 0, 0, 0xA11CE, false);
        _submitStored(otterKey, true, 1, 0, 0, 0xB0B, false); _close(otterKey, 0);
        (ResearchResult memory r,) = _researchCheck(otterKey, 8);
        assertEq(r.addresses.length, 2); assertEq(r.cases[0].output, 1);
        assertEq(r.recordRawDeficitNumerator, int256(RESEARCH_WAD)); assertEq(r.recordCeilDeficit, 1);
        assertEq(r.addressRawDeficitNumerator, int256(RESEARCH_WAD)); assertEq(r.addressCeilDeficit, 1);
    }

    function test_researchFundedAggregateCannotMeetSignedPerRecordMinima() public {
        _submitStored(otterKey, true, 1, RESEARCH_WAD / 4, 0, 0xA11CE, false);
        _submitStored(otterKey, true, 1, RESEARCH_WAD / 4, 1, 0xA11CE, false); _close(otterKey, 0);
        (ResearchResult memory r,) = _researchCheck(otterKey, 8);
        assertEq(r.cases[0].welfareNumerator, RESEARCH_WAD / 2);
        for (uint256 i; i < 2; ++i) {
            assertEq(r.records[i].paymentNumerator, 3 * RESEARCH_WAD / 4);
            assertEq(r.records[i].minimumPayment, 1); assertFalse(r.records[i].floorIR);
        }
        assertEq(r.recordRawDeficitNumerator, int256(RESEARCH_WAD / 2)); assertEq(r.recordCeilDeficit, 1);
        assertEq(r.addresses[0].aggregateMinimumPayment, 1); assertEq(r.addresses[0].sumRecordMinimumPayment, 2);
        assertEq(r.addresses[0].ceilPayment, 1); assertFalse(r.addresses[0].groupedCeilMeetsRecordMinimums);
        assertEq(r.addressCeilDeficit, 0);
    }

    function test_researchMatchesNativeSameAddressSplit() public {
        PoolKey memory k = _nativeEpoch(1);
        _submitStored(k, true, 1, 0, 1, 0xA11CE, false); _close(k, 0);
        (ResearchResult memory r,) = _researchCheck(k, 8);
        assertEq(r.soldCurrency, address(0)); assertEq(r.paymentCurrency, Currency.unwrap(k.currency1));
        assertEq(r.cases[0].output, 1); assertEq(r.recordCeilDeficit, 1); assertEq(r.addressCeilDeficit, 0);
    }

    function _researchFailure(uint256 cap, uint160 downLimit, string memory reason) private {
        EpochFixture memory f = _batchFixture(otterKey, 0, cap, address(this)); f.downLimit = downLimit;
        Vm.FfiResult memory result = vm.tryFfi(_epochCommand("--research", abi.encode(f)));
        assertNotEq(result.exitCode, 0); assertEq(result.stdout.length, 0);
        assertEq(string(result.stderr), string.concat("Epoch capture bridge failed: ", reason, "\n"));
    }

    function test_researchRejectsIncompletePartialUnsupportedMixedAndExcessWork() public {
        uint256 clean = vm.snapshotState(); uint160 limit = TickMath.getSqrtPriceAtTick(-1200);
        string memory missing = "Original opening prefixes contain missing, unsupported or partially consumed inputs.";
        _submitStored(otterKey, true, 9, 0, 0, 0xA11CE, false); _close(otterKey, 0);
        _researchFailure(8, limit, missing); assertTrue(vm.revertToState(clean));
        _submitStored(otterKey, true, 4, 0, 0, 0xA11CE, false); _close(otterKey, 0);
        _researchFailure(8, SQRT_PRICE_1_1 - 1, missing); _researchFailure(8, 0, missing);
        assertTrue(vm.revertToState(clean));
        _submitStored(otterKey, true, 1, 0, 0, 0xA11CE, false);
        _submitStored(otterKey, false, 1, 0, 1, 0xA11CE, false); _close(otterKey, 0);
        _researchFailure(8, limit, "Bound one-sided research cannot omit opposing orders or select a direction for a mixed batch.");
        assertTrue(vm.revertToState(clean));
        for (uint256 i; i < 9; ++i) _submitStored(otterKey, true, 1, 0, i, 0xA11CE, false);
        _close(otterKey, 0); _researchFailure(16, limit, "Bound one-sided research requires 1..8 original orders.");
        assertTrue(vm.revertToState(clean));
        for (uint256 i; i < 8; ++i) _submitStored(otterKey, true, 6, 0, i, 0xA11CE, false);
        _close(otterKey, 0); _researchFailure(64, limit, "Bound one-sided research exceeds the exhaustive vector work limit.");
    }

    function testFuzz_researchMatchesActualOriginalAndRemovalPivots(uint8 countSeed, uint8 budgetSeed, uint64 askSeed,
        bool down, bool sameTrader) public {
        uint256 n = bound(countSeed, 1, 3); uint256 budget = bound(budgetSeed, 1, 3);
        uint256 ask = bound(askSeed, 0, 2 * RESEARCH_WAD);
        for (uint256 i; i < n; ++i) _submitStored(otterKey, down, budget, ask, i,
            sameTrader || i % 2 == 0 ? 0xA11CE : 0xB0B, false);
        _close(otterKey, 0); _researchCheck(otterKey, 16);
    }

    // Separate Cartesian minimum oracle: no Node DP or welfare optimizer.
    function _visitMinimum(OtterOrderBook.Order[] memory orders, MinimumScan memory scan, uint256 depth,
        uint256 input, uint256 minimum, uint256 cost) private pure {
        ResearchScan memory a = scan.allocation;
        if (depth < a.indices.length) {
            OtterOrderBook.Order memory order = orders[a.indices[depth]];
            for (uint256 take; take <= order.budget; ++take) {
                a.amounts[depth] = take; uint256 term = order.ask * take;
                _visitMinimum(orders, scan, depth + 1, input + take, minimum + _ceilResearch(term), cost + term);
            }
            return;
        }
        ++scan.vectors; MinimumPoint memory previous = scan.points[input];
        bool wins = !scan.present[input] || minimum < previous.minimumPayment
            || (minimum == previous.minimumPayment && cost < previous.costNumerator);
        if (scan.present[input] && minimum == previous.minimumPayment && cost == previous.costNumerator)
            for (uint256 j; j < a.rank.length; ++j) {
                uint256 i = a.rank[j]; if (a.amounts[i] == previous.fill[i]) continue;
                wins = a.amounts[i] > previous.fill[i]; break;
            }
        if (wins) {
            uint256[] memory fill = new uint256[](a.amounts.length);
            for (uint256 i; i < fill.length; ++i) fill[i] = a.amounts[i];
            scan.points[input].fill = fill; scan.points[input].minimumPayment = minimum;
            scan.points[input].costNumerator = cost; scan.present[input] = true;
        }
    }

    function _assertMinimumCase(OtterOrderBook.Order[] memory orders, MinimumCase memory c, ResearchCase memory baseline,
        uint256[] memory outputs) private view {
        assertEq(c.kind, baseline.kind); assertEq(c.trader, baseline.trader); assertEq(c.ordersHash, baseline.ordersHash);
        assertEq(keccak256(abi.encode(c.indices)), keccak256(abi.encode(baseline.indices)));
        assertEq(keccak256(abi.encode(c.omittedIndices)), keccak256(abi.encode(baseline.omittedIndices)));
        MinimumScan memory scan; uint256 n = c.indices.length;
        scan.allocation.indices = c.indices; scan.allocation.rank = new uint256[](n); scan.allocation.amounts = new uint256[](n);
        uint256 budget; uint256 transitions; uint256 vectors = 1;
        for (uint256 i; i < n; ++i) {
            uint256 b = orders[c.indices[i]].budget; transitions += (budget + 1) * (b + 1); budget += b; vectors *= b + 1;
            scan.allocation.rank[i] = i;
        }
        for (uint256 i; i < n; ++i) for (uint256 j = i + 1; j < n; ++j) {
            OtterOrderBook.Order memory left = orders[c.indices[scan.allocation.rank[i]]];
            OtterOrderBook.Order memory right = orders[c.indices[scan.allocation.rank[j]]];
            if (right.ask < left.ask || (right.ask == left.ask && book.hashOrder(right) < book.hashOrder(left)))
                (scan.allocation.rank[i], scan.allocation.rank[j]) = (scan.allocation.rank[j], scan.allocation.rank[i]);
        }
        scan.points = new MinimumPoint[](budget + 1); scan.present = new bool[](budget + 1);
        _visitMinimum(orders, scan, 0, 0, 0, 0);
        assertEq(c.vectorCount, vectors); assertEq(c.vectorCount, scan.vectors); assertEq(c.dpTransitions, transitions);
        assertEq(c.points.length, budget + 1); bool positive;
        for (uint256 q; q <= budget; ++q) {
            assertTrue(scan.present[q]); MinimumPoint memory expected = scan.points[q]; MinimumPoint memory point = c.points[q];
            uint256 out = outputs[q]; uint256 shortfall = expected.minimumPayment > out ? expected.minimumPayment - out : 0;
            assertEq(point.totalInput, q); assertEq(point.output, out); assertEq(point.fill, expected.fill);
            assertEq(point.minimumPayment, expected.minimumPayment); assertEq(point.aggregateMinimumPayment, _ceilResearch(expected.costNumerator));
            assertEq(point.costNumerator, expected.costNumerator); assertEq(point.welfareNumerator, int256(out * RESEARCH_WAD) - int256(expected.costNumerator));
            assertEq(point.deficit, shortfall); assertEq(point.feasible, shortfall == 0);
            if (q > 0 && out > 0 && shortfall == 0) positive = true;
        }
        uint256 referenceMinimum;
        for (uint256 i; i < n; ++i) referenceMinimum += _ceilResearch(orders[c.indices[i]].ask * baseline.fill[i]);
        assertEq(c.researchInput, baseline.totalInput); assertEq(c.researchMinimumPayment, referenceMinimum);
        assertEq(c.researchMinimumDeficit, referenceMinimum > baseline.output ? referenceMinimum - baseline.output : 0);
        uint256 sameInputMinimum = scan.points[baseline.totalInput].minimumPayment;
        assertEq(c.sameInputMinimumPayment, sameInputMinimum); assertEq(c.sameInputFeasible, sameInputMinimum <= baseline.output);
        assertEq(c.positiveOutputAllocationExists, positive);
    }

    function _minimumCheck(PoolKey memory k, uint256 cap) private returns (MinimumResult memory r) {
        (ResearchResult memory baseline, bytes32 expectedResearchHash) = _researchCheck(k, cap);
        EpochFixture memory f = _batchFixture(k, 0, cap, address(this)); bytes32 researchHash; bytes32 minimumHash;
        (researchHash, minimumHash, r) = abi.decode(vm.ffi(_epochCommand("--minimum", abi.encode(f))), (bytes32, bytes32, MinimumResult));
        assertEq(researchHash, expectedResearchHash); assertEq(r.cases.length, baseline.cases.length);
        OtterOrderBook.Order[] memory orders = book.getOrders(PoolId.unwrap(k.toId()), 0);
        uint256[] memory outputs = new uint256[](baseline.originalInput + 1); OtterExecutionOracle oracle = new OtterExecutionOracle(manager);
        for (uint256 q; q < outputs.length; ++q) {
            OtterExecutionOracle.Quote memory quote = oracle.quoteExactInput(k, baseline.down, q, baseline.down ? f.downLimit : f.upLimit);
            assertEq(uint8(quote.status), uint8(OtterExecutionOracle.Status.Complete)); assertEq(quote.consumedInput, q); outputs[q] = quote.output;
        }
        for (uint256 c; c < r.cases.length; ++c) _assertMinimumCase(orders, r.cases[c], baseline.cases[c], outputs);
        assertEq(minimumHash, keccak256(abi.encode(keccak256("OtterSignedMinimumFrontier/v1"), researchHash, r)));
    }

    function test_minimumSplitPositiveAsksHaveNoPositiveOutputFeasibleFill() public {
        _submitStored(otterKey, true, 1, RESEARCH_WAD / 4, 0, 0xA11CE, false);
        _submitStored(otterKey, true, 1, RESEARCH_WAD / 4, 1, 0xA11CE, false); _close(otterKey, 0);
        MinimumCase memory c = _minimumCheck(otterKey, 8).cases[0];
        assertEq(c.points.length, 3); assertEq(c.points[1].minimumPayment, 1); assertEq(c.points[1].output, 0);
        assertEq(c.points[2].minimumPayment, 2); assertEq(c.points[2].output, 1);
        assertEq(c.researchMinimumDeficit, 1); assertFalse(c.sameInputFeasible); assertFalse(c.positiveOutputAllocationExists);
    }

    function test_minimumMergedRecordChangesDeliveryFeasibility() public {
        _submitStored(otterKey, true, 2, RESEARCH_WAD / 4, 0, 0xA11CE, false); _close(otterKey, 0);
        MinimumCase memory c = _minimumCheck(otterKey, 8).cases[0];
        assertEq(c.points[2].costNumerator, RESEARCH_WAD / 2); assertEq(c.points[2].minimumPayment, 1);
        assertTrue(c.sameInputFeasible); assertTrue(c.positiveOutputAllocationExists);
    }

    function test_minimumDeliveryFeasibilityDoesNotRepairPivotFunding() public {
        _submitStored(otterKey, true, 1, 0, 0, 0xA11CE, false);
        _submitStored(otterKey, true, 1, 0, 1, 0xA11CE, false); _close(otterKey, 0);
        (ResearchResult memory baseline,) = _researchCheck(otterKey, 8);
        MinimumCase memory c = _minimumCheck(otterKey, 8).cases[0];
        assertEq(c.researchMinimumDeficit, 0); assertTrue(c.positiveOutputAllocationExists); assertEq(baseline.recordCeilDeficit, 1);
    }

    function test_minimumMatchesActualNativeOriginalAndRemovalDomains() public {
        PoolKey memory k = _nativePool(SQRT_PRICE_1_1);
        _submitStored(k, true, 1, RESEARCH_WAD / 4, 0, 0xA11CE, false);
        _submitStored(k, true, 1, RESEARCH_WAD / 4, 1, 0xA11CE, false); _close(k, 0);
        MinimumCase memory c = _minimumCheck(k, 8).cases[0];
        assertEq(c.points[2].output, 1); assertEq(c.points[2].minimumPayment, 2); assertFalse(c.positiveOutputAllocationExists);
    }

    function test_minimumSameInputFeasibilityCanRequireHigherExactCostAllocation() public {
        PoolKey memory k = _nativePool(TickMath.getSqrtPriceAtTick(-6000));
        _submitStored(k, true, 1, RESEARCH_WAD / 10, 0, 0xA11CE, false);
        _submitStored(k, true, 2, 2 * RESEARCH_WAD / 5, 1, 0xA11CE, false); _close(k, 0);
        MinimumCase memory c = _minimumCheck(k, 8).cases[0];
        assertEq(c.researchInput, 2); assertEq(c.researchMinimumPayment, 2); assertEq(c.researchMinimumDeficit, 1);
        assertTrue(c.sameInputFeasible); assertEq(c.points[2].fill[0], 0); assertEq(c.points[2].fill[1], 2);
        assertEq(c.points[2].minimumPayment, 1); assertEq(c.points[2].costNumerator, 4 * RESEARCH_WAD / 5);
        assertEq(c.points[2].welfareNumerator, int256(RESEARCH_WAD / 5));
    }

    function _minimumFailure(uint256 cap, uint160 downLimit, string memory reason) private {
        EpochFixture memory f = _batchFixture(otterKey, 0, cap, address(this)); f.downLimit = downLimit;
        Vm.FfiResult memory result = vm.tryFfi(_epochCommand("--minimum", abi.encode(f)));
        assertNotEq(result.exitCode, 0); assertEq(result.stdout.length, 0);
        assertEq(string(result.stderr), string.concat("Epoch capture bridge failed: ", reason, "\n"));
    }

    function test_minimumMaximumBoundsAndRefusalCasesRemainExplicit() public {
        uint256 clean = vm.snapshotState(); uint160 limit = TickMath.getSqrtPriceAtTick(-1200);
        _submitStored(otterKey, false, 2, type(uint128).max, type(uint256).max, 0xA11CE, true); _close(otterKey, 0);
        MinimumCase memory c = _minimumCheck(otterKey, 8).cases[0]; assertLt(c.points[2].welfareNumerator, 0);
        assertTrue(vm.revertToState(clean));
        for (uint256 i; i < 8; ++i) _submitStored(otterKey, true, 1, RESEARCH_WAD / 4, i, 0xA11CE, false);
        _close(otterKey, 0); c = _minimumCheck(otterKey, 8).cases[0];
        assertEq(c.vectorCount, 256); assertEq(c.points.length, 9); assertFalse(c.positiveOutputAllocationExists);
        assertTrue(vm.revertToState(clean));
        string memory missing = "Original opening prefixes contain missing, unsupported or partially consumed inputs.";
        _submitStored(otterKey, true, 9, 0, 0, 0xA11CE, false); _close(otterKey, 0); _minimumFailure(8, limit, missing);
        assertTrue(vm.revertToState(clean));
        _submitStored(otterKey, true, 4, 0, 0, 0xA11CE, false); _close(otterKey, 0);
        _minimumFailure(8, SQRT_PRICE_1_1 - 1, missing); _minimumFailure(8, 0, missing); assertTrue(vm.revertToState(clean));
        _submitStored(otterKey, true, 1, 0, 0, 0xA11CE, false); _submitStored(otterKey, false, 1, 0, 1, 0xA11CE, false);
        _close(otterKey, 0); _minimumFailure(8, limit, "Bound one-sided research cannot omit opposing orders or select a direction for a mixed batch.");
        assertTrue(vm.revertToState(clean));
        for (uint256 i; i < 9; ++i) _submitStored(otterKey, true, 1, 0, i, 0xA11CE, false);
        _close(otterKey, 0); _minimumFailure(16, limit, "Bound one-sided research requires 1..8 original orders."); assertTrue(vm.revertToState(clean));
        for (uint256 i; i < 8; ++i) _submitStored(otterKey, true, 6, 0, i, 0xA11CE, false);
        _close(otterKey, 0); _minimumFailure(64, limit, "Bound one-sided research exceeds the exhaustive vector work limit.");
    }

    function testFuzz_minimumMatchesEveryActualOriginalAndRemovalQuantity(uint8 countSeed, uint8 budgetSeed,
        uint64 askSeed, bool down, bool sameTrader) public {
        uint256 n = bound(countSeed, 1, 3); uint256 budget = bound(budgetSeed, 1, 3);
        for (uint256 i; i < n; ++i) _submitStored(otterKey, down, budget, bound(uint256(askSeed) + i * 123456789, 0, 2 * RESEARCH_WAD),
            i, sameTrader || i % 2 == 0 ? 0xA11CE : 0xB0B, false);
        _close(otterKey, 0); _minimumCheck(otterKey, 16);
    }
}
