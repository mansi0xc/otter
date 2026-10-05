# Checkpoint 4G — integer cost grids and repeat-batch lot failure

Prepared 5 October 2026. Starting revision: user-created commit `d37d48b`.
Status: committed by the user as `5841493`; clean tree inspected before 4H.
The user creates every commit. No deployment or live transaction is included.

## Outcome

There is a useful **finite one-sided analytical argument** for exact integer
costs per input lot: pivot payments are integers, are funded on a certified
concave table and resist feasible same-direction value/budget/false-name
deviations under the stated assumptions. Independent enumeration and a separate
layer-cake calculation check the argument's components. This is a restricted
result, not a full two-sided theorem or a selected production mechanism.

It does not solve the original order domain by automatically rounding values:
ceiling a fractional true cost can permit a profitable misreport, and flooring
can violate signed minimum output. Larger lots can preserve every original WAD
ask mathematically, but retain severe asset/price limits. A real v4 residual
swap from an admissible special opening price moves the pool to a price where
**even the primitive exact exchange lots exceed the entire uint96 input bound**.
The proposed exact-lot family cannot admit the next batch at that ending price.
This is a candidate-policy failure, not a new freeze in the current contracts.

The user's priority remains preserving the paper's guarantees. The existing
WAD-valued orders, whole-token IR contract, production settlement, signatures
and concentrated gate are unchanged. No restricted cost domain, new signature,
large minimum lot, rounding fallback or weaker incentive guarantee is selected.

## Candidate and representation

`solver/src/cost-grid-research.ts` introduces a separate `CostBid` field:
`costPerLot`, an **exact integer number of output raw units for one input lot**.
It is not an automatically quantized version of the production WAD ask. Raw
budgets remain integers; complete input lots can fill and remainders stay unspent.
Zero budgets are permitted for research types only.

The one-sided adapter optimizes in lot-index space. It reuses 4D's quantity scan
and independent Cartesian solver, representing the integer cost exactly as
`costPerLot * WAD` per index unit. It converts selected lot counts back to actual
raw input. Every welfare and pivot numerator must divide WAD exactly; there is
no payment floor, ceiling, clamp or subsidy. The diagnostic retains deficits
on uncertified tables instead of adding a bid-dependent reject/refund policy.

The two-sided calculation retains 4E's fixed exact reciprocal exchange lots,
eligible complete-lot supply counts, currency0 dominance tie, minority spot
matching and actual residual quote table. Eligibility is `costPerLot <= output
spot lot`. It computes dominant pivots on the fixed selected augmentation,
including exact minority supply. Removing a dominant record does not rerun
majority selection. Minority/ineligible `withoutWelfare` entries are labeled
zero placeholders, not recomputed whole-auction counterfactuals. Both currencies'
signed residuals remain visible.

Bounds remain 8 supplied records, 32 eligible lots per side, 32 residual lots
per direction, uint96 raw individual/aggregate budgets and uint120 outputs.
The cost bound `(2^128-1)/WAD` allows reuse of the existing index-space optimizer;
it is a laboratory bound, not a selected production field width. An exact
mathematical conversion of an original ask can exceed this computational bound.
Those values are diagnostic and never silently admitted or clamped. Supplied
IDs and tables remain unauthenticated; no on-chain cost-grid verifier exists.

## Finite one-sided argument

