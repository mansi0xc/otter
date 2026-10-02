// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OtterTestDeployers} from "./OtterTestDeployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {OtterHook} from "../../src/OtterHook.sol";
import {OtterLiquidityVault} from "../../src/OtterLiquidityVault.sol";
import {OtterOrderBook} from "../../src/OtterOrderBook.sol";
import {OtterSettlement} from "../../src/OtterSettlement.sol";
import {HookMiner} from "./HookMiner.sol";

interface IFixtureToken {
    function approve(address, uint256) external returns (bool);
}

abstract contract OtterHookFixture is OtterTestDeployers {
    using PoolIdLibrary for PoolKey;
    OtterHook internal hook;
    OtterLiquidityVault internal vault;
    OtterOrderBook internal book;
    OtterSettlement internal settlement;
    PoolKey internal otterKey;
    PoolId internal otterId;
    int24 internal constant TICK_LOWER = -887272;
    int24 internal constant TICK_UPPER = 887272;
    OtterOrderBook.Order[] internal submittedOrders;

    function setUp() public virtual {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        book = new OtterOrderBook(60, 900);
        settlement = new OtterSettlement(manager, book, address(this), 300);
        book.setSettlement(address(settlement));
        uint160 flags =
            uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG);
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), flags, type(OtterHook).creationCode, abi.encode(manager, address(settlement)));
        hook = new OtterHook{salt: salt}(manager, address(settlement));
        assertEq(address(hook), predicted);
        vault = hook.liquidityVault();
        settlement.setApprovedHook(address(hook));
        (otterKey, otterId) = initPool(currency0, currency1, IHooks(address(hook)), 0, 1, SQRT_PRICE_1_1);
        settlement.registerPool(otterKey);
        _modifyLiquidity(otterKey, IPoolManager.ModifyLiquidityParams(TICK_LOWER, TICK_UPPER, 1e21, 0), ZERO_BYTES);
    }

    function _submitActiveOrder() internal returns (uint256 id) {
        (OtterOrderBook.Order[] memory os, bytes[] memory signatures) = _prepareActiveOrder();
        id = book.submit(os, signatures);
        submittedOrders.push(os[0]);
    }

    function _prepareActiveOrder() internal returns (OtterOrderBook.Order[] memory os, bytes[] memory signatures) {
        uint256 pk = 0xA11CE;
        address trader = vm.addr(pk);
        deal(Currency.unwrap(currency0), trader, 10e18);
        vm.prank(trader);
        IFixtureToken(Currency.unwrap(currency0)).approve(address(book), type(uint256).max);
        OtterOrderBook.Order memory order = OtterOrderBook.Order(
            trader,
            PoolId.unwrap(otterId),
            true,
            0,
            1e18,
            block.timestamp + 1 days,
            0,
            1,
            book.nextEpochId(PoolId.unwrap(otterId)),
            block.timestamp + 1 days
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, book.digestOf(order));
        os = new OtterOrderBook.Order[](1);
        signatures = new bytes[](1);
        os[0] = order;
        signatures[0] = abi.encodePacked(r, s, v);
    }

    function _wrappedVaultOnly(bytes4 selector) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            selector,
            abi.encodeWithSelector(OtterHook.VaultOnly.selector, address(modifyLiquidityRouter)),
            abi.encodePacked(Hooks.HookCallFailed.selector)
        );
    }
}
