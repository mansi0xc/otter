// Deployed Otter contracts on Ethereum Sepolia (chainId 11155111)
// Source: deployment.md — confirmed 13 September 2026, all 15 broadcast txs confirmed.

export const OTTER_CHAIN_ID = 11155111 as const

export const legacyOtter = {
  chainId: OTTER_CHAIN_ID,
  poolId:
    '0x62226a92f6feecc0053b46f84c202da078c41c5f69a250f5d352541eceb8fb90' as `0x${string}`,
  poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543' as `0x${string}`,
  orderBook: '0x8152DA3f2affDa3d233b0BDF8BF77e0bCeBA32cf' as `0x${string}`,
  settlement: '0x476943E2399d135B5e1F8497A4Dc50564886F1F5' as `0x${string}`,
  hook: '0xa4eb62f1A79856b030ce08B4A4E95fDd22C64a80' as `0x${string}`,
  token0: '0xA47293F2138724639942e34882D1741E33EC188D' as `0x${string}`, // OTA
  token1: '0xe934ab08488a89aEb491c5425D11AdCC44ac12e3' as `0x${string}`, // OTB
} as const

// Historical v1 addresses are explorer references only. Never use them for wallet writes.

// Etherscan links
export const ETHERSCAN = {
  base: 'https://sepolia.etherscan.io',
  orderBook: `https://sepolia.etherscan.io/address/${legacyOtter.orderBook}#code`,
  settlement: `https://sepolia.etherscan.io/address/${legacyOtter.settlement}#code`,
  hook: `https://sepolia.etherscan.io/address/${legacyOtter.hook}#code`,
  token0: `https://sepolia.etherscan.io/address/${legacyOtter.token0}`,
  token1: `https://sepolia.etherscan.io/address/${legacyOtter.token1}`,
  deployer: `https://sepolia.etherscan.io/address/0x34Df0107d4aEE3830899d2AC1F52ACd4015F729B`,
}
