# Checkpoint 2B: trader assets and isolated withdrawals

Prepared 2 October 2026. Starting revision: user-created commit `bc79d64`.
Status: implemented locally, pending the user's commit. No transactions have
been broadcast and no existing deployment has been changed.

## Achieved

Native ETH is now accepted as v4 currency0, with an explicit registration flag,
sorted distinct currencies, and code checks for ERC20 currencies. `submit` is
payable: value must exactly equal the native budgets in that call. Relayers may
fund native orders, but credits belong to the signed trader. Forced ETH and
unsolicited token balances grant no ownership. Zero traders cannot match a
failed ECDSA recovery.

ERC20 deposits support true or absent return data. Custody checks both actual
sender debit and receiver credit, rejecting transfer taxes, sender surcharges,
and false returns atomically. These checks cover order-book deposits, released
input, funded output claims, trader withdrawals, LP deposits/claims, and
settlement's PoolManager payments/takes. They detect inexact transfers at the
operation being performed; they cannot certify that an arbitrary token will
remain supported forever. Rebasing or malicious balance accounting is excluded.

Batch processing no longer invokes trader receivers. Full timeout refunds,
unfilled input, and both sides' outputs credit a withdrawable ledger. Owners
choose a recipient and may withdraw partially by currency. A failing claim
restores its accounting and leaves another user's claims and the owner's other
currency available. No relayer, solver, or outsider can redirect a trader claim.

Shared-currency liabilities are tracked across pools. The order book checks
`balance >= totalEscrow + totalClaimable`; settlement tracks and checks global
pending surplus backing. Moving full budgets from escrow into filled transfers
and refund claims counts each asset once. Input release and output funding are
one-shot operations tied to the currently executing committed batch, with full
replay and budget checks. Economic LP custody remains frozen until funded output
accounting completes; callback guards prevent reentry.

Native PoolManager debts explicitly sync the native currency and call
`settle{value: amount}()`. Swap input/output delta signs and consumed input are
checked. An incomplete input consumption reverts the entire settlement, keeps
the batch and full escrow outstanding, and permits full timeout refunds. This
is an explicit rejection policy while the later mechanism defines supported
partial execution; it is not partial-fill support. Unlock callbacks require the
authorized manager and matching in-flight data.

Registration and execution require zero LP and protocol swap fees, with a
second read immediately before the swap after escrow-token callbacks. A subsequent
protocol-fee change rejects execution without consuming escrow; full timeout
refunds remain available. The zero-fee policy is separate from implementing a
fee-aware mechanism.

The Sepolia deployment script supports `NATIVE_ETH`, `SQRT_PRICE_X96`, and
principal maxima. It computes seed debts with core amount math at the configured
price, attaches the exact native debt, and approves ERC20 principal amounts.
It checks liquidity/price domains before casts and rejects an incomplete ERC20
pair instead of silently replacing it with mocks. It was compiled; no RPC
simulation, broadcast, or live token integration was performed.

The README now describes a research prototype and the current gates instead of
advertising verified optimal/truthful trading. The historical grant critique
and original exploit evidence remain preserved.

## Public claim API and compatibility

```solidity
book.submit{value: sumOfNativeBudgets}(orders, signatures);
book.claimable(trader, currencyAddress); // native currency = address(0)
book.claim(currencyAddress, amount, recipient); // called by the credited trader
book.totalEscrow(currencyAddress);
book.totalClaimable(currencyAddress);
```

Successful settlement creates credits rather than immediately changing trader
wallet balances. Timeout finalization similarly creates credits. The integration
tests explicitly withdraw credits before existing wallet-balance assertions.
`ClaimCredited` and `Claimed` events expose delivery status separately.

The legacy EIP-712 v1 fields and deadlines remain unchanged in this slice. The
v2 epoch and maximum-execution fields belong to step 3. Newly compiled contracts
must be deployed as a new stack; editing source cannot repair an existing one.
The current dashboard targets the published older deployment and has not been
migrated to native funding, new addresses, or claim display. Wallet/EIP-1271 and
nonce management work remains assigned to the later integration step.

## Validation

Run contract commands from `contracts/`:

```sh
forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'
forge build --offline
```

The final suite passes **161 tests across 16 suites**, with zero failures or
skips. Ten fuzz tests run at least 512 cases each. A test-helper formatting
regression that attempted zero-amount withdrawals was corrected, and the full
suite was rerun successfully. The production fee-boundary callback regression
also passes. Formatting checks pass for all 15 changed Solidity files, and
`git diff --check` reports no whitespace errors.

Runtime/initialization sizes from the compiled artifacts:

| Contract | Runtime bytes | Initialization bytes |
|---|---:|---:|
| OtterHook | 2,406 | 12,532 |
| OtterLiquidityVault | 9,341 | 9,662 |
| OtterOrderBook | 9,542 | 10,077 |
| OtterSettlement | 11,089 | 11,438 |

