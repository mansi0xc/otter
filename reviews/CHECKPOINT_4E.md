# Checkpoint 4E — two-sided exact exchange lot candidate

Prepared 4 October 2026. Starting revision: user-created commit `e156b91`.
Status: implemented and validated locally; committed by the user as `5d6415e`.
The user creates every commit. No deployment or live transaction is included.

## Outcome and user-selected priority

The user selected **preserve the paper's guarantees; keep testing before
selecting a rule** on 4 October. A funded mechanism with weaker incentives is
not the default path. No production rule or fractional asset is selected here.
The existing whole-token per-order IR requirement remains in the specification.

This checkpoint extends the independent laboratory to both trade directions,
exact spot exchange lots, minority funding, residual AMM execution, dominant
counterfactuals and net-flow utility. It compares unrounded fractional
compensation, ceil transfers and immediate floor redemption. There are two
material limits: exact reciprocal lots are impractically large at most sampled
quantized prices, and fractional compensation does not establish immediate
underlying-token IR. Ceil transfers still create profitable deviations.

The [paper's two-sided construction](https://arxiv.org/html/2609.03474v1#S4)
selects a dominant direction from eligible supply, fully compensates the
minority at spot and runs the dominant auction on an augmented curve. The
[utility definition](https://arxiv.org/html/2609.03474v1#S2.SS1) uses net token
flows, including opposite-direction identities. This research adapts those
ideas to finite lot tables; the paper's full theorem is not established for it.

## Candidate calculation

`solver/src/lot-candidate.ts` implements the following complete **offline
candidate calculation and diagnostics**, not an accepted executable mechanism:

1. Fix an opening snapshot, both directional limits, lot multiple and residual
   quantity tables independently of reports. `buildLotFrame` obtains every
   point from the unchanged BigInt execution snapshot; only complete input
   consumption is usable. Validate the fee/domain/status rules through that
   model. Supplied maps and identity keys remain unauthenticated.
2. Choose integer exchange lots `L0,L1` satisfying
   `L1/L0 = sqrtPriceX96^2/2^192` exactly. Spot eligibility is an exact
   cross-product comparison. Round each eligible budget down to its input lot
   and retain the unused remainder. Ineligible records remain zero fills with
   full refunds.
3. Compare eligible **lot counts**; each opposing lot has the same spot value.
   Ties go to currency0. This changes dominance relative to comparing all raw
   budget remainders; it is an explicit candidate rule, not a silent proof step.
4. For the selected side, let m be the minority lot count. Its compensation
   table in dominant-input lots q is:

   ```text
   G_m(q) = q * opposite input lot                   for q <= m
          = m * opposite input lot + F((q-m)*Ldom)  for q > m.
   ```

   Actual residual capacity, the input/output domains and the table bounds are
   retained; unsupported points remain `null`. Maximize exact linear-cost
   welfare on this table, then prefer greater total input and `(ask,id)` fills.
   Compare the quantity scan with independent Cartesian enumeration.
5. Fill each eligible minority record's complete lots and pay exact reciprocal
   spot lots. For dominant records retain the raw WAD pivot numerator. Every
   dominant leave-one-out welfare uses the **same** chosen side and minority
   augmentation. It does not rerun majority selection after removing a bidder.
   Minority/ineligible counterfactual fields are labeled zero placeholders.
6. Compensate the minority from dominant input first, then quote the remaining
   whole input against the actual directional table. Skip a zero residual.
   Expose per-record fills, payments, remainders and minimum whole-unit outputs,
   both currencies' signed remaining assets and funding/certification flags.

The algorithm does not clamp deficits, convert partial input into a full fill,
silently subsidize rounding or decide that a failed diagnostic settles anyway.
`candidatePayments` compares three payment representations; it does not add a
refund-on-failure policy whose changed incentives would need separate analysis.

Bounds are 8 records, 32 eligible lots per side and 32 residual lots per
direction, with existing uint128 asks, per-currency uint96 aggregate budgets
and uint120 outputs. At most 64 augmented lots enter the reused optimizer.
They bound this laboratory, not production minimum trades, capacity or gas.

## What the local certificate establishes

`certifiedLotFrame` checks both full supplied residual tables before looking
at reports: supported points must be contiguous prefixes, integer lot output
increments must be nonnegative/nonincreasing, and the first increment cannot
exceed the reciprocal spot lot. Empty supported prefixes are allowed as finite
zero residual capacity, not evidence of an increasing unbounded curve.

These conditions make the augmented table integer-concave: the initial m
increments are the reciprocal spot lot, followed by the certified pool
increments. Eligible dominant capacity is at least m. On that initial segment,
each additional lot costs at most its spot compensation. Welfare maximization
and the quantity-maximizing tie therefore select at least m lots, funding all
minority outputs from actual dominant input. Removing a dominant record and
retaining other fills gives its raw pivot upper bound
`G_m(Q)-G_m(Q-x_i)`. The concavity argument in checkpoint 4D covers both raw
and ceil dominant compensation from available output. Optional participation
gives raw linear IR, and ceiling gives whole-unit reported IR.

This establishes the scoped **accounting/IR argument**, not full UIC. It does
not prove that finite lots/capacity, altered dominance or changed asset
representation preserve every direction-changing/false-name incentive,
Pareto optimality or builder claim. It does not address admission censorship,
identity grinding, LP utility/rewards, repeated epochs, protocol fees, gas
costs or real-world valuation of fractional claims. The certificate
authenticates no data and proves nothing beyond its finite tables.

## Candidate comparison and counterexamples

| Payment representation | Backing and IR on certified tables | Incentive evidence | Decision |
|---|---|---|---|
| Exact WAD fractional compensation claims | Raw liabilities are backed; linear IR holds if claims have their exact nominal value | No profitable deviation in the declared finite net-flow grid | Research only: generic price lots and actual asset/redemption semantics remain unresolved |
| Ceil whole-token transfers | Backed with whole-unit reported IR | Profitable ask misreport and split identities remain | Rejected for the user's exact incentive target |
| Immediate floor redemption of unrounded claims | Redeemable whole outputs can be below signed minimum; the unpaid fractions remain liabilities | Does not meet the existing whole-token IR contract | Not a whole-token IR fix |

### Exact spot lots can exceed all admissible input

Write the reduced spot ratio as `N/D`, with coprime positive integers N,D.
Any positive exact integer exchange uses `L0=k*D`, `L1=k*N`. Thus the primitive
lots computed by `spotLots` are the smallest possible; increasing their
multiple cannot fix an oversized minimum.

At sqrt price `3*2^96/2`, spot is 9/4 and primitive lots are `(4,9)`.
At core tick 1, the primitive lots are:

```text
L0 = 24519928653854221733733552434404946937899825954937634816
L1 = 24522380646719607155906925790044402809511515354687625729
```

Both exceed `2^96-1`; `buildLotFrame` rejects them before constructing an
execution table. Among 2,001 deterministic tick prices from -400,000 to
400,000 in steps of 400, only tick 0's primitive lots fit that bound. This is
the result for that explicit grid, not a probability estimate or a claim about
every pool initialization. Testing a specially convenient 9/4 price does not
establish general price support. Raising an amount type does not demonstrate
that these trade sizes are economically usable.

Rounding spot into a smaller rational ratio changes eligibility, compensation,
the augmented curve and direction selection. That needs a new funding and
incentive analysis; it is not an implementation-only correction. Fractional
input assets also need an explicit adapter to whole-input PoolManager swaps.

### Ceil profits persist with both sides present

At sqrt price `3*2^96/2`, full-range L=1,000 and spacing 60, fix each limit to
the end price of a complete one-lot quote. The exact residual prefixes are
`F0(0..1)=[0,8]` for input lots 4 and `F1(0..1)=[0,3]` for input lots 9.
Larger requests are partial, so both fixed tables certify.

Three currency0 sellers budget 4 each. A truly asks 3/16 per input unit,
making its lot cost 0.75; B/C ask 1/8, making their lot cost 0.5. One currency1
minority seller budgets 9 and asks 0.4. The augmented output is `[0,9,17]`;
two dominant lots can fill, including the spot crossing lot. B/C fill honestly
and A loses. A reports 1/16 and wins a lot with raw payment 0.5. Ceil pays 1:
A's true utility improves by 0.25. Unrounded nominal claims give a negative
0.25 deviation utility instead. Both ceil outcomes are funded. Whole IR and
finite concavity do not remove the rounding incentive.

The fixture also compares one seller budgeting 8 at ask 1/16 against two
identities budgeting 4 each, with an opposite-side seller and a competitor.
Total controlled input is unchanged. Raw nominal utility gain is zero;
ceil compensation creates **one raw output unit** of profit. These are
synthetic identities, not an authenticated production transaction or a
measurement of key/nonce grinding.

### Nominal compensation does not prove immediate token IR

In the honest profile above, B and C each receive a claim for 0.75 output
unit, above their linear cost 0.5. Their signed whole-token IR minimum is 1.
With no previous fractional balance, immediate floor redemption delivers zero,
giving actual delivered-token utility -0.5 each. The fractional debt remains
backed and owed, but that is a different payment/valuation contract.

This checkpoint implements no fractional ledger, transferable asset, market,
aggregation service, dust forfeiture, withdrawal policy or altered order
signature. Those components and their liabilities cannot be assumed to exist
because a numerator is stored in an offline result. Native ETH is still
redeemable only in whole wei; ERC20 underlying amounts are whole raw units.
No current custody/claim ABI changes here.

### Net flows matter in deviation testing

A controlled currency0 report gross-sells 8; a controlled currency1 report
buys 4 currency0 back. Net currency0 sale is 4, so a true budget of 4 is not
violated. Their nominal net currency1 gain is 8 in the published example.
It equals the corresponding standalone truthful trade's output; gross
overspend alone is not a valid reason to remove this strategy from the test.

`netUtility` sums all controlled records in both currencies, applies the net
true-budget and strictly opposite-direction conditions, then computes exact
linear utility. A hypothetical free lunch remains admissible to that utility
checker rather than being concealed by a gross-input rejection. Claim utility
uses WAD-squared-scaled raw output units; immediate redemption/ceil views use
their actual whole payments. Existing checkpoint 4D's bound remains a
separate one-sided result; it is not upgraded into a full two-sided theorem.

## Validation

- `cd solver && npm test`: **59 groups passed**: 8 legacy properties,
  20 execution, 17 discrete research and 14 new lot candidate groups.
- Every published dominant allocation/counterfactual agrees with the independent
  Cartesian optimizer. Another 1,000 seeded two-sided batches compare both
  implementations, remainder conservation, exact asset funding, eligibility
  and arrival permutations over full-range and concentrated execution tables.
  Uncertified examples keep their negative residuals and failure flags.
- The deviation grid evaluates 72,000 candidate strategies: **30,940 feasible**
  and 41,060 catastrophic under the declared net-flow utility. No profitable
  nominal-claim deviation is found among the feasible strategies, including
  6,396 changes of dominant side and 3,200 feasible gross-over-budget cases.
  It covers same/opposite direction reports, two identities, asks/caps,
  sub-lot true budgets and both real-user directions on two fixed real-model
  frames. This grid is evidence with explicit limits, not a full incentive proof.
- New `OtterLotCandidateTest` checks actual PoolManager input/output and final
  state in both directions for complete one-lot and partial two-lot requests.
  It anchors the residual tables; payment calculation is still offline.
- Broad contract suite excluding `GasCurveTest|SandwichHarness`:
  **269 tests passed in 26 suites**, including the existing 512-run three-way
  BigInt/oracle/core differential fuzz test.
- The standalone legacy grant-review checks still confirm minority dust,
  arrival-dependent ties and the old arithmetic-domain mismatch. They remain
  open evidence rather than new fixes.
- Offline build, changed Solidity formatting and whitespace checks pass.
  Existing build lint notes and the sandbox signature-cache warning remain;
  there is no compilation error. Production contracts are unchanged, and no
  new complete-verifier gas or production bytecode bound is claimed.

`fixtures/research/lot-candidate.json` is byte-identical to
`cd solver && node --experimental-strip-types research/lot-cli.ts`.
Every BigInt is a decimal string. The CLI uses no RPC, transactions or secrets.
The old discrete counterexamples, verifier vectors and economic artifacts are
preserved. Passing unsafe-variant tests does not close production findings.

## Remaining work

G1/G2 remain open. The candidate has enough specification and evidence to
reject ceil transfers for the selected guarantee target and to identify exact
primitive lots as an inadequate general price-support solution. Unrounded
compensation remains a research lead with a materially different asset/IR
contract; it is not selected merely because this grid shows no gain.

Next, investigate a proof-compatible compensation/asset representation that
works at ordinary quantized prices, with explicit ownership, redemption,
backing, dust and actual-input rules. Compare it against whole-token IR and
full net-flow incentives before changing the accepted order/product contract.
Independent mechanism review is still required; a tested grid cannot provide
it. Only after selecting and specifying the complete supported rule should
G3 measure its full authenticated computation/counterfactuals and step 5 begin.

R2 noncanonical settlement, R6 legacy minority IR and R7 historical LP capture
remain open. Concentrated auction/snapshot integration, partial-settlement
accounting, historical rewards, wallet migration, testnet evidence, economic
comparisons and the grant package remain required. Concentrated execution
stays gated; no weaker rule is substituted for the user's research target.

## User-created commit handoff

Include exactly these files:

```text
README.md
contracts/test/OtterLotCandidate.t.sol
fixtures/README.md
fixtures/research/lot-candidate.json
reviews/CHECKPOINT_4D.md
reviews/CHECKPOINT_4E.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/research/lot-cases.ts
solver/research/lot-cli.ts
solver/src/lot-candidate.ts
solver/test/lot-candidate.ts
```

Suggested title:

```text
test: evaluate two-sided exact-lot auction candidate
```

Suggested explanation:

> Add two-sided candidate calculations, net-flow deviation checks and real-v4 capacity evidence. Document oversized exact lots, fractional redemption IR and rounding profits while preserving the paper's incentive guarantees as the research target.

The user committed this checkpoint as `5d6415e`. The clean tree was verified
before [checkpoint 4F](./CHECKPOINT_4F.md). The handoff above is historical.
