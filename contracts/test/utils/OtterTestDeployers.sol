// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {OtterHook} from "../../src/OtterHook.sol";
import {OtterLiquidityVault} from "../../src/OtterLiquidityVault.sol";

interface IVaultTestToken {
    function approve(address, uint256) external returns (bool);
}

/// @dev Migrates this test contract's existing LP fixtures to authenticated
/// custody. Adversarial owners use the vault API directly, not this helper.
abstract contract OtterTestDeployers is Deployers {
    mapping(bytes32 => uint256) private _fixturePositions;

    function _modifyLiquidity(
        PoolKey memory poolKey,
        IPoolManager.ModifyLiquidityParams memory params,
        bytes memory data
    ) internal {
        if (address(poolKey.hooks) == address(0)) {
            modifyLiquidityRouter.modifyLiquidity(poolKey, params, data);
            return;
        }
        OtterLiquidityVault vault = OtterHook(address(poolKey.hooks)).liquidityVault();
        bytes32 positionKey = keccak256(abi.encode(poolKey, params.tickLower, params.tickUpper, params.salt));
        uint256 id = _fixturePositions[positionKey];
        if (params.liquidityDelta > 0) {
            IVaultTestToken(Currency.unwrap(poolKey.currency0)).approve(address(vault), type(uint256).max);
            IVaultTestToken(Currency.unwrap(poolKey.currency1)).approve(address(vault), type(uint256).max);
            uint128 liquidity = uint128(uint256(params.liquidityDelta));
            if (id == 0) {
                id = vault.createPosition(
                    poolKey, params.tickLower, params.tickUpper, liquidity, type(uint256).max, type(uint256).max
                );
                _fixturePositions[positionKey] = id;
            } else {
                vault.increaseLiquidity(id, liquidity, type(uint256).max, type(uint256).max);
            }
        } else if (params.liquidityDelta < 0) {
            vault.removeLiquidity(id, uint128(uint256(-params.liquidityDelta)), 0, 0);
        } else {
            vault.collectFees(id);
        }
        uint256 c0 = vault.claims(address(this), poolKey.currency0);
        uint256 c1 = vault.claims(address(this), poolKey.currency1);
        if (c0 != 0) vault.claim(poolKey.currency0, c0, address(this));
        if (c1 != 0) vault.claim(poolKey.currency1, c1, address(this));
    }
}
