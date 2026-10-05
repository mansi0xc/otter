// Offline Foundry FFI bridge. The private key is a public test fixture, never a live wallet.
import { decodeAbiParameters, encodeAbiParameters, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ORDER_BOOK_ABI } from '../src/protocol/abi.ts'
import { orderDigest, orderHash, typedOrder, type Order } from '../src/protocol/orders.ts'
import type { Deployment } from '../src/protocol/deployment.ts'
const [, , chain, book, encoded] = process.argv
const submit = ORDER_BOOK_ABI.find(a => a.type === 'function' && a.name === 'submit')!
if (submit.type !== 'function') throw new Error('Submit ABI missing')
const [order] = decodeAbiParameters([{ type: 'tuple', components: submit.inputs[0].components }], encoded as Hex) as [Order]
const d = { chainId: Number(chain), contracts: { orderBook: { address: book as Address } } } as Deployment
const key = `0x${'0'.repeat(59)}a11ce` as Hex
const signature = await privateKeyToAccount(key).signTypedData(typedOrder(d, order))
process.stdout.write(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes' }], [orderHash(order), orderDigest(d, order), signature]))
