# Corrections to `idea.md` / `plan.md` after reading eprint 2026/1877

Dated 9 Sep 2026. Supersedes the corresponding sections of `idea.md`.

## C1. The pivot-cost question is answered in the paper (supersedes `idea.md` §5)

`idea.md` §5 framed "can all `n` leave-one-out welfares be computed in one pass?" as
an open question and the project's headline contribution. It is not open. The proof of
**Lemma 16** states the closed form:

> `phi_Y(M; v, q) = ∫ from v to sigma0 of min{ q, (K_M(t) − D_O(t))_+ } dt`

`D_O` is aggregate capacity excluding the user, so on `[ask_i, sigma0]` it equals
`D_S(t) − q_i`, giving

```
phi_i = ∫ from ask_i to sigma0 of min{ q_i, ( g(t) + q_i )_+ } dt,
g(t) := K(t) − D_S(t)
```

`g` is nonincreasing, so the integrand is a flat cap `q_i` above the level set `g >= 0`,
tapers linearly to zero at `g = −q_i`, and vanishes below. The zero-crossing `t_a` is
**global** — one value for the whole batch, equal to the clearing marginal price. Only the
lower breakpoint `t_b(i) = sup{t : g(t) >= −q_i}` is per-user.

**Honest claim:** the closed form is the paper's, used there as a proof device. This repo
extracts it as an algorithm, implements it, and verifies it against the naive
leave-one-out computation. Verified to `3.8e-10` max relative error over 4,000 random
batches. Do **not** claim to have discovered it.

## C2. The gas curve and the solver-complexity curve are different measurements

`idea.md` §5 presented "cost per batch vs batch size, and where it stops fitting in a
block" as the answer to the pivot-cost question. It is not. Under the §4 architecture the
solver runs off-chain and the contract only *verifies* the §3.7 invariants, which are
`O(n)` and arithmetically trivial. On-chain cost is dominated by `n` ERC-20 transfers.
The answer is a property of ERC-20, not of Otter.

Report two separate things:

- **Settlement cost per order** (on-chain, gas). A practicality data point. Expect the
  ceiling to sit where `n × transfer cost` meets the block gas limit.
- **Solver cost vs batch size** (off-chain, milliseconds). Naive vs layer-cake.

Measured so far (`test/bench.ts`, single-threaded node 22):

| n | naive (ms) | layer-cake (ms) | speedup |
|---|---|---|---|
| 500 | 82.5 | 3.3 | 25x |
| 1,000 | 233.9 | 8.8 | 27x |
| 5,000 | 7,806 | 137 | 57x |
| 20,000 | — | 1,544 | — |

**Known limitation:** the current `LayerCake.solveLevel` / `integrateG` scan every piece
linearly, so the pivot loop is `O(n^2)` with a small constant, not `O(n log n)`. Replacing
the scans with a binary search plus a prefix-summed antiderivative table is the outstanding
optimisation. The n=20,000 row shows the current implementation bending upward.

## C3. Utility function: fidelity issue, not a live bug (downgrades `idea.md` §3.1)

`idea.md` §3.1 renders the catastrophic-utility condition as "its aggregate trade is
strictly opposite its true direction". The paper's eq. (2) is a **conjunction**:

```
-inf  iff  (-dY > q)  OR  ( -dY < 0  AND  dX < 0 )
```

The paper is explicit that a sell-Y user is not penalised for a net gain in Y when it does
not also lose X, including a weak-gain-in-both free lunch.

`test/mutation.ts` case A compares both readings on 4,000 random cross-direction sybil
outcomes: **they agree on every one**. That is not luck — §5.3.1 proves that on Otter's own
outcomes `SY − RY < 0` implies `dX < 0`. So the loose phrasing does not currently hide any
attack. Implement the conjunction anyway: it is what the spec says, and the two readings
diverge the moment the mechanism is modified (e.g. the one-sided-only fallback).

