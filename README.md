# Otter

**A research prototype for batch trading and surplus redistribution on Uniswap v4**

An implementation of [*Otter: A Provably MEV-Resilient Automated Market Maker via
Surplus Redistribution*](https://eprint.iacr.org/2026/1877) (Shi, Zhang, Chung, Li — IACR ePrint 2026/1877, posted
3 September 2026) as a Uniswap v4 hook with an off-chain VCG solver.

The local remediation now has authenticated LP custody, native ETH/ERC20
trader escrow, bounded v2 signed epochs, and independent stored-order recovery.
See [checkpoint 3A](./reviews/CHECKPOINT_3A.md) for the current contract API and
validation, and [checkpoint 2B](./reviews/CHECKPOINT_2B.md) for asset handling. These
changes have not been deployed, and the existing wallet dashboard and published
Sepolia addresses still target the earlier prototype.

The current settlement verifier accepts feasible allocations without enforcing
the paper's canonical allocation/payments. Integer incentive guarantees,
historical LP rewards, and queued LP exit priority remain unfinished. Concentrated positions can be custodied, but concentrated
batch execution is blocked pending the exact tick-aware model and mechanism
gates. This checkout does not establish optimal trading or truthfulness.

---

## What is Otter?

Otter explores the batch AMM and surplus redistribution mechanism described
in [the paper](https://eprint.iacr.org/2026/1877). The paper's continuous-model
results are the research target; the current integer implementation and security
remediation require additional mechanism and execution work before those
properties can be claimed for this code.

See [`CORRECTIONS.md`](./CORRECTIONS.md) for the places where this repo's
understanding of the paper diverges from the notes it was originally planned
from.

## Repository layout

| Path | What lives here |
| --- | --- |
| `solver/` | Reference implementation of the mechanism (TypeScript), with property tests. |
| `contracts/` | `OtterOrderBook`, `OtterSettlement`, `OtterHook`, and fixed-point invariant checks. |
| `harness/` | Sandwich-attack comparison (vanilla Uniswap v4 vs. Otter) and settlement-cost benchmarks. |
| `fixtures/` | Shared test vectors — written by the solver, read by both test suites. |
| `web/` | React/Vite dashboard with two modes: a guided **Demo story** that walks through a real settled batch (order ledger, sandwich-comparison chart, batch clock, proof rail, and outcome panel), and a **Sepolia sandbox** where you connect a wallet (RainbowKit/wagmi), mint demo tokens, and submit a real EIP-712-signed order to the deployed `OtterOrderBook`, with the batch countdown read live from the contract. No public solver runs against the sandbox yet, so settlement itself is shown through the Demo story's fixture rather than live. See [`deployment.md`](./deployment.md) for the exact contract addresses it talks to. |

## Limitations

Stated up front rather than buried:

- The mechanism's guarantees require **censorship resilience at the consensus
  layer** (Theorem 23). A testnet does not provide this.
- The legacy contract checks budget/curve feasibility and dominant-side
  individual rationality. Minority dust payments can still violate IR.
  **Canonical welfare-optimal allocations and payments are not enforced
  on-chain.**
- The `O(n log n)` pivot algorithm is extracted from the proof of the paper's
  Lemma 16. It is not original to this work.

## Inside the hook

The current hook enforces the following integration rules:

- **Batch-only swaps.** Only the configured settlement contract can swap.
- **Authenticated LP custody.** Only the hook's dedicated vault can add, remove,
  or collect liquidity. Its position ledger authenticates each beneficial owner.
- **Concentrated execution gate.** Range positions are supported for custody.
  Order admission and swaps reject pools containing funded concentrated
  positions while the legacy auction still uses constant-product reserves.
- **Batch-active guards.** LP changes and fee collection are frozen from the
  first accepted order through complete settlement or explicit expiry.
  Anyone can expire an epoch at its fixed execution deadline without token
  calls, then credit each stored refund independently. Callback guards preserve
  the freeze during asset transfers. Queued exits
  and protection against repeated-batch exit starvation remain planned.
- **Explicit permissions.** The hook address carries only before-swap,
  before-add-liquidity, and before-remove-liquidity flags.
- **Zero swap fees.** Registration and settlement reject nonzero LP or protocol
  fees. An authenticated later fee change permits immediate epoch expiry and
  stored refunds.
  The current delayed donation policy remains vulnerable to historical LP
  reward capture and will be replaced by snapshot-based claims.

## Prior art

Batch trading and MEV mitigation have existing implementations. The project's
research focus is the paper's allocation/payment mechanism and its suitability
for v4. Comparative economic evidence and claims of novelty belong in the
remaining grant-readiness work, with explicit assumptions and source support.

## Getting started

```bash
# Solver: property tests
cd solver && npm test

# Contracts: Foundry test suite
cd contracts && forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'

# Web dashboard
cd web && yarn && yarn dev
```

## Project documents

- [`deployment.md`](./deployment.md) — full Sepolia deployment record: every contract address (`OtterOrderBook`, `OtterSettlement`, `OtterHook`, demo tokens), pool configuration, the transaction-by-transaction deployment trail, and Etherscan verification links.
- [`CORRECTIONS.md`](./CORRECTIONS.md) — known divergences from the source paper.
- [`FEEDBACK.md`](./FEEDBACK.md) — open feedback and review notes.