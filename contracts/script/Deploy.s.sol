// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {OtterHook} from "../src/OtterHook.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterSettlement} from "../src/OtterSettlement.sol";
import {HookMiner} from "../test/utils/HookMiner.sol";

/// @title Deploy
/// @notice Deploys the Otter stack and stands up a pool.
///
///   forge script script/Deploy.s.sol \
///     --rpc-url $RPC_URL --broadcast --verify -vvvv
///
/// Required env:
///   POOL_MANAGER   the v4 PoolManager on your target chain
///   PRIVATE_KEY    deployer key
///
/// Optional env:
///   TOKEN0, TOKEN1   existing ERC20s. If unset, two MockERC20s are deployed and
///                    minted to the deployer.
///   BURN_SINK        where redistributed surplus goes. Defaults to the deployer.
///                    MUST NOT depend on any bidder's report (Theorem 22 / §3.6),
///                    which is why it is immutable in OtterSettlement.
///   WINDOW           batch window in seconds. Default 60.
///   LIQUIDITY        full-range liquidity to seed. Default 1e21.
///
/// POOL_MANAGER is deliberately NOT hardcoded per chain. The Uniswap docs warn
/// that v4 addresses differ between chains and the published table has been
/// unreliable; a wrong address here fails in confusing ways deep inside the hook
/// address validation. Look it up for your chain, pass it in, and this script
/// checks there is code at it before touching anything.
contract Deploy is Script {
    using PoolIdLibrary for PoolKey;

    /// Foundry routes salted `new` through the deterministic CREATE2 factory, so
    /// THIS is the deployer the hook address must be mined against — not the EOA
    /// and not the script contract.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 1 << 96

    /// Full range at tickSpacing 1. Otter requires a single full-range position so
    /// liquidity is constant across any batch — see OtterPoolMath.
    int24 constant TICK_LOWER = -887272;
    int24 constant TICK_UPPER = 887272;

    /// Fee MUST be zero: a non-zero LP fee makes the realised swap diverge from F~
    /// and breaks curve conservation. LPs are paid from the burn instead.
    uint24 constant FEE = 0;
    int24 constant TICK_SPACING = 1;

    function run() external {
        address pmAddress = vm.envAddress("POOL_MANAGER");
        require(pmAddress.code.length > 0, "no code at POOL_MANAGER: wrong address or wrong chain");
        IPoolManager manager = IPoolManager(pmAddress);

        uint64 window = uint64(vm.envOr("WINDOW", uint256(60)));
        uint256 liquidity = vm.envOr("LIQUIDITY", uint256(1e21));
        address deployer = msg.sender;
        address burnSink = vm.envOr("BURN_SINK", deployer);

        vm.startBroadcast();

        // --- tokens ---------------------------------------------------
        (Currency currency0, Currency currency1) = _resolveTokens(deployer, liquidity);

        // --- core -----------------------------------------------------
        OtterOrderBook book = new OtterOrderBook(window);
        OtterSettlement settlement = new OtterSettlement(manager, book, burnSink);
        book.setSettlement(address(settlement));

        // --- hook: mine a salt carrying exactly BEFORE_SWAP -----------
        bytes memory args = abi.encode(manager, address(settlement));
        (address predicted, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, uint160(Hooks.BEFORE_SWAP_FLAG), type(OtterHook).creationCode, args);

        OtterHook hook = new OtterHook{salt: salt}(manager, address(settlement));
        require(address(hook) == predicted, "hook address mismatch: wrong CREATE2 deployer?");
        require(
            uint160(address(hook)) & Hooks.ALL_HOOK_MASK == uint160(Hooks.BEFORE_SWAP_FLAG),
            "hook address encodes unexpected permissions"
        );

        // --- pool -----------------------------------------------------
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        manager.initialize(key, SQRT_PRICE_1_1);

        // --- liquidity ------------------------------------------------
        // PoolModifyLiquidityTest ships in v4-core's src/test. It is a testnet
        // convenience: with v4-periphery dropped (CORRECTIONS.md C9) there is no
        // PositionManager here, and Otter needs exactly one full-range position.
        // Do not use this on mainnet.
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);
        MockERC20(Currency.unwrap(currency0)).approve(address(lpRouter), type(uint256).max);
        MockERC20(Currency.unwrap(currency1)).approve(address(lpRouter), type(uint256).max);

        lpRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: int256(liquidity),
                salt: 0
            }),
            ""
        );

        vm.stopBroadcast();

        _report(key, book, settlement, hook, lpRouter, burnSink, window, liquidity);
    }

    function _resolveTokens(address deployer, uint256 liquidity)
        private
        returns (Currency currency0, Currency currency1)
    {
        address t0 = vm.envOr("TOKEN0", address(0));
        address t1 = vm.envOr("TOKEN1", address(0));

        if (t0 == address(0) || t1 == address(0)) {
            MockERC20 a = new MockERC20("Otter Test A", "OTA", 18);
            MockERC20 b = new MockERC20("Otter Test B", "OTB", 18);
            // mint generously: the deployer seeds liquidity and the demo traders
            a.mint(deployer, liquidity * 1000);
            b.mint(deployer, liquidity * 1000);
            (t0, t1) = (address(a), address(b));
        }

        // v4 requires currency0 < currency1 by address
        (currency0, currency1) = t0 < t1
            ? (Currency.wrap(t0), Currency.wrap(t1))
            : (Currency.wrap(t1), Currency.wrap(t0));
    }

    function _report(
        PoolKey memory key,
        OtterOrderBook book,
        OtterSettlement settlement,
        OtterHook hook,
        PoolModifyLiquidityTest lpRouter,
        address burnSink,
        uint64 window,
        uint256 liquidity
    ) private {
        PoolId id = key.toId();

        console2.log("=== Otter deployed ===");
        console2.log("chainId        ", block.chainid);
        console2.log("PoolManager    ", address(settlement.poolManager()));
        console2.log("OtterOrderBook ", address(book));
        console2.log("OtterSettlement", address(settlement));
        console2.log("OtterHook      ", address(hook));
        console2.log("  permissions  ", uint256(uint160(address(hook)) & Hooks.ALL_HOOK_MASK));
        console2.log("lpRouter       ", address(lpRouter));
        console2.log("currency0      ", Currency.unwrap(key.currency0));
        console2.log("currency1      ", Currency.unwrap(key.currency1));
        console2.log("burnSink       ", burnSink);
        console2.log("window (s)     ", window);
        console2.log("liquidity      ", liquidity);
        console2.logBytes32(PoolId.unwrap(id));

        string memory json = string.concat(
            '{\n  "chainId": ', vm.toString(block.chainid),
            ',\n  "poolManager": "', vm.toString(address(settlement.poolManager())),
            '",\n  "orderBook": "', vm.toString(address(book)),
            '",\n  "settlement": "', vm.toString(address(settlement)),
            '",\n  "hook": "', vm.toString(address(hook)),
            '",\n  "lpRouter": "', vm.toString(address(lpRouter)),
            '",\n  "currency0": "', vm.toString(Currency.unwrap(key.currency0)),
            '",\n  "currency1": "', vm.toString(Currency.unwrap(key.currency1)),
            '",\n  "burnSink": "', vm.toString(burnSink),
            '",\n  "poolId": "', vm.toString(PoolId.unwrap(id)),
            '",\n  "window": ', vm.toString(uint256(window)),
            ',\n  "liquidity": ', vm.toString(liquidity),
            ',\n  "fee": 0,\n  "tickSpacing": 1\n}\n'
        );
        string memory path =
            string.concat("../harness/results/deployment-", vm.toString(block.chainid), ".json");
        vm.writeFile(path, json);
        console2.log("wrote", path);
    }
}