## C4. The real silent-failure risk is the allocation stopping rule

`plan.md` Block 1 step 4 says "walk, partial-fill at the crossing point". Implemented the
obvious way — stop when the marginal price is no longer *strictly* above the current ask —
this drops the paper's quantity-maximising tie rule at equality, and **Fact 13 (`Q_Y >= M`)
fails**. Feasibility then breaks and the burn goes negative.

`test/mutation.ts` case B: **3,177 / 4,000** boundary batches violate `Q_Y >= M` under the
strict-inequality rule.

The fix is to fill each bidder up to `K(ask)` rather than testing the marginal price, since
`K(t) = sup{y : F'(y) >= t}` includes equality by construction. `Q_Y >= M` then falls out of
dominance for free: every eligible ask is `<= sigma0`, and `K(sigma0) = M`.

## C5. Scope and prize tracks (supersedes `idea.md` §6)

`idea.md` §6 has two factual errors about the prize board, both checked against
https://ethglobal.com/events/ethonline2026/prizes on 10 September 2026:

- **Uniswap Foundation is $3,000, not $5,000.** The $5,000 is the total pool; the
  Start Fresh track ("Best Uniswap Stack Contribution") is $3,000 across up to 3
  teams at $1,000 each. The remaining $2,000 is Continuity-only, and this project
  began during the event, so it is not eligible for it.
- **1inch is $5,000 for Start Fresh, not $7,000.** Same split: $7,000 total,
  $2,000 of it Continuity-only.

`idea.md` §6 also states that the Chainlink CRE Confidential Workflows track
"requires private-beta enrollment". **That is wrong.** The track has public
starter templates, CLI simulation, published docs and a recorded bootcamp, and
its qualification requirements are satisfiable without a live deployment.

Submissions may select up to three partner prizes, and multiple tracks from one
partner count as a single selection.

**Selected:**

- **Uniswap Foundation.** The primary track. This is the project.
- **Chainlink — Best Confidential Workflow ($2,000, up to 2 teams).** Running the
  solver inside a TEE handler means batch order flow is not visible to the solver
  operator before it computes on it. It does not make welfare-optimality provable
  — see C6 — but it addresses the confidentiality half of the trust limitation,
  which is a coherent contribution on a paper about MEV.

**Cut:**

- **1inch.** Reimplementing settlement as SwapVM opcodes is a second full
  implementation of the core contract, not an integration. Largest reachable pool,
  wrong trade against the remaining time.
- **The Graph.** The composable track explicitly rejects a single subgraph with no
  composition, and the AI track needs an agent doing meaningful work. Both are a
  forced fit.
- **Live order-entry dApp.** Replaced with a static results page rendered from a
  real testnet batch's JSON output. Judges need to see a trade happen, not a
  wallet connector.

**Also required, and easy to forget:** `FEEDBACK.md` plus a submitted Uniswap
Developer Feedback Form linking to it. Winners are audited for this.

## C6. Positioning that survives Q&A

`idea.md` §8's claim is sound and should be kept verbatim. Add to it:

- The mechanism's guarantees assume consensus-layer censorship resilience (Theorem 23).
  A testnet does not provide this.
- Welfare-optimality of the proposed allocation is asserted by the solver, verified only
  for feasibility, IR, budget bounds and curve conservation on-chain.
- The pivot algorithm is extracted from the paper's Lemma 16, not original to this work.

## C7. Theorem 12(c) is implied by the 12(b) bounds

Not a correction to `idea.md` — a finding from implementing the on-chain checks.

The burn constraint `sum x*_i <= F~(Q_Y)` cannot fail if all the per-user marginal
bounds `x*_i <= F~(Y*) - F~(Y* - y*_i)` hold.

`F~` is concave with `F~(0) = 0`, so `F~(t)/t` is nonincreasing and therefore
`F~(Y* - y*_i) >= ((Y* - y*_i)/Y*) F~(Y*)`. Summing over all `i`, and using
`sum y*_i = Y*`:

