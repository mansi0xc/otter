# Checkpoint 7C — local transaction history and read-only receipt recovery

Prepared 6 October 2026. Starting commit:
`d76b12c2ba1f1f6e74ef449f8d6bc792286840f4`. The working tree was clean.
Status: **committed by the user as `0e5b727`; the tree was clean before 4K**.

## Outcome

Refreshing the page previously lost the in-memory transaction intent and pending
hash. A wallet error could therefore leave the user without enough information
to inspect an interrupted action before sending another. The wallet now keeps a
bounded local history and supplies read-only receipt checks after reloads.

[The journal](../web/src/protocol/transactionJournal.ts) records the returned
transaction hash, wallet account, Sepolia chain, target, ETH value, wallet method,
calldata hash and local timestamp. A fingerprint includes all configured manifest
anchors, separating history across deployments/configurations. **Raw calldata and
reusable order signatures are never written to this history.** Separate storage
keys avoid unrelated records overwriting each other. Hash reuse cannot replace
an already recorded intent or erase its observed receipt alias. All fields are
validated, including bounds, exact keys and the hash in the storage key.

The shared action hook checks storage before starting a wallet flow; the adapter
checks it again before each broadcast. Corrupt, unavailable, silently discarded
or full storage prevents sending. A size-bounded storage probe tests capacity.
The 100-record history never automatically evicts old transactions. If persistence
fails after the wallet returns a hash, a dedicated error exposes that hash and
retains the new intent in this tab where possible. Filling during an open wallet
prompt preserves the existing persisted records and warns about the new unsaved
record. Nothing is automatically resent. A verified repricing discovered during
the live confirmation wait saves its observed receipt hash. Cancellation or a
different replacement still fails the action.

[The inspector](../web/src/protocol/inspectTransaction.ts) accepts only RPC read
methods. Stored records never become signing/sending requests. It restricts
decoding to existing wallet methods at the current configured contracts/assets,
checks the chain, actual sender/target/calldata hash/value and mined transaction/
receipt block metadata against the returned block hash, then rereads receipt and
chain to detect movement during the inspection. It distinguishes a missing
receipt, mismatched intent, revert and matching successful mined receipt. Missing
receipts remain unresolved; they cannot distinguish pending, dropped, cancelled
or replaced transactions. RPC errors remain errors.

A single-order submission additionally needs exactly one matching book admission
event for pool, trader, epoch, order hash and index before displaying recovery
IDs. **Admitted is not settled, refundable or a current balance.** Other actions
show a matching mined receipt without reconstructing vault events/credited
amounts or current protocol state. Refresh the existing position/epoch/claims
panels for those reads. One receipt is not finality.

[The history panel](../web/src/components/TransactionHistoryPanel.tsx) shows only
the selected wallet and current manifest. It offers receipt checks and explorer
links, and invalidates outstanding results if account/network/history changes.
Forgetting needs explicit acknowledgement that only the local record is removed;
it does not cancel/refund/reverse an action. The acknowledgement resets after
forgetting. Storage events update other tabs' displayed history but supply no
cross-tab action lock. The existing wallet action lock remains per tab.

**The deployment manifest stays null.** The actual production build offers no
order, exit, recovery or history actions. No real wallet was connected; no RPC
transaction, deployment, reviewer contact, upload or grant submission occurred.
Production Solidity, ABI, solver, mechanism, asset/utility rules and dependencies
are unchanged. This is a bounded local recovery interface, not step 7 completion
or grant qualification. G1–G4 and concentrated auction gates remain open.

## Fresh validation and provenance

- `web/: npm test`: **47 tests passed**, zero failures/skips. The 17 new groups
  cover reload persistence without signatures, separate transaction keys and
  subscriptions, explicit forgetting/no eviction, same-hash collision protection,
  full-history races, malformed/unknown fields, storage-key mismatches, manifest
  segregation, pre-broadcast storage failures, post-broadcast read/write failures
  and hash retention, live repricing/cancellation, read-only reload inspection,
  exact block numbers beyond JavaScript's safe integer limit, unresolved receipts
  versus RPC/chain failures, reorg/disappearance/block inconsistencies, mismatched
  sender/target/calldata/value, reverts, native/ERC20 admission reconstruction,
  missing/duplicate/wrong admission events, unsupported contract/method/approval
  destinations, and all existing wallet methods/credit ledgers. Tests use mocked
  transport/storage/RPC/wallet data, not a real connector or chain.
- `npm run build -- --outDir /tmp/otter-7c-web-dist`: TypeScript and production
  build passed. The existing large-chunk warning remains (about 951 kB main JS).
  No dependency installation/upgrade; tracked `web/dist/` is unchanged.
- Browser checks use the actual history JSX and journal with a temporary mock
  wallet/session and read-only mock receipt client. Synthetic records survive
  reloads; admission epoch 7/index 31 appears only after its matching receipt;
  unresolved/reverted/altered receipts stay distinct; switching account/network
  hides previous history; an outstanding read released after switching wallets
  cannot apply its old result. Forgetting is disabled until acknowledgement,
  resets acknowledgement afterwards, persists through reload, and is reversible
  through the disposable fixture's reset control. Pending reads disable row
  inspection/forget controls. Final preview pages show no console errors.
  These are interface checks, not browser-to-real-wallet-to-chain evidence.
