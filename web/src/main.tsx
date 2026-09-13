import React from 'react'
import ReactDOM from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { wagmiConfig } from '@/config/wagmi'
import App from './App'
import './styles/theme.css'
import './styles/animations.css'

const queryClient = new QueryClient()

// Custom RainbowKit theme using Otter palette
const otterTheme = lightTheme({
  accentColor: '#5c3268',
  accentColorForeground: '#fff',
  borderRadius: 'small',
  fontStack: 'system',
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={otterTheme}>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
