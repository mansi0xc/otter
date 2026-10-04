# Checkpoint 4F — compensation representation and actual-input gaps

Prepared 5 October 2026. Starting revision: user-created commit `5d6415e`.
Status: implemented and validated locally; committed by the user as `d37d48b`.
The user creates every commit. No deployment or live transaction is included.

## Outcome

An output-credit ledger alone cannot repair the exact-lot candidate. Fully
backed fractional compensation can miss the signed minimum underlying output;
fixed decimal precision cannot express every exact spot payment; and fractional
minority compensation can leave an input v4 cannot execute exactly. We also
establish a **scoped contradiction for any whole payment preserving two
published allocation outcomes**, rather than testing only one rounding formula.

No production mechanism, changed order contract, fractional token, subsidy or
weaker incentive target is selected. The user's priority remains preserving
the paper's guarantees; whole-token per-order IR remains the product target.
This result narrows the design search. It is not an impossibility theorem for
all revised allocations, all asset systems or all Otter implementations.

The [paper's model](https://arxiv.org/html/2609.03474v1#S2) uses divisible amounts
and a continuous concave curve. Its [two-sided construction](https://arxiv.org/html/2609.03474v1#S4)
pays the minority at exact spot and trades the dominant residual with the pool.
The following diagnostics concern adapting that construction to underlying
integer tokens and the pinned v4 implementation; the paper's theorem does not
establish correctness of these adapters.

## 1. Changing the rounding formula cannot preserve these two fills

Use 4E's real-core-backed frame: spot 9/4, input lots 4 and 9, minority one lot,
and residual pool capacity one lot. Hold all other reports, identity and budget
fixed. The controlled currency0 seller has two reports:

| Reported ask per input unit | Fill | Unrounded output compensation |
|---|---:|---:|
| 3/16 | 0 | 0 |
| 1/16 | 4 | 1/2 |

Consider **any deterministic whole output payment p** keeping those fills and
zero compensation for the losing report. For a true ask 1/16, reported IR at
the winning outcome requires `p >= ceil(4/16) = 1`. For a true ask 3/16,
truthfulness against submitting the lower report requires `p <= 12/16 = 3/4`.
No integer p satisfies both. Paying at least one unit creates a deviation gain
of at least 1/4 for the higher type; paying zero fails the lower type's IR.

This uses two admissible WAD asks, not a continuum or an assumed critical-value
theorem. The test recomputes both allocations independently and enumerates
payments 0 through the available 17 output units. Another 49 report pairs use
independent Cartesian allocation calculations and exhibit the same conflict.
Adding backing cannot repair these inequalities while preserving their premises.

**Scope:** unchanged fills, deterministic whole payments, linear underlying
utility, zero losing compensation and no fees/reward side channels. Changing
allocations, losing transfers, asset valuation, input charges or the accepted
type domain requires a new rule and proof. This does not establish that every
integer mechanism is impossible. Nominal unrounded claims retain the previous
research evidence, but change what the user receives and can immediately redeem.

## 2. A precise fractional ledger retains debt, not immediate IR

`solver/src/representation-research.ts` adds an immutable **offline arithmetic
model**, not a Solidity claim contract. Each currency ledger records whole cash,
a fixed credit scale, locked escrow, exact individual output/refund claims and
an explicitly assigned community claim. Its invariant is:

```text
cash * scale >= escrowCredits + traderCredits + communityCredits
```

All pools sharing one currency must be included in that currency's backing.
Different currencies cannot cover each other's liabilities. Actual owned
PoolManager credits can be backing in a future contract, but moving an asset
between cash and manager credits must not count it twice. This model uses cash
only; it implements no manager, delivery, callback or authorization integration.

The model enforces these arithmetic rules:

- Individual credit transfer preserves the exact liability. Transfers assume
  owner authorization; transferability alone establishes no market price.
- Redemption delivers only whole units and burns exactly `raw * scale` credit.
  Every unpaid fraction remains owned by that account. No automatic forfeiture,
  ceiling, subsidy or dust sweep is applied.
- Community delivery consumes only its own assigned credit. It cannot use
  locked escrow, another pool's claim or an unpaid trader fraction.
- Operations return new states. Invalid or underfunded transitions leave the
  source state intact. The model's 64-account cap bounds research work only.

In 4E's truthful batch the output pot is 17 currency1 units. Two traders own
3/4 credit each; the community owns 15 1/2. Each original trader's signed
minimum is one whole unit, but each can initially redeem zero. Delivering 15
community units leaves cash 2 backing trader debt 1 1/2 and community debt 1/2.
With voluntary aggregation, the traders' combined 1 1/2 credit can redeem one
unit, retaining 1/2 trader debt and 1/2 community debt against cash 1.

Aggregation requires consent and does not establish each original order's
immediate IR. Selling a credit requires a counterparty and a price. Delaying
payment introduces waiting and redemption assumptions absent from a guaranteed
underlying transfer. A lottery paying one unit with probability 3/4 has the
nominal expected payment, but its zero-payment outcome fails whole-token IR;
this does not establish truthful expectation, secure randomness or full UIC.

**Future backing hazard:** subtracting only the floors of those trader claims
would classify all 17 units as sweepable. After that sweep, 1 1/2 trader debt
would have zero backing. The model rejects it. This is a negative control for
a proposed fractional system, not a newly identified production ledger bug.
Ordinary integer claim custody is not changed by this checkpoint.

## 3. More decimal places do not solve general exact spot payments

For opening sqrt price P, one raw currency0 unit has exact spot compensation
`P^2 / 2^192`; the reciprocal compensation is `2^192 / P^2`. For a reduced
fraction a/b, a fixed credit scale S represents it exactly iff `b divides S`.
`creditPrecision` exposes any missing fraction instead of silently truncating it.

At P = 3/2 * Q96, the reciprocal is 4/9. It cannot be represented by **any**
power-of-ten scale because 9 divides none of them. At core tick 1, neither
direction's one-unit spot compensation fits WAD or 36 decimal places. A
`2^192` credit scale represents all downward squared-price fractions, but not
generic reciprocals: tick 1's reduced reciprocal denominator has factors other
than 2 and 5. Decimal precision alone cannot represent that reciprocal either.
Multiples of a denominator can restore exactness, leading back to 4E's minimum
exchange-lot constraints. Arbitrary rational balances are a research possibility,
not an implemented bounded Solidity ledger or proof-compatible asset system.

The pinned [ERC6909](../contracts/lib/v4-core/src/ERC6909.sol) stores integer
balances; [PoolManager mint/burn](../contracts/lib/v4-core/src/PoolManager.sol)
account in the currency's raw units. A manager credit does not add fractional
underlying precision. Reinterpreting integers as finer credits needs a separate
representation, liability ledger and redemption contract.

## 4. Output claims leave a separate actual-input problem

Suppose Q whole dominant input units compensate a whole minority supply with
exact spot amount M. The prescribed residual is `r = Q - M`. If M is
fractional, r is fractional for every whole Q. A pool swap's integer
`amountSpecified` cannot express r. Exact rational credits on the output side
do not change that debit.

`diagnoseBridge` compares floor and ceil adapters using fixed-opening exact
execution quotes. It records the requested amount, actual consumed amount,
status and signed input assets remaining after the exact minority claim.
Neither partial nor unsupported execution is treated as complete. For a
complete quote:

| Actual residual input | Remaining dominant input after minority claims | Meaning |
|---|---|---|
| floor(r) | r - floor(r), between 0 and 1 | Retained fractional liability/backing or a separately owned reserve must be specified |
| ceil(r) | r - ceil(r), between -1 and 0 | Exact minority liabilities exceed available input backing without another funding/classification rule |

At spot 9/4, Q=1 currency0 and minority supply 1 currency1 require M=4/9,
so r=5/9. A floor swap is zero and returns zero. A ceil swap consumes 1 and
returns 2 currency1, leaving an input-backing deficit 4/9. In the opposite
direction, Q=3 currency1 and minority supply 1 currency0 require M=9/4:
r=3/4, with ceil input deficit 1/4. At ordinary tick 1, Q=10 currency0 and
minority supply 1 currency1 also leave a fractional residual; actual inputs 9
and 10 yield outputs **7 and 8**, including core's word-boundary step rounding.

The diagnostic additionally computes a straight interpolation of neighboring
quotes. At r=5/9 it is 10/9 output, while the floor swap produces zero. This
illustrates an output gap if interpolation is chosen as a compensation target.
**Interpolation is not executable, authenticated as a curve, selected as a
mechanism or proven globally concave.** A floor adapter can still fund particular
payments when they leave enough surplus; the diagnostic does not claim every
floor-based allocation is insolvent. It shows that neither adapter implements
the fractional trade literally. Ceil input funding and floor output/payment
rules require a complete new mechanism, not a hidden rounding adjustment.

A reserve-assisted adapter would need an explicit owner, funding source,
debit/credit limits, lifetime solvency, reserve exhaustion and recovery rules,
and an incentive analysis of reserve use. Changing input fills/refunds, shifting
the spot or issuing finer input assets also changes the allocation/valuation or
v4 integration. None is silently selected here.

## Validation and limits

- **15 new Node groups**, including 49 independently enumerated allocation
  witnesses, 5,000 seeded immutable ledger transitions across five credit
  scales, 500 seeded bidirectional ordinary-price bridge diagnostics, malformed
  data, retained dust/escrow, signed deficits, partial/unsupported status checks
  and byte-for-byte fixture reproduction.
- **74 total Node groups** pass via `cd solver && npm test`: 8 legacy properties,
  20 execution, 17 discrete, 14 lot candidate and 15 representation groups.
  Passing legacy floating-point properties do not resolve the documented
  integer verifier failures. The separate grant-review reproductions still
  confirm minority dust underpayment, arrival-sensitive ties and the old
  BigInt/Solmate multiplication-domain mismatch.
- **271 contract tests in 27 suites** pass via
  `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'`.
  The two new core tests compare read-only quotes with actual swaps in both
  directions at spot 9/4 and neighboring amounts at tick 1. Existing 512-case
  three-way execution fuzz comparisons remain included.
- Offline contract build and changed-test formatting pass. The two excluded
  suites write saved economic artifacts; they compile but are not rerun here.
  No legacy vectors or economic benchmarks are regenerated.
  The build retains existing lint notes and a sandbox warning when flushing
  Foundry's signature cache outside the workspace; compilation succeeds.

The rational helpers are unbounded BigInt research arithmetic; no Solidity bit
width, gas or canonical auction cost is established. The ledger assumes correct
liabilities, authorized operations and successful delivery. It implements no
escrow-to-claim finalization, signature revision, token market or actual reserve
adapter. The bridge does not compute a two-sided allocation or payments at
ordinary prices. Neither these tests nor a passing finite deviation grid
establish full UIC, builder resistance, LP incentives or repeated-epoch behavior.

## Next design gate

G1/G2 remain open. A proof-oriented redesign must either change the conflicting
allocation outcomes with an explicitly supported user/type domain, or define a
complete asset/curve adapter whose backing, redeemability and user utility
justify its incentive claims. Merely changing payment rounding, adding decimal
precision or collecting more passing nominal-claim grids cannot close the
demonstrated gaps. Any weaker guarantee or changed minimum-output contract
requires an explicit decision; the user's current priority is retained.

Before implementing step 5, require the complete supported rule, analytical
incentive/accounting arguments and independent mechanism review. Then G3 must
measure the full authenticated computation, including counterfactuals. Current
R2 canonical settlement, R6 minority IR, R7 historical surplus capture,
concentrated integration, wallet migration, economics and the grant package
remain open. Presenting this as completed MEV-resistant settlement would be
unsupported. These results can support a clearly scoped mechanism-research
milestone; they do not establish grant approval or production readiness.

## User-created commit handoff

Include exactly these files:

```text
README.md
contracts/test/OtterRepresentation.t.sol
fixtures/README.md
fixtures/research/representation-research.json
reviews/CHECKPOINT_4E.md
reviews/CHECKPOINT_4F.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/research/representation-cases.ts
solver/research/representation-cli.ts
solver/src/representation-research.ts
solver/test/representation-research.ts
```

Suggested title:

```text
test: expose compensation and residual input representation gaps
```

Suggested explanation:

> Add exact rational spot/input diagnostics, a fractional-credit backing and redemption model, and real-v4 comparisons. Establish a scoped whole-payment IR/truthfulness conflict and retain the original guarantee target.

The user committed this checkpoint as `d37d48b`. The clean tree was verified
before [checkpoint 4G](./CHECKPOINT_4G.md). The handoff above is historical.
