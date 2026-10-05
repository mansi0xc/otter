// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterExecutionOracle} from "../src/OtterExecutionOracle.sol";
import {OtterRewardLedger} from "../src/OtterRewardLedger.sol";
import {OtterRewardMath} from "../src/OtterRewardMath.sol";
import {IOtterLiquidityGuard} from "../src/interfaces/IOtterLiquidityGuard.sol";
import {OtterExecutionFixture} from "./utils/OtterExecutionFixture.sol";

/// @dev ONLY reward-composition test state, not an opening pool authenticator.
/// Real roster/policy authentication is exercised by OtterHistoricalRewards.
/// The candidate pivots below are not implemented in production settlement.
contract CompositionRewardBook {
    mapping(bytes32 => bool) public executionInProgress;
    mapping(bytes32 => uint256) public currentBatchId;
    mapping(bytes32 => mapping(uint256 => bool)) public payoutsCredited;
    mapping(bytes32 => mapping(uint256 => bytes32)) public snapshotHash;
    mapping(bytes32 => bytes32) public rewardPolicyHashOf;
    mapping(bytes32 => address) public currency0Of;
    mapping(bytes32 => address) public currency1Of;
    mapping(bytes32 => mapping(uint256 => uint256)) public openingRewardWeight;
    mapping(bytes32 => IOtterLiquidityGuard.PositionSnapshot[]) private positions;
    mapping(bytes32 => uint256[]) private weights;

    function setup(bytes32 id, address c0, address c1, bytes32 policy, uint256 weight) external {
        currency0Of[id] = c0;
        currency1Of[id] = c1;
        rewardPolicyHashOf[id] = policy;
        executionInProgress[id] = true;
        payoutsCredited[id][0] = true;
        snapshotHash[id][0] = bytes32(uint256(1));
        openingRewardWeight[id][0] = weight * 2;
        positions[id].push(IOtterLiquidityGuard.PositionSnapshot(1, address(0xA1), -887220, 887220, 20));
        positions[id].push(IOtterLiquidityGuard.PositionSnapshot(2, address(0xB1), -887220, 887220, 20));
        weights[id].push(weight);
        weights[id].push(weight);
    }

    function openingPositions(bytes32 id, uint256)
        external
        view
        returns (IOtterLiquidityGuard.PositionSnapshot[] memory)
    {
        return positions[id];
    }

    function openingRewardWeights(bytes32 id, uint256) external view returns (uint256[] memory) {
        return weights[id];
    }
}

