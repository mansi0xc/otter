# Shared test vectors

`vectors.json` is written by the TypeScript solver and read by **both** test suites:

- `solver/test/` asserts the reference implementation reproduces them
- `contracts/test/CrossCheck.t.sol` asserts the Solidity fixed-point port agrees

This is the only mechanism that catches rounding divergence between the two. A
rounding difference that flips an invariant is a silent failure: the demo still runs
and proves nothing. Round *against* the party being paid, in both implementations.

Regenerate with `cd solver && npm run vectors`. Commit the result.
