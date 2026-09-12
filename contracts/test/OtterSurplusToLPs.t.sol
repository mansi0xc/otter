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

import {OtterHook, OtterPoolMath} from "../src/OtterHook.sol";
import {OtterMath} from "../src/OtterMath.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {HookMiner} from "./utils/HookMiner.sol";

interface IERC20S {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Where the surplus actually goes.
///
/// The paper permits several destinations for the redistributed surplus and
/// lists LP rewards first (§1.1, §3.6). Paying it to an address chosen at
/// deployment satisfies the theorems and achieves nothing: the guarantee that
/// matters is only that the payment is outcome-independent, and an EOA clears
/// that bar as easily as the pool does. Paying it to the pool's LPs is the
/// destination that makes the next batch cheaper to trade against, which is the
/// mechanism's own stated reason for redistributing at all.
///
/// Three things need to be true for that to be honest, and each is a test here:
///   1. the surplus reaches LPs, in full;
///   2. a batch never donates its own surplus, only an earlier batch's, so no
///      bidder's payout can be a function of its own report (Theorem 22);
///   3. donating does not move the curve the next batch will be priced on.
contract OtterSurplusToLPsTest is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    OtterOrderBook book;
    OtterSettlement settlement;
    OtterHook hook;

    uint64 constant WINDOW = 60;

    uint256 domPk = 0xD0;
    uint256 minPk = 0xD1;
    address dom;
    address min;

    PoolKey otterKey;
    PoolId otterId;

    int24 constant TICK_LOWER = -887272;
    int24 constant TICK_UPPER = 887272;
    int256 constant LIQUIDITY = 1e21;

