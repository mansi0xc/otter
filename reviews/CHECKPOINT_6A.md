# Checkpoint 6A — funded historical LP rewards

Prepared 5 October 2026. Starting revision: user-created commit `ed69b3e`.
Status: implemented and validated locally, pending the user-created commit.
The starting tree was clean. The user creates every commit.

## What changed

Otter's residual batch assets no longer wait in settlement for a donation to
whoever supplies liquidity later. A new cash-backed `OtterRewardLedger` credits
the **recorded opening owners** during the successful settlement. A later LP
receives none of that epoch's reward, while an opening owner retains its claim
after removing liquidity or processing a queued exit. Claim delivery is separate
from economic completion and calls no recipient during settlement.

This prevents the reviewed R7 post-settlement historical capture in the admitted
full-range path. It does not fix R2's arbitrary feasible trader payments, R6's
minority IR, or establish the paper's integer/trader/builder/LP guarantees.
Those remain separate mechanism gates. Concentrated positions remain supported
for custody; concentrated auction/reward integration is still gated.

## Opening capital weights

`OtterRewardMath` computes the selected policy using actual rounded-down
removable principal, excluding ordinary fees and rewards. At opening price `P`
and position endpoints `A < B`, principal uses the appropriate active or
inactive portion of the range:

```text
principal0 = floor(L * Q96 * (B-max(P,A)) / (B*max(P,A))) if P<B, else 0
principal1 = floor(L * (min(P,B)-A) / Q96)                if P>A, else 0
weight     = principal1 + floor(principal0 * P^2 / 2^192)
```

Solidity uses the pinned core's amount math and full-precision `mulDiv` for the
wide spot-value product. It requires the selected opening price domain
`[2^64,2^128)`, which also makes `P^2` representable. The independent BigInt
reference evaluates direct rational expressions without prematurely rounding
spot or using floating point for monetary quantities.

The order book freezes each weight beside its authenticated position roster,
plus the total weight. A zero-weight position keeps its principal ownership but
receives no residual reward. A zero **total** rejects the first admission before
escrow, rolling back its clock, snapshot and nonce. For example, one liquidity
unit at raw spot 1 can have nonzero virtual reserves but removable principal
rounding to zero; raw liquidity alone would incorrectly give it weight.

Queued exits do not remove principal until processed, so their opening liquidity
remains eligible. Existing accrued fees and direct external donations do not
increase these weights. Different widths and inactive ranges are covered by the
math/reference tests; the current authenticated auction roster still admits
only full-range positions. These arithmetic checks do not enable concentrated
auctions or prove that the policy compensates LP risk fairly.

## Configuration and commitment

Settlement deploys its own immutable `rewardLedger`; the ledger accepts
registration and funding only from that settlement address. Each pool's
`OtterCapitalRewards/v1` policy hash commits to chain, ledger and fixed community
rounding-dust recipient. The order book records this policy at registration.

Both settlement registration overloads are now **owner-only**. The one-argument
form fixes the deployment owner as dust recipient. The owner may instead name
a treasury on first registration with `registerPool(key, communityRecipient)`.
It cannot be changed afterwards. Restricting both overloads prevents another
caller from front-running a planned treasury selection by registering the
default first. Zero, ledger, settlement and order-book recipients are rejected.
No new owner power to spend claims or sweep backing is introduced.

The local deployment script accepts `REWARD_COMMUNITY`, defaulting to the
deployer. This selects the small rounding remainder, not the entire LP pot.
No deployment script, RPC, broadcast or live transaction was run.

The opening snapshot domain becomes `OtterOpeningSnapshot/v2`. In addition to
4C's pool, roster, clocks, guard and deployment fields, it binds the reward
policy hash, total opening weight and hash of the complete ordered weight
vector. The existing **v2 order fields and EIP-712 domain version are unchanged**;
the opening snapshot is not a newly added signed order field. New deployment
addresses still have their own verifying-contract domain.

## Funding, dust and independent claims

