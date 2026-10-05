# Redistribution design proposal — requirements before selection

Prepared 5 October 2026 following [checkpoint 6B](./CHECKPOINT_6B.md).
Status: **research candidate and analytical constraints; no production selection**.
The user's target remains preserving the paper's guarantees, including the
original valuation/IR requirements. This document does not replace G1–G3 with a
restricted integer grid or declare G4 complete.

## Decision supported by the evidence

Do not adopt immediate, vested, capped or lagged current-pot LP rewards as a
guarantee-preserving fix. Each can retain a payoff influenced by the actor's
reports. A **pre-funded fixed calendar** provides a concrete way to remove that
dependence from an auxiliary cash benefit for one batch, conditional on fixed
history and unchanged utility/strategy feasibility. It is implemented only as an
offline arithmetic model, and is **not yet a complete redistribution mechanism**.

It requires a separate funding source, unconditional clock-based release, and a
defined destination for the current pot. It does not prove repeated-epoch
incentives, strategic LP principal/range behavior or an all-wallet utility model.
Adding it alongside the existing variable LP pot would leave 6B's gap intact.

The paper permits a current-outcome-independent exogenous builder subsidy in
its additive-fee model. Extending that idea to these LP schedules is our
**inference under extra premises**, not a theorem supplied by the paper.
[Paper section 7](https://arxiv.org/html/2609.03474v1#S7).

| Proposed change | Cash incentive consequence | Remaining requirement |
|---|---|---|
| Current-pot percentage to opening LPs | Fails 6B even at fixed AMM state | Replace outcome-dependent benefit or redesign the full mechanism |
| Earlier ownership cutoff / separate LP address | Does not change an existing owner's variable benefit | Treat beneficial control separately from entry timing |
| Vesting a current-pot entitlement | Positive discount scales the gain without eliminating it | Report independence of its present value |
| Cap or smooth the variable entitlement | Flat regions do not establish independence across thresholds | Prove the whole response rule; the tested cap family still gains |
| “Fixed” reward paid per admitted/settled batch | May reward starting zero-fill batches | Predeclared clock schedules; release even without a batch |
| Future reward funded from earlier surplus | Earlier reports may alter future budget/availability | A dynamic incentive argument, not only fixed-history neutrality |
| Pre-funded, precommitted clock schedule | Conditional auxiliary cash neutrality | Unchanged feasible utility; current-pot destination; funding/authentication; multi-epoch and LP proofs |
| Treasury or inaccessible custody for current surplus | Can remove immediate LP claims, but does not itself prove the desired community policy | Model control, later uses, asset semantics and the intended public benefit before selection |

## Analytical constraints

### Equal own trade requires equal supplemental benefit

Fix other reports, the actor's true budget, ownership history and two admissible
asks. Suppose both reports spend the same own input, pay the same trader output
and end at the same AMM state. All other controlled wealth considered here is
also the same. Let supplemental present-value benefits be `B(a)` and `B(b)`.

For the true type corresponding to each ask, original trade utility is identical
under either report. Truthfulness in both directions therefore requires
`B(a)>=B(b)` and `B(b)>=B(a)`, hence equality. This argument needs no continuous
valuation assumption or VCG payment-uniqueness theorem. It also applies to whole
WAD-representable types on a common allocation/payment plateau.

The 6B core case has exactly that plateau but cash benefits 1 and 2. Holding an
entitlement for eight periods with discount 1/2 gives a gain of `1/256`; any
strictly positive discount and finite delay leaves a positive present-value
gain. A zero-value/infinite-delay promise is not an implemented useful reward.

The cap evidence uses **synthetic finite concave tables**, not new v4 snapshots.
For cap `k>=1`, set `F=[0,2k+3,2k+8,null]`, input lot 4, A budget 8, B budget 4,
A true cost 4, false cost 2 and B cost 0 per lot. Exact pivots pay A 5 in both
cases and B 4 versus 2. Pots are `2k-1` and `2k+1`. Half-stake rewards capped
at `k` are `k-1` versus `k`: the gain remains one. The saved artifact tests
caps 1–8; the formula states the family subject to the laboratory's numeric
bounds. This establishes a failure of that cap rule, not all conceivable caps.

### Constant-benefit preservation is conditional

Suppose a base mechanism is already truthful for utility `U` over strategy set
`D`, with the same feasibility/catastrophic gates. Fix history `H` before the
choice being evaluated. If each real actor's total auxiliary benefit `C(H)`
is finite and independent of every allowed deviation, including identity
creation, then

```text
U(truth,H) >= U(deviation,H)
    implies
U(truth,H)+C(H) >= U(deviation,H)+C(H).
```

Catastrophic utility remains catastrophic under that additive convention.
This is a preservation lemma, not a proof that the base integer/two-sided rule
is truthful. It assumes the controlled beneficiaries and all feasible strategies
stay the same; a fixed grant per new identity would violate that premise.
It also does not cover LP principal if different AMM outcomes change the
actor's wealth. G1–G3 and a full LP/utility treatment remain necessary.

### A fixed gift can change the net-flow gates

The paper's net order-flow utility includes a true-budget gate and an
opposite-direction catastrophic gate; weak gains in both assets are allowed.
A fixed fee added **outside** that utility is a different operation from adding
a gift **inside** those net-flow tests.
[Paper section 2.1](https://arxiv.org/html/2609.03474v1#S2.SS1).

The artifact makes this boundary explicit using 6B's core-matched pool at spot
9/4. A true currency0 seller has raw ask 4 and budget 4. Its truthful order is
ineligible, so its trading flows are `(0,0)`. Instead it submits a sole opposite
order with currency1 budget 9 and ask zero. The exact candidate swaps 9 currency1
for 3 currency0 and pays all 3 to that order: flows are `(+3,-9)`. The actor
is assumed able to fund that opposite order with its currency1 holdings.

Under the original order-only gates, the opposite strategy is catastrophic.
An exogenous output gift of 9, treated as a separate additive fee, leaves it
catastrophic, while truth gets utility 9. However, if the same gift is included
**inside the wallet net-flow gates**, the opposite outcome becomes `(+3,0)`.
It is then admissible under that alternate interpretation and has utility
`0+4*3=12`, exceeding truth's 9. Both order outcomes are funded; the reward is
external, fixed and identical. The gain is before gas.

This is **not a counterexample to the paper's additive fixed-fee convention**.
It shows why declaring a gift constant is insufficient to establish equivalence
to a broader wallet-flow game. The alternate utility is diagnostic, not selected
for production. Define exactly where budget, preference, LP principal, reward
claims and other endowments enter utility before writing the combined guarantee.
Do not silently change the user's original minimum-output or guarantee target.

### Positive fixed amounts need independently reserved funding

A zero-output/zero-surplus outcome is possible. A positive reward promised
unchanged across such outcomes cannot be guaranteed solely by that batch's
surplus. It needs cash reserved beforehand or a separately specified external
funding guarantee. “Pay when enough surplus exists” is outcome dependence;
reducing, cancelling or rolling the promise changes its effective benefit.

The offline calendar rejects such underfunding at commitment, rather than
waiting for settlement. It reserves all unreleased grants and released claims
for every pool sharing its currency. It also reserves space for known future
claimants under the model's account bound; otherwise a funded promise could
fail to release because its recipients exceed that bound.

## Concrete fixed-calendar candidate

This candidate models one currency per ledger; the zero address labels native
ETH, and nonzero addresses label ERC20s. Instances do not exchange backing.
It uses whole underlying units, with no fractional asset or redemption promise.

1. **Pre-fund:** receive independently available funds before the relevant
   reports. Real integration must measure received assets exactly and reserve
   existing liabilities first. Funding provenance is an economic assumption,
   not something a token balance alone proves.
2. **Commit before the cutoff:** assign an immutable ID to a predeclared clock
   slot and freeze currency, amount, owner weights, dust destination, cutoff and
   release time. Compute and store all whole claims immediately. Aggregate repeated
   owner addresses after per-position flooring. Reserve the full amount and future
   account capacity atomically. A changed owner/weight array cannot alter it later.
3. **Release at the clock boundary:** move reserved cash liability into claim
   liability exactly once. Require no order, filled input, successful settlement,
   surplus level, solver action or recipient acceptance. Expiry or an empty slot
   must not change the payment. No catch-up grant is created for every missed or
   attacker-started batch.
4. **Claim independently:** reduce only that owner's whole claim and backing.
   Real ERC20/native delivery must retain existing exact-transfer and callback
   protections. A failed delivery must roll back only that claim.

The reference implements those cash transitions immutably in
[`redistribution-research.ts`](../solver/src/redistribution-research.ts), reusing
the prior scale-1 backing model. Its laboratory limits are 8 lifetime grant
records, 32 position entries per commitment and 64 current/future backing-account
identities per currency. These are **model limits**, not selected on-chain caps.
Grant IDs, owners, funding and clock are assumed authenticated. It performs no
native/ERC20 transfers and enforces no real authorizations.

For the 6B plateau, committing a separate 7-unit external pot before reports
allocates A 3, B 3 and dust 1. The amount and release time are identical after
either report, an expiry or no batch. Claiming A's 3 leaves cash 4 exactly backing
B's 3 and community's 1. This closes only the *auxiliary cash variation in that
fixed-history model*, provided no variable current-pot claim is also paid.

## Clock, history and current-pot integration still need resolution

**No per-start subsidy.** Otter currently starts a new epoch at the first valid
order, with a caller-influenced epoch count. A fixed subsidy for each such start
can be farmed with accepted ineligible orders, zero canonical fills and recovered
principal. The artifact's hypothetical 3-unit reward over three starts pays 9
before gas without net trade input. A precommitted clock pays the same fixed
3-unit benefit whether there are zero or three starts. Batch ID must not serve
as the subsidy clock. An eight-grant cash limit bounds exposure; it is not an
incentive proof or spam deterrent.

**Earlier history is strategic.** The 6B reports leave pots 3 and 5. If those
fund a promised next-period pot of 5, only the second history can cover it.
The next owner claim can therefore exist only after the earlier deviation.
Freezing a later promise does not erase that causal dependence. Define a
dynamic strategy/utility horizon before replenishing schedules from Otter
surplus or claiming a repeated-epoch guarantee.

**Current pot is still an economic liability.** The fixed calendar consumes no
current-pot argument. Production still pays that pot through the 6A ledger.
Replacing that payout requires a separately selected custody/redistribution
rule. Keeping it in a treasury whose later payouts depend on its balance can
reintroduce the dynamic issue; returning it to the pool changes future trading
and LP principal. An inaccessible sink would change the public-benefit and LP
revenue proposition, and generic ERC20 “burn” semantics cannot be assumed.
None of those destinations is selected or implemented by this checkpoint.

**LP entry and economic control.** A clock cutoff needs authenticated historical
ownership/capital and a policy for exiting LPs, idle periods and same-block entry.
An old stake or a different wallet does not remove beneficial ownership. Do not
freeze unrelated withdrawals throughout idle clock slots merely to simplify
reward accounting. Continued-capital/range risk and strategy across slots need
separate analysis; the conditional same-range split proof does not supply it.

## Requirements for a production proposal

- A complete utility definition and strategy set explain additive versus
  all-wallet flows, original true budgets/asks, both directions, controlled
  identities, LP principal and the multi-period horizon.
- G1/G2 define a compatible integer/asset/curve mechanism across changing v4
  prices; G3 binds the complete authenticated verification, not just this reward.
- G4 proves the whole redistribution policy, including current-pot destination,
  future use and economically controlled community recipients. The calendar's
  conditional lemma is only one component.
- Specify funding authority/provenance, exact receipts, immutable calendar
  configuration, clock/admission coupling, stored data availability, and shared
  backing. Bind selected policy/version to the pool/snapshot; existing registered
  policy hashes cannot be silently repurposed.
- Reconcile deposits, exits, unchanged prior claims and deployment/wallet ABI
  migration. Measure actual native/ERC20 failure, reentrancy, maximum commitments,
  cold claims and complete solving/counterfactual costs in contracts.
- Obtain independent mechanism review and a revised funding/LP-economics budget.
  This research can inform the grant proposal; it does not establish deployment
  readiness, complete concentrated support or eligibility for a production grant.
