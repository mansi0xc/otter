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

## C5. Scope

Cut from the submission plan:

- **1inch track.** Reimplementing settlement as SwapVM opcodes is a second full
  implementation, not an integration.
- **Chainlink CRE track.** Private beta; enrollment latency is not a risk worth carrying
  with the time remaining.
- **Live order-entry dApp.** Replace with a static results page rendered from a real
  testnet batch's JSON output. Judges need to see a trade happen, not a wallet connector.

Keep: Uniswap Foundation track, `FEEDBACK.md` + the Developer Feedback Form, the sandwich
comparison harness, both benchmark curves, the demo video.

## C6. Positioning that survives Q&A

`idea.md` §8's claim is sound and should be kept verbatim. Add to it:

- The mechanism's guarantees assume consensus-layer censorship resilience (Theorem 23).
  A testnet does not provide this.
- Welfare-optimality of the proposed allocation is asserted by the solver, verified only
  for feasibility, IR, budget bounds and curve conservation on-chain.
- The pivot algorithm is extracted from the paper's Lemma 16, not original to this work.