Settlement first verifies its existing feasible outcome, executes the residual
swap, measures actual output, and funds trader claims. It then transfers the
actual remaining pot to the ledger before completing the order-book epoch.
The legacy path creates surplus in one currency; the ledger explicitly supports
both currency pots. Even a zero-pot successful epoch is recorded exactly once.
Expired/refunded epochs receive no reward.

`creditEpoch` requires the current epoch to be executing and trader payouts to
have been credited. It reads the stored opening roster/weights, rather than live
LP state. For each recorded position and each currency it assigns

```text
positionReward = floor(epochPot * openingWeight / totalOpeningWeight).
```

Multiple positions owned by the same address aggregate into that owner's claim.
It records the exact remaining `epochDust` and credits that remainder to the
predeclared community recipient. Thus LP entitlements plus dust exhaust each
pot without assigning the residue to a solver or new LP. With at most 32 records,
the rounding remainder is less than the number of positive-weight records per
currency. The policy rounds per position; splitting or merging principal is an
economic policy question, not a claimed incentive theorem.

ERC20 pulls check exact changes in both settlement and ledger balances. Native
value must match exactly. Existing shared-currency reward liabilities are
reserved **before** accepting a new pot, including excluding incoming native
value from the old-backing check. Final cash must back all owner/community
claims across every pool sharing that currency. Unsolicited funds create no
claim, and there is no administrative withdrawal/sweep function.

Owners withdraw through `rewardLedger.claim(currency, amount, recipient)`.
Effects precede delivery, and a reentrancy guard covers funding and claims.
Optional-return ERC20s are supported; false returns and sender/recipient taxes
reject atomically. A rejected recipient or taxed claim rolls back only that
withdrawal, preserving other owners' backing. This assumes the same stable,
exact token semantics as the other custody paths; rebasing assets are not added.

Failed reward **funding** rolls back the entire settlement, including the swap,
trader claims and terminal flags. Timeout expiry and stored-order refunds still
work independently. Successful accounting makes no LP/community recipient call
and does not delay queued exits until someone claims.

## ABI and migration

- Removed `pendingSurplus`, `totalPendingSurplus`, `flushSurplus` and
  `SurplusDonated`. Settlement no longer donates Otter residuals into fee growth.
- Added settlement's `rewardLedger` getter and treasury registration overload;
  registration now requires the owner. Book-only registration gains a nonzero
  reward-policy hash argument.
- Added book opening-weight getters and the v2 snapshot commitment. The ledger
  exposes immutable per-epoch `epochSurplus`/`epochDust`, current aggregate claims,
  policy data and allocation/credit/claim events.
- Trader claims remain in the order book. Principal and ordinary fee claims
  remain in the vault. Reward claims are separate cash in the reward ledger.
  Retained epoch amounts are historical records, not an undonated balance.

This is a new local stack, not an in-place migration of deployed pending pots.
The earlier wallet and published Sepolia addresses are unchanged and require
explicit ABI/address/flow migration before they can operate these paths.

## Validation and resource evidence

- **298 contract tests in 32 suites** pass through
  `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'`.
  New tests cover real opening ownership/weights/dust, multiple positions per
  owner, new LP exclusion, reward survival after exits, queued-exit priority,
  expiry without rewards, zero-weight opening rejection and policy authority.
- Ledger tests cover both currency pots, shared-token pools, exact cash/dust,
  optional/false-return/taxed tokens, existing insolvency, unauthorized/repeated
  funding, corrupt weight totals, unsolicited funds and token/native reentrancy.
  Recipient rejection affects only its claim. A real-manager integration test
  taxes only the later reward pull and proves complete swap/epoch rollback and
  independent native timeout recovery.
- The R7 grant-review reproduction now asserts prevention. The R2 reproduction
  still demonstrates underpayment and opening-LP reward capture; changing
  reward delivery does not make that finding safe. R6 remains a reproduction.
- **108 Node groups** pass via `cd solver && npm test`. Four new reference
  groups include 4,096 seeded exact reward divisions and wide products. Another
  **512 Solidity/BigInt FFI comparisons** check capital values across full,
  narrow and inactive ranges. Existing execution fuzz/references remain included.
