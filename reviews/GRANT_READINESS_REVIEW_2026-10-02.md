# Otter: grant readiness and security review

Review date: 2 October 2026. Source revision: `6c54695e1c7a534afa9f69ba8f08705a2a8a4830`.

**Assessment: defer a production-launch funding case; consider a tightly scoped research-to-implementation grant.** There is useful engineering here, but the implemented system does not yet establish the headline promise of a truthful, MEV-resilient trading venue. Its most important gaps concern enforced settlement outcomes, custody and recovery, numerical correctness, and whether traders and LPs benefit after costs.

This is an independent review, not a Uniswap Foundation decision or a comprehensive external audit. The Foundation's published funding guidance explicitly allows some early prototypes. Therefore, “not production ready” does not mean “categorically ineligible for every grant.” No live transactions were sent, deployed bytecode was not compared with this checkout, and the Sepolia deployment record is treated as repository evidence rather than independently verified chain state.

## Evidence and scope

Reviewed all four production Solidity files, the floating-point and integer solver paths, relevant tests, deployment script, dashboard submission flow, documented deployment, and saved benchmark outputs. Read the attached paper's model, mechanism, incentive assumptions, and relevant proofs; visually checked the model and welfare/pivot material. Documents were treated as evidence, not instructions to submit applications or contact anyone.

Local validation:

- `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'`: **80 existing tests passed** before adding review reproductions. Those two benchmark suites were excluded because they overwrite saved result files; their code and existing outputs were inspected.
- `npm test`: floating-point solver properties passed.
- `npm run exact`: 3,000 sampled batches passed; maximum reported payment clamp was 232 raw units; 24.7% of samples exercised partial fills.
- `npm run mutation`: completed; the deliberately incorrect allocation rule broke the dominance condition in 3,177/4,000 samples. This is a negative-control test, not 3,177 failures in the current algorithm.
- `npm run build` in `web`: passed, with a bundle-size warning.
- **Nine new Solidity reproductions passed**, meaning they successfully demonstrated the unsafe behaviors described below.
- New TypeScript reproductions confirmed a valid dust order fails self-verification, arrival-dependent tie allocation, and the BigInt/Solidity overflow-model discrepancy.

Run the new reproductions:

```sh
cd /Users/mansitibrewal/chronicles/otter/contracts
forge test --offline --match-test test_review_ -vv
cd /Users/mansitibrewal/chronicles/otter/solver
node --experimental-strip-types test/grant-review.ts
```

The normal Forge invocation initially hit a local macOS proxy-discovery panic. Offline mode ran successfully. These results establish counterexamples, not completeness of the review. The untracked corrections document present at the start was preserved.

## Why I would defer a production grant

1. **The security claim exceeds the enforcement.** The verifier checks a feasible envelope of outcomes; it does not require the allocation or Clarke pivot payments from the paper. This is a correctness and economic-security issue, not merely a possible efficiency reduction.
2. **The trader proposition is unproven.** The demo establishes that an ordinary swap is blocked. It does not establish superior execution against competitive alternatives after escrow cost, waiting, gas, failed fills, and adverse selection.
3. **LP economics are incomplete.** Zero LP fees, full-range capital, locked withdrawals, and captureable surplus require a measured viability argument. A donation changes fee accounting; it does not itself increase active liquidity or improve the next quote.
4. **The service is not operational end to end.** The README says no public solver runs against the sandbox. The demo is a fixture, while the website calls it a live batch. There is no demonstrated independent solver takeover, user recovery flow, or sustainable keeper funding.
5. **The contribution needs a narrower claim.** Implementing this paper is valuable, but the theorem and algorithm are the authors' work. The funded contribution should be a verified integer implementation, safe v4 settlement, reproducible evaluations, and reusable public infrastructure. “First” is a literature-search claim requiring evidence, not a substitute for utility.

