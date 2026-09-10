// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {OtterHook, OtterPoolMath} from "../src/OtterHook.sol";
import {OtterMath} from "../src/OtterMath.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {HookMiner} from "./utils/HookMiner.sol";

interface IERC20H {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice The demo, as a measurement.
///
/// Identical liquidity, identical price, identical victim order. On a plain v4
/// pool a searcher front-runs and back-runs it for risk-free profit. On the Otter
/// pool the same searcher cannot place a swap at all, and the best it can do is
/// join the batch — where its order executes at the pre-batch spot price, so
/// there is no "before" and "after" to extract value between.
///
/// A zero-fee sandwich has NO OPTIMAL SIZE. Profit rises monotonically with the
/// searcher's capital and asymptotes to the victim's ENTIRE input: 9.5% of it at
/// 1x the victim's size, 75% at 20x, 97% at 100x. Extraction is bounded by the
/// attacker's balance sheet, not by the curve. (With a non-zero LP fee there is an
/// interior optimum, because fees on both legs eventually dominate — one more way
/// the zero-fee comparison flatters the attacker.)
///
/// So this harness does not search for "the" sandwich. It sweeps capital and
/// reports extraction as a function of it, which is the honest shape of the
/// threat — and the shape Otter flattens to zero at every level.
///
/// Caveat stated up front: both pools are zero-fee, because Otter requires it (a
/// non-zero LP fee makes the realised swap diverge from F~ and breaks curve
/// conservation). Zero fee FLATTERS the attacker — on a 0.30% pool the searcher
/// would pay fees on both legs and net less. The comparison is therefore an upper
/// bound on extraction, not a typical one, and the README should say so.
contract SandwichHarness is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    OtterOrderBook book;
    OtterSettlement settlement;
    OtterHook hook;
    address burnSink = address(0xB0F1);
    uint64 constant WINDOW = 60;

    PoolKey vanillaKey;
    PoolId vanillaId;
    PoolKey otterKey;
    PoolId otterId;

    int24 constant LO = -887272;
    int24 constant HI = 887272;
    uint128 constant LIQUIDITY = 1e21;

    /// the trade being attacked: ~5% price impact
    uint256 constant VICTIM_SIZE = 5e19;
    /// What the searcher brings to the batch when it cannot swap directly.
    /// Deliberately SMALLER than the victim's order: if the two matched exactly,
    /// M would cover the whole victim order, the pool would never be touched, and
    /// the demo would be showing coincidence of wants rather than the mechanism.
    uint256 constant BOT_BATCH_SIZE = 1e19;

    /// A second seller on the dominant side, used only by the surplus test.
    uint256 constant RIVAL_SIZE = 3e19;

