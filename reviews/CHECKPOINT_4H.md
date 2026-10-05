# Checkpoint 4H — whole payments and partial-allocation limits

Prepared 5 October 2026. Starting revision: user-created commit `5841493`.
Status: implemented and validated locally, pending the user-created commit.
The tree was clean at the start. The user creates every commit.

## Outcome

Changing partial fills does not automatically repair the payment conflict. With
fixed others and budget, a deterministic rule with integer underlying payments
cannot distinguish certain positive original WAD asks through its allocation.
This follows from the two truthful-report inequalities, without choosing Groves
payments, requiring zero payments to losers, imposing IR or relying on a funding
deficit. Extra whole-token backing does not remove the constraint.

The real-core-backed example permits every raw input from 0 through 4. For three
asks in the interval `(0,1/4)`, all **125 possible fill responses** are checked.
Only five constant-fill responses admit integer truthful payments. Even the best
constant-fill response sacrifices at least **1/8 of an underlying output raw
unit of allocation welfare** in one of the three profiles. That is an exact
arithmetic bound, not a fractional payment made by production.

This is a necessary single-identity condition for a specific deterministic
underlying-token model. It is **not an impossibility theorem for every Otter
redesign**, a full two-sided proof, or a claim that the paper is incorrect. A
different asset/curve model or a different discrete efficiency target needs its
own guarantees. No weaker production rule is selected, and the user's original
guarantee and signed minimum-output priorities remain unchanged.

## Exact transfer feasibility checker

`solver/src/transfer-research.ts` examines a finite response to one user's ask
reports with the other reports, direction and true budget fixed. Each point has
its original uint128 WAD ask, uint96 input fill, and whole output-payment bounds.
Every fill must be affordable under that same true budget. There are at most 16
points. The caller supplies these model assumptions; the checker does not
authenticate a batch, derive an allocation or enforce production settlement.

For true report `i` and alternative report `j`, truthfulness requires

```text
WAD * (p_i - p_j) >= ask_i * (x_i - x_j).
```

Because payments are integers, this is exactly equivalent to

```text
p_j - p_i <= floor(ask_i * (x_j - x_i) / WAD).
```

The implementation encodes these necessary inequalities and the payment bounds
as a directed graph of difference constraints. A zero anchor fixes the payment
origin. Bellman-Ford either returns integer payments or a closed negative cycle.
Summing the cycle's constraints cancels all payments and yields `0 <= negative`,
an independently checkable certificate that **no payments within the supplied
bounds** implement that allocation response. Integer graph potentials suffice
because every edge weight and bound is an integer.

Signed division uses mathematical floor. JavaScript BigInt's truncation toward
zero would incorrectly replace a negative fractional bound with zero. The
payment verifier separately compares exact WAD-scaled utilities; it does not
reuse the floor calculation. The cycle verifier checks each edge against the
actual problem, closure, simplicity and the negative sum. Malformed asks,
quantities, duplicate asks and oversized report sets are rejected. A lower bound
above its upper bound is retained as an infeasible problem rather than clamped.

