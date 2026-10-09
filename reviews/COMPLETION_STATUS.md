# Otter completion status

Prepared 8 October 2026. Checkpoint 4R was committed by the user as
`b25bea017f07b37f9a64b24912dc825ebbeb3dec`; checkpoint 4S is local work pending
that user's review and commit. This is an assessment against the requested
paper-preserving native/concentrated project, not a grant eligibility decision.

**The local safety and evidence foundations are substantial. A complete
mechanism is still unresolved, so Otter is several major phases from production
readiness. A candid research-grant application is a closer target.** No credible
percentage or finish date follows from the number of commits or passing tests.
The critical path depends on whether the intended guarantees can hold together
in actual integer assets and range liquidity under an explicit utility model.

## What exists locally

| Area | Implemented or tested evidence | Material boundary |
| --- | --- | --- |
| Custody and recovery | Native/ERC20 exact escrow, isolated claims, bounded epochs/recovery, owned LP custody and exit priority | Local evidence; token compatibility limits remain; no current hardened live demonstration or independent audit |
| Range and execution support | Concentrated LP custody; zero-fee tick execution reference/oracle and actual-core comparisons | Concentrated auction admission/swaps remain gated; custody/quotes are not complete concentrated auctions |
| Opening and original data | Ownership/capital-weight records, content checks, pinned source/batch readers, complete bounded original/removal inventories | Configured source/RPC are trust inputs; FFI transport/block identity is synthetic; bounded tables are not a scalable general verifier |
| Delivery safety | Both-side signed minima enforced in current settlement; offline preflight; exact minimum frontiers | Safety rejection does not supply a canonical allocation/payment rule or useful execution liveness |
| Research and review packet | Reproducible integer, backing and joint-role counterexamples; review brief, scope draft and content manifests | No selected compatible rule, full proof or external independent review; manifests certify content identity only |
| Wallet surfaces | Claims/history and guarded configuration flows tested locally | Deployment manifest remains null; no live wallet/solver/testnet evidence for the hardened system |

## Remaining production critical path

| Work | Completion condition | Dependency |
| --- | --- | --- |
| 1. Resolve mechanism gates G1–G4 | Versioned complete type/strategy/utility/representation domain, both-side units/direction/ties, allocation/payments/refunds/counterfactuals, delivery/backing and joint-role/repeated-epoch arguments; independent adversarial checks | Research may produce a qualified incompatibility result instead of a deployable rule |
| 2. Enforce canonical computation | Accepted on-chain recomputation or complete authenticated witness for the selected rule, including every required counterfactual; measured worst supported resources | A specified compatible mechanism |
| 3. Complete concentrated auctions | Supported finite-capacity/nonconcave curve domain, exact residual execution, correct capital/reward treatment and recovery across gaps/ranges | Mechanism and verification design; existing custody/quotes are reusable |
| 4. Obtain independent reviews | Scoped independent mechanism and security reports, reproduced findings and fixes, disclosed assumptions and remaining risks | Stable rule and implementation; no reviewers have been contacted in this work |
| 5. Demonstrate current integration | Configured reviewed testnet, solver/wallet/native/ERC20/LP lifecycle and failure-path evidence | Accepted implementation and explicit authorization for external actions |
| 6. Finish economic evidence and application | Fair workload/baseline comparisons with complete costs, both-side/LP outcomes, contributor/budget/impact facts and verified intake terms | Defined supported behavior, measurements, reviews and real applicant facts |

These are dependency stages, not a claim that each takes one commit or equal
calendar time. Local groundwork can be reused, but a research blocker prevents
honestly counting the mechanism stage as mostly finished.

## Closer target: a research grant

[The scope draft](./GRANT_RESEARCH_SCOPE.md) already frames reusable tools,
independently reviewed specification work and a qualified negative result as
possible research deliverables. The packet can describe completed safety work
and the precise unresolved questions without promising launch or profitability.

Still missing are the real applicant/team facts, accountable owners and
availability, itemized effort/rates/requested amount, an independent reviewer and
quote/conflict disclosures, publication/access permissions, and verified current
program route/terms. Those facts cannot be invented from the codebase. Its
historical provisional **eight-week research schedule is conditional planning,
not a current estimate for finishing Otter or a delivery commitment**. No award,
program fit, application submission or reviewer arrangement is established.

## How to stop an open-ended test loop

The next research deliverable should consolidate the fixed assumptions, proven
local conflicts and unresolved obligations into a claim matrix and an
implementation decision. Each further experiment should answer a named open
obligation or test a concrete compatible proposal; increasing test counts is not
mechanism progress by itself. Production integration must wait for the gates,
or the research output must precisely explain which requirements conflict and
present alternatives for an explicit product decision.

The user's preference remains to preserve the paper's intended guarantees.
This status selects no weaker incentive claim, revised valuation, payment asset,
minimum/budget/report restriction, participant policy or subsidy. No external
contact, funding application, deployment or Git commit has been performed here.
See [4S](./CHECKPOINT_4S.md) for the next bounded report-response result and its
exact evidence/handoff.
