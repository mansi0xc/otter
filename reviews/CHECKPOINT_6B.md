# Checkpoint 6B — LP rewards and trader incentives

Prepared 5 October 2026. Starting revision: user-created commit `ebfea3e`.
The starting tree was clean. Status: local research evidence, pending the user's
commit. No production contract, custody rule, reward policy or order ABI changes.

## Result: historical ownership does not preserve combined truthfulness

Checkpoint 6A prevents a later LP from collecting an earlier epoch's rewards.
Its funded cash accounting still holds. However, **a fixed opening stake in the
current batch's residual pot can reward an ask misreport**, even with exact
welfare optimization and exact pivotal payments in a certified one-sided domain.
Canonical trader payments alone will not fix this composition problem.

This is a new mechanism gate, **G4: joint trader/builder/LP redistribution**.
It is separate from R2's solver discretion, R7's corrected historical capture,
and G1–G3's integer representation, curve and verification questions. No weaker
guarantee or replacement redistribution rule is selected.

The paper models trading utility through controlled identities' net token flows.
Its builder-fee section requires current-outcome-independent builder benefits
when a builder is also a trader. Applying that reasoning to an economically
controlled LP reward is our **inference**, not a claim that the paper analyzes
this ledger. See [section 2.1](https://arxiv.org/html/2609.03474v1#S2.SS1) and
[section 7](https://arxiv.org/html/2609.03474v1#S7). Their continuous curve
assumptions also differ from the bounded integer v4 table below. This checkpoint
does not disprove the paper or prove a universal impossibility for revised
mechanisms.

## Counterexample with real v4 execution and cash claims

At opening sqrt price `3*Q96/2`, a zero-fee pool has two full-range positions
`[-887220,887220]` with liquidity 20 each. Opening capital per position is
`principal0=13`, `principal1=29`, and weight `29+floor(13*9/4)=58`.
Trader A owns one position; another actor owns the other. The fixed community
dust recipient is independent of A.

Fix input lots of 4 currency0 units and a price limit accepting at most 8 units.
**Before examining any report**, derive the limit from the pool's 8-input quote.
Actual v4 gives the fixed quantity table `F=[0,7,13,null]`: requests 4 and 8 are
complete, while request 12 consumes only 8 and outputs 13. The partial request
does not become an executable 12-input allocation. The reverse 9-unit-lot table
is `[0,3,6,null]`. Both supported prefixes are integer-concave, with first outputs
below the opposite spot lot. No concentrated range, fee, deficit, payment ceil,
fractional claim or extra funding is used.

A's true budget is 8 and true cost is 4 output units per input lot (original
WAD ask `1e18`). B's budget is 4 and cost is 1 per lot (ask `0.25e18`). A changes
only its ask to `0.5e18`, encoding cost 2 exactly. Evaluate both outcomes at A's
**true** cost 4. All orders remain eligible, and both reports fill one lot per
trader, leaving A's other lot unspent.

| Quantity, in raw units | Truthful A | A reports cost 2 |
|---|---:|---:|
| A input spent | 4 | 4 |
| B input spent | 4 | 4 |
| Actual pool output | 13 | 13 |
| Exact pivot payment to A | 6 | 6 |
| Exact pivot payment to B | 4 | 2 |
| Residual pot | 3 | 5 |
| A's funded LP claim | 1 | 2 |
| Other LP's funded claim | 1 | 2 |
| Fixed community dust | 1 | 1 |
| A's trade utility, payment minus true cost | 2 | 2 |
| A's trade utility plus LP cash | **3** | **4** |

Independent counterfactuals are also exact. Without A, B's welfare is 6 for both
reports. Without B, A's welfare is 5 truthfully and 9 under its false report.
Full reported welfare is respectively 8 and 10. The pivots are therefore
`4+8-6=6`, `1+8-5=4`, then `2+10-6=6`, `1+10-9=2`.
Every payment is funded and individually rational at its reported cost; A's
unchanged payment also exceeds its true cost.

Both reports swap the same 8 input for 13 output and finish at identical price,
tick and liquidity. Deposits, LP ownership and fees are unchanged, so LP
principal cancels from the comparison. The one-unit gain comes from a **cash
claim**, not an optimistic valuation of an unredeemable credit or a changed
mark-to-market LP position. It is a gain before transaction gas, not a claim of
profitable trading after all costs in a deployed market.

The Solidity test independently enumerates allocations and leave-one-out
counterfactuals, executes the real core swap, manually delivers the computed
trader payments, funds the actual `OtterRewardLedger`, and withdraws A's claim.
Its book is explicitly a **test stub**, not the real epoch authenticator or
canonical `OtterSettlement`. Thus this is execution/cash evidence for candidate
composition, not a claim that production settlement already enforces these
pivots. Actual book/vault ownership authentication remains covered by 6A's
historical reward suite. The offline reference separately compares scan and
Cartesian outcomes and the original WAD-ask candidate.

## Analytical family: this is not a dust-only accident

On a fixed two-lot domain let `F(1)=u`, `F(2)=u+v`, with `u>=v>c>d>=0`.
A can supply two lots at true cost `c`; B supplies one at cost `d`. For any
reported A cost `a` satisfying `d<a<v`, both traders supply one lot.
The pivots are `paymentA=v`, `paymentB=a`, and surplus `u-a`.

A can lower its report below `c` while staying above `d`. Its own input and
payment stay fixed, but its fraction `lambda>0` of the surplus increases by
`lambda*(c-a)` before reward rounding. Whole cash claims gain whenever the
entitlement crosses a whole-unit boundary, as the core example shows. The
finite suite checks 1,024 strict-margin profiles with a two-unit-or-greater
report change and equal LP weights; all give a whole-unit composed gain.
The displayed core example has `u=7,v=6,c=4,d=1,a=2`.

With no controlled LP stake, the two displayed reports have identical utility.
A fixed exogenous subsidy adds the same utility to both reports. These negative
controls isolate the outcome-dependent reward; they are not implemented or
funded alternative policies and do not prove a complete replacement mechanism.

## Conditional rounding result for same-range splits

At fixed opening price and endpoints, removable principal is the floor of a
nonnegative linear function of liquidity in each currency. Consequently
`principal(L1+L2)>=principal(L1)+principal(L2)` componentwise. Flooring the spot
conversion preserves that inequality, so merged capital weight is at least
the sum of split weights. This extends to any admitted finite partition.

Let the owner's merged weight be `M`, split weight `S<=M`, other total weight
`O`, and fixed pot `R`. For every valid positive total,

```text
sum(split claims) <= floor(R*S/(S+O)) <= floor(R*M/(M+O)).
```

If `O=0`, every other claim is zero and any valid division still exhausts the
pot with LP claims plus dust. If `O>0`, reducing the denominator weakly increases
each other position's reward. Owner plus controlled community dust equals
`R - sum(other claims)`, so that combined cash also cannot increase by splitting.

Example: at the displayed price, liquidity 20 has weight 58; two positions of
10 have weights 27 each. With another weight-58 owner and pot 100, the merged
owner gets 50. Splitting yields 24+24, the other owner 51 and community dust 1.
Even controlling the dust gives only 49. This reveals a rounding disadvantage
for fragmented positions; it does not show reward inflation.

The proof and 4,096 seeded comparisons are **conditional arithmetic**, not a
full LP strategy proof. They fix range, price, pot, other weights and aggregate
liquidity, and exclude deposit/withdrawal cash, ordinary fees, gas, range changes,
pool-count fragmentation and sequential epochs. Same aggregate liquidity does
not imply identical rounded deposit or withdrawal amounts. Concentrated auction
integration remains gated, even though general range weight math is tested.

## Fix requirements before a grant claim

1. Define beneficial control across trader identities, vault positions, the
   community destination and builder. Require the complete mechanism to resist
   deviations in their **combined** utility, including unchanged-AMM-outcome
   examples. Merely checking the trader leg against its signed ask is insufficient.
2. For the same allocation and existing trader transfer rule, a supplemental
   benefit must satisfy the required report independence. A predeclared percentage
   or old LP position does not make its current-pot amount independent. Research
   an exogenously funded, pre-fixed benefit or a different redistribution model
   with a complete joint incentive argument; assess funding and repeated epochs.
3. Treat recipient/address exclusions as insufficient: one actor can control
   separate trader and LP addresses. Delaying the reward, vesting it, capping
   its percentage, or moving the stake cutoff earlier does not remove current
   outcome dependence for an existing economically interested LP/builder.
4. Address entry timing separately. The real book captures the roster at the
   first valid order; an LP admitted just before that order still participates.
   A prior-block or earlier cutoff may restrict entry timing, but requires a
   defined clock, authenticated history and an inclusion model. It cannot alone
   repair the existing-stake counterexample above.
5. Keep G1–G3 and add G4 before selecting canonical settlement or representing
   the redistribution extension as preserving the paper's guarantees. Obtain an
   independent mechanism review of the complete proposal. Wallet/testnet/grant
   packaging should accurately label the current policy as a research prototype.

## Validation and commit handoff

- `forge test --offline --match-contract OtterRewardCompositionTest -vv`: **3
  tests passed**, including 512 conditional split fuzz cases. The cash-composition
  assertion demonstrates the open incentive gap; it does not assert a fix.
- `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'`:
  **301 tests passed across 33 suites**, including historical rewards, claim
  isolation and exact execution differentials. Artifact-writing benchmark
  suites were excluded intentionally and their saved results were preserved.
- `npm test`: **116 groups passed**: eight legacy floating-point groups, 100
  existing integer/reward groups and eight new composition groups. The new
  suite includes 1,024 strict-margin examples, 4,096 partition comparisons,
  original WAD encodings and byte-for-byte research evidence reproduction.
- `forge build --offline`: passed with no recompilation needed. Existing lint
  notes and the sandbox's signature-cache write warning do not change the
  successful result; no dependency/runtime installation or escalation occurred.
- Solidity format check, changed/new-file whitespace, local Markdown targets
  and the twelve-file handoff were checked. Production contracts, scripts,
  dependencies, previous research/verifier fixtures and saved economic evidence
  are unchanged. No deployment, RPC, live transaction, Git staging or commit.

Run Forge from `contracts/` and Node scripts from `solver/`. The new diagnostic
neither changes legacy settlement checks nor enables concentrated admission.

Include exactly these twelve files:

```text
README.md
contracts/test/OtterRewardComposition.t.sol
fixtures/README.md
fixtures/research/reward-composition.json
reviews/CHECKPOINT_6B.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/research/reward-composition-cases.ts
solver/research/reward-composition-cli.ts
solver/src/reward-composition-research.ts
solver/test/reward-composition-research.ts
```

Suggested commit:

```text
test: expose incentive gap in opening LP rewards

Reproduce an ask deviation with exact pivots, real v4 swaps and
funded LP claims. Prove the conditional same-range split bound
and require joint trader, builder and LP reward analysis.
```

The user creates the commit. Stop before the next checkpoint until it is
confirmed; no commit or staging is performed by the assistant.