```
sum_i F~(Y* - y*_i)  >=  (n-1) F~(Y*)
```

so

```
sum_i [ F~(Y*) - F~(Y* - y*_i) ]  =  n F~(Y*) - sum_i F~(Y* - y*_i)  <=  F~(Y*)
```

Verified against the exact fixed-point implementation over 300,000 random batches:
`sum(bounds) - F~(Y*)` never exceeded 0.

The `NegativeBurn` revert in `OtterMath.verify` is therefore unreachable as
written. It is retained deliberately — it costs one comparison, and it is the
check that would catch a rounding direction being flipped in `fTildeDown` or
`fTildeUp` later. `testFuzz_marginalBoundsImplyNonNegativeBurn` asserts the
implication; if that fuzz ever fails, the revert has become load-bearing and the
rounding has regressed.

## C8. On-chain math needs no square root

`plan.md`'s stack table offers `PRBMath` or solmate's `FixedPointMathLib` and says
to pick one on day 1. Picked: **solmate**, which is already in the tree via
v4-core.

The reasoning matters more than the choice. `K(t) = sup{y : F~'(y) >= t}` requires
a square root, but `K` is a solver-side function only — the contract never
computes it. Every on-chain operation reduces to `mulDiv(a, b, c)` with a chosen
rounding direction:

| Quantity | Form |
|---|---|
| `sigma0 * y` | `mulDiv(x0, y, y0)` |
| `k / (y0 + z)` | `mulDiv(x0, y0, y0 + z)` — never materialises `k`, so no overflow |
| `v~_i * y*_i` | `mulDiv(ask, y, 1e18)` |

solmate exposes both `mulDivDown` and `mulDivUp`. PRBMath's public API is
round-down only (`Common.mulDiv`, `mulDiv18`, and the `UD60x18` operators), with
no `mulDivUp`. For the one operation that decides whether rounding can flip an
invariant, solmate is the better tool and costs no new dependency.

Rounding rule, applied throughout `OtterMath`: bounds on what a user **may**
receive round down; amounts a user **must** have earned round up. Every quantity
exists in a `Down` and an `Up` form and the two are never mixed.

## C9. v4-periphery is not a dependency

`BaseHook` has been removed from both `v4-core` (tag `v4.0.0`,
`e50237c43811bd9b526eff40f26772152a42daba`) and `v4-periphery`
(`dce236d4e2057422d0791d9a973a58765eb46f65`), despite the docs and every tutorial
starting from it. `OtterHook` implements `IHooks` directly.

With `BaseHook` gone, the only thing this project wanted from v4-periphery was
`HookMiner`, which lives at `test/shared/HookMiner.sol` and imports nothing but
`Hooks` from v4-core. It is vendored to `contracts/test/utils/HookMiner.sol` with
a provenance header. Dropping v4-periphery also removes permit2 and four nested
submodules — roughly 70MB — plus a second copy of v4-core at a different commit
than the top-level one.

Working remappings for consuming v4-core from a parent Foundry project:

```
forge-std/=lib/forge-std/src/
@uniswap/v4-core/=lib/v4-core/
v4-core/=lib/v4-core/src/
solmate/=lib/v4-core/lib/solmate/
```

Note `solmate/` has no trailing `src/`: v4-core's imports already carry it, and
its own `remappings.txt` declares `solmate/=lib/solmate/`, correct relative to
itself but wrong from a parent. Getting this wrong produces
`lib/solmate/src/src/auth/Owned.sol not found`, an error that points into
v4-core's source and reads like a bug there rather than a remapping problem in
the consumer. Written up in `FEEDBACK.md`.

## C10. The paper's curve and v4's swap math differ, and the gap tracks price impact

The most substantive finding here, and the only one not derived from the paper.

