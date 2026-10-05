import { encodeFunctionData, type PublicClient, type WalletClient, type Hash, type Address, type Hex, type Abi } from 'viem'
import type { Transport, Call } from './client.ts'

export function viemTransport(publicClient: PublicClient, wallet: () => Promise<WalletClient>, session: Transport['session']): Transport {
  const sent = new Map<Hash, { address: Address; account: Address; input: Hex; value: bigint }>()
  return {
    chainId: () => publicClient.getChainId(),
    block: async () => { const b = await publicClient.getBlock(); return { number: b.number, timestamp: b.timestamp } },
    code: (address, blockNumber) => publicClient.getCode({ address, blockNumber }),
    read: (call, blockNumber) => publicClient.readContract({ ...call, blockNumber }),
    session,
    sign: async data => {
      const w = await wallet()
      const s = await session()
      if (!w.account || w.account.address.toLowerCase() !== data.message.trader.toLowerCase()
        || s.address.toLowerCase() !== data.message.trader.toLowerCase()
        || s.chainId !== data.domain.chainId || await w.getChainId() !== data.domain.chainId) {
        throw new Error('Wallet account or network changed before signing.')
      }
      return w.signTypedData({ ...data, account: w.account })
    },
    simulate: async (call: Call, account) => (await publicClient.simulateContract({ ...call, account })).request,
    send: async (request, account) => {
      const w = await wallet()
      const s = await session()
      if (!w.account || w.account.address.toLowerCase() !== account.toLowerCase() || s.address.toLowerCase() !== account.toLowerCase()
        || await w.getChainId() !== publicClient.chain?.id || s.chainId !== publicClient.chain?.id) {
        throw new Error('Wallet account or network changed before sending.')
      }
      const call = request as { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }
      const expected = { address: call.address, account, input: encodeFunctionData(call), value: call.value ?? 0n }
      const hash = await w.writeContract({ ...(request as Parameters<WalletClient['writeContract']>[0]), account: w.account, chain: w.chain })
      sent.set(hash, expected)
      return hash
    },
    wait: async hash => {
      let changed = false
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, onReplaced: replacement => {
        if (replacement.reason !== 'repriced') changed = true
      } })
      if (changed) throw new Error('Transaction was cancelled or replaced with a different action. Inspect it before retrying.')
      const expected = sent.get(hash)
      if (!expected) throw new Error('No intended transaction is recorded for this receipt.')
      const actual = await publicClient.getTransaction({ hash: receipt.transactionHash })
      if (actual.to?.toLowerCase() !== expected.address.toLowerCase() || actual.from.toLowerCase() !== expected.account.toLowerCase()
        || actual.input.toLowerCase() !== expected.input.toLowerCase() || actual.value !== expected.value) {
        throw new Error('Confirmed transaction differs from the requested wallet action. Inspect it before retrying.')
      }
      sent.delete(hash)
      return receipt
    },
  }
}
