# Otter

An implementation of **Otter: A Provably MEV-Resilient Automated Market Maker via
Surplus Redistribution** (Shi, Zhang, Chung, Li — IACR ePrint 2026/1877, posted
3 September 2026) as a Uniswap v4 hook with an off-chain VCG solver.

No public implementation of this mechanism was found as of 9 September 2026.

## Status

Work in progress. See `CORRECTIONS.md` for where this repo's understanding of the
paper diverges from the notes it was planned from.

## Layout

| Path | What |
|---|---|
| `solver/` | Reference implementation of the mechanism, TypeScript. Property tests. |
| `contracts/` | `OtterOrderBook`, `OtterSettlement`, `OtterHook`, fixed-point invariant checks. |
| `harness/` | Sandwich comparison (vanilla v4 vs Otter) and settlement-cost benchmarks. |
| `fixtures/` | Shared test vectors. Written by the solver, read by both test suites. |
| `cre/` | Chainlink CRE Confidential Workflow: solver inside a TEE handler. |
| `web/` | Static results page over a real testnet batch. |

## Limitations

Stated up front rather than buried:

- The mechanism's guarantees require **censorship resilience at the consensus layer**
  (Theorem 23). A testnet does not provide this.
- The contract verifies feasibility, individual rationality, budget bounds and curve
  conservation. **Welfare-optimality of the proposed allocation is asserted by the
  solver, not proven on-chain.**
- The `O(n log n)` pivot algorithm is extracted from the proof of the paper's Lemma 16.
  It is not original to this work.

## Prior art

Batch AMMs exist and are implemented: CoW Protocol, Angstrom, SPEEDEX, am-AMM,
Penumbra. This is not the first batch AMM or the first anti-MEV hook. Existing batch
AMMs clear at a uniform price and are not incentive compatible. Otter is the first
design achieving dominant-strategy truthfulness for users *and* for a builder-as-user,
via surplus redistribution. This is its first implementation.

## Running

```bash
cd solver && npm test
cd contracts && forge test
```
