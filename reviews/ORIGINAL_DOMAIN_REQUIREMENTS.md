# Original-domain coverage and canonical verification requirements

Prepared for checkpoint 4P, 6 October 2026. This is a verification boundary,
not a selected allocation/payment rule. G1–G4 remain open.

## What the current coverage inventory establishes

[The pure inspector](../web/src/protocol/batchCoverage.ts) accepts a caller-
authenticated 4O batch binding, opening record, captured curve frame and complete
original orders. It revalidates mutable content with the existing opening/batch
validators and compares the recomputed hashes, point count, domain and original
side budgets with that binding. A caller who fabricates the anchor together with
the content supplies no authentication; this pure step adds no RPC, signature,
current lifecycle/custody check, consensus or finality proof.

It inventories the original batch, removal of each record, and removal of every
record for each distinct trader address. Retained fields and order sequence are
unchanged. Each case records its omitted original indices, exact retained-order
ABI hash and the sum of retained original budgets on each side. These cases use
the same opening state, ownership roster and declared directional price limits.
They are hypothetical inputs, not independently admitted/signed replacement
batches, computed pivots or an accepted participant model.

For each direction and case, it describes all integer requested inputs
`0..sum(retained budgets on that side)`. This is an opening-input inventory for
alternative single swaps, not a cross-side welfare comparison or sequential
swap trace. It distinguishes:

| Quantity | Meaning |
| --- | --- |
| `requiredInput` | Original sum of retained side budgets, without clipping |
| `domainPresent`, `maxInput`, `limit` | Whether that direction was captured and its fixed prefix/limit; absent domains use zero sentinels |
| `representedInputs` | Number of actual table rows within the required prefix, including zero |
| `missingInputs`, `firstMissing` | Exact missing suffix count and first missing input; no uint96 range is enumerated |
| `unsupportedAt` | Represented rows whose status is outside `Complete`/`PriceLimit` |
| `partialAt` | Supported represented rows that consume less than the requested input |
| `supportedPrefixRepresented` | No missing or unsupported row in the required prefix; supported partial rows may remain |
| `wholeInputPrefixAvailable` | Additionally, every supported row consumes its full requested input |

The aggregate `wholeInputPrefixesAvailable` requires the latter condition for
both directions in every listed case. Both zero points must be explicitly
represented, even for an empty retained side. An absent direction does not gain
an invented zero row. The execution model's actual zero no-op remains supported;
it is not a public zero-amount `PoolManager.swap` permission. Diagnostic rows
outside a case's required prefix do not veto that case's data precondition.

`requireWholeInputOpeningPrefixes` recomputes this inventory from the bound
content and rejects missing, unsupported or partial required inputs. It is a
conservative precondition for research that assumes full requested input. A
future rule explicitly handling actual consumption may use different data
requirements; this helper does not select that rule or change admission policy.
No budget, ask, valuation, utility, unit, payment, reward or trade-size restriction
is changed to obtain a passing flag.

The detached result is frozen through its case/direction/array entries. Its
versioned `OtterOpeningPrefixCoverage/v1` hash commits, in the exported ABI order,
to chain/book/pool/epoch/configuration/read block number and hash, snapshot/curve/
original-order/rolling-digest hashes and the complete normalized case inventory.
Derived convenience flags and `firstMissing` follow from that inventory; the
guard evaluates inputs again instead of trusting a supplied report flag.
This is input/content identity, not an on-chain economic outcome commitment.

The limits remain 32 original records, at most 32 address groups, 65 cases and
130 original captured points. At most 8,450 bounded point classifications follow
the existing tables after their revalidation. Huge uint96 demands are reported
as missing ranges; they are never converted to Number or used as loop bounds.
No additional RPC is made. These work bounds are not transaction gas, production
latency or verifier capacity evidence.

## What a canonical mechanism and witness must still establish

1. **Select an explicit participant and utility model under G1/G4.** Record
   removal and all-records-for-one-address removal differ when one trader submits
   several orders. An address is not proof of beneficial ownership, and the
   inventory does not merge aliases or alter LP ownership on removal. Specify
   which reports form one strategic participant, how LP/trader overlap, builders,
   false names and repeated epochs affect the theorem, and what each required
   counterfactual removes. Do not silently treat record-level pivots as a
   trader-level dominant-strategy proof.
2. **Publish one deterministic rule and policy version.** Define both-side
   allocation, direction selection and comparable objective units, ties, exact
   rounding, output/refunds/residuals and all counterfactual calculations. Use
   the same function on chain and in the reference. A coverage hash does not
   choose this policy or validate a feasible vector. Whole-unit IR and the
   original WAD-valued signed asks must remain explicit until a compatible
   alternative is selected with evidence.
3. **Cover the complete original feasible computation under G2.** Summed side
   prefixes are necessary input inventories for the represented alternative
   opening swaps; they do not enumerate allocations, prove welfare optimality,
   decide direction or cover sequential/netting/ownership-changing traces of an
   unspecified mechanism. Keep original budget bounds for every counterfactual.
   For large budgets, provide an exact scalable algorithm or authenticated proof
   of the omitted computation; a sampled 0–64 table, monotone interpolation or
   clipped budget supplies none. Price-limit partial consumption, finite capacity,
   integer output and concentrated tick/gap behavior need a proved or qualified
   mechanism adaptation, rather than literal reuse of a continuous theorem.
4. **Bind the entire economic witness under G3.** An accepted witness must name
   the selected mechanism/policy and authenticated current batch/curve/ownership
   inputs, then verify every required original and counterfactual computation,
   canonical tie/direction result and unique per-record fills/payments/refunds.
   Actual consumption and both-asset conservation must account for payouts,
   residuals/rewards and unspent input without borrowing other batches' backing.
   Revalidate execution-critical state before the actual swap. Missing traces,
   unsupported cases, failed IR/funding or noncanonical alternatives must fail
   without economic completion and retain timeout recovery.
5. **Measure and review the complete verifier.** Benchmark original and
   counterfactual work, actual calldata/transaction costs and native/ERC20 delivery
   under a stated chain/resource budget. The local fixture's FFI/oracle gas and
   case-count bounds do not set deployable limits. A trusted hardware, bond or
   delayed dispute substitute changes the trust/delivery model and requires a
   revised specification; it does not close immediate trustless verification.

Concentrated auction integration, compatible incentives, independent security/
mechanism review and grant evidence remain necessary. Passing the current prefix
precondition establishes none of them. Existing production settlement remains
the legacy feasibility implementation; no replacement rule or weaker guarantee
is selected by this checkpoint.
