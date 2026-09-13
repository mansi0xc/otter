import { http, createConfig } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import { injectedWallet, rabbyWallet } from '@rainbow-me/rainbowkit/wallets'

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Wallets',
      wallets: [injectedWallet, rabbyWallet],
    },
  ],
  {
    appName: 'Otter Batch Room',
    projectId: 'otter-batch-room',
  },
)

export const wagmiConfig = createConfig({
  connectors,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http('https://rpc.sepolia.org'),
  },
})