This adapts the [paper's one-sided pivot and submodularity approach](https://arxiv.org/html/2609.03474v1#S3)
to a finite table of indivisible input lots and integer costs. It does not
inherit the paper's full continuous/two-sided theorem. The argument below is
specific to this laboratory's mathematical model and needs independent review.

### Assumptions

Fix one direction, input lot L and a report-independent supported prefix
`G(0),...,G(C)`, with `G(0)=0`. Every G value is an integer output quantity.
Marginals `a_j=G(j)-G(j-1)` are nonnegative and nonincreasing. Unsupported tail
points are outside this fixed domain; there are no holes in the prefix.

Each admitted report i has integer cost c_i per lot and capacity
`k_i=floor(rawBudget_i/L)`. The optimizer maximizes

```text
W(S) = max [ G(sum z_i) - sum(c_i*z_i) ],
       integer 0 <= z_i <= k_i, sum z_i <= C.
```

Prefer larger total quantity on welfare ties, then the published cost/ID fill
priority. All counterfactuals retain the same table and other reports. Do not
include fees, LP/community rewards, claim discounts or admission displacement
in this utility model. A real user has one true integer cost c per lot, a true
raw budget q and linear utility `receivedOutput - c*inputLotsSold`.

### Exact payments, IR and funding

For selected quantities z and Q=sum z_i, pay

```text
p_i = c_i*z_i + W(S) - W(S without i).
```

Every term is integer. Optional participation gives `W(S)>=W(S without i)`,
so truthful IR holds without payment rounding. Leaving other fills unchanged
after removing i gives

```text
p_i <= G(Q) - G(Q-z_i).
```

For Q>0, this suffix of z_i nonincreasing marginals has average no larger than
the average of all Q marginals. Consequently
`G(Q)-G(Q-z_i) <= (z_i/Q)*G(Q)`. Summing over i gives `sum p_i <= G(Q)`.
At Q=0, every payment is zero. This is a finite integer accounting argument;
it does not require a continuous derivative, strictly increasing curve or an
unbounded input domain.

### Independent layer-cake identity and submodularity

Sort the offered unit costs into nondecreasing order. Concavity makes the
sequence of marginal rewards minus those sorted costs nonincreasing, so the
optimal welfare is the sum of its positive terms. For a threshold t, define

```text
D_G(t) = number of curve marginals a_j > t;
A_S(t) = sum k_i over reports whose c_i <= t.
```

Both qualifying sets are prefixes of their ordered lists. The count of matched
positive cost/reward intervals covering t is `min(D_G(t), A_S(t))`. Integrating
those interval lengths yields

```text
W(S) = integral from 0 to infinity of min(D_G(t), A_S(t)) dt.
```

Values at individual breakpoints have zero measure. `layerCakeWelfare` computes
the integral over distinct cost/marginal breakpoints, with exact BigInts and no
loop over price units. At fixed t, A is a modular nonnegative sum and D is a
fixed cap. Capping such a sum is monotone and submodular; summation over the
breakpoint intervals preserves both properties, with `W(empty)=0`.

### Same-direction coalition/false-name bound

Fix other reports O. Let one real user submit any finite same-direction
collection I of cost/budget reports, with actual aggregate sold quantity Z
lots. If `L*Z > q`, its utility is catastrophic. For feasible deviations,
submodularity gives

```text
sum over i in I [W(O union I)-W((O union I) without i)]
    <= W(O union I)-W(O).
```

Substituting the payment formula bounds the user's deviating utility by

```text
G(Q) - sum over O (reportedCost_j*z_j) - trueCost*Z - W(O).
```

Those same other fills and aggregate own fill Z are feasible for the single
truthful report because `Z <= floor(q/L)`. The expression is therefore at most
`W(O union truthful)-W(O)`, exactly the truthful user's utility. This includes
feasible inflated budget declarations, understatements and multiple identities
with different reports; it does not merely bound a split into identical bids.

**Scope:** a fixed one-sided table, true integer per-lot costs, indivisible input
lots, exact underlying payments, fixed included other reports and the stated
linear utility. The mathematical argument allows finite collections; the code
admits only its declared resource bounds. It supplies no opposite-direction
or majority-flip proof, admission/censorship guarantee, builder theorem,
LP/reward utility, gas model, repeated-epoch guarantee or broad-token efficiency
claim. Applying it to one selected dominant augmentation does not prove that
strategically changing that augmentation/dominance is harmless.

## Why rounding existing valuations is not an implementation

The real-core-backed 9/4 frame offers one residual currency0 input lot of 4,
returning 8 currency1. Two records compete for that lot at integer reported cost
1; the lower canonical ID wins and receives integer compensation 1.

- A higher-ID user has original WAD ask 3/16, true lot cost 3/4. Ceiling its cost
  to 1 loses the tie and gives utility zero. Reporting 0 wins, pays 1 and yields
  true utility 1/4. All payments are integer and funded.
- A lower-ID user has original WAD ask 5/16, true lot cost 5/4. Flooring its cost
  to 1 wins and pays 1, giving utility -1/4. Its original signed minimum at fill
  4 is 2 whole units. Grid-reported IR is satisfied while the original IR fails.

These are users outside the declared integer-cost grid, not counterexamples to
the scoped one-sided argument. They prevent silently claiming that ceil/floor
preprocessing of every production ask preserves the original guarantees.
Also, an integer cost 1 per 9 input units cannot be expressed exactly as a raw
WAD ask; the reverse encoding is checked rather than silently rounded.

## Larger lots preserve values but fail practical repeat-batch support

For original WAD ask a and input lot L, its lot cost is `a*L/WAD`. This is integer
for **every** original ask iff `WAD divides L`: ask 1 proves necessity, and the
division proves sufficiency. Let primitive reciprocal spot lots be coprime D,N.
Every exact exchange pair is `(kD,kN)`. Requiring WAD to divide both components
is equivalent to WAD dividing k, by Bezout's identity. The smallest pair
preserving all original WAD valuations in both directions is therefore
`(WAD*D, WAD*N)`.

At exact spot 9/4 those lots are `4e18` and `9e18` raw units. For an 18-decimal
input token, 4e18 raw units are four tokens; for a 6-decimal input token, the same
raw minimum is four trillion tokens. These are denomination examples at this
raw spot, not a valuation of a real token pair or a universal minimum. Costs
for mathematically exact high asks can still exceed the laboratory cost bound.

The scaled example uses full-range liquidity `1000e18`, initial P=3/2*Q96 and a
complete residual input `4e18`. It returns exactly
`8,946,322,067,594,433,399` output raw units. Actual core deltas/final state match
the bounded oracle; the BigInt reference supplies the same quote. At its ending
price the reduced spot denominator is `2^190`, already far above `2^96-1`.
Both primitive exchange lots and their WAD-preserving multiples are oversized.
A larger multiple cannot repair that. The reference's next-frame builder would
reject this otherwise supported price under the exact-lot policy.

This makes the problem a **repeat-batch integration failure** in a concrete
example, not just a sampled-price coverage concern. Pinning/rounding the next
spot, resetting the price, using smaller nonreciprocal lots or introducing a
curve/asset adapter changes rules or accounting and requires new analysis.
No such change is selected. The current production hook remains unchanged.

## Validation

- **18 new Node groups:** exact pivots, whole grid IR, reverse WAD encoding,
  value-preserving minimum lots and post-swap failure, out-of-grid deviations,
  retained staircase deficits, large BigInt integration and malformed domains.
- 1,000 seeded one-sided profiles match independent Cartesian allocations and
  every pivot. Independent layer-cake integration matches base and counterfactual
  welfare. Another 100 six-report families check all **409,600** pairwise
  submodularity inequalities against independently calculated welfare.
- 3,000 seeded same-direction coalitions check the payment bound. **2,635**
  deviations meet the true budget; **365** are catastrophic. Of the feasible
  set, **1,093** declare total capacities larger than the true budget while
  their actual selected input remains affordable. No profitable feasible
  deviation appears in these tests.
- 1,000 seeded two-sided batches compare all allocations/counterfactuals with
  enumeration. A separate **72,000-strategy** integer-type grid covers both
  directions, capacities, single records and two false names. **30,940** are
  feasible, **41,060** catastrophic, with **6,396** feasible dominant-side flips
  and **3,200** feasible gross-over-budget strategies using input bought back.
  No profitable deviation appears in that grid. **This is not a full two-sided
  proof**, even though its utility uses complete net flows.
- **92 total Node groups** pass via `cd solver && npm test`: the previous 74
  groups plus these 18. The checked-in research JSON reproduces byte-for-byte.
- **272 contract tests in 28 suites** pass via
  `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'`.
  The new real-core test proves the starting/ending lot diagnostics around an
  actual scaled swap, including output and final state. Existing 512-case
  three-way execution fuzz checks remain included.
- Offline build, changed-test formatting, whitespace and handoff checks pass.
  The artifact-writing gas/sandwich suites compile but are not rerun. Existing
  vectors and economic benchmark artifacts remain unchanged.

No production contract, deployment, wallet, old auction solver or claim ledger
is modified. This is an offline proof-oriented research slice, not an audit or
grant approval. R2 canonical verification, R6 legacy minority IR, R7 historical
surplus capture and the concentrated mechanism remain open.

## Next design gate

The argument identifies a coherent restricted model, but choosing that model
would not satisfy the original broader valuation, price and asset scope.
G1/G2 remain open. The next redesign must address original WAD valuations and
multi-epoch v4 prices together with whole underlying payments and finite
capacity; it cannot rely solely on value quantization or exact reciprocal lots.
Specify the efficiency target and analytical incentive/accounting arguments for
any changed allocation or report-independent curve/asset adapter. Record scoped
failures rather than treating more passing nominal grids as a proof. Do not
silently select weaker guarantees or revise the signed minimum-output contract.

Independent mechanism review and a complete supported rule remain prerequisites
for step 5. G3 must then measure its full authenticated computation, including
counterfactuals. Concentrated integration, historical rewards, wallet migration,
testnet evidence, economics and the grant package remain separate required work.

## User-created commit handoff

Include exactly these files:

```text
README.md
contracts/test/OtterCostGrid.t.sol
fixtures/README.md
fixtures/research/cost-grid-research.json
reviews/CHECKPOINT_4F.md
reviews/CHECKPOINT_4G.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/research/cost-grid-cases.ts
solver/research/cost-grid-cli.ts
solver/src/cost-grid-research.ts
solver/test/cost-grid-research.ts
```

Suggested title:

```text
test: evaluate integer cost grids and repeat-batch lot limits
```

Suggested explanation:

> Add exact integer-per-lot pivots, independent finite welfare checks and net-flow deviation tests. Document the scoped one-sided argument, unsafe valuation rounding and real-v4 post-swap lot inadmissibility while retaining the original guarantee target.

Committed by the user as `5841493`. The handoff above is retained as history;
checkpoint 4H contains the current pending commit instructions.