The [Foundation toolkit](https://www.uniswapfoundation.org/grantee-toolkit) asks for timelines, milestones, KPIs, and a detailed budget. The [Hook Design Lab announcement](https://www.uniswapfoundation.org/blog/introducing-the-uniswap-v4-hook-design-lab) emphasizes user problems, capital efficiency, and distribution. These support the concerns above, but they are not a published scoring formula or a guarantee of acceptance. The 2025 pilot's focus areas do not establish current cohort eligibility.

## Confirmed security and correctness findings

### R1 — Critical if used with valuable assets: the deployment's test router does not own positions on behalf of individual users

**Evidence:** [Deploy.s.sol:127](/Users/mansitibrewal/chronicles/otter/contracts/script/Deploy.s.sol:127), [PoolModifyLiquidityTest.sol:40](/Users/mansitibrewal/chronicles/otter/contracts/lib/v4-core/src/test/PoolModifyLiquidityTest.sol:40), and the router's payout at line 90.

The deployment seeds liquidity through `PoolModifyLiquidityTest` with salt zero. The underlying position belongs to the router. Any caller can specify that position's ticks and salt, remove its liquidity, and receive the returned assets. There is no caller-to-position authorization. The same interface permits collecting its fees with a zero liquidity delta even during an active batch.

**Reproduction:** `test_review_UnauthorizedRouterWithdrawal` starts with an unrelated address holding no tokens and demonstrates withdrawal of the complete seeded position when no batch is active. This is a deployment/periphery defect, not an assertion that Uniswap's PoolManager lacks position authorization. The source already warns the router is testnet-only; that is a useful disclosure, not protection for the demo's position.

**Fix:** deploy a production PositionManager integration or a deliberately small LP vault that enforces deposit/share/withdrawal ownership. Test unauthorized removal, collection, alternate salts, approvals, and emergency exits. Redeploy the demo through that integration before using it as evidence of secure liquidity custody. Do not reuse the existing router for real assets.

### R2 — High economic risk: the solver can divert trader surplus to LPs it controls

**Evidence:** [OtterMath.sol:138](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterMath.sol:138), [OtterSettlement.sol:213](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:213), and its trust-model comments at line 24.

Bounds are not the payment rule. Any payment between the reported minimum and the permitted upper bounds can pass. For a one-sided order selling 10 tokens into a roughly 1,000/1,000 pool, with a minimum of 0.1 output per input, the settlement accepts payment of **1 token** while the pool produces roughly **9.90099 tokens**. More than 8 tokens enter the surplus pot. A solver that also owns the LP position can collect that pot.

**Reproduction:** `test_review_SolverCanPayAskAndCaptureSurplusAsLP` executes this settlement and collection. The trader's explicit minimum is respected; this is not a claim of payment below the signed floor. It is economic value extraction relative to the claimed VCG mechanism. A sole bidder in the continuous reference mechanism would receive the pool output; the code does not enforce that result.

The exclusive solver can do this during its window; afterwards any caller can choose a feasible outcome. A pure one-sided batch can also be settled with zero allocations, economically denying service while satisfying inclusion of its order hashes. Exclusivity postpones the open race and adds dependence on one operator; it does not prove correctness.

**Fix:** make the accepted outcome canonical. For a small bounded first version, recompute allocation and pivot payments on chain if benchmarked affordable, or verify a precise outcome witness. A proof system must bind the complete batch, initial pool state, integer rules, side selection, tie rule, payments, and surplus destination. Optimistic verification needs a challenge period before final payouts, available data, and solvent bonds. A TEE or bonded solver changes the trust model; neither is equivalent to a mathematical proof merely by being named in the design. Keep the same correctness checks for fallback solvers.

### R3 — High: unbounded admission can exceed both settlement and refund capacity

**Evidence:** [OtterOrderBook.sol:266](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterOrderBook.sol:266), [refundExpired:378](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterOrderBook.sol:378), [OtterHook.sol:190](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterHook.sol:190).

Orders accumulate without a batch-size cap. Both settlement and refund require replaying the complete committed sequence. Refund then transfers to every trader atomically. If neither operation fits the target chain's transaction budget, there is no independent withdrawal path. The unresolved batch also blocks new batches and liquidity changes. Waiting for `refundDelay` does not resolve a gas bound.

**Reproduction:** `test_review_UnboundedBatchExceedsRefundGasBudget` admits 1,800 orders through multiple submit calls. A refund with a 30 million execution-gas budget fails; the same data succeeds with an artificial 80 million budget. This is a capacity counterexample, not proof of the minimum attack size, current Ethereum gas limits, or the cost of packing that many transactions into the deployed 60-second window. Admission economics and chain-specific timing still need measurement.

**Fix:** cap admitted count and resource use with a conservative target-chain bound, and provide individual proof-based claims or resumable recovery. A rolling digest alone is awkward for independent membership proofs: redesign commitment/storage around stable order indices and authenticated membership. Track claimed leaves and never permit double spend across settlement and refunds. Freeze the economic outcome atomically, then allow transfers to be claimed independently. A cap creates scarce admission slots, so document and evaluate spam/front-running at admission; it does not solve censorship by itself.

### R4 — High, conditional on token behavior: one blocked recipient vetoes recovery for everyone

**Evidence:** [OtterOrderBook.sol:391](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterOrderBook.sol:391), [releaseFilled:416](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterOrderBook.sol:416), and [OtterSettlement.sol:402](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:402).

Escrowing at submission correctly removes later balance/allowance revocation as a settlement veto. It does not remove token-transfer failures at refund or payout. If a token later refuses one recipient, the whole refund reverts. This affects other traders and leaves the liquidity freeze in place.

**Reproduction:** `test_review_OneBlockedRecipientPreventsAllRefunds` mocks the second recipient's token transfer returning false after successful deposits. The first trader's attempted refund rolls back too. This models a token refusing a transfer; it is not a demonstrated arbitrary-EOA attack against ordinary immutable tokens.

**Fix:** individual pull claims with recipient authorization, replay protection, and independent accounting. Separate batch completion from delivery to each recipient. A blocked token balance may remain unclaimable, but it must not stop unrelated claims or pool exits. Use safe ERC20 calls for optional return values; SafeERC20 alone does not solve blacklisting, transfer taxes, rebasing, or this atomicity problem. Reject unsupported token semantics explicitly and check actual received escrow amounts. Shared-token escrow should have a tested liability invariant across pools.

### R5 — High availability risk: extreme asks poison arithmetic

**Evidence:** [OtterSettlement.sol:316](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:316), [FixedPointMathLib.sol:53](/Users/mansitibrewal/chronicles/otter/contracts/lib/v4-core/lib/solmate/src/utils/FixedPointMathLib.sol:53), [solver/fixed.ts:17](/Users/mansitibrewal/chronicles/otter/solver/src/fixed.ts:17).

Submission accepts an arbitrary `uint256` ask. Minority eligibility evaluates `ask * reserve` using Solmate's multiplication, which reverts if the 256-bit product overflows. A one-raw-unit escrow order with maximum ask can therefore make an otherwise valid batch revert during classification. It should simply be recognized as ineligible. The TypeScript BigInt mirror instead evaluates the product and returns false, so it is not an exact EVM arithmetic mirror over the advertised input domain.

**Reproduction:** `test_review_ExtremeAskPoisonsClassification`. The proposed economically sensible side fails; flipping the example's side cannot pay the honest order's required minority fill from the attacker's one-unit budget. Refund remains possible after the timeout if recovery itself works.

**Fix:** define and enforce supported price/amount domains at admission. Implement overflow-safe comparisons for eligibility; use full-precision arithmetic where the mathematical quotient is representable. Simply replacing every operation with FullMath still needs handling when the quotient itself is unrepresentable. Add range and overflow semantics to the BigInt oracle. The comment in `OtterMath` saying mulDiv carries a 512-bit intermediate is incorrect for the imported Solmate library.

### R6 — Medium correctness, potentially high operational impact: the integer mechanism is not fully specified

**Evidence:** [solveExact:199](/Users/mansitibrewal/chronicles/otter/solver/src/exact.ts:199), [minority pricing:324](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:324), [allowance:108](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterMath.sol:108).

Three counterexamples matter:

- With both reserves `10^21`, one order of budget `10` raw units and ask `0.9 * WAD` gets fill `10`, payment `6`. Its required minimum is `9`; `selfCheck` returns `ERR_IR`. The lower bound exceeds the upper bound, and the clamp returns a value anyway. Solidity correctly rejects this dominant-side payment. The issue is solver liveness/correctness, not successful on-chain dominant-side underpayment.
- At a pool price of four currency1 units per currency0, a minority seller offers one raw currency1 unit with ask `0.25 * WAD`. The contract accepts spending that unit and receiving zero currency0. There is no minority-side integer IR check. `test_review_MinorityCanReceiveZeroBelowItsAsk` reproduces this. The shortfall is sub-unit before rounding, but it contradicts an absolute IR claim and matters for dust/low-decimal assets.
- Equal asks preserve input order in `sort`. For reserves 1,000/1,000 and two asks of `0.25 * WAD`, each budget 1,000, reversing the input changes which trader gets the 1,000-unit fill. Both outcomes pass the verifier. This disproves literal per-order outcome independence; it does not by itself prove profitable manipulation under the paper's utility model, because the tied traders have zero marginal surplus in this example.

The allowance depends on total filled input, which depends on reports. It is not automatically incentive-neutral because its formula is fixed. Continuous real-number results do not establish exact truthfulness for floored allocations, rounded welfare, and clamped payments.

**Fix:** specify a discrete mechanism, valid token scales, dust policy, tie rule, payment rounding, and invalid-input behavior. Handle an empty feasible-payment interval explicitly with a mechanism-consistent allocation rule; never silently drop a committed order. Test both sides' IR. Use independent rational/integer optimization on small exhaustive domains, then differential settlement against v4 across unequal decimals, extreme prices, thin liquidity, zero budgets, near-equality, and signed/cast bounds. Quantify any epsilon-incentive guarantee instead of claiming exact DSIC without proof. Deterministic ID tie-breaking fixes arrival dependence but also needs a sybil/grinding analysis.

### R7 — High incentive risk: surplus can be captured by an LP that supplied no liquidity during the trade

**Evidence:** [pendingSurplus comments:99](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:99), [flushSurplus:435](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:435).

Rewards go to whoever has liquidity at donation time. After a batch settles, a new LP can add a large position, call `flushSurplus`, collect its share, and withdraw. The active-batch freeze no longer applies. `flushSurplus` also allows payout immediately after settlement in the same transaction; a one-batch delay is not an enforced property of every payout path.

**Reproduction:** `test_review_JitLPCollectsPreviousTradersSurplus` uses a separate position salt and contributes nine times the pre-existing liquidity after settlement. It collects 90% of the pending pot and withdraws. This does not rely on stealing the original router position from R1. It demonstrates gross reward capture; net profitability depends on capital/flash-liquidity availability and gas.

**Fix:** account for rewards to eligible historical liquidity through an authenticated vault/checkpoint design, including claims after LP exit. Define eligibility before the rewarded trading interval and prevent newly added liquidity receiving past surplus. Time-weighting or vesting needs explicit economics, not just a delay. Alternatively use a specified community destination with no per-batch trader/builder control, then separately solve LP compensation. Reassess bidder-as-LP and repeated-batch incentives; the current comment considering only a bidder voluntarily reducing its own payout does not cover adversarial allocation against other traders or reward capture.

### R8 — Medium: the deadline is an admission deadline, not an execution deadline

**Evidence:** [OtterOrderBook.sol:289](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterOrderBook.sol:289), [consume:361](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterOrderBook.sol:361), [web signing:97](/Users/mansitibrewal/chronicles/otter/web/src/hooks/useSubmitOrder.ts:97).

The deadline is checked at submit and never at settlement. Becoming refundable does not prevent later settlement; the two calls race. `test_review_ExpiredOrderCanStillSettle` admits orders with one second remaining and settles them a day later. Their signed price bounds still apply, but a trader has exposure long after a conventional execution deadline would expire.

**Fix:** explicitly separate submission cutoff from execution validity, bind orders to a batch/epoch and maximum execution time, and expose expiry/refund status to users. Define expiry before committing to whole-batch inclusion. Adding a per-order settlement revert without changing recovery would introduce another batch veto. Provide nonce invalidation for unused signatures and a usable refund/claim UI.

### R9 — Medium, configuration dependent: zero LP fee does not establish a zero-fee execution curve

**Evidence:** [registerPool:200](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:200), [_curveFor:278](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:278), [unlockCallback:470](/Users/mansitibrewal/chronicles/otter/contracts/src/OtterSettlement.sol:470).

Registration checks `key.fee == 0`, but `_curveFor` ignores the separate protocol fee returned in slot0. A fee controller can change actual swap output without changing price or liquidity. `test_review_ProtocolFeeBreaksModelOutcome` enables a 0.1% protocol fee on the local manager and demonstrates that the previously modeled outcome reverts with `PoolOutputShortfall`. This is a configuration counterexample, not a claim that the deployed pool currently charges that fee.

**Fix:** include all execution fees in the model or explicitly reject/fail safely on an unsupported configuration with independent refunds. Specify how fee changes during a batch are handled. Account using returned BalanceDelta values; the current callback assumes all requested input was consumed, which also needs boundary tests near finite full-range endpoints and price limits. Inspecting returned deltas is necessary even with full-range liquidity: its usable tick range is finite.

## Other hardening and operational gaps

- **Liquidity exit griefing:** a tiny accepted order freezes all amount changes. Once resolved, another order can start the next freeze; an attacker or ordinary continuous demand may starve exits. Add withdrawal requests serviced at bounded epoch boundaries independently of an adversary's next submission. A timeout tied to successful whole-batch refund does not provide that bound.
- **Token callbacks and settlement state:** `consume` marks settled before token transfers finish, and the settlement contract has no general reentrancy guard. The order book has a guard, but this is not a proof of cross-contract/cross-pool safety. Keep the pool economically locked until settlement completes, restrict supported assets, and run stateful callback-token tests. No additional reentrancy theft is claimed as confirmed here.
- **Order-data recovery:** events contain hashes, not full orders. Calldata is available on chain, but an operational indexer must recover relayed/internal-call submissions, handle reorgs, and reconstruct the exact sequence. An independent claimant should not depend on one operator retaining the whole batch. Design data availability alongside new claim proofs.
- **Wallet flow:** `useSubmitOrder` sets APPROVED and DONE when it receives a transaction hash, without waiting for receipt success. Its `batchId` is never populated. It reads only nonce word zero and returns 256 once that word is full, without checking word one. Add receipt-based state, nonce refresh across words, chain/account-change handling, decoded submission events, and recovery UI. EIP-1271 support is also needed before positioning this for smart-account treasuries.
- **Production setup:** validate the manager, hook flags and immutable links in deployment; pin dependencies and compiler; produce a bytecode/parameter manifest. Design explicit pause-admission and exit behavior before adding admin controls. Multisigs protect keys; they do not prove the mechanism.

## Paper fidelity and trader economics

The [paper](https://arxiv.org/html/2609.03474v1) assumes censorship resilience and uncongested block space. The batch digest establishes completeness only for already admitted orders. It cannot force transaction inclusion before a deadline, prevent admission censorship, or remove scarce-capacity effects. Public escrow submission is not a sealed-bid protocol.

The paper's welfare objective includes the redistributed surplus. More community surplus therefore does not imply every current trader receives the best available execution price. The LP redistribution policy is part of the mechanism's economic design, not a harmless output destination that inherits all proofs automatically.

The grant should distinguish:

| Layer | What is implemented | What remains unestablished |
|---|---|---|
| Custody | Signed orders, escrow, nonce bitmap, full-batch commitment | Independent recovery, supported-token solvency, production LP ownership |
| Settlement checks | Budgets, dominant-side payment bounds, majority of feasibility conditions | Canonical allocation/payments, all integer IR cases |
| Consensus/admission | Transactions accepted into time windows | Guaranteed inclusion before the batch boundary, spam-resistant finite capacity |
| Incentives | Floating-point sampled tests; BigInt solver | Exact discrete DSIC, strategic LPs, repeated batches, operational funding |
| Trading product | Fixture demo, Sepolia order submission | Reliable live solving, competitive all-in execution, routing distribution |

For fast opportunity-driven trading, the present design is a difficult fit: a window lasts up to 60 seconds, there is a 300-second exclusive-solver period after closing, and timeout refunds become available 900 seconds after close. An active honest solver may settle promptly after closing; users are not forced to wait the full exclusivity window. But a production service must measure the distribution of those delays and the cost of failed fills and locked capital.

Compare against a clean vanilla v4 execution, v4 with realistic slippage and fees, private submission where available, CoW-style intent execution, and Angstrom. [CoW's documentation](https://docs.cow.fi/cow-protocol) describes solver access to broad liquidity sources; [Angstrom's source documentation](https://github.com/SorellaLabs/angstrom/blob/main/contracts/docs/overview.md) describes batch trading, LP rewards, and explicit economic assumptions. A new venue must beat a useful alternative for an identified user, not just stop a deliberately exposed sequential sandwich.

Run two distinct experiments: (1) equal starting reserves/liquidity to isolate mechanism effects; (2) equal capital/TVL to test market competitiveness against concentrated liquidity. Measure same decision-time and execution-time benchmarks. Report output net of all fees, fill rate, partial-fill rate, p50/p95 latency, refund frequency, stale-price markouts, solver costs, and LP P&L against holding and matched-risk LP baselines. Do not hide adverse selection in a favorable definition of trader savings.

The current gas headline omits admission. In the saved 200-order row, settlement total is 8,184,591 gas, about 40,923 per order. Adding the saved submission execution cost of 7,416,225 brings the measured sum to about **78,004 gas per order**, before submission calldata/intrinsic cost and approvals. This is a recombination of existing benchmark outputs, not a fresh real-transaction measurement. Rebenchmark separate cold transactions, multiple fill/refund shapes, and target-chain transaction limits. The saved 630-order result is a probe under a hardcoded 30M budget, not a universal chain limit or a proven maximum.

With zero LP fees, a one-trader batch can leave essentially only rounding surplus under the ideal payment rule. There is no demonstrated durable LP revenue in that flow pattern. LPs still bear inventory risk. Donation does not increase `L`; reinvestment would be a separate, measurable action. Prove retention and LP economics under realistic competing flow before requesting liquidity incentives.

## A fundable repair plan

These are proposed acceptance gates, not Foundation requirements or promised delivery dates. A roughly 8–12 week planning envelope is reasonable only after estimating staffing and proof work; cryptographic verification may need a separate phase.

| Milestone | Deliverable | Acceptance evidence |
|---|---|---|
| 1. Precise mechanism and trust model | Versioned discrete specification; supported tokens/ranges; expiry and tie rules; solver/LP/builder threat model | Each claimed guarantee mapped to code, proof, or an explicit limitation; paper-author or independent mechanism review requested |
| 2. Safe bounded prototype | Production LP ownership; bounded intake; individual recovery; overflow-safe math; both-side IR; canonical settlement validation | All confirmed reproductions converted to security regression tests; stateful accounting and adversarial suites pass; independent recovery demonstrated at resource limits |
| 3. Operational testnet and evaluation | Live solver/indexer, independent recovery operator, receipt-aware UI, reproducible comparative benchmark | Proposed target: 14-day soak including forced solver outages, a published set of at least 1,000 varied batches, and complete latency/gas/fill/refund reporting; count scripted activity separately from adoption |
| 4. Independent review and integration | External Solidity review plus mechanism/economic review; one real integration prototype; public final report | Every high-severity issue closed or explicitly excluded from pilot scope; distribution partner evidence; mainnet go/no-go tied to measured user and LP results |

Fund the output of the validation even if the answer is that a proposed market is not viable. A high-quality negative result, safe reference implementation, and adversarial dataset can still be valuable public goods. Do not make mainnet TVL the first milestone while basic safety is unsettled.

Budget engineering weeks × actual rate, independent mechanism review, audit quotations, infrastructure/data costs, and a defined contingency. Separate requested cash from team contribution and anticipated security subsidies; do not double-count them. The repository does not establish the team's available time, historical delivery record, or partner commitments, so those must come from the applicant rather than being invented for the proposal.

The [official funding page](https://developers.uniswap.org/docs/ecosystem/builder-support/get-funded) lists general Foundation grants and security-audit subsidies, including possible full audit-cost coverage for recipients. Use its current application route rather than broken historical toolkit links. The [Foundation FAQ](https://www.uniswapfoundation.org/faqs) describes milestone-linked payments. Verify current intake and program fit when submitting; a linked form is not proof that a particular cohort is open. The [November 2025 UNIfication post](https://www.uniswapfoundation.org/blog/unification) describes an organizational transition proposal, so do not assume an old pilot's administration is unchanged.

Suggested application framing:

> Otter is an experimental implementation of Shi, Zhang, Chung, and Li's surplus-redistribution batch mechanism on Uniswap v4. We seek milestone-based support to specify and validate a discrete implementation, enforce settlement correctness, deliver bounded custody recovery, and evaluate trader execution and LP economics against existing alternatives. The current prototype establishes the integration path but does not yet establish production security or the paper's full incentive guarantees. All specifications, test vectors, adversarial reproductions, and evaluation results will be public.

Rewrite the website accordingly: identify the demonstration as a recorded fixture; qualify “provably” with the actual assumptions and verification scope; replace “sealed” for publicly visible submissions; publish all-in costs and latency. Describe solver speedups separately for the floating-point reference and the BigInt settlement path. The exact solver currently uses naive leave-one-out welfare recomputation; the faster float benchmark is not a benchmark of production execution.

The practical funding question is whether a specified group of traders and LPs benefits enough from this mechanism to tolerate its latency, cost, and constraints. Secure the assets, enforce the intended rule, and publish that evidence. That is the case worth putting in front of a grant reviewer.
