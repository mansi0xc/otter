# Otter Sepolia Deployment

**Network:** Ethereum Sepolia (`chainId: 11155111`)  
**Deployment date:** 13 September 2026  
**Status:** all 15 broadcast transactions confirmed successfully.

This is the canonical record for the current hackathon deployment. It contains
every non-zero address used or created by the deployment. No private key or RPC
endpoint is recorded here.

## Complete address inventory

| Role | Address | Notes |
|---|---|---|
| Deployer / owner / solver | [`0x34Df0107d4aEE3830899d2AC1F52ACd4015F729B`](https://sepolia.etherscan.io/address/0x34Df0107d4aEE3830899d2AC1F52ACd4015F729B) | Deployed the stack; is Settlement owner and initial solver. |
| Uniswap v4 PoolManager | [`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543) | Existing official Sepolia v4 deployment; this deployment initialized Otter's pool in it. |
| CREATE2 deployer proxy | [`0x4e59b44847b379578588920cA78FbF26c0B4956C`](https://sepolia.etherscan.io/address/0x4e59b44847b379578588920cA78FbF26c0B4956C) | Existing deterministic deployer used to mine the hook-permission address. |
| Otter Test A (`OTA`) | [`0xA47293F2138724639942e34882D1741E33EC188D`](https://sepolia.etherscan.io/address/0xA47293F2138724639942e34882D1741E33EC188D) | Newly deployed mintable demo token; pool `currency0`. |
| Otter Test B (`OTB`) | [`0xe934ab08488a89aEb491c5425D11AdCC44ac12e3`](https://sepolia.etherscan.io/address/0xe934ab08488a89aEb491c5425D11AdCC44ac12e3) | Newly deployed mintable demo token; pool `currency1`. |
| OtterOrderBook | [`0x8152DA3f2affDa3d233b0BDF8BF77e0bCeBA32cf`](https://sepolia.etherscan.io/address/0x8152DA3f2affDa3d233b0BDF8BF77e0bCeBA32cf) | Verified source. Window: 60 seconds; refund delay: 900 seconds. |
| OtterSettlement | [`0x476943E2399d135B5e1F8497A4Dc50564886F1F5`](https://sepolia.etherscan.io/address/0x476943E2399d135B5e1F8497A4Dc50564886F1F5) | Verified source. Exclusivity window: 300 seconds. |
| OtterHook | [`0xa4eb62f1A79856b030ce08B4A4E95fDd22C64a80`](https://sepolia.etherscan.io/address/0xa4eb62f1A79856b030ce08B4A4E95fDd22C64a80) | Verified source. CREATE2 address encodes `beforeSwap`, `beforeAddLiquidity`, and `beforeRemoveLiquidity` permissions. |
| PoolModifyLiquidityTest | [`0x9F3F36097B6C9193439962096A6E1ef1A6ee1912`](https://sepolia.etherscan.io/address/0x9F3F36097B6C9193439962096A6E1ef1A6ee1912) | Newly deployed Uniswap v4 test router used only to seed demo liquidity. |

## Libraries with no standalone address

`OtterMath` was intentionally **not** deployed as a separate contract. Every
function in [`contracts/src/OtterMath.sol`](contracts/src/OtterMath.sol) is
`internal`, so Solidity compiles its fixed-point math and settlement-verification
logic directly into the bytecode of
[`OtterSettlement`](https://sepolia.etherscan.io/address/0x476943E2399d135B5e1F8497A4Dc50564886F1F5#code).
There is therefore no `OtterMath` address to list or call independently.

`OtterPoolMath` follows the same pattern: it is an internal helper library
compiled into `OtterHook`, not an independently deployed contract.

## Pool configuration

| Setting | Value |
|---|---|
| Pool ID | `0x62226a92f6feecc0053b46f84c202da078c41c5f69a250f5d352541eceb8fb90` |
| `currency0` | `0xA47293F2138724639942e34882D1741E33EC188D` (OTA) |
| `currency1` | `0xe934ab08488a89aEb491c5425D11AdCC44ac12e3` (OTB) |
| Hook | `0xa4eb62f1A79856b030ce08B4A4E95fDd22C64a80` |
| Fee | `0` |
| Tick spacing | `1` |
| Initial sqrt price | `79228162514264337593543950336` (1:1) |
| Initial liquidity | `1000000000000000000000` full-range liquidity, ticks `-887272` to `887272` |

The confirmed on-chain wiring is: OrderBook → Settlement
`0x476943E2399d135B5e1F8497A4Dc50564886F1F5`; Settlement → OrderBook
`0x8152DA3f2affDa3d233b0BDF8BF77e0bCeBA32cf`; Settlement → approved Hook
`0xa4eb62f1A79856b030ce08B4A4E95fDd22C64a80`.

## Complete transaction record

All transactions were sent by
[`0x34Df0107d4aEE3830899d2AC1F52ACd4015F729B`](https://sepolia.etherscan.io/address/0x34Df0107d4aEE3830899d2AC1F52ACd4015F729B).

| Nonce | Transaction | Action / address created or called |
|---:|---|---|
| 63 | [`0x8c5e…cf3c`](https://sepolia.etherscan.io/tx/0x8c5e99a7b6a605b2e96cd6495e94d3c0d76529127ade090a85223e1cd005cf3c) | Created OTA at `0xA47293F2138724639942e34882D1741E33EC188D`. |
| 64 | [`0x0a74…3ed8`](https://sepolia.etherscan.io/tx/0x0a7403c8cd7d7b49ce26b0c8de4ef134c042d92c639c3fd728d7457d6d9c3ed8) | Created OTB at `0xe934ab08488a89aEb491c5425D11AdCC44ac12e3`. |
| 65 | [`0xb279…8026`](https://sepolia.etherscan.io/tx/0xb2793aaf04d6cac6338d5fe87bb37686dcc4760eac77e72fe929dd21c9bc8026) | Minted OTA to deployer/solver `0x34Df0107d4aEE3830899d2AC1F52ACd4015F729B`. |
| 66 | [`0x9831…20df`](https://sepolia.etherscan.io/tx/0x98312fee247104895c4df97fdd92d34482fb41ad5885bc38ac4b2bb81a2320df) | Minted OTB to deployer/solver `0x34Df0107d4aEE3830899d2AC1F52ACd4015F729B`. |
| 67 | [`0xbf31…a206`](https://sepolia.etherscan.io/tx/0xbf315655e98593c956343fcf570ba910b43a9abcd3bdb6d91d70c2109ca4a206) | Created OtterOrderBook at `0x8152DA3f2affDa3d233b0BDF8BF77e0bCeBA32cf`. |
| 68 | [`0x8df9…a6f0`](https://sepolia.etherscan.io/tx/0x8df955047ac8e138b12fb606256ed97785e7c96e341cb89422d082ad25fea6f0) | Created OtterSettlement at `0x476943E2399d135B5e1F8497A4Dc50564886F1F5`. |
| 69 | [`0x68a9…3d10`](https://sepolia.etherscan.io/tx/0x68a9a22b2781588456a2c2fc599a7c6ed7effd80208d734e1c303be70c463d10) | Called `setSettlement` on OrderBook `0x8152DA3f2affDa3d233b0BDF8BF77e0bCeBA32cf`. |
| 70 | [`0x3c34…0bd6`](https://sepolia.etherscan.io/tx/0x3c3430293b34076ce9a373e9340c9b3b16ac9401b805265e2945d55dfea20bd6) | Created OtterHook `0xa4eb62f1A79856b030ce08B4A4E95fDd22C64a80` through CREATE2 proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C`. |
| 71 | [`0x38c5…9177`](https://sepolia.etherscan.io/tx/0x38c53f6086c80378c2f5c3283668e111886484e8c337e6741abcc2a977329177) | Called `setApprovedHook` on Settlement `0x476943E2399d135B5e1F8497A4Dc50564886F1F5`. |
| 72 | [`0xd721…4496a`](https://sepolia.etherscan.io/tx/0xd72160b7de0913419c2fedf18c6260109cb09c36b311205e265e2d8616b4496a) | Initialized the OTA/OTB pool in PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`. |
| 73 | [`0xc9f7…c0a8`](https://sepolia.etherscan.io/tx/0xc9f7627f69a2c4d9da8750cea5296a38a49deded16eac0ab9c1e74b0dad5c0a8) | Registered the pool in Settlement `0x476943E2399d135B5e1F8497A4Dc50564886F1F5`. |
| 74 | [`0x8a2c…b23e`](https://sepolia.etherscan.io/tx/0x8a2c97198e4ad2ee352928e1321f5054c3d2514fd0b120a06d842aa59559b23e) | Created PoolModifyLiquidityTest at `0x9F3F36097B6C9193439962096A6E1ef1A6ee1912`. |
| 75 | [`0x4cff…6184`](https://sepolia.etherscan.io/tx/0x4cff86e070a18019a28a63b1b426a0bf203bb2789fb363f273d76ec3cc906184) | Approved PoolModifyLiquidityTest `0x9F3F36097B6C9193439962096A6E1ef1A6ee1912` to spend OTA `0xA47293F2138724639942e34882D1741E33EC188D`. |
| 76 | [`0x000d…674c`](https://sepolia.etherscan.io/tx/0x000dadd479c31ac5bed72871159b1c3f10d0e3e936416444c6c6cad6d907674c) | Approved PoolModifyLiquidityTest `0x9F3F36097B6C9193439962096A6E1ef1A6ee1912` to spend OTB `0xe934ab08488a89aEb491c5425D11AdCC44ac12e3`. |
| 77 | [`0x73d2…e676`](https://sepolia.etherscan.io/tx/0x73d24d2532c094f8c1aff3e2a20188f6cc72a184021747aba4861690bdd9e676) | Added the initial full-range liquidity through PoolModifyLiquidityTest `0x9F3F36097B6C9193439962096A6E1ef1A6ee1912`. |

## Verification

The three core Otter contracts are source-verified on Etherscan:

- [OtterOrderBook](https://sepolia.etherscan.io/address/0x8152DA3f2affDa3d233b0BDF8BF77e0bCeBA32cf#code)
- [OtterSettlement](https://sepolia.etherscan.io/address/0x476943E2399d135B5e1F8497A4Dc50564886F1F5#code)
- [OtterHook](https://sepolia.etherscan.io/address/0xa4eb62f1A79856b030ce08B4A4E95fDd22C64a80#code)

The OTA/OTB tokens and `PoolModifyLiquidityTest` are intentionally hackathon-demo
support contracts, not production assets or a production liquidity-management
router.
