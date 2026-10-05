# Checkpoint 6C — redistribution design constraints and fixed-calendar candidate

Prepared 5 October 2026. Starting revision: user-created commit `2f12631`.
The starting tree was clean. Status: research/design checkpoint pending the
user-created commit. No production rule or guarantee has been selected.

## What was achieved

[The redistribution proposal](./REDISTRIBUTION_DESIGN.md) turns the 6B finding
into concrete mathematical and implementation requirements. It contains:

- A necessary equal-benefit condition on unchanged-trade/payment plateaus.
- A conditional preservation lemma for independently fixed cash benefits,
  explicitly requiring unchanged feasible utility and fixed history.
- A whole-unit, pre-funded clock schedule with reserved liabilities, frozen
  owner/dust entitlements and independent claims, implemented **offline only**.
- Funding, clock, utility, current-pot destination and repeated-epoch requirements
  that must be resolved before adopting a redistribution rule.

The model gives the same auxiliary claim after a successful, zero-fill, expired
or absent batch because release has no batch-result input. It is not a simulation
of actual on-chain epoch transitions or a new token/authorization contract.
Production retains its existing historical rewards and legacy settlement checks.
G1–G4 and concentrated auction integration remain open.

## Candidate limits exposed rather than hidden

Delaying the 6B reward eight periods with discount 1/2 leaves a gain of `1/256`.
A positive-cap family retains a whole-unit gain at the cap threshold, with exact
funded pivots on explicitly synthetic concave tables. A hypothetical fixed
reward per started batch can be farmed by zero-fill epochs; a fixed clock avoids
that particular count dependence. Earlier surplus also changes the availability
of later fixed promises, so fixed-history neutrality is not a dynamic guarantee.

A new utility boundary is recorded. Under the paper's additive-fee convention,
a fixed bonus preserves catastrophic outcomes. Under an alternate interpretation
that includes the gift inside net wallet-flow gates, a funded opposite-direction
order plus a fixed gift can become admissible and gain. The example uses 6B's
core-matched reverse quote of 9 input for 3 output. This rejects claiming the two
utilities are equivalent; it does **not** refute the paper's fixed-fee convention.

Fixed schedules are not a complete fix: adding them to current variable LP
claims leaves 6B intact. Current-pot routing, strategic LP principal and repeated
epochs need the full policy and proof. No weaker mechanism, restricted valuation
domain, new true-budget definition or modified IR promise is adopted.

## Model accounting and safety properties

Each currency instance reserves all grant amounts at commitment, before release.
Released claims remain reserved until delivery. Other grants cannot spend that
backing; early/double release and duplicate IDs fail. Frozen allocations include
the exact per-position rounding residue and aggregate repeated owners. Operations
return new states so a failed operation cannot mutate its source. Zero address
labels native ETH, and distinct currency instances cannot exchange cash.

The bounded model reserves **future beneficiary capacity** before committing.
This avoids accepting a funded promise that later fails the reused model's
64-account limit. Its eight-grant/32-position bounds are laboratory limits, not
measured production resource caps. Exact ERC20/ETH receipt/delivery, clock,
ownership and authority are assumptions here and require contract integration.

## Validation

- `npm run test:redistribution`: **13 groups passed**, including 1,024 seeded
  commitment/release/partial-claim histories with independently computed cash
  entitlements, reservation of future account capacity, boundary/replay failures
  and the utility/clock/funding examples. Failure assertions document candidate
  limits, not closed incentive findings.
- `npm test`: **129 groups passed**: eight legacy floating-point groups and 121
  integer/reference/research groups, including all earlier saved-evidence checks.
- Changed/new-file whitespace, local Markdown targets, exact twelve-file handoff
  and research-artifact reproduction were checked. Production Solidity,
  deployment scripts, dependencies, existing FFI references, earlier fixtures
  and saved economic benchmarks are unchanged. The contract suites were not
  rerun for this Node/design-only checkpoint; 6B records their 301-test baseline.
- No RPC, deployment, live transaction, dependency installation, Git staging or
  commit. Funding, native/ERC20 delivery, authenticated clock and ownership remain
  explicit model assumptions; this checkpoint contains no new contract.

Run the Node scripts from `solver/`. Resource limits are laboratory bounds; no
on-chain gas claim or complete guarantee follows from the passing arithmetic.

## Commit handoff

Include exactly these twelve files:

```text
README.md
fixtures/README.md
fixtures/research/redistribution-research.json
reviews/CHECKPOINT_6C.md
reviews/REDISTRIBUTION_DESIGN.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/research/redistribution-cases.ts
solver/research/redistribution-cli.ts
solver/src/redistribution-research.ts
solver/test/redistribution-research.ts
```

Suggested commit:

```text
research: specify fixed-reward redistribution constraints

Model pre-funded calendar rewards with reserved claims and fixed
release times. Document utility, epoch-farming and future-funding
limits before selecting a guarantee-preserving redistribution rule.
```

The user creates the commit. Stop before the next checkpoint until confirmation;
the assistant performs no Git staging or commit.