These four runtime artifacts fit the 24,576-byte deployed-code limit, and their
initialization artifacts fit the 49,152-byte init-code limit. This is a code-size
check, not a transaction gas benchmark. `forge build --offline` also passes,
including the deployment script and excluded benchmark sources. Existing lint
notes/warnings are not an independent security assessment.

`GasCurveTest` and `SandwichHarness` are excluded because they overwrite stored
benchmark artifacts. Their source fixtures are migrated and compiled; their
saved results have not been regenerated. Existing costs are not measurements of
this revised claim-based flow. Solver/property logic and the wallet were not
changed or separately rerun in this slice; existing contract fixture replay is
included in the Solidity suite.

Acceptance coverage includes:

- Direct native input/output, both dominant directions, opposing native/ERC20
  submissions, complete netting, and native surplus donation.
- Exact native value, relayer ownership, rejecting recipients, redirecting one's
  own claim, partial withdrawals, unauthorized/repeated claims, and forced ETH.
- Optional/false token returns, taxed receipts, extra sender fees, and a token
  changing behavior after admission or after an LP exit.
- Actual Manager debt/credit checks, unsupported fees at registration and during
  execution (including a fee-controller token callback during escrow release),
  and partial consumption at both finite full-range endpoints.
- Atomic failed-admission nonce/commitment rollback; one-shot input/output
  accounting; in-flight callback authentication; claim reentry rejection.
- Multiple pools sharing a currency, with unsettled escrow and finalized claims
  simultaneously outstanding, plus fuzzed conservation and both native directions.

R1, R4's recipient veto, and R9's zero-fee/reject-partial policy now assert
prevention. **Six original unsafe-behavior reproductions still pass because
those problems remain:** R2 payment discretion, R3 unbounded atomic recovery,
R5 extreme-ask overflow, R6 integer dust IR, R7 historical LP capture, and R8
execution after the signed admission deadline. A green suite does not close
those findings or prove the paper's incentive properties.

## Remaining work and next checkpoint

Concentrated positions are supported for custody, while concentrated batch
admission/swaps remain rejected until the exact tick-aware model and mechanism
gates pass. The legacy curve remains limited to zero-fee full-range execution
in the supported starting price interval. It can still move beyond that interval
and prevent another batch from settling; bounded quote/admission/capacity work
must address this. This checkpoint is neither mainnet-ready nor an independent
audit.

Timeout finalization still needs the complete committed array, scales with the
unbounded batch, and does not store individual order data. The 1,800-order
reproduction still fails at a 30M gas refund budget and succeeds only with an
artificial larger budget. Pull claims solve recipient rejection after
finalization, not this replay/data-availability failure. Step 3 replaces it with
bounded admission, stored recovery and constant-work expiry.

Legacy payment discretion, unsafe ask domains, dust/tie rules, deadline/epoch
binding, and captureable surplus donations remain. LP exits still need a queue
and an admission barrier against repeated-batch starvation. Token-level blocks
on Otter/PoolManager, reverting balance calls, or arbitrary rebasing can still
make that unsupported currency unavailable. They are not solved by a pull claim.

After the user commits 2B, implement step 3: bounded admission, epoch-bound
signatures and execution clocks, independent stored-order refunds, constant-work
expiry, and queued LP exits. Preserve claim isolation and shared-currency backing.
Canonical settlement and historical rewards follow their existing research gates.

## User-created commit handoff

Include these 19 files:

```text
README.md
contracts/script/Deploy.s.sol
contracts/src/OtterLiquidityVault.sol
contracts/src/OtterOrderBook.sol
contracts/src/OtterSettlement.sol
contracts/test/GrantReview.t.sol
contracts/test/OtterAssets.t.sol
contracts/test/OtterHook.t.sol
contracts/test/OtterNativeSettlement.t.sol
contracts/test/OtterOrderBook.t.sol
contracts/test/OtterOrderBookView.t.sol
contracts/test/OtterSettlement.t.sol
contracts/test/OtterSettlementSellX.t.sol
contracts/test/SandwichHarness.t.sol
contracts/test/SolverEndToEnd.t.sol
contracts/test/utils/OtterTestDeployers.sol
reviews/CHECKPOINT_2B.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
```

Suggested title: `fix: support native trader escrow and isolate asset claims`

Suggested explanation:

> Add native ETH/ERC20 escrow and independently withdrawable trader refunds and
> outputs. Check exact transfers and shared-currency backing, harden LP asset
> delivery and settlement callbacks, and reject protocol fees or partial input
> consumption while preserving timeout recovery. Update deployment and regression
> tests, and document the remaining mechanism and recovery limitations.

The assistant must not create/amend a commit or start step 3 before the user
confirms this checkpoint has been committed.
