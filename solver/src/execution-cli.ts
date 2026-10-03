/** Local test bridge: one ABI request argument in, one ABI quote on stdout. */
import { quoteExactInput } from './execution.ts';
import { decodeRequest, encodeQuote } from './execution-abi.ts';

try {
  if (process.argv.length !== 3) throw new Error('expected one ABI-encoded request');
  const r = decodeRequest(process.argv[2]);
  process.stdout.write(encodeQuote(quoteExactInput(r.snapshot, r.down, r.amount, r.limit)));
} catch (error) {
  console.error(`Execution reference failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