    uint256 constant DOM_BUDGET = 10e18;
    uint256 constant MIN_BUDGET = 2e18;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        book = new OtterOrderBook(WINDOW);
        settlement = new OtterSettlement(manager, book);
        book.setSettlement(address(settlement));

        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            uint160(Hooks.BEFORE_SWAP_FLAG),
            type(OtterHook).creationCode,
            abi.encode(manager, address(settlement))
        );
        hook = new OtterHook{salt: salt}(manager, address(settlement));
        assertEq(address(hook), predicted);

        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(otterKey);
        _modifyLiquidity(LIQUIDITY);

        dom = vm.addr(domPk);
        min = vm.addr(minPk);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _modifyLiquidity(int256 delta) internal {
        modifyLiquidityRouter.modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: delta,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    /// @dev A zero-delta `modifyLiquidity` collects accrued fees without touching
    ///      the position, so the balance change it produces is exactly what the
    ///      LP has earned. This is how the donation is observed.
    function _collectFees() internal returns (uint256 got0, uint256 got1) {
        uint256 b0 = IERC20S(Currency.unwrap(currency0)).balanceOf(address(this));
        uint256 b1 = IERC20S(Currency.unwrap(currency1)).balanceOf(address(this));
        _modifyLiquidity(0);
        got0 = IERC20S(Currency.unwrap(currency0)).balanceOf(address(this)) - b0;
        got1 = IERC20S(Currency.unwrap(currency1)).balanceOf(address(this)) - b1;
    }

    function _fund(Currency c, address who, uint256 amount) internal {
        address token = Currency.unwrap(c);
        deal(token, who, amount);
        vm.prank(who);
        IERC20S(token).approve(address(book), type(uint256).max);
    }

    function _curve() internal view returns (OtterMath.Curve memory c) {
        (uint160 p,,,) = manager.getSlot0(otterId);
        uint128 L = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, L);
        c = OtterMath.Curve({x0: r1, y0: r0, M: 0});
        c.M = (c.y0 * MIN_BUDGET) / c.x0;
    }

    function _order(address trader, uint256 pk, bool sellsC0, uint256 budget, uint256 nonce)
        internal
        view
        returns (OtterOrderBook.Order memory o, bytes memory sig)
    {
        o = OtterOrderBook.Order({
            trader: trader,
            poolId: PoolId.unwrap(otterId),
            sellingCurrency0: sellsC0,
            ask: 0,
            budget: budget,
            deadline: block.timestamp + 1 days,
            nonce: nonce
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(o));
        sig = abi.encodePacked(r, s, v);
    }

    /// Runs one whole batch: fund, submit, close the window, settle with `slack`
    /// wei of deliberate under-payment so there is a surplus worth watching.
    function _runBatch(uint256 nonce, uint256 slack) internal returns (uint256 surplusCreated) {
        _fund(currency0, dom, DOM_BUDGET);
        _fund(currency1, min, MIN_BUDGET);

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        (orders[0], sigs[0]) = _order(dom, domPk, true, DOM_BUDGET, nonce);
        (orders[1], sigs[1]) = _order(min, minPk, false, MIN_BUDGET, nonce);

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        OtterMath.Curve memory c = _curve();
        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = DOM_BUDGET;
        x[0] = OtterMath.fTildeSettleable(c, DOM_BUDGET) - slack;
        y[1] = MIN_BUDGET;
        x[1] = (c.y0 * MIN_BUDGET) / c.x0;

        // `settle` drains whatever was pending (the previous batch's surplus,
        // donated during this call) and then adds only this batch's own burn.
        // So the pot's value right after `settle` already isolates this batch's
        // surplus — no need to diff against what was there before.
        settlement.settle(
            otterKey, batchId, orders, OtterSettlement.Outcome({dominantSellsCurrency0: true, y: y, x: x})
        );
        surplusCreated = settlement.pendingSurplus(otterId, currency1);
    }

    // ------------------------------------------------------------------
    // 1. the surplus reaches the LPs
    // ------------------------------------------------------------------

    function test_flushDonatesSurplusToLPs() public {
        uint256 surplus = _runBatch(0, 1e15);
        assertGt(surplus, 0, "batch should leave a surplus");

        // Nothing has reached the LP yet: the pool is zero-fee and the batch's
        // swap therefore generates no fee growth of its own.
        (, uint256 beforeFees1) = _collectFees();
        assertEq(beforeFees1, 0, "a zero-fee pool pays LPs nothing until the surplus is donated");

        settlement.flushSurplus(otterKey);
        assertEq(settlement.pendingSurplus(otterId, currency1), 0, "pot emptied");

        (, uint256 got1) = _collectFees();
        console2.log("surplus created ", surplus);
        console2.log("collected by LP ", got1);

        // Fee growth is a Q128 per-liquidity number, so a sole LP recovers the
        // donation up to the truncation of one division and one multiplication.
        assertApproxEqAbs(got1, surplus, 2, "LP should recover the donated surplus");
    }

    function test_flushRevertsWhenThereIsNothingToDonate() public {
        vm.expectRevert(OtterSettlement.NoSurplus.selector);
        settlement.flushSurplus(otterKey);
    }

    // ------------------------------------------------------------------
    // 2. the lag: a batch never donates its own surplus
    // ------------------------------------------------------------------

    function test_batchNeverDonatesItsOwnSurplus() public {
        // Batch 1 creates surplus and donates nothing, because nothing preceded it.
        uint256 s1 = _runBatch(0, 1e15);
        (, uint256 fees1) = _collectFees();
        assertEq(fees1, 0, "batch 1 must not donate its own surplus");
        assertEq(settlement.pendingSurplus(otterId, currency1), s1, "batch 1's surplus is held back");

        // Batch 2 donates exactly batch 1's surplus, and holds back its own.
        uint256 s2 = _runBatch(1, 1e15);
        (, uint256 fees2) = _collectFees();

        console2.log("batch 1 surplus ", s1);
        console2.log("donated at batch 2", fees2);
        console2.log("batch 2 surplus ", s2);

        assertApproxEqAbs(fees2, s1, 2, "batch 2 donates batch 1's surplus, in full");
        assertEq(settlement.pendingSurplus(otterId, currency1), s2, "batch 2's own surplus is held back");
    }

    // ------------------------------------------------------------------
    // 3. donating does not move the curve
    // ------------------------------------------------------------------

    /// @dev This is the claim that lets a donation share a settlement with the
    ///      batch's own swap. `donate` writes only to feeGrowthGlobal; if it ever
    ///      touched price or liquidity, the virtual reserves the mechanism is
    ///      solved against would shift underneath the next batch and curve
    ///      conservation would be measuring the wrong pool.
    function test_donationLeavesPriceAndLiquidityUntouched() public {
        _runBatch(0, 1e15);

        (uint160 priceBefore,,,) = manager.getSlot0(otterId);
        uint128 liquidityBefore = manager.getLiquidity(otterId);
        (uint256 r0Before, uint256 r1Before) = OtterPoolMath.virtualReserves(priceBefore, liquidityBefore);

        settlement.flushSurplus(otterKey);

        (uint160 priceAfter,,,) = manager.getSlot0(otterId);
        uint128 liquidityAfter = manager.getLiquidity(otterId);
        (uint256 r0After, uint256 r1After) = OtterPoolMath.virtualReserves(priceAfter, liquidityAfter);

        assertEq(priceAfter, priceBefore, "donation moved the price");
        assertEq(liquidityAfter, liquidityBefore, "donation moved the liquidity");
        assertEq(r0After, r0Before, "donation moved the virtual reserve of currency0");
        assertEq(r1After, r1Before, "donation moved the virtual reserve of currency1");
    }
}
