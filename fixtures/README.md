# Shared test vectors

The legacy verifier cases in `vectors/` are written by the TypeScript generator
and read by the contract test suite:

- `solver/src/cli.ts` records the BigInt verifier result for each generated case.
- `contracts/test/CrossCheck.t.sol` asserts the Solidity fixed-point verifier agrees.

These cases check the legacy verifier; they do not establish canonical auction
outcomes or fix the documented dust/payment/tie failures. A demo passing them
does not establish the mechanism's incentive guarantees.

Regenerate with `cd solver && npm run vectors`. Commit the result.

The new execution model has a separate comparison path:

- `solver/test/execution.ts` tests integer math, tick inversion, snapshot completeness,
  domain rejection, and traversal bounds without modifying these saved fixtures.
- `contracts/test/OtterExecutionReference.t.sol` captures real PoolManager state,
  invokes the local BigInt reference through a strict ABI/FFI bridge, and compares
  all oracle fields. Supported nonzero quotes are then checked against real swaps.

Run `cd solver && npm test` and the contract suite documented in the root README.
The bridge needs Node with TypeScript strip support on PATH; it reads no RPC,
downloads no dependencies, and does not write benchmark or fixture artifacts.
It is test infrastructure, not a production snapshot reader or an on-chain proof.
