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
/// This harness reports TWO different numbers for the vanilla pool, and they
/// answer different questions:
///
/// CEILING (unrealistic). A zero-fee sandwich against a victim with no slippage
/// protection has NO OPTIMAL SIZE — profit rises monotonically with the
/// searcher's capital and asymptotes to the victim's ENTIRE input: 9% of it at
/// 1x the victim's size, 75% at 20x, 97% at 100x. This number requires assuming
/// the victim would accept literally any execution price, which no real wallet
/// defaults to. It is included because it is the honest upper bound on the
/// threat, not because it is what a sandwich nets in practice.
///
/// REALISTIC (slippage-protected). A searcher who pushes price past the
/// victim's actual tolerance gets a REVERTED victim transaction, not a bigger
/// sandwich — there is nothing to back-run. At the tolerances real wallets and
/// routers actually use (0.5% / 1% / 5%, all measured against the victim's
/// ALREADY-price-impacted quote, not some hypothetical impact-free execution),
/// the searcher's extraction is bounded by roughly that same tolerance — a
/// fraction of a percent of the trade, not 97% of it. This is the number that
/// describes an actual sandwich against an actual careful trader.
///
/// Both numbers are computed and reported. Leading with the ceiling number alone
/// — as an earlier version of this harness did — invites exactly the objection
/// it deserves: nobody trades with unlimited slippage, so a 97% headline number
/// measures a strawman, not the threat.
///
/// Otter beats BOTH numbers, at every tolerance tested, and (see the assertions
/// at the end of the test) beats the completely unattacked fairOut too — the
/// mechanism doesn't just avoid losing to a sandwich, it gives this particular
/// victim a curve strictly better than the one a lone AMM trade would apply
/// throughout. The reason why is explained where it happens, in
/// `test_sandwichComparison`'s final section, not asserted here.
///
/// Caveat stated up front: both pools are zero-fee, because Otter requires it (a
/// non-zero LP fee makes the realised swap diverge from F~ and breaks curve
/// conservation). Zero fee FLATTERS the attacker in both scenarios above — on a
/// 0.30% pool the searcher would pay fees on both legs and net less. The
/// comparison is therefore an upper bound on extraction in both cases, not a
/// typical one, and the README should say so.
contract SandwichHarness is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    OtterOrderBook book;
    OtterSettlement settlement;
    OtterHook hook;
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

        book = new OtterOrderBook(WINDOW, 900);
        settlement = new OtterSettlement(manager, book, address(this), 300);
        book.setSettlement(address(settlement));

        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG),
            type(OtterHook).creationCode,
            abi.encode(manager, address(settlement))
        );
        hook = new OtterHook{salt: salt}(manager, address(settlement));
        assertEq(address(hook), predicted);
        settlement.setApprovedHook(address(hook));

        (vanillaKey, vanillaId) = initPool(currency0, currency1, IHooks(address(0)), 0, 1, SQRT_PRICE_1_1);
        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(otterKey);
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
        IERC20H(token).approve(address(book), type(uint256).max);
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

    /// Victim's output for a given front-run size, in isolation (state reverted
    /// after). Used as the monotone function the tolerance search below climbs.
    function _victimOutForFront(uint256 frontSize) internal returns (uint256 victimOut) {
        uint256 snap = vm.snapshotState();
        _swap(vanillaKey, true, frontSize);
        victimOut = _swap(vanillaKey, true, VICTIM_SIZE);
        vm.revertToState(snap);
    }

    /// @notice The realistic version of "the searcher's optimal front-run": the
    ///         largest front-run that still lets the victim's trade clear at or
    ///         above `minOut`.
    ///
    /// A searcher who pushes the price past the victim's slippage limit does not
    /// get a bigger sandwich — they get a REVERTED victim transaction and no
    /// back-run to fund from, which is why every real wallet defaults to some
    /// non-zero tolerance and every serious searcher respects it. Modelling
    /// extraction as unconstrained by that limit (the ceiling search above) is
    /// the strawman version of this attack; this is the realistic one.
    ///
    /// Binary search relies on `victimOut` being non-increasing in `frontSize`,
    /// which holds for any front-run in the same direction as the victim on a
    /// monotone AMM curve — asserted at `hi` rather than assumed.
    function _maxFrontRunWithinTolerance(uint256 minOut)
        internal
        returns (uint256 frontSize, int256 profit, uint256 victimOut)
    {
        uint256 lo = 0;
        uint256 hi = VICTIM_SIZE; // see the note at VICTIM_SIZE: already ~5% impact alone
        assertLt(_victimOutForFront(hi), minOut, "search bound too small: raise hi");

        for (uint256 i; i < 40; ++i) {
            uint256 mid = (lo + hi) / 2;
            if (_victimOutForFront(mid) >= minOut) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        frontSize = lo;
        uint256 snap = vm.snapshotState();
        (profit, victimOut) = _runSandwich(frontSize);
        vm.revertToState(snap);
    }

    /// Realistic slippage tolerances a wallet or router would actually set,
    /// in basis points, relative to `fairOut` — i.e. on top of the victim's OWN
    /// price impact, which `fairOut` already reflects and the trader already
    /// accepted when they saw the quote. 50 = the common wallet default (0.5%);
    /// 100 = a looser default (1%); 500 = a deliberately generous one (5%),
    /// included specifically so the ceiling comparison below isn't cherry-picked
    /// to make Otter look better than a merely-careless victim would find it.
    uint16[3] internal TOLERANCE_BPS = [uint16(50), uint16(100), uint16(500)];

    function test_sandwichComparison() public {
        // ---- 1. what the victim gets with nobody attacking -------------
        uint256 snap = vm.snapshotState();
        uint256 fairOut = _swap(vanillaKey, true, VICTIM_SIZE);
        vm.revertToState(snap);

        // ---- 2a. UNREALISTIC CEILING: victim has no slippage protection ----
        // Searcher capital, as a multiple of the victim's trade. Bounded by the
        // balance sheet, not by any optimum — see the note at the top. This
        // requires a victim who will accept literally any execution price,
        // which no real wallet defaults to and no careful trader would set.
        // It is included as the theoretical ceiling, not as what a sandwich
        // actually nets against a protected trade — see 2b for that.
        uint256[6] memory candidates = [
            VICTIM_SIZE,
            VICTIM_SIZE * 4,
            VICTIM_SIZE * 8,
            VICTIM_SIZE * 20,
            VICTIM_SIZE * 50,
            VICTIM_SIZE * 100
        ];

        int256 ceilingProfit = type(int256).min;
        uint256 ceilingFront;
        uint256 ceilingVictimOut;
        int256 prevProfit = type(int256).min;

        console2.log("--- ceiling (NO slippage protection): extraction vs searcher capital ---");
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

            if (profit > ceilingProfit) {
                ceilingProfit = profit;
                ceilingFront = candidates[i];
                ceilingVictimOut = vOut;
            }
        }

        assertGt(ceilingProfit, 0, "no profitable sandwich found: the demo has no attack to show");

        // ---- 2b. REALISTIC: victim protected by an actual slippage tolerance --
        // The searcher's real constraint: push the price further than this and
        // the victim's transaction reverts instead of executing worse. No
        // completed victim trade means no acquired tokens to back-run, so a
        // searcher aware of the tolerance has no reason to exceed it.
        uint256[3] memory tolFront;
        int256[3] memory tolProfit;
        uint256[3] memory tolVictimOut;

        console2.log("");
        console2.log("--- realistic (slippage-protected): extraction at each tolerance ---");
        console2.log("tolerance bps / searcher capital / searcher profit / victim output");
        for (uint256 i; i < TOLERANCE_BPS.length; ++i) {
            uint256 minOut = fairOut - (fairOut * TOLERANCE_BPS[i]) / 10_000;
            (uint256 front, int256 profit, uint256 vOut) = _maxFrontRunWithinTolerance(minOut);
            tolFront[i] = front;
            tolProfit[i] = profit;
            tolVictimOut[i] = vOut;

            console2.log(TOLERANCE_BPS[i], front, uint256(profit > 0 ? profit : int256(0)));
            console2.log("  victim output", vOut);

            // The searcher is not made WORSE off by a tighter tolerance forcing a
            // smaller front-run — it simply cannot extract as much. Profit should
            // be non-decreasing as tolerance widens (same monotonicity as 2a).
            if (i > 0) {
                assertGe(tolProfit[i], tolProfit[i - 1], "wider tolerance must allow at least as much extraction");
            }
        }

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
        (uint256 otterOut, uint256 m) = _settleVictimBatchWithBot();

        // ---- 4. report --------------------------------------------------
        uint256 ceilingLoss = fairOut - ceilingVictimOut;

        console2.log("");
        console2.log("========================================");
        console2.log("victim sells (currency0)     ", VICTIM_SIZE);
        console2.log("fair output (no attack)      ", fairOut);
        console2.log("");
        console2.log("VANILLA v4 POOL");
        console2.log("  [ceiling, unrealistic: no slippage protection]");
        console2.log("    searcher capital          ", ceilingFront);
        console2.log("    searcher profit (currency0)");
        console2.logInt(ceilingProfit);
        console2.log("    victim output             ", ceilingVictimOut);
        console2.log("    loss as pct of trade      ", ceilingLoss * 100 / VICTIM_SIZE);
        console2.log("  [realistic, slippage-protected]");
        for (uint256 i; i < TOLERANCE_BPS.length; ++i) {
            console2.log("    tolerance (bps)           ", TOLERANCE_BPS[i]);
            console2.log("      searcher capital        ", tolFront[i]);
            console2.log("      victim output           ", tolVictimOut[i]);
        }
        console2.log("");
        console2.log("OTTER POOL");
        console2.log("  searcher swap: REVERTED at every capital level tested");
        console2.log("  victim output               ", otterOut);
        console2.log("  burn to LPs                 ", settlement.pendingSurplus(otterId, currency1));
        console2.log("========================================");

        // ---- 5. why Otter's victim gets MORE than fairOut, not just "not less"
        //
        // fairOut is a plain constant-product swap of the WHOLE VICTIM_SIZE:
        // marginal price degrades from the first unit sold. otterOut instead
        // comes from F~_M, the augmented curve, which clears the first M units
        // at the pre-batch SPOT price and only applies curve pricing beyond that
        // — M being the size the bot's counter-order can absorb at spot. Since
        // the victim here is the ONLY dominant-side seller, its Clarke pivot
        // payment is its entire marginal contribution: F~(VICTIM_SIZE), i.e. it
        // is paid AS IF it were the only trade against this exact curve, and
        // that curve is weakly better than the plain AMM curve at every point
        // (concavity) — strictly better here because M > 0. This is not
        // rounding noise or a mispriced edge case; it is the mechanism working
        // exactly as designed for whatever fraction of a trade a batch's
        // opposite side can actually absorb at spot.
        console2.log("");
        console2.log("why otterOut > fairOut:");
        console2.log("  spot-cleared portion (M)    ", m);
        console2.log("  M as pct of victim trade    ", m * 100 / VICTIM_SIZE);
        console2.log("  remainder priced by curve   ", VICTIM_SIZE - m);
        assertGt(otterOut, fairOut, "the spot-cleared portion should make Otter strictly beat a plain AMM swap here");

        assertGt(otterOut, ceilingVictimOut, "Otter must beat even the ceiling-attacked price");
        for (uint256 i; i < TOLERANCE_BPS.length; ++i) {
            assertGt(otterOut, tolVictimOut[i], "Otter must beat every slippage-protected realistic price too");
        }

        // The demo page reads victimSize/fairOut/sandwichedOut/otterOut/
        // searcherCapital/searcherProfit/victimLoss — kept as the ceiling numbers
        // for backward compatibility with the existing page. `realistic` is new
        // and not yet consumed there.
        string memory realisticJson = "[";
        for (uint256 i; i < TOLERANCE_BPS.length; ++i) {
            realisticJson = string.concat(
                realisticJson,
                i == 0 ? "" : ",",
                '\n    { "bps": ', vm.toString(uint256(TOLERANCE_BPS[i])),
                ', "searcherCapital": ', vm.toString(tolFront[i]),
                ', "searcherProfit": ', vm.toString(uint256(tolProfit[i] > 0 ? tolProfit[i] : int256(0))),
                ', "victimOut": ', vm.toString(tolVictimOut[i]),
                " }"
            );
        }
        realisticJson = string.concat(realisticJson, "\n  ]");

        vm.writeFile(
            "../harness/results/sandwich.json",
            string.concat(
                '{\n  "victimSize": ', vm.toString(VICTIM_SIZE),
                ',\n  "fairOut": ', vm.toString(fairOut),
                ',\n  "sandwichedOut": ', vm.toString(ceilingVictimOut),
                ',\n  "otterOut": ', vm.toString(otterOut),
                ',\n  "searcherCapital": ', vm.toString(ceilingFront),
                ',\n  "searcherProfit": ', vm.toString(uint256(ceilingProfit)),
                ',\n  "victimLoss": ', vm.toString(ceilingLoss),
                ',\n  "spotClearedM": ', vm.toString(m),
                ',\n  "realistic": ', realisticJson,
                '\n}\n'
            )
        );
    }

    /// Victim sells currency0 (dominant). Searcher joins selling currency1, which
    /// fills in full at the INITIAL spot price — the pre-batch price, not a price
    /// its own front-run created. That is where the sandwich dies.
    /// @return victimOut what the victim actually receives.
    /// @return m the dominant-side spot-clearing capacity created by the bot's
    ///         order (in the victim's sold token) — see the explanation in
    ///         `test_sandwichComparison` for why this is what makes `victimOut`
    ///         come out ABOVE `fairOut`.
    function _settleVictimBatchWithBot() internal returns (uint256 victimOut, uint256 m) {
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
        m = c.M;

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

        uint256 burn = settlement.pendingSurplus(otterId, currency1);

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
