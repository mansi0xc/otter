// Deployed Otter contracts on Ethereum Sepolia (chainId 11155111)
// Source: deployment.md — confirmed 13 September 2026, all 15 broadcast txs confirmed.

export const OTTER_CHAIN_ID = 11155111 as const

export const otter = {
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

// EIP-712 domain for OtterOrderBook
export const ORDER_BOOK_DOMAIN = {
  name: 'OtterOrderBook',
  version: '1',
  chainId: OTTER_CHAIN_ID,
  verifyingContract: otter.orderBook,
} as const

// EIP-712 Order type
export const ORDER_TYPES = {
  Order: [
    { name: 'trader', type: 'address' },
    { name: 'poolId', type: 'bytes32' },
    { name: 'sellingCurrency0', type: 'bool' },
    { name: 'ask', type: 'uint256' },
    { name: 'budget', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

// Minimal ABI for OtterOrderBook — extracted from contracts/out/OtterOrderBook.sol/OtterOrderBook.json
export const ORDER_BOOK_ABI = [
  {
    type: 'function',
    name: 'submit',
    inputs: [
      {
        name: 'orders',
        type: 'tuple[]',
        components: [
          { name: 'trader', type: 'address' },
          { name: 'poolId', type: 'bytes32' },
          { name: 'sellingCurrency0', type: 'bool' },
          { name: 'ask', type: 'uint256' },
          { name: 'budget', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      { name: 'signatures', type: 'bytes[]' },
    ],
    outputs: [{ name: 'batchId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'openBatchId',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'closesAt', type: 'uint64' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'batches',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'batchId', type: 'uint256' },
    ],
    outputs: [
      { name: 'closesAt', type: 'uint64' },
      { name: 'count', type: 'uint32' },
      { name: 'settled', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'windowLength',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nonceBitmap',
    inputs: [
      { name: 'trader', type: 'address' },
      { name: 'word', type: 'uint256' },
    ],
    outputs: [{ name: 'bits', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'OrderSubmitted',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'batchId', type: 'uint256', indexed: true },
      { name: 'trader', type: 'address', indexed: true },
      { name: 'orderHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BatchSettled',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'batchId', type: 'uint256', indexed: true },
      { name: 'count', type: 'uint32', indexed: false },
    ],
  },
] as const

// Minimal ABI for MockERC20 (OTA / OTB) — extracted from contracts/out/MockERC20.sol/MockERC20.json
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const

// Etherscan links
export const ETHERSCAN = {
  base: 'https://sepolia.etherscan.io',
  orderBook: `https://sepolia.etherscan.io/address/${otter.orderBook}#code`,
  settlement: `https://sepolia.etherscan.io/address/${otter.settlement}#code`,
  hook: `https://sepolia.etherscan.io/address/${otter.hook}#code`,
  token0: `https://sepolia.etherscan.io/address/${otter.token0}`,
  token1: `https://sepolia.etherscan.io/address/${otter.token1}`,
  deployer: `https://sepolia.etherscan.io/address/0x34Df0107d4aEE3830899d2AC1F52ACd4015F729B`,
}
