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
Historical residual rewards now credit opening owners through a separate funded
ledger; later liquidity cannot capture a past epoch’s surplus.
Small-domain discrete research now exposes funding and rounding incentive failures
in candidate integer adaptations; no production mechanism is selected.
The two-sided exact-lot candidate has further price-support and fractional
redemption limits. The paper's incentive guarantees remain the research target.
See [checkpoint 6A](./reviews/CHECKPOINT_6A.md) for historical reward accounting,
[checkpoint 4E](./reviews/CHECKPOINT_4E.md) for that candidate and its net-flow
tests, [checkpoint 4D](./reviews/CHECKPOINT_4D.md) for the original discrete counterexamples,
[checkpoint 4C](./reviews/CHECKPOINT_4C.md) for snapshot scope and limitations,
[checkpoint 4B](./reviews/CHECKPOINT_4B.md) for reference/domain comparisons and
[checkpoint 4A](./reviews/CHECKPOINT_4A.md) for authenticated exact quotes,
[checkpoint 3B](./reviews/CHECKPOINT_3B.md)
for exit processing and donation limits, [checkpoint 3A](./reviews/CHECKPOINT_3A.md)
for order recovery, and [checkpoint 2B](./reviews/CHECKPOINT_2B.md) for assets. These
changes have not been deployed. The hardened wallet now checks a separate v2
deployment manifest and uses receipt-based signing/recovery flows; it is disabled
by default because no reviewed deployment is configured. Published Sepolia
addresses and the tracked legacy web build still identify the earlier prototype.
See [checkpoint 7A](./reviews/CHECKPOINT_7A.md) and [wallet setup](./web/README.md).
The source wallet also exposes owner-checked LP exit requests, idle-pool processing
and separate native/ERC20 vault-credit withdrawals. Requests are irrevocable and
have no token-output minimum. This is a local recovery flow, not a deployment or
concentrated-auction completion; see [checkpoint 7B](./reviews/CHECKPOINT_7B.md).
The local wallet now records returned transaction hashes across reloads and
offers read-only receipt inspection, including recovery of verified admission
IDs. It stores calldata hashes, not reusable order signatures. This is browser
history rather than an authenticated indexer or finality guarantee; see
[checkpoint 7C](./reviews/CHECKPOINT_7C.md).

The next mechanism decision is documented in
[the independent review brief](./reviews/MECHANISM_REVIEW_BRIEF.md), with a hashed
source/fixture baseline and local reproduction commands. A
[research grant scope draft](./reviews/GRANT_RESEARCH_SCOPE.md) defines milestones,
evaluation criteria and outstanding budget inputs. Neither an independent review
nor a grant submission has occurred; [checkpoint 8A](./reviews/CHECKPOINT_8A.md)
records the prepared packet and fresh evidence checks.

The current settlement verifier accepts feasible allocations without enforcing
the paper's canonical allocation/payments. Integer incentive guarantees
remain unresolved. Opening LP rewards can also make an ask misreport profitable
when the trader owns LP capital, even under exact candidate pivots. Historical
rewards are implemented for admitted full-range pools; concentrated reward/auction
integration remains unfinished. Concentrated positions can be custodied, but
concentrated batch execution is blocked pending concentrated snapshot/execution
integration and mechanism gates. The quote/reference alone do not implement canonical payments or
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
| `web/` | Research dashboard and guided historical fixtures, plus a v2 wallet for checked native/ERC20 submission, stored-order recovery and independent trader/reward claims. Wallet writes are disabled until a reviewed deployment is configured. The September explorer links and tracked `dist/` are historical; no public solver is running. |

## Limitations

Stated up front rather than buried:

- The mechanism's guarantees require **censorship resilience at the consensus
  layer** (Theorem 23). A testnet does not provide this.
- The local settlement checks budget/curve feasibility and signed minimum output
  on both sides. A minority spot floor below its signed minimum now reverts;
  it is neither topped up nor omitted. Some batches can therefore require expiry
  and stored refunds while the full discrete rule remains unresolved. See
  [checkpoint 4I](./reviews/CHECKPOINT_4I.md).
  **Canonical welfare-optimal allocations and payments are not enforced
  on-chain.**
- The legacy solver's `selfCheck` now checks minority fills/payments/minima and
  derives crossing totals from the orders, with bounded unsigned inputs. Its
  success means offline arithmetic feasibility for the current full-range rule;
  it does not authenticate pool state or establish successful execution,
  canonical payments or incentives. `solveExact` can still return a rejected
  candidate. See [checkpoint 4J](./reviews/CHECKPOINT_4J.md).
