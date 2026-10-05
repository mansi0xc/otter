# Otter

**A research prototype for batch trading and surplus redistribution on Uniswap v4**

An implementation of [*Otter: A Provably MEV-Resilient Automated Market Maker via
Surplus Redistribution*](https://eprint.iacr.org/2026/1877) (Shi, Zhang, Chung, Li — IACR ePrint 2026/1877, posted
3 September 2026) as a Uniswap v4 hook with an off-chain VCG solver.

The local remediation now has authenticated LP custody, native ETH/ERC20
trader escrow, bounded v2 signed epochs, independent stored-order recovery,
queued LP exits that precede the next epoch, and a bounded read-only execution
oracle with an independent BigInt execution reference. Epochs now retain their
opening pool state and authenticated LP roster, with validation before execution.
Small-domain discrete research now exposes funding and rounding incentive failures
in candidate integer adaptations; no production mechanism is selected.
The two-sided exact-lot candidate has further price-support and fractional
redemption limits. The paper's incentive guarantees remain the research target.
See [checkpoint 4E](./reviews/CHECKPOINT_4E.md) for that candidate and its net-flow
tests, [checkpoint 4D](./reviews/CHECKPOINT_4D.md) for the original discrete counterexamples,
[checkpoint 4C](./reviews/CHECKPOINT_4C.md) for snapshot scope and limitations,
[checkpoint 4B](./reviews/CHECKPOINT_4B.md) for reference/domain comparisons and
[checkpoint 4A](./reviews/CHECKPOINT_4A.md) for authenticated exact quotes,
[checkpoint 3B](./reviews/CHECKPOINT_3B.md)
for exit processing and donation limits, [checkpoint 3A](./reviews/CHECKPOINT_3A.md)
for order recovery, and [checkpoint 2B](./reviews/CHECKPOINT_2B.md) for assets. These
changes have not been deployed, and the existing wallet dashboard and published
Sepolia addresses still target the earlier prototype.

The current settlement verifier accepts feasible allocations without enforcing
the paper's canonical allocation/payments. Integer incentive guarantees
and historical LP rewards remain unfinished. Concentrated positions can be
custodied, but concentrated
batch execution is blocked pending concentrated snapshot/execution integration and mechanism
gates. The quote/reference alone do not implement canonical payments or
enable concentrated auctions. This checkout does not establish optimal trading
or truthfulness.

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
| `solver/` | Legacy references, an independent BigInt execution model, and bounded discrete mechanism research with exhaustive comparison. |
| `contracts/` | `OtterOrderBook`, `OtterSettlement`, `OtterHook`, and fixed-point invariant checks. |
| `harness/` | Sandwich-attack comparison (vanilla Uniswap v4 vs. Otter) and settlement-cost benchmarks. |
| `fixtures/` | Saved legacy verifier vectors, demo data and separately labeled discrete research counterexamples. |
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
- **Opening epoch records.** The first accepted order stores the pool key,
  manager, price/tick/liquidity, fee fields and up to 32 authenticated LP records.
  Later admission and settlement check the opening state; donations and exit
  reservations leave it intact. Historical records survive exits and new epochs.
  This does not yet allocate historical rewards or supply a production RPC reader.
- **Concentrated execution gate.** Range positions are supported for custody.
  Order admission and swaps reject pools containing funded concentrated
  positions while the legacy auction still uses constant-product reserves.
- **Exact read-only execution quote.** `OtterExecutionOracle` authenticates
  live pool/tick/bitmap state and models zero-fee core swaps through tick
  crossings, empty words, gaps, and price limits. It reports consumed input,
  output, and final state. Only `Complete`/`PriceLimit` results are usable;
  traversal failures are unsupported. It does not change settlement, reserve
  liquidity, or model arbitrary hooks or token delivery.