- The actual compiled production bundle shows the default disabled Sepolia
  notice and no wallet action/history controls. Connect Wallet was not clicked.
  The production HTML's asset prefix alone was adjusted in a temporary copy for
  serving beside the fixture; compiled JS/CSS bytes remain unchanged. A browser
  selector initially confused native accessibility checkbox representation with
  the mode's DOM button; a fresh DOM snapshot resolved the harness selector.
  The temporary browser tab and localhost server were closed.
- [The 7C snapshot](./EVIDENCE_MANIFEST_7C.json) verifies **274 selected files**:
  the prior 270 plus four journal/inspection/interface sources. It records the
  pre-checkpoint baseline and explicitly identified local checkpoint bytes,
  without asserting those bytes equal the baseline commit. Five selected files
  now differ from frozen 7B: shared styles, Sepolia panel, wallet action hook,
  viem adapter and wallet tests. Earlier manifests are unchanged. The frozen 4J
  manifest still verifies its 217 selected bytes; it did not select this wallet
  closure, so its success does not validate the new wallet. Installed packages,
  generated artifacts/builds, mock previews and mutable packet/status docs are
  excluded. This is unsigned content identity, not proof, audit or deployment
  certification.
- Whitespace, local Markdown targets, the exact 17-file handoff, unchanged HEAD/
  empty index and preservation of contracts, solver/research, fixtures,
  benchmarks, dependencies, published deployments, older manifests, null wallet
  config and tracked web build are checked before handoff. No contract, solver
  or economic benchmark suite is claimed as fresh in this wallet-only checkpoint.
  Existing wallet ABI tests still compare against the local Foundry artifacts.

Run from `web/`, using existing dependencies:

```sh
npm test
npm run build -- --outDir /tmp/otter-7c-web-dist
```

From the repository root:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_7C.json
```

Logs: `/tmp/otter-7c-wallet.log`, `/tmp/otter-7c-build.log`,
`/tmp/otter-7c-preview-build.log`, `/tmp/otter-7c-handoff.log`.
Read-only visual artifacts: `/tmp/otter-7c-history-fixture.jpg`,
`/tmp/otter-7c-history-admission.jpg`, `/tmp/otter-7c-wallet-disabled.jpg`.
`/tmp/otter-7c-history-summary.jpg` captures the synthetic disclosure and verified
admission card for the handoff preview.
Temporary mock sources/builds remain under `/tmp/otter-7c-preview*`.
Node 24.10.0, Python 3.9.6, existing viem/React/Vite dependencies; Forge version
1.5.1 was observed read-only, with no fresh contract execution claimed.

## Material limits and next work

Browser storage can be changed, cleared, unavailable or scoped to another origin.
It is not authenticated proof of a user's original intent. A changed local record
cannot trigger a wallet action, but can change what is displayed as the expected
intent. An edited observed hash is not independently bound to the original nonce.
The RPC supplies the transaction/receipt/block data; checks do not independently
verify consensus or prevent a later reorg. Receipt results are not durable
finality records and must be rechecked before acting.

This does not discover replacements after reload, coordinate wallets in other
tabs, prevent duplicate manual sends, eliminate concurrent capacity races or
recover a broadcast interrupted before the wallet returns its hash. Save hashes
and admission IDs separately, especially after a persistence error. Storage
failure is a wallet-interface restriction; on-chain recovery stays independent
of this browser. No automated retry, keeper, cancellation, new claim entitlement
or funds transfer follows a history record.

Durable indexing/reorg reconciliation, actual contract-wallet/EIP-1271 connector
flows and testnet end-to-end evidence remain. LP deposits, position discovery,
cross-pool navigation and automatic exit processing remain. Concentrated custody
support is not concentrated auction correctness. Complete canonical payments,
useful integer fills and combined trader/LP incentives remain unresolved under
G1–G4. No weaker mechanism, fractional asset, subsidy, new cost grid/utility or
redistribution destination has been selected.

## User-created commit handoff

Suggested title:

```text
feat: persist wallet intents and recover receipt history
```

Suggested explanation:

> Save bounded browser transaction history without order signatures. Add read-only
> receipt and admission-ID recovery, storage/session/reorg failure checks and
> explicit local forgetting. Keep writes disabled pending a reviewed deployment.

The assistant did not stage or commit anything. The user committed these
**17 files** as `0e5b727`, confirming before checkpoint 4K began:

```text
README.md
reviews/CHECKPOINT_7B.md
reviews/CHECKPOINT_7C.md
reviews/EVIDENCE_MANIFEST_7C.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/src/components/OrderComposer.module.css
web/src/components/SepoliaStatus.tsx
web/src/components/TransactionHistoryPanel.tsx
web/src/hooks/useWalletActions.ts
web/src/protocol/inspectTransaction.ts
web/src/protocol/transactionJournal.ts
web/src/protocol/viemTransport.ts
web/src/protocol/walletJournal.ts
web/test/protocol.test.ts
```