contract OtterRewardCompositionTest is OtterExecutionFixture {
    address constant ALICE = address(0xA1);
    address constant BOB = address(0xB1);
    address constant COMMUNITY = address(0xD057);
    uint160 constant PRICE = uint160(3) << 95;
    bytes32 constant REWARD_POOL = bytes32(uint256(1));
    PoolKey k;
    OtterRewardLedger ledger;
    uint160 downLimit;
    uint160 upLimit;

    function _prepareComposition() private {
        k = _pool(60, PRICE);
        _add(k, -887220, 887220, 20, 1);
        _add(k, -887220, 887220, 20, 2);
        int24 tick = TickMath.getTickAtSqrtPrice(PRICE);
        downLimit = oracle.quoteExactInput(k, true, 8, TickMath.getSqrtPriceAtTick(tick - 20000)).sqrtPriceX96;
        upLimit = oracle.quoteExactInput(k, false, 18, TickMath.getSqrtPriceAtTick(tick + 20000)).sqrtPriceX96;
        uint256 w = _weight(PRICE, 20);
        assertEq(w, 58);
        CompositionRewardBook book = new CompositionRewardBook();
        ledger = new OtterRewardLedger(OtterOrderBook(address(book)));
        book.setup(
            REWARD_POOL,
            Currency.unwrap(currency0),
            Currency.unwrap(currency1),
            ledger.registerPool(REWARD_POOL, COMMUNITY),
            w
        );
        MockERC20(Currency.unwrap(currency1)).approve(address(ledger), type(uint256).max);
        MockERC20(Currency.unwrap(currency0)).transfer(ALICE, 8);
        MockERC20(Currency.unwrap(currency0)).transfer(BOB, 4);
    }

    function test_realV4FixedTablesRetainPartialCapacity() public {
        _prepareComposition();
        uint256[4] memory outputs = [uint256(0), 7, 13, 13];
        for (uint256 i; i < 4; ++i) {
            uint256 checkpoint = vm.snapshotState();
            OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, true, i * 4, downLimit);
            assertEq(q.output, outputs[i]);
            assertEq(q.consumedInput, i == 3 ? 8 : i * 4);
            assertEq(
                uint256(q.status),
                uint256(i == 3 ? OtterExecutionOracle.Status.PriceLimit : OtterExecutionOracle.Status.Complete)
            );
            assertTrue(vm.revertToState(checkpoint));
        }
        uint256[3] memory upOutputs = [uint256(3), 6, 6];
        for (uint256 i; i < 3; ++i) {
            uint256 checkpoint = vm.snapshotState();
            OtterExecutionOracle.Quote memory q = _quoteAndSwap(k, false, (i + 1) * 9, upLimit);
            assertEq(q.output, upOutputs[i]);
            assertEq(q.consumedInput, i == 2 ? 18 : (i + 1) * 9);
            assertTrue(vm.revertToState(checkpoint));
        }
    }

    /// @dev Independent two-seller Cartesian optimization. The fixed raw
    /// outputs are checked against actual v4 above, not a virtual-reserve curve.
    function _best(uint256 costA, uint256 capA, uint256 capB)
        private
        pure
        returns (uint256 a, uint256 b, int256 welfare)
    {
        uint256[3] memory outputs = [uint256(0), 7, 13];
        for (uint256 x; x <= capA; ++x) {
            for (uint256 y; y <= capB && x + y <= 2; ++y) {
                int256 value = int256(outputs[x + y]) - int256(costA * x + y);
                if (value > welfare || (value == welfare && x + y > a + b)) {
                    (a, b, welfare) = (x, y, value);
                }
            }
        }
    }

    function _pay(uint256 report) private pure returns (uint256 paymentA, uint256 paymentB, uint256 pot) {
        (uint256 a, uint256 b, int256 w) = _best(report, 2, 1);
        require(a == 1 && b == 1, "fixture allocation changed");
        (,, int256 withoutA) = _best(report, 0, 1);
        (,, int256 withoutB) = _best(report, 2, 0);
        paymentA = uint256(int256(report * a) + w - withoutA);
        paymentB = uint256(int256(b) + w - withoutB);
        pot = 13 - paymentA - paymentB;
    }

    function _run(uint256 report) private returns (uint256 walletGain, OtterExecutionOracle.Quote memory q) {
        MockERC20 input = MockERC20(Currency.unwrap(currency0));
        MockERC20 output = MockERC20(Currency.unwrap(currency1));
        uint256 beforeInput = input.balanceOf(ALICE);
        uint256 beforeOutput = output.balanceOf(ALICE);
        vm.prank(ALICE);
        input.transfer(address(this), 4);
        vm.prank(BOB);
        input.transfer(address(this), 4);
        q = _quoteAndSwap(k, true, 8, downLimit);
        assertEq(q.output, 13);
        (uint256 paymentA, uint256 paymentB, uint256 pot) = _pay(report);
        assertEq(paymentA, 6);
        assertGe(paymentA, 4); // A's TRUE reservation cost, even for false report 2.
        assertGe(paymentB, 1);
        output.transfer(ALICE, paymentA);
        output.transfer(BOB, paymentB);
        ledger.creditEpoch(REWARD_POOL, 0, 0, pot);
        assertEq(ledger.epochDust(REWARD_POOL, 0, address(output)), 1);
        assertEq(output.balanceOf(address(ledger)), ledger.totalClaimable(address(output)));
        uint256 reward = ledger.claimable(ALICE, address(output));
        vm.prank(ALICE);
        ledger.claim(address(output), reward, ALICE);
        assertEq(beforeInput - input.balanceOf(ALICE), 4);
        walletGain = output.balanceOf(ALICE) - beforeOutput;
    }

    function test_currentCashRewardsBreakComposedTruthfulnessEvenWithExactPivots() public {
        _prepareComposition();
        uint256 checkpoint = vm.snapshotState();
        (uint256 honest, OtterExecutionOracle.Quote memory truth) = _run(4);
        assertEq(honest, 7); // Payment 6 + LP claim 1; true trading cost 4.
        assertTrue(vm.revertToState(checkpoint));
        (uint256 fake, OtterExecutionOracle.Quote memory deviation) = _run(2);
        assertEq(fake, 8); // Payment 6 + LP claim 2; SAME true trading cost 4.
        assertEq(fake - honest, 1); // Whole token gain before transaction gas.
        assertEq(truth.consumedInput, deviation.consumedInput);
        assertEq(truth.output, deviation.output);
        assertEq(truth.sqrtPriceX96, deviation.sqrtPriceX96);
        assertEq(truth.tick, deviation.tick);
        assertEq(truth.liquidity, deviation.liquidity);
        // Same final price/range/L => same removable LP principal and fees.
        assertEq(_weight(truth.sqrtPriceX96, 20), _weight(deviation.sqrtPriceX96, 20));
    }

    function _weight(uint160 price, uint128 liquidity) private pure returns (uint256) {
        return
            OtterRewardMath.weight(price, IOtterLiquidityGuard.PositionSnapshot(1, ALICE, -887220, 887220, liquidity));
    }

    function testFuzz_sameRangeSplitCannotIncreaseControlledCash(
        uint88 x,
        uint88 y,
        int24 rawTick,
        uint96 rawPot,
        uint88 other
    ) public pure {
        // Bounds are local to the conditional math property; no change to any
        // production admission rule, range policy or fee/principal accounting.
        uint160 price = TickMath.getSqrtPriceAtTick(int24(int256(rawTick) % 400001));
        uint256 a = _weight(price, uint128(x) + 1);
        uint256 b = _weight(price, uint128(y) + 1);
        uint256 merged = _weight(price, uint128(x) + uint128(y) + 2);
        uint256 stranger = uint256(other) + 1;
        assertGe(merged, a + b);
        uint256 mergedReward = FullMath.mulDiv(rawPot, merged, merged + stranger);
        uint256 splitReward =
            FullMath.mulDiv(rawPot, a, a + b + stranger) + FullMath.mulDiv(rawPot, b, a + b + stranger);
        assertLe(splitReward, mergedReward);
        uint256 otherBefore = FullMath.mulDiv(rawPot, stranger, merged + stranger);
        uint256 otherAfter = FullMath.mulDiv(rawPot, stranger, a + b + stranger);
        assertGe(otherAfter, otherBefore);
        // Owner + community dust = pot - other owners' claims.
        assertLe(uint256(rawPot) - otherAfter, uint256(rawPot) - otherBefore);
    }
}