The welfare definition being extended is the paper's **one-sided** objective:
pool output minus reported input costs, with redistributed surplus included.
See [Section 3 of the paper](https://arxiv.org/html/2609.03474v1#S3). The argument
below concerns its finite integer adaptation; it does not assert that the
paper's continuous curve assumptions hold for this v4 prefix or introduce a
common numeraire for the full two-sided mechanism.

## Analytical constraint on changed allocations

Fix a user with true budget `C`, other reports and a deterministic response
`(x(a),p(a))` to raw WAD ask `a`. Let every report's actual net input expenditure
lie in `[0,C]` and every net output payment be an integer. No alternative input
asset, extra payoff, probability distribution or changed utility is included.
Refunded unspent escrow is not expenditure. Arbitrary whole output subsidies,
including positive payments to losing reports, are allowed by this argument.

For two distinct asks `0 < a < b` with `b*C < WAD`, exact truthfulness at both
types gives

```text
a * (x(a)-x(b)) <= WAD * (p(a)-p(b)) <= b * (x(a)-x(b)).
```

Summing the two incentive inequalities first implies `x(a) >= x(b)`. If the
fill difference were positive, it would be at most `C`, and the payment
difference would have to satisfy

```text
0 < (a/WAD)*(x(a)-x(b)) <= p(a)-p(b)
  <= (b/WAD)*(x(a)-x(b)) < 1.
```

No integer lies strictly between zero and one. Thus the fills must be equal;
the original inequalities then require equal payments. Every admissible positive
ask in this interval must have the same fill and payment, including when partial
fills are available. This is stronger than the earlier unchanged-Groves-fill
counterexample, but its premises are explicit and narrower than a universal
mechanism impossibility claim.

Zero asks and the boundary `b*C = WAD` are excluded. Large trade quanta may
remove this particular interval obstruction; checkpoint 4G records their
different generic-price and next-batch problems. Randomization, fractional or
different assets, changed net-input behavior and revised efficiency/IR targets
fall outside this argument and require new analysis. They are not accepted fixes.

## Real v4 case and exhaustive changed fills

The fixture opens zero-fee full-range liquidity 1000 at `P = 3/2 * Q96`, spacing
60. The report-independent downward limit is the final price of a complete
four-unit quote, `118133443112720185278644061138`. Independent BigInt quotes and
actual PoolManager swaps from the **same opening state** agree:

| Requested raw input | Actual consumed | Output | Status |
|---|---:|---:|---|
| 0 | 0 | 0 | Complete model; manager swap skipped/rejects zero |
| 1 | 1 | 2 | Complete |
| 2 | 2 | 4 | Complete |
| 3 | 3 | 6 | Complete |
| 4 | 4 | 8 | Complete |
| 5 | 4 | 8 | PriceLimit; not `F(5)` |

Both bidders have input budget 4. The rival's ask is `1/8`; the target's original
WAD asks are `1/16`, `1/8`, `3/16`. At the first ask the unique welfare-optimal
target fill is 4; at the last it is 0. At the middle ask the published ID tie
rule gives the rival all four, but **the conflict does not depend on that tie**:
the first and last profiles alone force unequal efficient fills in the forbidden
interval. Exhaustive Cartesian allocation independently matches these optima.

The efficient transfer graph has a two-edge cycle of weight `-1`, containing
only truthfulness constraints. Thus neither IR constraints nor the payment
upper bounds cause this certificate. For the first/middle reports the winning
payment difference must be at least 1 and at most 0. A positive payment to the
loser would shift both payments, leaving the difference integral and impossible.

The separate enumeration includes **all** `5^3 = 125` raw target-fill responses,
not just welfare optima or full-budget bids. It finds 120 infeasible responses:
90 violate monotonicity and 30 are nonconstant monotone responses. Exactly five
constant responses remain. Independent enumeration of `9^3` payment vectors
per response agrees with the graph result under bounds `[0,8]`; the analytic
argument and truthfulness-only cycle are not limited to that payment range.

At constant target fill `k`, sending the rival's remaining `4-k` maximizes
welfare at each profile. Both asks are far below every supported marginal
output 2, so leaving additional capacity unused makes welfare worse. The regrets
at the first/last profiles, expressed in underlying output units, are

```text
low-ask regret  = (4-k)/16
high-ask regret = k/16.
```

Their maximum is minimized at `k=2`, with value `1/8`. Enumeration also checks
every smaller rival fill, so this lower bound does not assume that a revised
rule must use the full capacity. The five constant responses admit conditional
target IR payments and leave enough output to satisfy the rival's reported IR.
Those payments are **not a proposed mechanism**: rival-report incentives, budget
misreports, false names, opposite-side strategies and builder behavior are not
established. A local truthful menu is insufficient for the full guarantee.

## Validation

- **12 new Node groups**, **104 total**, pass through `cd solver && npm test`.
  They cover the real quote prefix, independent allocations, the cycle proof,
  signed floor, a feasible aligned-payment boundary, all 125 changed responses,
  conditional original IR/funding and the regret bound including unused capacity.
- Another **1,000 bounded three-report problems** agree with independently
  enumerated payment vectors. **983** are infeasible, each with a validated
  negative-cycle certificate. Changed edges/weights/problems and nonclosed
  certificates are rejected. Wide products, maximum report count, exact bounds
  and malformed quantities are checked.
- `fixtures/research/transfer-research.json` regenerates byte-for-byte from
  `cd solver && npm run research:transfers --silent`. BigInts are decimal strings;
  it is offline research, not a settlement witness or grant-approved theorem.
- **273 contract tests in 29 suites** pass with
  `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'`.
  The new core test executes every raw choice from the same state and compares
  consumed input, output and exact final price. Existing three-way execution
  comparisons and 512-case fuzz remain included.
- Offline build, changed-test formatting, whitespace and handoff checks pass.
  The saved artifact-writing gas/sandwich suites compile but are not rerun;
  prior economic, vector and research artifacts are unchanged.

No production contract, old auction solver, signature, minimum-output rule,
claim asset, concentrated gate, dependency or deployment is changed. Active
R2 canonical verification, R6 minority IR and R7 historical surplus capture are
still open. No external mechanism or contract audit has been completed.

## Next work

G1/G2 cannot be closed by payment rounding, whole-token reserves, allowing smaller
partial fills or adding more passing restricted grids. A complete representation
or allocation redesign must say how it escapes the stated premises, then prove
its efficiency, IR, full net-flow incentives and actual v4 backing/redemption.
Keep the original guarantee priority. Independent mechanism review and measured
full authenticated verification under G3 remain prerequisites for step 5.

Historical reward capture can be fixed independently using the already recorded
opening LP ownership. After this user-created commit, inspect and implement a
bounded historical-surplus accounting slice for the currently admitted
full-range model: later LPs must receive no past rewards and exiting opening
owners must retain independent claims. Preserve cross-pool backing, independent
claims, callback safety and queued-exit priority. Do not treat arbitrary legacy
settlement payments as canonical or raw concentrated liquidity as a valid
capital weight. The concentrated gate and its expanded-support work remain open.
This ordering makes safety progress while the mechanism requires a compatible
design; it does not declare all of step 6 complete before step 5.

## User-created commit handoff

Include exactly these files:

```text
README.md
contracts/test/OtterTransferResearch.t.sol
fixtures/README.md
fixtures/research/transfer-research.json
reviews/CHECKPOINT_4G.md
reviews/CHECKPOINT_4H.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/research/transfer-cases.ts
solver/research/transfer-cli.ts
solver/src/transfer-research.ts
solver/test/transfer-research.ts
```

Suggested title:

```text
test: certify whole-payment limits for partial allocations
```

Suggested explanation:

> Add exact truthful-payment constraints with verifiable infeasibility certificates. Check every raw fill in a real-v4 case and document the scoped partial-allocation welfare conflict without selecting weaker guarantees.

Create the commit and confirm completion before the next implementation slice.
