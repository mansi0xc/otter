/** Deterministic stdout only: no RPC, signatures, secrets, or transactions. */
import { renderCases } from './discrete-cases.ts';
process.stdout.write(renderCases());
