# Checkpoint 7B — owner LP exits and independent vault-credit withdrawals

Prepared 5 October 2026. Starting commit:
`2404cce1ee766aa62d695b02acd8907615991874`. The working tree was clean.
Status: **committed by the user as `d76b12c`; clean tree verified before 7C**.

## Outcome

The contracts already support owner-reserved exits and independently delivered
LP principal/core-fee credits. The wallet lacked the interface for those actions
and exposed only trader and Otter reward claims. This checkpoint connects the
local wallet to the existing vault policy without changing production Solidity,
the auction/redistribution rule, any fixture, dependency or deployment.

The new [liquidity panel](../web/src/components/LiquidityExitPanel.tsx) accepts
a manual vault position ID from a deposit receipt. Position owner, pool ID,
liquidity, reservation and actual pool activity are read at the deployment-check
block. The wallet accepts only its connected owner's position in the configured
pool. Account/network/ID changes invalidate displayed data and outstanding reads.
Actions always refresh the record rather than relying on the displayed snapshot.

Queueing is available during an active batch. The existing request is irrevocable
and has no caller-set token-output minimum; removal uses the processing-time pool
state. The panel explains that decision, requires an acknowledgement, displays
exact liquidity units, and resets acknowledgement if the amount changes. It
offers a full-position amount without converting through floating point.
Requests require positive uint128 liquidity within the current owned balance and
no existing reservation. A successful confirmed receipt must contain exactly one
matching vault `ExitRequested` event for owner/pool/ID/liquidity.

Processing requires a reservation and an idle book state. A passed deadline
alone does not establish idleness; a timed-out epoch must be expired. The current
batch can settle despite the reservation, while new admission waits for exits.
Processing invokes no beneficiary transfer and creates owner credits. Its
confirmation must contain exactly one matching `ExitProcessed` event, and the
panel reports the actual credited amounts. The contract remains permissionless;
the interface deliberately selects only the connected owner's position.

Recovery now distinguishes three sources in each asset: trader credit, Otter
reward, and liquidity exit/core-fee credit. Vault balances aggregate per owner
and currency across positions/pools; they are not a per-position payment estimate.
Withdrawals go to the vault's `claim` function rather than the reward ledger or
book. Native claims attach no ETH and require no approval. Partial withdrawals
are limited to uint120 max per call so large core fee balances remain usable in
chunks. The UI also refuses vault-credit recipients equal to any of the four
configured custody addresses, a conservative restriction beyond the vault's
nonzero-recipient check. No recipient or amount is chosen during processing.

The shared deployment gate additionally verifies the vault's immutable book
wiring. ABI entries come directly from existing compiled artifacts and are
compared in the offline tests. Writes share the existing per-tab serialization,
session checks, simulation, confirmed-success receipt and actual transaction
sender/target/calldata/value verification. Failed or unmatched confirmation is
not reported as a successful request/credit. Inspect a broadcast transaction
before retrying; this checkpoint adds no automatic retries or cancellation.

**The deployment manifest is still null.** Production wallet controls remain
absent. No wallet was connected, no RPC transaction was sent, no public instance
was deployed, and no reviewer contact, upload or grant application occurred.
The isolated interface preview uses synthetic state and a mock action hook that
does not execute transaction callbacks. It is visual evidence, not a live demo.

## Validation and provenance

- `web/: npm test`: **30 tests passed**, zero failures/skips. Nine new groups cover
  pinned position reads, wrong owner/pool/immutable book, missing records/read
  failure, active/paused reservation, exact large IDs/liquidity, invalid and
  stale/duplicate reservations, real activity versus a passed deadline, matching
  request/processing events, pending receipt behavior, simulation/revert/session
  failures, native/ERC20 vault routing, uint120 chunks, recipient policy and
  isolated delivery errors. Event failure matrices include missing, wrong kind,
  owner, pool, ID, liquidity, emitter and duplicate events for both actions.
  Existing signing/recovery/transaction replacement tests remain passing.
  These tests use mocked transport/wallet responses, not a real connector.
- The selected book/settlement/ledger/vault ABI entries match local Foundry
  artifacts byte-for-byte. Monetary quantities remain BigInts; the new interface
  uses whole-string parsing for liquidity and exact asset-unit parsing for claims.
- `contracts/: forge test --offline --match-contract
  '^(OtterExitsTest|OtterLiquidityVaultTest)$'`: **28 existing contract tests passed**,
  zero failures/skips, with 512 cases in each of the two fuzz tests. They exercise
  actual book/vault/hook/core ownership, expiry/settlement exit priority,
  native/standard/optional-return tokens, callback isolation, concentrated and
  inactive one-sided position removal, blocked recipients, retained IDs,
  full-budget refund backing and large fee credits delivered in chunks. These
  separate contract tests support the existing policy; they are not an integrated
  browser-to-real-wallet-to-chain test. No Solidity/test code changed.