- The bounded-wallet unit call allowance is adjusted from 400k/500k to 800k to
  include new opening-weight storage. The production **100k per-wallet signature
  validation cap is unchanged**; gas-grief/large-return tests still pass.
- The 32-LP/32-costly-wallet opening fixture uses **11,286,357 execution gas**
  plus **383,908 intrinsic/calldata gas**, totaling **11,670,265**. Cold individual
  order recovery with retained records uses **67,445** in that fixture. A
  32-opening-owner, one-order settlement call uses **1,760,691** execution gas.
  These are declared local measurements, not full canonical-auction resource
  bounds. They omit unimplemented counterfactual verification and do not close G3.
- Compiled runtime/initcode sizes in bytes are: order book **20,627/21,159**,
  settlement **12,122/18,944**, reward ledger **5,835/6,078**, vault
  **14,870/15,219**, and hook **3,231/18,928**. The local integrated tests deploy
  the stack successfully; these measurements are not a live deployment.
- Offline build, changed Solidity formatting, whitespace, artifact-preservation
  and handoff checks pass. Artifact-writing gas/sandwich suites compile but are
  not rerun. Prior economic/vector/research artifacts and dependencies are unchanged.

## Remaining scope

R7's reviewed post-settlement capture is prevented locally for admitted pools.
Step 6 is not fully complete: concentrated ownership/tick integration and its
economics remain pending. The general range-capital formula is implemented but
not an authenticated concentrated-auction reward pipeline.

Opening-time LP entry, position splitting, trader/builder-as-LP overlap and the
community recipient's incentives require explicit analysis. Earlier LP entry
before the snapshot remains eligible. The ledger does not assert independence
of a trader's reward from its reports, prove the paper's full guarantees, or
resolve legacy solver discretion. No weaker auction/payment rule is selected.

Next evaluate the capital-rounding and LP-overlap policy independently before
claiming stronger LP or builder guarantees. Retain G1–G3 and independent mechanism
review before canonical settlement or concentrated admission. Wallet/testnet
flows, measured full verification, economic comparisons, audits and the grant
package remain required. There has been no live deployment or external audit.

## User-created commit handoff

Include exactly these files:

```text
README.md
contracts/script/Deploy.s.sol
contracts/src/OtterOrderBook.sol
contracts/src/OtterRewardLedger.sol
contracts/src/OtterRewardMath.sol
contracts/src/OtterSettlement.sol
contracts/test/GrantReview.t.sol
contracts/test/OtterAssets.t.sol
contracts/test/OtterEpochs.t.sol
contracts/test/OtterExecutionOracle.t.sol
contracts/test/OtterHistoricalRewards.t.sol
contracts/test/OtterMargin.t.sol
contracts/test/OtterNativeSettlement.t.sol
contracts/test/OtterOrderBook.t.sol
contracts/test/OtterOrderBookView.t.sol
contracts/test/OtterRewardLedger.t.sol
contracts/test/OtterRewardMath.t.sol
contracts/test/OtterSettlement.t.sol
contracts/test/OtterSettlementSellX.t.sol
contracts/test/OtterSnapshots.t.sol
contracts/test/OtterSurplusToLPs.t.sol
contracts/test/SandwichHarness.t.sol
contracts/test/SolverEndToEnd.t.sol
contracts/test/utils/MockLiquidityGuard.sol
reviews/CHECKPOINT_4H.md
reviews/CHECKPOINT_6A.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/src/rewards-cli.ts
solver/src/rewards.ts
solver/test/rewards.ts
```

Suggested title:

```text
fix: credit surplus to opening LP owners
```

Suggested explanation:

> Replace delayed donations with cash-backed historical reward claims. Freeze opening capital weights, assign exact rounding dust to a fixed recipient, and preserve rewards after exits. Validate later-LP exclusion, funding rollback and shared-currency claim safety.

Create the commit and confirm completion before the next implementation slice.
