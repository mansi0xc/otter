import { http } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

export const wagmiConfig = getDefaultConfig({
  appName: 'Otter Batch Room',
  projectId: 'otter-batch-room-demo', // WalletConnect project ID — replace with real one for production
  chains: [sepolia],
  transports: {
    [sepolia.id]: http('https://rpc.sepolia.org'),
  },
})