- **Independent execution reference.** `solver/src/execution.ts` uses integer
  fractions and a binary-search tick inverse, with the same supported domain and
  result statuses. Tests compare it with the oracle and real PoolManager swaps.
  Missing bitmap/tick data fails explicitly. This is an offline execution model;
  the legacy auction solver still has its documented payment and tie failures.
- **Discrete mechanism research.** `solver/src/discrete-research.ts` maximizes
  exact linear welfare on fixed small one-sided domains and computes raw pivots,
  with independent exhaustive checks. It preserves partial-capacity diagnostics
  and exposes deficits without clamping. Candidate ceil/refund policies have
  funding or incentive counterexamples; these tests do not enforce canonical
  settlement or establish integer truthfulness or sybil resistance.
- **Two-sided candidate research.** `solver/src/lot-candidate.ts` tests exact
  reciprocal exchange lots, minority funding, residual swaps and raw dominant
  pivots against full net-flow utility. Exact lots exceed the accepted input
  bound at most sampled tick prices. Fractional claims are not implemented and
  do not establish immediate underlying-token IR; ceil rounding still rewards
  some deviations. No candidate is selected or integrated into settlement.
- **Representation research.** `solver/src/representation-research.ts` checks
  exact rational spot payments, fractional debt/redemption and actual residual
  input. Fixed decimal credits cannot represent every spot payment; output
  claims do not guarantee whole-token IR or fractional v4 input. Two unchanged
  allocation outcomes rule out every whole payment satisfying both IR and
  truthfulness under their stated assumptions. This is scoped research, not an
  impossibility theorem for every redesigned mechanism or an implemented asset.
- **Integer cost-grid research.** `solver/src/cost-grid-research.ts` computes
  exact per-lot integer pivots and independent finite welfare. A scoped one-sided
  argument supports funding/IR and same-direction false-name resistance for
  true integer costs; it does not prove the two-sided rule. Rounding original
  valuations into that grid fails in published cases. Larger value-preserving
  lots also lose next-batch admissibility after a real v4 swap. The production
  order domain and minimum-output contract are unchanged.
- **Whole-payment allocation limits.** `solver/src/transfer-research.ts` checks
  original WAD-valued fill responses against exact truthful-payment constraints.
  In a real-v4 case, all raw partial fills still force a welfare tradeoff under
  whole payments. Verifiable negative cycles prove scoped infeasibility; this
  is necessary single-user research, not a full mechanism impossibility claim.
  See [checkpoint 4H](reviews/CHECKPOINT_4H.md) for the assumptions and limits.
- **Batch-active guards.** LP changes and fee collection are frozen from the
  first accepted order through complete settlement or explicit expiry.
  Anyone can expire an epoch at its fixed execution deadline without token
  calls, then credit each stored refund independently. Callback guards preserve
  the freeze during asset transfers. Owners can reserve an irrevocable exit
  during collection; it changes no liquidity or current admission. After economic
  completion, anyone can process each exit into owner claims. Next-epoch admission
  and new LP deposits wait until the queue is empty.
- **Explicit permissions.** The hook address carries only before-swap,
  before-add-liquidity, before-remove-liquidity, and before-donate flags.
- **Bounded donation accrual.** Uncollected donations per pool/currency cannot
  exceed `2^120 - 1`. Harvested fee credits release capacity; principal withdrawals
  and claim delivery do not. This prevents donations from overflowing core fee
  deltas and blocking LP exits.
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
# Includes local BigInt comparisons; Node with TypeScript strip support must be on PATH.
cd contracts && forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'

# Web dashboard
cd web && yarn && yarn dev
```

## Project documents

- [`deployment.md`](./deployment.md) — full Sepolia deployment record: every contract address (`OtterOrderBook`, `OtterSettlement`, `OtterHook`, demo tokens), pool configuration, the transaction-by-transaction deployment trail, and Etherscan verification links.
- [`CORRECTIONS.md`](./CORRECTIONS.md) — known divergences from the source paper.
- [`FEEDBACK.md`](./FEEDBACK.md) — open feedback and review notes.