Otter is proved on a continuous pricing curve `F(y) = x0 - k/(y0 + y)`, evaluated
once and rounded once. Uniswap v4 executes a swap in two stages — derive the new
`sqrtPrice` from the input, then derive the output from the price delta — rounding
in the pool's favour at each, on a Q64.96 price grid. **v4 therefore pays strictly
less than `F` predicts.** A settlement that pays the dominant side its exact `F~`
ceiling has zero headroom and reverts.

This is not hypothetical. `OtterMargin.t.sol`, paying the full ceiling, failed with
`PoolOutputShortfall` by 14 wei before the fix.

### Measurement

`contracts/test/CurveSweep.t.sol`, three pools spanning liquidity `1e20` to `1e22`,
six trade sizes through each, both directions, plain hookless pools so nothing but
the curve is under test:

| price impact | gap (wei) |
|---|---|
| <= 100 ppm | 0 |
| ~1,000 ppm (0.1%) | 0 - 2 |
| ~10,000 ppm (1%) | 0 - 1 |
| ~50,000 ppm (5%) | 4 |
| ~110,000 ppm (11%) | 8 - 9 |

The gap scales with **price impact, not trade size** — roughly 1 wei per 1.2% of
impact. An earlier version of this sweep varied trade size at fixed liquidity,
which held impact near 0.1% throughout and reported a misleading 2 wei maximum.
Sweeping the wrong variable is worse than not measuring, because it produces a
number that looks like an answer.

Across 512 fuzz runs the model never predicted *less* than v4 paid, so the error
is one-directional and an allowance is sufficient.

### The allowance

```
allowance(y) = ceil((y - M) * 200 / y0) + 2     for y > M
             = 0                                otherwise
```

Zero at or below `M`: the batch never touches the pool there, since the minority
side supplies everything at spot and no swap occurs.

Covers every measured point with at least 1.5x margin. On a `10e18` trade at 10%
impact it is 22 wei, or 2e-16% of the trade.

`OtterMath.fTildeDown` is left untouched and remains a faithful port of the
paper's curve — it is what `solver/src/fixed.ts` mirrors and what the mechanism is
reasoned about in. The allowance is a separate function, and `verify` uses
`fTildeSettleable = fTildeDown - allowance`. The two are different in kind: one is
the paper, the other is a fact about executing it on v4, and folding them together
would leave `OtterMath` a port of nothing.

### What it costs the mechanism

**Incentive compatibility survives.** The allowance is a function of the batch's
own size and the pool's reserves, never of any bidder's report, so it creates no
outcome-dependent transfer. This is the same distinction Theorem 22 draws for
builder payments: a fixed exogenous deduction is permitted, an outcome-dependent
one destroys the guarantees.

**Individual rationality is shaved at the margin.** A bidder whose ask exactly
equals its compensation can be underpaid by up to the allowance. Bidders with any
strictly positive surplus are unaffected. This is a real, if tiny, deviation from
the paper and belongs in the README next to the trust model.

Guarded by `test_allowanceCoversMeasuredWorstCase`. If that ever fails, re-run the
sweep before touching the constant.

## C11. `plan.md`'s fallback triggers, resolved

For the record, since none of the three fired:

- **Two-sided mechanism not passing property tests.** It passed. The two-sided
  case is implemented, not the one-sided fallback. The symmetry `H(x) =
  -F^{-1}(-x)` is, for constant product, just `F` with the reserves swapped, so
  the sell-X-dominant branch calls the same code with `(y0, x0)` and swaps the
  answer back. One implementation, used twice, no chance of the branches drifting.
- **On-chain invariant verification too expensive.** It is not. Every §3.7 check
  is `O(n)` and arithmetically trivial; settlement cost is dominated by ERC-20
  transfers and `ecrecover`, not by verification.
- **v4 integration fighting you.** It did, but only at the dependency layer — see
  C9 and `FEEDBACK.md`. The integration itself was straightforward once `BaseHook`
  was ruled out and the remappings were right.