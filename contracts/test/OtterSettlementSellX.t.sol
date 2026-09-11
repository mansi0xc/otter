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

interface IERC20X {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Coverage for the sell-X-dominant branch.
///
/// Every other settlement test sets `dominantSellsCurrency0 = true`, so the
/// symmetric path through `_curveFor` (which swaps x0/y0), `_classify`, and the
/// oneForZero swap direction had never executed on-chain. That is half the
/// two-sided mechanism, and it is exactly the shape of thing that works in the
/// reference solver and fails in Solidity because a reserve got inverted.
///
/// The strongest test here is `test_directionSymmetryAtParity`: at a 1:1 price the
/// virtual reserves are equal, so a batch and its mirror image must settle to
/// byte-identical numbers. An inverted reserve anywhere breaks that immediately.
contract OtterSettlementSellXTest is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    OtterOrderBook book;
    OtterSettlement settlement;
    OtterHook hook;

    address burnSink = address(0xB0F1);
    uint64 constant WINDOW = 60;

    uint256 domPk = 0xD0;
    uint256 minPk = 0xD1;
    address dom;
    address min;

    PoolKey otterKey;
    PoolId otterId;

    int24 constant LO = -887272;
    int24 constant HI = 887272;

    uint256 constant DOM_BUDGET = 10e18;
    uint256 constant MIN_BUDGET = 2e18;

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

        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: LO,
                tickUpper: HI,
                liquidityDelta: 1e21,
                salt: 0
            }),
            ZERO_BYTES
        );

        dom = vm.addr(domPk);
        min = vm.addr(minPk);
    }

    function _fund(Currency c, address who, uint256 amount) internal {
        address token = Currency.unwrap(c);
        deal(token, who, amount);
        vm.prank(who);
        IERC20X(token).approve(address(settlement), type(uint256).max);
    }

    function _mkOrder(address trader, bool sellsC0, uint256 budget, uint256 nonce)
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
            nonce: nonce
        });
    }

    function _sign(uint256 pk, OtterOrderBook.Order memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(o));
        return abi.encodePacked(r, s, v);
    }

    /// @dev OtterMath's x0 is the reserve of the token the dominant side RECEIVES,
    ///      y0 the reserve of the token it SUPPLIES. Mirrors OtterSettlement._curveFor.
    function _curve(bool dominantSellsC0, uint256 minorityBudget)
        internal
        view
        returns (OtterMath.Curve memory c)
    {
        (uint160 p,,,) = manager.getSlot0(otterId);
        uint128 liq = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, liq);
        c = dominantSellsC0
            ? OtterMath.Curve({x0: r1, y0: r0, M: 0})
            : OtterMath.Curve({x0: r0, y0: r1, M: 0});
        c.M = (c.y0 * minorityBudget) / c.x0;
    }

    /// Submits a batch in the given direction and settles it.
    /// Returns what the dominant and minority traders received.
    function _runBatch(bool dominantSellsC0, uint256 slack)
        internal
        returns (uint256 domReceived, uint256 minReceived, uint256 burn)
    {
        Currency domIn = dominantSellsC0 ? currency0 : currency1;
        Currency domOut = dominantSellsC0 ? currency1 : currency0;

        _fund(domIn, dom, DOM_BUDGET);
        _fund(domOut, min, MIN_BUDGET);

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        orders[0] = _mkOrder(dom, dominantSellsC0, DOM_BUDGET, 0);
        orders[1] = _mkOrder(min, !dominantSellsC0, MIN_BUDGET, 0);
        sigs[0] = _sign(domPk, orders[0]);
        sigs[1] = _sign(minPk, orders[1]);

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        OtterMath.Curve memory c = _curve(dominantSellsC0, MIN_BUDGET);

        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = DOM_BUDGET;
        x[0] = OtterMath.fTildeSettleable(c, DOM_BUDGET) - slack;
        y[1] = MIN_BUDGET;
        x[1] = (c.y0 * MIN_BUDGET) / c.x0;

        settlement.settle(
            otterKey,
            batchId,
            orders,
            OtterSettlement.Outcome({dominantSellsCurrency0: dominantSellsC0, y: y, x: x})
        );

        domReceived = IERC20X(Currency.unwrap(domOut)).balanceOf(dom);
        minReceived = IERC20X(Currency.unwrap(domIn)).balanceOf(min);
        burn = IERC20X(Currency.unwrap(domOut)).balanceOf(burnSink);
    }

    // ------------------------------------------------------------------

    function test_settlesSellXDominantBatch() public {
        (uint256 domReceived, uint256 minReceived, uint256 burn) = _runBatch(false, 1e15);

        // dominant sold all its currency1
        assertEq(IERC20X(Currency.unwrap(currency1)).balanceOf(dom), 0, "dominant sold its budget");
        assertGt(domReceived, 0, "dominant must receive currency0");
        assertGt(minReceived, 0, "minority must receive currency1");
        assertGt(burn, 0, "surplus should reach the sink");

        console2.log("sell-X dominant:");
        console2.log("  dominant received (currency0)", domReceived);
        console2.log("  minority received (currency1)", minReceived);
        console2.log("  burn (currency0)             ", burn);
    }

    /// At a 1:1 price the virtual reserves are equal, so a batch and its mirror
    /// image are the same problem with the token labels swapped. Any inverted
    /// reserve in _curveFor, _classify, or the swap direction breaks this.
    function test_directionSymmetryAtParity() public {
        uint256 snap = vm.snapshotState();
        (uint256 domY, uint256 minY, uint256 burnY) = _runBatch(true, 1e15);
        vm.revertToState(snap);

        (uint256 domX, uint256 minX, uint256 burnX) = _runBatch(false, 1e15);

        console2.log("sell-Y dominant / sell-X dominant");
        console2.log("  dominant received", domY, domX);
        console2.log("  minority received", minY, minX);
        console2.log("  burn             ", burnY, burnX);

        assertEq(domX, domY, "mirrored batch must pay the dominant side identically");
        assertEq(minX, minY, "mirrored batch must pay the minority side identically");
        assertEq(burnX, burnY, "mirrored batch must burn identically");
    }

    function test_rejectsWrongMinorityFill_sellXDominant() public {
        _fund(currency1, dom, DOM_BUDGET);
        _fund(currency0, min, MIN_BUDGET);

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        orders[0] = _mkOrder(dom, false, DOM_BUDGET, 0);
        orders[1] = _mkOrder(min, true, MIN_BUDGET, 0);
        sigs[0] = _sign(domPk, orders[0]);
        sigs[1] = _sign(minPk, orders[1]);

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        OtterMath.Curve memory c = _curve(false, MIN_BUDGET);
        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = DOM_BUDGET;
        x[0] = OtterMath.fTildeSettleable(c, DOM_BUDGET) - 1e15;
        y[1] = MIN_BUDGET;
        x[1] = ((c.y0 * MIN_BUDGET) / c.x0) - 1; // one wei short

        vm.expectRevert(abi.encodeWithSelector(OtterSettlement.MinorityFillWrong.selector, 1));
        settlement.settle(
            otterKey, batchId, orders, OtterSettlement.Outcome({dominantSellsCurrency0: false, y: y, x: x})
        );
    }

    /// The sell-X twin of OtterMargin: full ceiling, zero headroom, across price.
    function testFuzz_sellXMarginNeverNegative(uint96 rawDom, uint96 rawMin) public {
        uint256 domBudget = bound(uint256(rawDom), 1e15, 1e19);
        uint256 minBudget = bound(uint256(rawMin), 1e15, 1e18);

        _fund(currency1, dom, domBudget);
        _fund(currency0, min, minBudget);

        OtterMath.Curve memory c = _curve(false, minBudget);
        vm.assume(domBudget >= c.M);

        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        orders[0] = _mkOrder(dom, false, domBudget, 0);
        orders[1] = _mkOrder(min, true, minBudget, 0);
        sigs[0] = _sign(domPk, orders[0]);
        sigs[1] = _sign(minPk, orders[1]);

        uint256 batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);

        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = domBudget;
        x[0] = OtterMath.fTildeSettleable(c, domBudget); // no headroom
        y[1] = minBudget;
        x[1] = (c.y0 * minBudget) / c.x0;

        settlement.settle(
            otterKey, batchId, orders, OtterSettlement.Outcome({dominantSellsCurrency0: false, y: y, x: x})
        );
    }
}