    uint256 victimPk = 0xF1CE;
    uint256 botPk = 0xB07;
    uint256 rivalPk = 0xB1;
    address victim;
    address bot;
    address rival;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        book = new OtterOrderBook(WINDOW);
        settlement = new OtterSettlement(manager, book, burnSink);
        book.setSettlement(address(settlement));

        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            uint160(Hooks.BEFORE_SWAP_FLAG),
            type(OtterHook).creationCode,
            abi.encode(manager, address(settlement))
        );
        hook = new OtterHook{salt: salt}(manager, address(settlement));
        assertEq(address(hook), predicted);

        (vanillaKey, vanillaId) = initPool(currency0, currency1, IHooks(address(0)), 0, 1, SQRT_PRICE_1_1);
        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        _addLiquidity(vanillaKey);
        _addLiquidity(otterKey);

        victim = vm.addr(victimPk);
        bot = vm.addr(botPk);
        rival = vm.addr(rivalPk);
    }

    function _addLiquidity(PoolKey memory k) internal {
        modifyLiquidityRouter.modifyLiquidity(
            k,
            IPoolManager.ModifyLiquidityParams({
                tickLower: LO,
                tickUpper: HI,
                liquidityDelta: int256(uint256(LIQUIDITY)),
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _fund(Currency c, address who, uint256 amount) internal {
        address token = Currency.unwrap(c);
        deal(token, who, amount);
        vm.prank(who);
        IERC20H(token).approve(address(settlement), type(uint256).max);
    }

    /// exact-input swap by this contract, returns the output received
    function _swap(PoolKey memory k, bool zeroForOne, uint256 amountIn) internal returns (uint256 out) {
        Currency outC = zeroForOne ? currency1 : currency0;
        uint256 before = IERC20H(Currency.unwrap(outC)).balanceOf(address(this));
        swapRouter.swap(
            k,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
        out = IERC20H(Currency.unwrap(outC)).balanceOf(address(this)) - before;
    }

    /// Front-run `frontSize`, let the victim through, back-run everything acquired.
    /// Returns the searcher's currency0 profit and the victim's realised output.
    function _runSandwich(uint256 frontSize) internal returns (int256 botProfit, uint256 victimOut) {
        uint256 acquired = _swap(vanillaKey, true, frontSize);
        victimOut = _swap(vanillaKey, true, VICTIM_SIZE);
        uint256 returned = _swap(vanillaKey, false, acquired);
        botProfit = int256(returned) - int256(frontSize);
    }

    // ------------------------------------------------------------------

    function test_sandwichComparison() public {
        // ---- 1. what the victim gets with nobody attacking -------------
        uint256 snap = vm.snapshotState();
        uint256 fairOut = _swap(vanillaKey, true, VICTIM_SIZE);
        vm.revertToState(snap);

        // ---- 2. search the searcher's optimal front-run ----------------
        // Searcher capital, as a multiple of the victim's trade. Bounded by the
        // balance sheet, not by any optimum — see the note at the top.
        uint256[6] memory candidates = [
            VICTIM_SIZE,
            VICTIM_SIZE * 4,
            VICTIM_SIZE * 8,
            VICTIM_SIZE * 20,
            VICTIM_SIZE * 50,
            VICTIM_SIZE * 100
        ];

        int256 bestProfit = type(int256).min;
        uint256 bestFront;
        uint256 victimUnderAttack;
        int256 prevProfit = type(int256).min;

        console2.log("--- vanilla pool: extraction vs searcher capital ---");
        console2.log("capital / searcher profit / victim output / pct of victim trade");
        for (uint256 i; i < candidates.length; ++i) {
            snap = vm.snapshotState();
            (int256 profit, uint256 vOut) = _runSandwich(candidates[i]);
            vm.revertToState(snap);

            console2.log(candidates[i], vOut, uint256(profit) * 100 / VICTIM_SIZE);
            console2.logInt(profit);

            // No interior optimum on a zero-fee pool: more capital is always more
            // extraction. If this ever stops holding, the curve assumption broke.
            assertGt(profit, prevProfit, "extraction must rise monotonically with capital");
            prevProfit = profit;

            if (profit > bestProfit) {
                bestProfit = profit;
                bestFront = candidates[i];
                victimUnderAttack = vOut;
            }
        }

        assertGt(bestProfit, 0, "no profitable sandwich found: the demo has no attack to show");

        // ---- 3. the same victim order through Otter --------------------
        // The searcher cannot swap at ANY capital level: the hook rejects anything
        // not coming from settlement. expectRevert must attach to the swap itself,
        // so this cannot go through the _swap helper — that reads a balance first,
        // and the cheatcode would bind to the balanceOf call instead.
        for (uint256 i; i < candidates.length; ++i) {
            vm.expectRevert();
            swapRouter.swap(
                otterKey,
                IPoolManager.SwapParams({
                    zeroForOne: true,
                    amountSpecified: -int256(candidates[i]),
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ZERO_BYTES
            );
        }

        // Its only remaining move is to join the batch, where its order clears at
        // the pre-batch spot price.
        uint256 otterOut = _settleVictimBatchWithBot();

        // ---- 4. report --------------------------------------------------
        uint256 victimLoss = fairOut - victimUnderAttack;

        console2.log("========================================");
        console2.log("victim sells (currency0)     ", VICTIM_SIZE);
        console2.log("");
        console2.log("VANILLA v4 POOL  (searcher at max capital tested)");
        console2.log("  fair output (no attack)    ", fairOut);
        console2.log("  searcher capital           ", bestFront);
        console2.log("  searcher profit (currency0)");
        console2.logInt(bestProfit);
        console2.log("  victim output under attack ", victimUnderAttack);
        console2.log("  victim loss                ", victimLoss);
        console2.log("  loss as pct of trade       ", victimLoss * 100 / VICTIM_SIZE);
        console2.log("");
        console2.log("OTTER POOL");
        console2.log("  searcher swap: REVERTED at every capital level tested");
        console2.log("  victim output              ", otterOut);
        console2.log("  burn to LPs                ", IERC20H(Currency.unwrap(currency1)).balanceOf(burnSink));
        console2.log("========================================");

        assertGt(otterOut, victimUnderAttack, "Otter must beat the sandwiched price");
    }

    /// Victim sells currency0 (dominant). Searcher joins selling currency1, which
    /// fills in full at the INITIAL spot price — the pre-batch price, not a price
    /// its own front-run created. That is where the sandwich dies.
    function _settleVictimBatchWithBot() internal returns (uint256 victimOut) {
        _fund(currency0, victim, VICTIM_SIZE);
        _fund(currency1, bot, BOT_BATCH_SIZE);

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        orders[0] = _mkOrder(victim, true, VICTIM_SIZE);
        orders[1] = _mkOrder(bot, false, BOT_BATCH_SIZE);
        sigs[0] = _sign(victimPk, orders[0]);
        sigs[1] = _sign(botPk, orders[1]);

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        (uint160 p,,,) = manager.getSlot0(otterId);
        uint128 liq = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, liq);
        OtterMath.Curve memory c = OtterMath.Curve({x0: r1, y0: r0, M: 0});
        c.M = (c.y0 * BOT_BATCH_SIZE) / c.x0;

        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = VICTIM_SIZE;
        x[0] = OtterMath.fTildeSettleable(c, VICTIM_SIZE);
        y[1] = BOT_BATCH_SIZE;
        x[1] = (c.y0 * BOT_BATCH_SIZE) / c.x0;

        settlement.settle(
            otterKey, batchId, orders, OtterSettlement.Outcome({dominantSellsCurrency0: true, y: y, x: x})
        );

        victimOut = IERC20H(Currency.unwrap(currency1)).balanceOf(victim);

        // The searcher's round trip: it gave up BOT_BATCH_SIZE of currency1 and
        // received x[1] of currency0, priced at the pre-batch spot. Valued back at
        // that same spot it is a wash, which is the point.
        uint256 botGot = IERC20H(Currency.unwrap(currency0)).balanceOf(bot);
        uint256 botGaveValuedAtSpot = (c.y0 * BOT_BATCH_SIZE) / c.x0;
        console2.log("  searcher batch round-trip: got", botGot, "spot-equivalent", botGaveValuedAtSpot);
        assertLe(botGot, botGaveValuedAtSpot, "searcher must not profit from joining the batch");
    }

    function _mkOrder(address trader, bool sellsC0, uint256 budget)
        internal
        view
        returns (OtterOrderBook.Order memory)
    {
        return OtterOrderBook.Order({
            trader: trader,
            poolId: PoolId.unwrap(otterId),
            sellingCurrency0: sellsC0,
            ask: 0,
            budget: budget,
            deadline: block.timestamp + 1 days,
            nonce: 0
        });
    }

    function _sign(uint256 pk, OtterOrderBook.Order memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(o));
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------
    // surplus redistribution
    // ------------------------------------------------------------------

    /// The burn is the Clarke pivot surplus, and it only exists when there is
    /// COMPETITION on the dominant side. With a single seller, that seller's
    /// marginal contribution is the entire welfare and it is paid all of it —
    /// which is why the comparison above shows a zero burn and should.
    ///
    /// With two sellers each is paid F~(Y) - F~(Y - y_i), so together they receive
    /// 2F~(Y) - F~(y1) - F~(y2) and the pool retains
    ///     F~(y1) + F~(y2) - F~(Y)
    /// which is strictly positive because F~ is concave with F~(0) = 0 — the same
    /// subadditivity that makes Theorem 12(c) redundant (CORRECTIONS.md C7).
    /// That residue is the redistributed surplus. It is the thing that separates
    /// Otter from a uniform-clearing-price batch AMM, and it is what the burn
    /// counter in the demo should be showing.
    function test_surplusRedistribution() public {
        _fund(currency0, victim, VICTIM_SIZE);
        _fund(currency0, rival, RIVAL_SIZE);

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        orders[0] = _mkOrder(victim, true, VICTIM_SIZE);
        orders[1] = _mkOrder(rival, true, RIVAL_SIZE);
        sigs[0] = _sign(victimPk, orders[0]);
        sigs[1] = _sign(rivalPk, orders[1]);

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        (uint160 p,,,) = manager.getSlot0(otterId);
        uint128 liq = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, liq);
        OtterMath.Curve memory c = OtterMath.Curve({x0: r1, y0: r0, M: 0}); // no minority side

        uint256 total = VICTIM_SIZE + RIVAL_SIZE;
        uint256 available = OtterMath.fTildeSettleable(c, total);

        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = VICTIM_SIZE;
        y[1] = RIVAL_SIZE;
        // Clarke pivot with ask 0: x_i = F~(Y) - F~(Y - y_i)
        x[0] = available - OtterMath.fTildeUp(c, total - VICTIM_SIZE);
        x[1] = available - OtterMath.fTildeUp(c, total - RIVAL_SIZE);

        settlement.settle(
            otterKey, batchId, orders, OtterSettlement.Outcome({dominantSellsCurrency0: true, y: y, x: x})
        );

        uint256 burn = IERC20H(Currency.unwrap(currency1)).balanceOf(burnSink);

        // The burn has two components and they should be reported separately.
        //
        //   mechanism surplus = F~(Y) - sum x*_i, the welfare no bidder's marginal
        //                       contribution claimed. This is the redistribution
        //                       the paper is about.
        //   allowance residue = the part of the discretisation allowance v4 did
        //                       not actually consume. The allowance is sized ~3x
        //                       the measured gap (CORRECTIONS.md C10), so most of
        //                       it falls through to the burn on every batch.
        //
        // Conflating them would make the redistribution look larger than it is.
        uint256 mechanismSurplus = available - x[0] - x[1];
        uint256 allowance = OtterMath.discretisationAllowance(c, total);
        uint256 residue = burn - mechanismSurplus;

        console2.log("--- surplus redistribution (two competing sellers) ---");
        console2.log("  total sold          ", total);
        console2.log("  F~(Y) available     ", available);
        console2.log("  paid to victim      ", x[0]);
        console2.log("  paid to rival       ", x[1]);
        console2.log("  burn to LPs         ", burn);
        console2.log("    mechanism surplus ", mechanismSurplus);
        console2.log("    allowance residue ", residue);
        console2.log("  allowance budgeted  ", allowance);
        console2.log("  v4 gap consumed     ", allowance - residue);
        console2.log("  surplus as ppm      ", mechanismSurplus * 1e6 / total);

        assertGt(mechanismSurplus, 0, "competition on the dominant side must leave surplus");
        assertGe(burn, mechanismSurplus, "burn cannot fall below the unallocated welfare");
        assertLe(residue, allowance, "residue cannot exceed the allowance that produced it");
    }
}

