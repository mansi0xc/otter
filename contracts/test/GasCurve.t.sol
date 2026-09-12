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

interface IERC20G {
    function approve(address, uint256) external returns (bool);
}

/// @notice Settlement cost versus batch size, with the number that actually
///         matters: where a batch stops fitting in an Ethereum block.
///
/// Two honesty notes, both of which most gas charts get wrong.
///
/// 1. `gasleft()` deltas measure EXECUTION only. A real transaction also pays the
///    21,000 intrinsic cost and, more importantly here, calldata: every order is
///    seven words plus two outcome words, and at 16 gas per non-zero byte that is
///    thousands of gas per order before a single opcode runs. This test ABI-encodes
///    the real call and counts the bytes, so the reported total is what a sender
///    would actually be charged.
///
/// 2. The bidders all use ask = 0, so every order fills in full and the Clarke
///    pivot reduces to x*_i = F~(Y) - F~(Y - y_i). That is a genuine VCG outcome
///    for any n (its feasibility is CORRECTIONS.md C7), and it lets arbitrary batch
///    sizes be built without invoking the solver. It is also the CHEAPEST shape:
///    every order fills, so every order costs two ERC-20 transfers. A batch with
///    priced-out orders would settle for less.
contract GasCurveTest is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    OtterOrderBook book;
    OtterSettlement settlement;
    OtterHook hook;
    uint64 constant WINDOW = 60;

    PoolKey otterKey;
    PoolId otterId;

    uint256 constant BLOCK_GAS_LIMIT = 30_000_000;
    uint256 constant PER_ORDER_BUDGET = 1e17;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        book = new OtterOrderBook(WINDOW);
        settlement = new OtterSettlement(manager, book, address(this), 300);
        book.setSettlement(address(settlement));

        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG),
            type(OtterHook).creationCode,
            abi.encode(manager, address(settlement))
        );
        hook = new OtterHook{salt: salt}(manager, address(settlement));
        assertEq(address(hook), predicted);

        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(otterKey);
        modifyLiquidityRouter.modifyLiquidity(
            otterKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -887272,
                tickUpper: 887272,
                liquidityDelta: 1e24,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _pkFor(uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("otter-gas-trader", i)));
    }

    function _calldataGas(bytes memory cd) internal pure returns (uint256 gasCost, uint256 nonZero) {
        for (uint256 i; i < cd.length; ++i) {
            if (cd[i] != 0) nonZero++;
        }
        gasCost = nonZero * 16 + (cd.length - nonZero) * 4;
    }

    /// One full submit + settle at batch size n. Returns the gas a real sender
    /// would pay: execution + calldata + the 21,000 intrinsic cost.
    function _measure(uint256 n) internal returns (uint256 submitGas, uint256 settleGas, uint256 cdGas) {
        OtterOrderBook.Order[] memory orders = new OtterOrderBook.Order[](n);
        bytes[] memory sigs = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            uint256 pk = _pkFor(i);
            address t = vm.addr(pk);
            deal(Currency.unwrap(currency0), t, PER_ORDER_BUDGET);
            vm.prank(t);
            IERC20G(Currency.unwrap(currency0)).approve(address(book), type(uint256).max);

            orders[i] = OtterOrderBook.Order({
                trader: t,
                poolId: PoolId.unwrap(otterId),
                sellingCurrency0: true,
                ask: 0,
                budget: PER_ORDER_BUDGET,
                deadline: block.timestamp + 1 days,
                nonce: 0
            });
            (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, book.digestOf(orders[i]));
            sigs[i] = abi.encodePacked(r, ss, v);
        }

        uint256 g0 = gasleft();
        uint256 batchId = book.submit(orders, sigs);
        submitGas = g0 - gasleft();

        vm.warp(block.timestamp + WINDOW);

        (uint160 p,,,) = manager.getSlot0(otterId);
        uint128 liq = manager.getLiquidity(otterId);
        (uint256 r0, uint256 r1) = OtterPoolMath.virtualReserves(p, liq);
        OtterMath.Curve memory c = OtterMath.Curve({x0: r1, y0: r0, M: 0});

        uint256 total = PER_ORDER_BUDGET * n;
        uint256 available = OtterMath.fTildeSettleable(c, total);

        uint256[] memory y = new uint256[](n);
        uint256[] memory x = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            y[i] = PER_ORDER_BUDGET;
            x[i] = available - OtterMath.fTildeUp(c, total - PER_ORDER_BUDGET);
        }
        OtterSettlement.Outcome memory outcome =
            OtterSettlement.Outcome({dominantSellsCurrency0: true, y: y, x: x});

        (cdGas,) = _calldataGas(
            abi.encodeWithSelector(OtterSettlement.settle.selector, otterKey, batchId, orders, outcome)
        );

        g0 = gasleft();
        settlement.settle(otterKey, batchId, orders, outcome);
        settleGas = g0 - gasleft();
    }

    function test_gasCurve() public {
        // 300/400/500 exist so the plotted curve has data across the region where
        // memory expansion starts to bite. Without them a chart interpolates a
        // straight line from 200 to 610 and visually contradicts the superlinearity
        // the numbers actually show.
        uint256[11] memory sizes = [uint256(1), 2, 5, 10, 25, 50, 100, 200, 300, 400, 500];

        string memory csv = "orders,submit_gas,settle_gas,calldata_gas,total_gas,total_per_order,pct_of_block\n";
        console2.log("orders | settle gas | calldata gas");

        for (uint256 s; s < sizes.length; ++s) {
            uint256 n = sizes[s];
            uint256 snap = vm.snapshotState();
            (uint256 submitGas, uint256 settleGas, uint256 cdGas) = _measure(n);
            uint256 totalGas = settleGas + cdGas + 21_000;
            uint256 pctOfBlock = totalGas * 100 / BLOCK_GAS_LIMIT;
            vm.revertToState(snap);

            console2.log(n, settleGas, cdGas);
            console2.log("   total", totalGas, totalGas / n);
            console2.log("   pct of block", pctOfBlock);

            csv = string.concat(
                csv,
                vm.toString(n), ",",
                vm.toString(submitGas), ",",
                vm.toString(settleGas), ",",
                vm.toString(cdGas), ",",
                vm.toString(totalGas), ",",
                vm.toString(totalGas / n), ",",
                vm.toString(pctOfBlock), "\n"
            );
        }

        vm.writeFile("../harness/results/gas-curve.csv", csv);
        console2.log("wrote harness/results/gas-curve.csv");
    }

    /// @notice Locate the largest batch that fits in a block BY MEASUREMENT.
    ///
    /// Settlement cost is SUPERLINEAR in batch size, which a linear fit hides. Over
    /// n = 100..200 the marginal cost is ~41,300 gas per order and looks flat. It
    /// is not:
    ///
    ///     n = 600    41,885 avg     ~42,000 marginal
    ///     n = 700    44,734 avg      61,830 marginal
    ///     n = 720    47,626 avg     148,822 marginal
    ///
    /// The cause is EVM memory expansion, which costs words^2/512 — the Fill[]
    /// array and the two outcome arrays grow linearly in n, so their memory cost
    /// grows quadratically. Extrapolating the flat region predicted a ceiling of
    /// 726; the true ceiling is materially lower. Anyone quoting a batch-AMM
    /// capacity from a linear fit over small batches is overstating it.
    ///
    /// This probes the 600-700 band directly. The ceiling is the one number
    /// idea.md correctly identified as not existing anywhere, so it gets measured.
    function test_blockCeiling() public {
        uint256[5] memory probes = [uint256(610), 630, 650, 670, 690];
        uint256 largestFitting;
        string memory csv = "orders,total_gas,gas_per_order,pct_of_block,fits\n";

        console2.log("--- locating the block ceiling (30M gas) ---");
        for (uint256 i; i < probes.length; ++i) {
            uint256 snap = vm.snapshotState();
            (, uint256 settleGas, uint256 cdGas) = _measure(probes[i]);
            uint256 totalGas = settleGas + cdGas + 21_000;
            vm.revertToState(snap);

            bool fits = totalGas <= BLOCK_GAS_LIMIT;
            if (fits) largestFitting = probes[i];

            // average per order, to make the superlinearity visible in the output
            console2.log(probes[i], totalGas, totalGas / probes[i]);
            console2.log("   pct of block", totalGas * 100 / BLOCK_GAS_LIMIT);
            csv = string.concat(
                csv,
                vm.toString(probes[i]), ",",
                vm.toString(totalGas), ",",
                vm.toString(totalGas / probes[i]), ",",
                vm.toString(totalGas * 100 / BLOCK_GAS_LIMIT), ",",
                fits ? "yes" : "no", "\n"
            );
        }

        console2.log("largest probed batch fitting in 30M gas:", largestFitting);
        vm.writeFile("../harness/results/block-ceiling.csv", csv);

        assertGt(largestFitting, 0, "even the smallest probe exceeded a block");
    }
}
