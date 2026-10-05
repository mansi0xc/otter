# Otter: research grant scope draft

Prepared 5 October 2026 against source baseline `2c24344`.
**Local draft, not a submitted application. Funding amount, contributors,
availability and independent reviewer are not yet confirmed.**

Local 4I update, starting from `149db34`: signed minimum output is now enforced
on both sides. The research milestones and unresolved mechanism gates below
remain unchanged; this safety patch is not a deployment-readiness claim.

Local 4J update, starting from the user's `6cf5348` commit: the solver preflight
now rejects malformed numeric inputs and minority outcomes rejected by the
current settlement rule, without trusting solver diagnostic totals. This
reusable offline check is supported by real-settlement comparisons; it supplies
neither a selected incentive mechanism nor live-state authentication. See
[the checkpoint report](./CHECKPOINT_4J.md) and current review runbook.

## Proposed project and public benefit

**Title:** Exact settlement and incentive research for Otter on Uniswap v4.

Otter explores how a surplus-redistributing batch mechanism can be implemented
with v4's actual integer settlement and range liquidity. The proposed grant funds
an independently reviewed mechanism specification, reproducible counterexamples
and reusable execution/verification tools. It targets a useful mechanism that
preserves the intended guarantees; it does not promise a production deployment
before those requirements are shown compatible.

The public contribution is the extension analysis and implementation evidence.
The source paper's theorem and algorithm belong to its authors. No priority,
best-price, all-in profitability or universal MEV-resilience claim is made.