- `npm run build -- --outDir /tmp/otter-7b-web-dist`: TypeScript/production build
  passed. The existing wallet bundle warning remains (about 938 kB main chunk);
  no package was installed/upgraded and tracked `web/dist/` is unchanged.
- Browser checks at the default narrow viewport: actual JSX in an isolated
  read-only fixture shows exact liquidity, disclosure and acknowledgement gating;
  changing the amount clears acknowledgement; reserved positions cannot queue
  again; processing is disabled for an active pool and enabled in the idle fixture.
  Separate vault and reward balances and the chunk cap render correctly. All
  accounts/balances/chain state are explicitly synthetic, and no real wallet
  action is available in that preview. The actual production bundle, served under
  a temporary local asset path, shows the default disabled notice and no order,
  LP exit or recovery transaction controls. No runtime errors were observed on
  the final built preview/production pages. An initial temporary Vite preview
  failed on macOS `/tmp` path resolution; serving its built files resolved that
  harness issue without changing project configuration. The tab and local servers
  were closed after inspection.
- [The 7B selected snapshot](./EVIDENCE_MANIFEST_7B.json) verifies **270 files**:
  the prior 217 plus 53 wallet source/config/style/test/build/lockfile entries.
  It records the pre-checkpoint baseline and explicitly labeled local bytes;
  hashes are not deployment, proof or audit certification. No prior selected
  file changed, so the frozen 4J manifest still verifies its 217 bytes on this
  checkout. It selected only the dashboard from `web/`; its successful check
  therefore does not cover this wallet change. Earlier manifests remain immutable.
  Installed packages, generated builds and temporary mock-preview files are
  excluded. The new selection covers the browser source import paths, not the
  content of third-party installed JavaScript packages or remote font responses.
- Whitespace, local Markdown targets, the exact handoff list, unchanged HEAD/empty
  index and preservation of contracts, solver/research, fixtures, manifests,
  published deployments, benchmarks, dependency pins and the null wallet config
  are checked before handoff. No broad contract, solver or economic benchmark run
  is claimed as fresh; the affected wallet and supporting custody suites suffice.

Run from `web/`:

```sh
npm test
npm run build -- --outDir /tmp/otter-7b-web-dist
```

Run from `contracts/`, one Forge job at a time:

```sh
forge test --offline --match-contract '^(OtterExitsTest|OtterLiquidityVaultTest)$'
```

Content check from the repository root:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_7B.json
```

Logs: `/tmp/otter-7b-wallet.log`, `/tmp/otter-7b-contract.log`,
`/tmp/otter-7b-build.log`, `/tmp/otter-7b-preview-build.log`,
`/tmp/otter-7b-handoff.log`. Read-only visual artifacts:
`/tmp/otter-7b-fixture.jpg`, `/tmp/otter-7b-exit-fixture.jpg`,
`/tmp/otter-7b-wallet-disabled.jpg`; temporary mock sources/builds remain under
`/tmp/otter-7b-preview*`. Existing Node 24.10.0, Forge 1.5.1,
solc 0.8.26/Cancun/via-IR/optimizer 200 and 512 fuzz runs; no dependency changes.

## Material limits and next work

One confirmation is not reorg-proof finality. Persistent transaction recovery
across reloads, wallet/chain history and robust indexing are unfinished. Real
contract-wallet/EIP-1271 connector flows are not demonstrated. The interface
needs a saved position ID and configured pool; it supplies no deposits, position
discovery, cross-pool navigation, automatic exit processing or guaranteed timing.
The request's existing no-minimum policy retains price exposure before processing.
Funded credits are withdrawable independently of position ownership reads.

This is a bounded local LP recovery interface, not step 7 completion or grant
qualification. G1–G4, canonical payments, useful integer fills, combined trader/LP
incentives and concentrated auction execution remain open. Native/concentrated
custody exit support does not prove concentrated trading correctness. No weaker
mechanism, fractional asset, new utility/grid/subsidy or reward destination has
been selected. Continue the complete guarantee-preserving mechanism work and
remaining wallet acceptance evidence after the user-created commit.

## User-created commit handoff

Suggested title:

```text
feat: add owner LP exit and vault claim flows
```

Suggested explanation:

> Add checked position reads, explicit irrevocable exit requests, idle processing
> and separate native/ERC20 vault-credit withdrawals. Validate confirmation events
> and failure paths; keep the wallet disabled until a reviewed deployment exists.

The assistant has not staged or committed anything. Commit these **16 files**
and confirm before work continues:

```text
README.md
reviews/CHECKPOINT_4J.md
reviews/CHECKPOINT_7B.md
reviews/EVIDENCE_MANIFEST_7B.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/src/components/LiquidityExitPanel.tsx
web/src/components/OrderComposer.module.css
web/src/components/RecoveryPanel.tsx
web/src/components/SepoliaStatus.tsx
web/src/hooks/useWalletActions.ts
web/src/protocol/abi.ts
web/src/protocol/client.ts
web/test/protocol.test.ts
```
