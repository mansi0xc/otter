# Checkpoint 4D — discrete allocation and payment research

Prepared 4 October 2026. Starting revision: user-created commit `caca1bd`.
Status: implemented and validated locally, pending the user-created commit.
The user creates every commit. No deployment or live transaction is included.

## Result and scope

An exact optimizer does not by itself supply a funded integer auction. This
checkpoint reproduces deficits, impossible whole-unit IR payments at particular
optimal fills, and profitable deviations against two candidate rounding/fallback
policies. It adds a bounded laboratory and independent enumeration rather than
selecting those policies for production. G1–G3 remain open. No production
contract or legacy auction solver changes in this checkpoint.

The [paper's one-sided construction](https://arxiv.org/html/2609.03474v1#S3)
uses linear-cost welfare maximization and leave-one-out pivot compensation;
its funding argument uses a continuous concave output function. The laboratory
tests adaptations to finite, integer v4 output. Its failures do not disprove
the paper under its assumptions, or prove that every adapted mechanism fails.

## Reproducible research implementation

`solver/src/discrete-research.ts` fixes **one direction** and a report-independent
snapshot, price limit, positive input lot and finite quantity table. Monetary
arithmetic uses BigInt. Each `executionTable` quote starts from the same supplied
opening state. Only complete consumption of the requested quantity defines a
table point. Partial and unsupported requests become `null`, while their exact
quote diagnostics remain available. No requested amount is silently replaced
by its smaller actual consumption.

For fills `y_i` and WAD-scaled asks `a_i`, the objective numerator is:

```text
W(S) = max [10^18 * F(sum y_i) - sum a_i * y_i]
p_i numerator = a_i * y_i + W(S) - W(S without i)
```

Fills are multiples of the fixed lot, bounded by each reported budget and the
supported quantity table. Unspent sub-lot remainders remain explicit. Compare
welfare first, then prefer more total input. At a fixed total input, prioritize
smaller `(ask, supplied 32-byte identity key)`. This is a deterministic research
tie rule; these keys are neither authenticated nor computed from signed orders.
It supplies no identity-grinding or sybil guarantee.

Two allocation implementations compare every allocation, welfare value and
leave-one-out raw payment: a scan of all total quantities with cheapest-prefix
linear cost, and an independent Cartesian enumeration evaluating each feasible
fill vector directly. The scan does **not** assume concavity or stop at the
first unfavorable marginal increment. All leave-one-out calculations retain
the same snapshot, domain and lot. Neither implementation rounds costs while
optimizing. The result exposes raw payment numerators, floor/ceil alternatives,
integer IR minima, deficits and signed residuals without hiding a negative pot.

Limits are at most 8 supplied bids, 64 input lots and 100,000 Cartesian vectors.
Asks/budgets retain the existing uint128/uint96 bounds and table output is at
most uint120. Zero budgets are permitted for research deviations only. These
limits bound this offline program; they are **not** on-chain gas evidence or
proposed production lot/minimum-trade settings. A raw-unit scan of a uint96
budget is not scalable. Snapshot maps are supplied, not authenticated by this
module. It defines no spot-eligibility filter, majority selection, two-sided
netting, native payout, LP utility or complete settlement function.

## Counterexamples

All quantities/payments below are **raw token units**, not human whole tokens.
Asks are the corresponding output/input rate with WAD scaling in the code.
Passing these negative controls demonstrates a candidate's failure; it does
not close R2, R6 or R7.

### 1. A raw pivot deficit exists before payment rounding

At opening sqrt price `2^96`, full-range liquidity 1,000, spacing 1 and a
downward price limit at tick -100, the exact output table for requested inputs
0 through 8 is:

```text
requested input:  0  1  2  3  4  5  6  7     8
usable output:   0  0  1  2  3  4  4  null  null
```

With two sellers each asking zero and budgeting one, optimal fills are `[1,1]`
and output is 1. Removing either seller leaves output 0, so both pivots are 1.
Their total payment 2 exceeds available output 1 even with exact raw payments.
This rules out replacing the continuous curve by the literal integer quote
and assuming the pivot funding bound still holds.

### 2. Some optimal fills cannot retain whole-unit IR without funding

For the same two one-unit budgets, set each ask to 0.1. Both filling gives
welfare 0.8, while one filling gives negative welfare and neither gives zero.
Every integer IR payment is at least `ceil(0.1 * 1) = 1`; only one output unit
exists. No payment vector can retain **these particular optimal fills**, whole
output units, both individual IR and no external funding. A fix must change at
least one of those choices. This is not an impossibility theorem for other
allocations, objectives or compensation representations.

At ask 0.5 each, the specified quantity-maximizing zero-welfare tie fills both.
Raw pivots are `[0.5,0.5]`, which are funded. Floor payments `[0,0]` fail IR;
ceil payments `[1,1]` create a deficit. Rounding adds a separate failure even
when the raw vector itself is funded.

### 3. Refunding every insolvent candidate changes incentives

On the same curve, seller A's true ask is zero and budget 2; seller B asks zero
with budget 1. Honest optimal fills `[2,1]` produce 2 and pivots `[2,1]`, which
are insolvent. The negative-control `refundOnDeficit` policy refunds everyone.

If A reports ask 1 instead, the quantity-maximizing welfare tie still selects
`[2,1]`, but payments become `[2,0]` and fit output 2. A's true utility rises
from 0 under the honest refund to 2. The reported ask is spot-eligible at 1:1.
This rejects that fallback as an incentive-preserving fix. Production currently
does not execute this laboratory policy.

### 4. Funded ceil payments can reward a single ask misreport

Use sqrt price `3 * 2^96 / 2`, full-range liquidity 1,000 and spacing 60.
Fix the downward limit to the final price for a one-unit quote. The complete
table is `[0,2]`: requests of 2 or more reach the limit after consuming only 1.
This finite prefix is integer-concave and is fixed independently of reports.

A truly asks 0.75 with budget 1; B asks 0.5 with budget 1. A loses honestly.
Reporting 0.25 lets A win; its raw critical payment is 0.5 and the ceil policy
pays 1. Its true utility becomes `1 - 0.75 = 0.25`. Both outcomes are funded
and satisfy reported integer IR. Concavity plus rounding therefore does not
establish exact dominant-strategy truthfulness.

### 5. Splitting identities captures payment-rounding dust

At that same opening state, fix the limit to the final price of a two-unit
quote toward `openingTick - 100`. The complete prefix `[0,2,4]` is
integer-concave; larger requests reach the limit after consuming only 2. This
capacity is enforced by the actual price limit, not an arbitrary table cutoff.
A asks 0.25 with budget 2, competing
with C asking 0.5 with budget 2. A receives raw and rounded payment 1.

Split A into two identities each asking 0.25 and budgeting 1. Their total fill
remains 2 and total raw compensation remains 1, but each 0.5 payment rounds up
to 1. Rounded compensation rises to 2, giving a one-unit profit. Both outcomes
remain funded and satisfy reported IR. These are supplied synthetic keys, not
a signed-order exploit or a measurement of hash grinding; the compensation
failure does not depend on winning a contested hash tie.

### 6. Minority spot flooring still conflicts with integer IR

At raw spot price 9/4, an eligible currency1 seller with budget 1 and ask 0.4
gets floor spot output `floor(4/9) = 0`, below its integer IR minimum 1. The
opposite orientation also fails at spot 1/4 with ask 0.2 and budget 1. Exact
spot arithmetic does not remove minority dust IR. This is a payment diagnostic,
not an implemented two-sided adapter.

## Limited analytical conclusions

The laboratory admits a **local** concavity certificate only if all supported
points form a prefix `0..C`, output starts at zero, and every lot increment is
nonnegative and nonincreasing. Holes fail certification. It says nothing about
unqueried inputs, authentic state, the opposite direction or a production
minimum trade size. A coarser fixed lot can pass on particular tables; it is not
automatically a mechanism-wide fix.

For this fixed one-sided domain, let `G(q)` be output at q lots. Write payments
in raw output units as rational `p_i` and integer filled lots as `x_i`, with
`Q = sum x_i`. Optional participation
gives `p_i >= a_i * y_i / 10^18`, hence `ceil(p_i)` satisfies integer IR. Removing
i and retaining everyone else's fills is feasible, giving:

```text
p_i <= G(Q) - G(Q - x_i).
```

The right side is integer, so the same upper bound holds for `ceil(p_i)`.
For a certified table, its piecewise-linear concave extension and `G(0)=0`
give `G(Q)-G(Q-x_i) <= x_i * G(Q)/Q` when Q>0. Summing proves ceil payments
are funded **under these finite, fixed-domain assumptions**. At Q=0 all
payments are zero. The staircase counterexamples fail the certificate. This
funding argument does not prove exact incentives, as examples 4–5 show.

There is also a limited single-identity rounding bound. With fixed direction,
domain, lot and other reports, linear true utility and no LP utility, a raw
pivot utility equals true welfare of the selected outcome minus the same
leave-one-out constant. Truthful optimization maximizes that welfare. Any ask
or budget misreport whose selected fill remains within the **true** budget has
raw utility no greater than truthful utility. Ceiling changes one identity's
payment by an amount in `[0,1)`, so its improvement over truthful **rounded**
utility is strictly less than one raw output unit.

This is not exact DSIC, the paper's complete UIC result, or a system-wide sybil
bound. It excludes direction changes, multiple identities, LP rewards, changed
domains, eligibility/side selection, repeated epochs and the refund fallback.
It does not establish economic insignificance for every token. When raw
payments are insolvent, those utilities are algebraic diagnostics rather than
executable funded transfers. The exact test grid supports the scoped bound;
random testing is not its proof or a substitute for independent review.

## Validation

- `cd solver && npm test`: 8 legacy property groups, 20 exact execution groups,
  and **17 discrete research groups passed**. Legacy properties concern their
  earlier model and do not certify the new integer candidates.
- Every published one-sided candidate/counterfactual matches the independent
  Cartesian optimizer. Seeded tests compare 3,000 batches across 18 execution
  tables (both directions, full-range/concentrated ranges, lots/remainders).
- Another 1,000 generated finite integer-concave tables have funded ceil
  pivots and integer IR. An exhaustive grid checks **28,665 feasible
  single-identity ask/budget deviations** against the limited bound, including
  staircase cases whose unfunded utility is only an algebraic diagnostic.
- Four new `OtterDiscreteMechanismTest` cases anchor the critical tables to
  actual pinned PoolManager swaps and oracle final-state/delta comparisons.
  These exercise zero raw output, integer funding/IR conflicts, input 3's
  output 2, partial consumption and the `[0,2,4]` table with a real two-unit
  price-limit capacity. Payment enumeration
  remains offline; this is not an implemented on-chain auction proof.
- Full contract suite excluding the two artifact-writing benchmark harnesses:
  **268 tests passed across 25 suites**, including the existing 512-run
  reference/oracle/core differential fuzz test. No saved economic benchmark or
  legacy verifier vector is regenerated.
  After strengthening the split-order fixture to use a real two-unit price
  limit, all four affected core tests and all 17 discrete groups passed again.
- `node --experimental-strip-types test/grant-review.ts` still confirms the
  known legacy minority dust, arrival-tie and arithmetic-domain failures.
- Solidity formatting, offline build and whitespace checks pass. Production
  Solidity is unchanged; no new production gas/bytecode limit is claimed.
  The build retains existing lint notes and a sandbox signature-cache warning,
  with no compilation error.

`fixtures/research/discrete-counterexamples.json` reproduces byte-for-byte from
`cd solver && node --experimental-strip-types research/discrete-cli.ts`.
The CLI writes JSON to stdout, has no RPC or transaction path, and uses decimal
strings for every BigInt. The fixture is explicitly a negative-control research
artifact, not a valid settlement witness or economic benchmark.

## Next work and remaining grant blockers

Select and analyze a complete adaptation with explicit tradeoffs for allocation,
payment representation, finite capacity, lots/dust, both-side integer IR and
identity splitting. Preserve independent small-domain checks before scaling it.
Changing the objective to include per-order integer minima, fractional claims,
rounding subsidies, clamping or pro-rata compensation changes mechanism rules;
none inherits pivot truthfulness merely from satisfying a balance constraint.
The tested whole-batch refund shortcut has a concrete incentive failure.

G1/G2 remain unresolved. G3 must measure the **selected complete algorithm**
and every counterfactual under authenticated state bounds. This offline scan's
small caps and a single quote's gas cannot justify an on-chain verifier. Step 5
and concentrated auctions stay gated. Existing R2 noncanonical settlement, R6
minority IR and R7 historical LP reward capture remain open, as do concentrated
snapshot integration, actual partial-settlement accounting, wallet migration,
testnet evidence, independent reviews, economic comparisons and the grant package.

## User-created commit handoff

Include exactly these files:

```text
README.md
contracts/test/OtterDiscreteMechanism.t.sol
fixtures/README.md
fixtures/research/discrete-counterexamples.json
reviews/CHECKPOINT_4C.md
reviews/CHECKPOINT_4D.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/research/discrete-cases.ts
solver/research/discrete-cli.ts
solver/src/discrete-research.ts
solver/test/discrete-research.ts
```

Suggested title:

```text
test: expose integer auction funding and incentive failures
```

Suggested explanation:

> Add bounded exact welfare/pivot research, independent exhaustive checks and real-v4 counterexamples. Preserve unsupported capacity and document funding, IR, rounding and false-name failures without enabling canonical or concentrated settlement.

Create the commit and confirm completion before the next implementation slice.