Uniswap's current builder funding guidance includes research, tooling and product
development, with documentation and impact evidence relevant to applications.
This supports considering a research scope; it is not an eligibility decision
or an award promise. [Official funding guidance](https://developers.uniswap.org/docs/ecosystem/builder-support/get-funded).
The Foundation's portfolio includes research and security work, but a portfolio
page does not establish an open call, current cohort terms or a scoring rubric.
[Foundation grants portfolio](https://www.uniswapfoundation.org/grants).
Confirm the current application route and terms before submission.

## Why a production-readiness pitch would fail today

| Gap | Consequence for the proposal | Proposed funded result |
|---|---|---|
| Feasibility is accepted without canonical payments; both-side signed minima now reject underpayment, but empty intervals/ties remain | A grant reviewer cannot infer the advertised mechanism or execution liveness from the deployed or local verifier | A complete rule and acceptance conditions, followed by a measured verification design only if the rule passes review |
| Whole outputs conflict with exact truthful allocation responses on a published finite domain | Another rounding patch cannot support a blanket guarantee claim | Proof-quality representation/domain analysis, including a precise negative result if requirements conflict |
| Existing LP traders benefit from changing other traders' pivots and current surplus | Historical ownership accounting alone does not restore incentives | Joint trader/LP/builder/community utility, current-pot routing and repeated-epoch analysis |
| Concentrated custody and quotes exist, but concentrated auctions are gated | Expanded support has not been delivered end to end | A supported curve/domain specification and exact execution regressions; auction integration contingent on proof and verification gates |
| Hardened wallet is unconfigured; no current live solver or external review | Old testnet addresses cannot demonstrate the remediated system | Independent mechanism review and reproducible local evidence first; a later reviewed testnet demonstration under a separately accepted implementation scope |
| Legacy gas/sandwich fixtures omit complete redesigned costs | No credible economic superiority or deployable batch-cap claim | A measured cost/evaluation protocol with honest baselines and uncertainty |

The detailed request, source paths and witnesses are in
[the independent review brief](./MECHANISM_REVIEW_BRIEF.md).
These are known research blockers, not minor remaining polish.

## Milestones and acceptance criteria

The sequence below is a planning estimate of **eight weeks for the research
package**, subject to named contributor capacity and reviewer availability.
It is not a delivery commitment or an estimate for mainnet readiness. Record
owners and effort estimates before requesting an amount. Progress is evaluated
by public artifacts and review, not trading volume from a disabled prototype.

| Milestone | Provisional window | Reviewable deliverable | Acceptance / go-no-go |
|---|---|---|---|
| M1: freeze claims and reproduce evidence | Weeks 1–2 | Versioned type/utility/strategy/domain matrix, hashed source baseline, all five evidence families independently reproduced, source-to-claim map | Every claimed property has assumptions and a proof/test/unknown label; discrepancies resolved or disclosed. Name the mechanism reviewer and record conflicts. |
| M2: resolve representation and curve questions | Weeks 3–5 | Complete two-sided proposal with actual residual execution and changing-price support, **or** a precise incompatibility result and explicit alternatives | Proposal must address E1 and E3–E5 without silent changes to valuations, redemption or signed minima. Finite exhaustive checks supplement an argument; they do not replace it. If no compatible design exists, stop production integration and present the product decision. |
| M3: resolve redistribution and obtain independent review | Weeks 5–7, after M2's assumptions are fixed | Joint-role/current-pot/dynamic analysis, review report and responses, corrected reproducible fixtures | E2 is addressed under the selected complete utility and horizon. A fixed auxiliary subsidy alone does not pass. Independent review distinguishes proven, conditional and unresolved properties. An honest negative result is a research output, not a shipping gate pass. |
| M4: publish implementation decision and reusable tools | Week 8, after review | Final claims matrix, versioned reference or counterexample library, exact v4 execution examples, verification resource plan and follow-on budget | Research artifacts reproduce from recorded pins; no unresolved result is advertised as a theorem. Proceed to canonical implementation only if G1–G4 have an implementation-ready design and acceptance evidence. Otherwise publish the qualified result and retain the execution gate. |

"Publish" is the proposed award deliverable. This checkpoint does not publish,
upload, contact a reviewer or submit an application. Review turnaround and open
questions may require revising the schedule before it is agreed.

## Evaluation and useful KPIs

- **Reproducibility:** all seven existing research JSON fixtures reproduce exactly;
  relevant actual-core/ownership/cash tests run with recorded pins and logs. Track
  external reproduction success and discrepancies once a reviewer exists.
- **Claim quality:** 100% of requested guarantees mapped to explicit assumptions,
  complete rules and proof status. Acceptance requires resolving blockers or
  publishing a precise negative result, not inflating the number of tests.
- **Verification resources:** measure first admission, complete canonical
  settlement including every counterfactual, native/ERC20 claims and exits on a
  specified target chain/budget if a rule is selected. Record cold-access costs,
  calldata/data availability and worst supported traces. Unsupported cases must
  fail before escrow or retain independent recovery under the selected rule.
- **Economic evaluation plan:** compare fills, signed-minimum satisfaction, surplus
  destination, trader and LP net returns, latency and gas/calldata/approval/keeper
  costs across identical opening states. Include zero fills, both directions,
  concentrated gaps, adversarial reports and repeated epochs. Compare against
  direct v4 execution and investigate suitable batch competitors with explicit
  semantic differences. Select workloads before publishing advantage claims.
- **Reuse:** publish documented execution/counterexample interfaces and record
  actual independent users or integrations later. Repository stars, fixture profit
  or a historical gas curve are not protocol adoption evidence.

## Budget worksheet and funding boundary

No dollar total is defensible before capacity, rates and review quotes are known.
Use the worksheet below to obtain an itemized request. Do not reuse the original
short shipping estimate after the scope expanded to native assets, concentrated
execution and mechanism redesign.

| Cost line | Quantity and price basis to supply | Owner / quote status |
|---|---|---|
| Mechanism research, specification and proof work | Named researcher hours × quoted rate, including corrections | Unassigned; no quote |
| Independent mechanism review | Fixed scoped quote or capped reviewer hours; conflicts and deliverables recorded | Reviewer not selected or contacted |
| Reference/exhaustive model and v4 regressions | Named engineer hours × rate; specify new versus already completed work | Capacity/rate to confirm |
| Resource/economic evaluation design and documentation | Engineer/researcher hours × rate; reproducible workload/tool costs | Capacity/rate to confirm |
| Contingency | Explicit amount, rationale and change-approval rule | To agree; do not hide in other lines |
| Follow-on security review / implementation | Separate estimate only after a compatible design is selected | Outside this initial research request; no audit scheduled |

Separate historical completed work from requested future work and disclose any
other funding. Attach reviewer quotes, accountable owners and milestone payment
criteria when available. A research award may support an informative negative
result; confirm that with the actual program before promising payment terms.

The repository has an MIT license. Preserve vendor licenses and record the
intended license for new artifacts before an award/public release. Contributors'
rights, reviewer report publication permission and any affiliation need factual
confirmation; this draft claims no Uniswap employment or endorsement.

## Submission checklist and evidence boundary

Attach this scope, the review brief, provenance manifest and reproduction
results; summarize custody/recovery work with its material limits. Supply the
actual applicant identity, team experience, repository URL or approved access,
milestone owners, rates, requested amount, reviewer quote and program-specific
terms before sending an application. None of those facts should be invented.

No hardened deployment, complete concentrated auction, production audit,
adoption, accepted grant or independent review has been demonstrated. The current
research strengthens the basis for a technically honest application; acceptance
still depends on the program's criteria, assessment and available funding.
