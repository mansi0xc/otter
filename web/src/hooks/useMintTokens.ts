import { useState, useCallback } from 'react'
import { useWriteContract, useAccount } from 'wagmi'
import { parseUnits, type Address } from 'viem'
import { otter, ERC20_ABI } from '@/config/contracts'

export type MintToken = 'OTA' | 'OTB'

export interface MintState {
  isMinting: boolean
  mintedToken: MintToken | null
  txHash: `0x${string}` | null
  error: string | null
  mint: (token: MintToken, amount?: string) => Promise<void>
}

// MockERC20.mint(address to, uint256 value) — no access control
const MINT_AMOUNT_DEFAULT = '100' // 100 tokens

export function useMintTokens(): MintState {
  const { address } = useAccount()
  const [isMinting, setIsMinting] = useState(false)
  const [mintedToken, setMintedToken] = useState<MintToken | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()

  const mint = useCallback(async (token: MintToken, amount = MINT_AMOUNT_DEFAULT) => {
    if (!address) { setError('Connect a Sepolia wallet first.'); return }
    setError(null)
    setIsMinting(true)
    setMintedToken(token)

    try {
      const tokenAddr: Address = token === 'OTA' ? otter.token0 : otter.token1
      const value = parseUnits(amount, 18)

      const hash = await writeContractAsync({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: 'mint',
        args: [address, value],
      })
      setTxHash(hash)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Minting failed')
    } finally {
      setIsMinting(false)
    }
  }, [address, writeContractAsync])

  return { isMinting, mintedToken, txHash, error, mint }
}
