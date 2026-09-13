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

interface IERC20Minimal {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

contract OtterSettlementTest is Deployers {
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

    uint256 constant DOM_BUDGET = 10e18; // currency0 sold by the dominant side
    uint256 constant MIN_BUDGET = 2e18; // currency1 sold by the minority side

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

        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(otterKey);
        modifyLiquidityRouter.modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 1e21,
                salt: 0
            }),
            ZERO_BYTES
        );

        dom = vm.addr(domPk);
        min = vm.addr(minPk);
        _fund(currency0, dom, DOM_BUDGET);
        _fund(currency1, min, MIN_BUDGET);
    }

    function _fund(Currency c, address who, uint256 amount) internal {
        address token = Currency.unwrap(c);
        deal(token, who, amount);
        vm.prank(who);
        IERC20Minimal(token).approve(address(book), type(uint256).max);
    }

    function test_registerRejectsPoolWithoutApprovedHook() public {
        PoolKey memory unprotected = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 0,
            tickSpacing: 1,
            hooks: IHooks(address(0))
        });
        vm.expectRevert(abi.encodeWithSelector(OtterSettlement.InvalidHook.selector, address(0)));
        settlement.registerPool(unprotected);
    }

    function test_registerRejectsNonZeroFeePool() public {
        PoolKey memory feePool = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        vm.expectRevert(abi.encodeWithSelector(OtterSettlement.NonZeroFee.selector, uint24(3000)));
        settlement.registerPool(feePool);
    }

    // ------------------------------------------------------------------

    function _curve() internal view returns (OtterMath.Curve memory c) {
        (uint160 p,,,) = manager.getSlot0(otterId);
        uint128 L = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, L);
        // dominant sells currency0, so it receives currency1: x0 = r1, y0 = r0
        c = OtterMath.Curve({x0: r1, y0: r0, M: 0});
        c.M = _mulDown(c.y0, MIN_BUDGET, c.x0);
    }

    function _mulDown(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b) / d;
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
            ask: 0, // always eligible; keeps this test about plumbing, not pricing
            budget: budget,
            deadline: block.timestamp + 1 days,
            nonce: nonce
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(o));
        sig = abi.encodePacked(r, s, v);
    }

    /// Submits one dominant and one minority order and closes the window.
    function _openBatch() internal returns (uint256 batchId, OtterOrderBook.Order[] memory orders) {
        orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        (orders[0], sigs[0]) = _order(dom, domPk, true, DOM_BUDGET, 0);
        (orders[1], sigs[1]) = _order(min, minPk, false, MIN_BUDGET, 0);
        batchId = book.submit(orders, sigs);
        vm.warp(block.timestamp + WINDOW);
    }

    /// A valid — but deliberately not welfare-maximal — outcome. The contract does
    /// not verify optimality (see the trust model), so under-paying the dominant
    /// side by `slack` is accepted and simply enlarges the burn. Paying the exact
    /// ceiling leaves zero rounding headroom, which is a separate test below.
    function _outcome(OtterMath.Curve memory c, uint256 slack)
        internal
        pure
        returns (OtterSettlement.Outcome memory o)
    {
        uint256[] memory y = new uint256[](2);
        uint256[] memory x = new uint256[](2);
        y[0] = DOM_BUDGET;
        x[0] = OtterMath.fTildeSettleable(c, DOM_BUDGET) - slack;
        y[1] = MIN_BUDGET;
        x[1] = _mulDownPure(c.y0, MIN_BUDGET, c.x0);
        o = OtterSettlement.Outcome({dominantSellsCurrency0: true, y: y, x: x});
    }

    function _mulDownPure(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b) / d;
    }

    // ------------------------------------------------------------------
    // exclusivity window
    // ------------------------------------------------------------------

    /// @notice Within `exclusivityWindow` seconds of the window closing, only
    ///         `solver` may call `settle` — even with a perfectly valid outcome.
    function test_nonSolverCannotSettleDuringExclusivityWindow() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 1e15);

        // Still inside the 300s exclusivity window: _openBatch warps exactly to
        // closesAt, so exclusiveUntil is closesAt + 300 from here.
        address rando = address(0xBEEF);
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(OtterSettlement.NotExclusiveSolver.selector, block.timestamp + 300));
        settlement.settle(otterKey, batchId, orders, o);
    }

    /// @notice The designated solver may always settle, including at the very
    ///         instant the window closes — exclusivity restricts everyone else,
    ///         not the solver itself.
    function test_solverCanSettleImmediatelyAfterWindowCloses() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 1e15);

        // settlement's solver is address(this) — see setUp.
        settlement.settle(otterKey, batchId, orders, o);
        assertEq(orders.length, 2, "sanity: batch had orders");
    }

    /// @notice Once the exclusivity window elapses, settlement is permissionless
    ///         — a batch can never be stuck forever because a solver went dark.
    function test_anyoneCanSettleAfterExclusivityWindowElapses() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 1e15);

        vm.warp(block.timestamp + 300); // clears the exclusivity window too

        address rando = address(0xBEEF);
        vm.prank(rando);
        settlement.settle(otterKey, batchId, orders, o); // does not revert

        assertEq(
            IERC20Minimal(Currency.unwrap(currency1)).balanceOf(dom),
            o.x[0],
            "settlement by a non-solver after the window still pays correctly"
        );
    }

    // ------------------------------------------------------------------
    // the veto attack this escrow model closes
    // ------------------------------------------------------------------

    /// @notice Before escrow, funds were pulled from the trader at SETTLE time.
    ///         A trader who revoked approval, or simply spent the tokens, any
    ///         time between submitting and settlement made the whole batch
    ///         revert — including every other trader's fill, because the digest
    ///         forbids dropping the order that broke. One dishonest or careless
    ///         trader could veto arbitrarily many honest ones.
    ///
    ///         Escrowing at `submit` moves the pull to the moment the trader's
    ///         balance and allowance are known good. What they do with their
    ///         wallet afterwards is irrelevant to settlement, because this
    ///         contract is no longer asking their wallet for anything.
    function test_revokingApprovalAfterSubmitDoesNotBlockSettlement() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();

        // The attack: revoke the approval that funded the order, and spend the
        // balance elsewhere. Under the old pull-at-settle design either of these
        // alone would have made settlement of this whole batch revert.
        vm.prank(dom);
        IERC20Minimal(Currency.unwrap(currency0)).approve(address(book), 0);
        vm.prank(dom);
        currency0.transfer(address(0xdead), currency0.balanceOf(dom));

        assertEq(currency0.balanceOf(dom), 0, "dominant trader is now broke, as the attack requires");

        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 1e15);

        // Settlement succeeds anyway: the funds were already escrowed at submit.
        settlement.settle(otterKey, batchId, orders, o);

        assertEq(
            IERC20Minimal(Currency.unwrap(currency1)).balanceOf(dom),
            o.x[0],
            "dominant trader is still paid in full despite revoking approval afterward"
        );
        assertEq(
            IERC20Minimal(Currency.unwrap(currency0)).balanceOf(min),
            o.x[1],
            "minority trader's fill is unaffected by the other trader's later behaviour"
        );
    }

    // ------------------------------------------------------------------
    // the happy path
    // ------------------------------------------------------------------

    function test_settlesBatchEndToEnd() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 1e15);

        uint256 domOutBefore = IERC20Minimal(Currency.unwrap(currency1)).balanceOf(dom);
        uint256 minOutBefore = IERC20Minimal(Currency.unwrap(currency0)).balanceOf(min);

        settlement.settle(otterKey, batchId, orders, o);

        assertEq(
            IERC20Minimal(Currency.unwrap(currency0)).balanceOf(dom), 0, "dominant sold its whole budget"
        );
        assertEq(
            IERC20Minimal(Currency.unwrap(currency1)).balanceOf(dom) - domOutBefore,
            o.x[0],
            "dominant paid exactly x*"
        );
        assertEq(
            IERC20Minimal(Currency.unwrap(currency0)).balanceOf(min) - minOutBefore,
            o.x[1],
            "minority filled in full at spot"
        );

        uint256 burn = settlement.pendingSurplus(otterId, currency1);
        assertGt(burn, 0, "surplus should reach the sink");
        console2.log("surplus held for LPs", burn);
        console2.log("slack given up by dominant", uint256(1e15));
    }

    /// Paying the exact ceiling leaves no rounding headroom. Whether this succeeds
    /// tells us if the conservative rounding in OtterMath is actually conservative
    /// enough against v4's tick math, which is the whole reason for the
    /// PoolOutputShortfall check.
    function test_exactCeilingPayment() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 0);

        settlement.settle(otterKey, batchId, orders, o);
        console2.log("burn at exact ceiling", settlement.pendingSurplus(otterId, currency1));
    }

    // ------------------------------------------------------------------
    // rejections
    // ------------------------------------------------------------------

    function test_rejectsWrongMinorityFill() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 1e15);
        o.x[1] -= 1; // short-change the minority side by one wei

        vm.expectRevert(abi.encodeWithSelector(OtterSettlement.MinorityFillWrong.selector, 1));
        settlement.settle(otterKey, batchId, orders, o);
    }

    function test_rejectsOverpaymentToDominant() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 0);
        o.x[0] += 1e18; // above the marginal bound

        vm.expectRevert();
        settlement.settle(otterKey, batchId, orders, o);
    }

    function test_cannotSettleTwice() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();
        OtterSettlement.Outcome memory o = _outcome(c, 1e15);

        settlement.settle(otterKey, batchId, orders, o);
        vm.expectRevert(OtterOrderBook.AlreadySettled.selector);
        settlement.settle(otterKey, batchId, orders, o);
    }

    function test_cannotSettleWhileWindowOpen() public {
        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](2);
        bytes[] memory sigs = new bytes[](2);
        (orders[0], sigs[0]) = _order(dom, domPk, true, DOM_BUDGET, 0);
        (orders[1], sigs[1]) = _order(min, minPk, false, MIN_BUDGET, 0);
        uint256 batchId = book.submit(orders, sigs);

        OtterMath.Curve memory c = _curve();
        vm.expectRevert(OtterOrderBook.WindowStillOpen.selector);
        settlement.settle(otterKey, batchId, orders, _outcome(c, 1e15));
    }

    /// The inclusion guarantee, end to end: a solver cannot drop an order it
    /// dislikes and settle the rest.
    function test_cannotDropAnOrder() public {
        (uint256 batchId, OtterOrderBook.Order[] memory orders) = _openBatch();
        OtterMath.Curve memory c = _curve();

        OtterOrderBook.Order[] memory trimmed = new OtterOrderBook.Order[](1);
        trimmed[0] = orders[0];
        OtterSettlement.Outcome memory o = _outcome(c, 1e15);
        uint256[] memory y1 = new uint256[](1);
        uint256[] memory x1 = new uint256[](1);
        y1[0] = o.y[0];
        x1[0] = o.x[0];

        vm.expectRevert(abi.encodeWithSelector(OtterOrderBook.CountMismatch.selector, 1, uint32(2)));
        settlement.settle(
            otterKey, batchId, trimmed, OtterSettlement.Outcome({dominantSellsCurrency0: true, y: y1, x: x1})
        );
    }
}