- Opening ownership prevents later LPs from taking historical rewards. It does
  not preserve combined trader/LP truthfulness: an exact-pivot counterexample
  increases an existing LP trader's funded reward with the same trade and pool
  state. G4 requires a joint redistribution design; see
  [checkpoint 6B](reviews/CHECKPOINT_6B.md).
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
  The v2 snapshot also binds capital weights and the fixed reward policy.
  A bounded raw-core reader now collects quote state at one block hash;
  production provider/indexer and authenticated concentrated epoch integration
  remain unfinished. See [checkpoint 4K](./reviews/CHECKPOINT_4K.md).
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
- **Read-only state collection.** A callback-based RPC reader checks the chain
  and configured manager runtime fingerprint, pins code/storage reads to one
  canonical block hash and fetches only the quote's visited words/ticks. It
  rejects missing/malformed state and detected block changes, with at most 82
  storage calls. Its local tests compare exported real core storage, exact quotes
  and native/concentrated swaps. It is not an authenticated epoch or live provider
  integration; concentrated auctions remain gated.
- **Bounded exhaustive execution curves.** The same reader can collect every raw
  input 0–64 in one or both declared directions from one shared opening block.
  Storage is reused, while each quote keeps its own traversal limits and actual
  consumption. Partial/unsupported points remain explicit. These small research
  tables neither interpolate the curve nor set a production trade-size rule;
  see [checkpoint 4L](./reviews/CHECKPOINT_4L.md).
- **Opening-record content binding.** A pure helper checks the book's v2 snapshot
  hash, full-range LP roster and capital weights, then verifies every curve
  field and sparse tick record against that context. It returns fixed metadata
  and a curve-content hash. The caller must authenticate the supplied anchor;
  this is not a live book reader or execution authorization. See
  [checkpoint 4M](./reviews/CHECKPOINT_4M.md).
- **Pinned opening-epoch collection.** A read-only helper checks configured
  book/vault/hook/settlement/manager fingerprints and wiring, collects the opening
  record and curves at one block hash, and enforces the current closed window and
  caller's solver exclusivity. Book/vault assertions reject live drift. RPC and
  configured fingerprints remain trust inputs; canonical outcomes and future
  execution are unverified. See [checkpoint 4N](./reviews/CHECKPOINT_4N.md).
- **Complete stored-batch binding.** A read-only extension binds all admitted
  orders to their rolling digest and signing domain, checks recovery/nonce bits,
  and requires native/ERC20 custody to cover shared escrow plus claims at the
  same block hash. Original budgets remain intact; bounded quote prefixes do
  not cover them automatically. See [checkpoint 4O](./reviews/CHECKPOINT_4O.md).
- **Original-prefix coverage inventory.** A pure helper compares original summed
  side budgets with the bound tables, distinguishing missing, unsupported and
  partially consumed inputs. It inventories record/address removals and rejects
  incomplete data for whole-input experiments. This verifies no economic outcome
  or incentive theorem. See [checkpoint 4P](./reviews/CHECKPOINT_4P.md).
- **Bound stored-batch pivot diagnostics.** A pure adapter checks complete small
  one-sided original domains and every record/address removal with independent
  optimizers. Actual book/core tests expose record funding deficits and a funded
  aggregate that cannot meet original per-record minima. Address grouping remains
  a comparison hypothesis; no payment rule is adopted. See
  [checkpoint 4Q](./reviews/CHECKPOINT_4Q.md).
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
- **Reward composition research.** An exact-pivot case with real v4 swaps and
  funded reward claims gives an existing LP trader a profitable ask deviation.
  Same-range splitting cannot increase controlled cash under the fixed-state
  arithmetic assumptions, but this does not prove general LP incentives.
  [Checkpoint 6B](reviews/CHECKPOINT_6B.md) records the reproduction and G4
  requirements; no replacement redistribution rule is selected.
- **Redistribution design research.** An offline pre-funded calendar freezes
  auxiliary claims before a cutoff and releases them independently of trading.
  Its preservation argument requires fixed history and unchanged feasible utility.
  Delays, cap thresholds, caller-started epochs, later funding and alternate
  wallet-flow gates have explicit limits. The current-pot destination and full
  multi-epoch/LP guarantee remain unresolved; no calendar is deployed or selected.
  See [the design proposal](reviews/REDISTRIBUTION_DESIGN.md) and
  [checkpoint 6C](reviews/CHECKPOINT_6C.md).
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
- **Historical LP rewards.** Residual cash is assigned during settlement using
  opening principal-value weights. Owners retain independently withdrawable
  claims after exit; new liquidity receives no past pot. Exact rounding dust
  is credited to a fixed community recipient. Initial registration is owner-only;
  the default dust recipient is that deployment owner. Otter surplus never enters
  position fee growth. This does not resolve solver payment discretion or prove
  LP/builder incentive compatibility.

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
