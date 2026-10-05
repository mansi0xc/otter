/** Local Foundry test bridge. No files, RPC, signing or transaction submission. */
import { checkLegacyOutcome } from './settlement-check.ts';
import type { Order } from './exact.ts';

try {
  const args = process.argv.slice(2);
  if (args.length < 8 || (args.length - 3) % 5 !== 0) throw new Error('expected reserves, direction, then side/ask/budget/y/x per order');
  const amount = (s: string): bigint => {
    if (!/^(0|[1-9][0-9]*)$/.test(s) || s.length > 78) throw new Error('expected bounded unsigned decimal integer');
    return BigInt(s);
  };
  const side = (s: string): boolean => {
    if (s !== '0' && s !== '1') throw new Error('expected boolean bit');
    return s === '1';
  };
  const orders: Order[] = [], y: bigint[] = [], x: bigint[] = [];
  for (let i = 3; i < args.length; i += 5) {
    orders.push({ trader: '', sellingCurrency0: side(args[i]), ask: amount(args[i + 1]), budget: amount(args[i + 2]) });
    y.push(amount(args[i + 3]));
    x.push(amount(args[i + 4]));
  }
  const v = checkLegacyOutcome(amount(args[0]), amount(args[1]), orders, { dominantSellsCurrency0: side(args[2]), y, x });
  // Seven static ABI uint256 words. Never convert monetary values to Number.
  const words = [BigInt(v.code), BigInt(v.index), v.arg0, v.arg1, v.totalIn, v.totalPaid, v.burn];
  process.stdout.write('0x' + words.map(n => n.toString(16).padStart(64, '0')).join(''));
} catch (error) {
  console.error(`Settlement preflight bridge failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
