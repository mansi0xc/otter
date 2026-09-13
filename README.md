# Otter

**The MEV-resilient AMM — optimal truthful trading with excess redistribution**

An implementation of [*Otter: A Provably MEV-Resilient Automated Market Maker via
Surplus Redistribution*](https://eprint.iacr.org/2026/1877) (Shi, Zhang, Chung, Li — IACR ePrint 2026/1877, posted
3 September 2026) as a Uniswap v4 hook with an off-chain VCG solver.

No public implementation of this mechanism was found as of 9 September 2026.

---

## What is Otter?

Otter is a batch automated market maker that clears trades in a way that's
**dominant-strategy truthful** — not just for ordinary users, but for a builder
acting as a user too. Where existing batch AMMs (CoW Protocol, Angstrom, SPEEDEX,
am-AMM, Penumbra) clear at a uniform price without incentive compatibility, Otter
achieves truthfulness by redistributing the mechanism's surplus back to
participants, as described in [the paper](https://eprint.iacr.org/2026/1877).
This is its first implementation.

See [`CORRECTIONS.md`](./CORRECTIONS.md) for the places where this repo's
understanding of the paper diverges from the notes it was originally planned
from.

## Repository layout

| Path | What lives here |
| --- | --- |
| `solver/` | Reference implementation of the mechanism (TypeScript), with property tests. |
| `contracts/` | `OtterOrderBook`, `OtterSettlement`, `OtterHook`, and fixed-point invariant checks. |
| `harness/` | Sandwich-attack comparison (vanilla Uniswap v4 vs. Otter) and settlement-cost benchmarks. |
| `fixtures/` | Shared test vectors — written by the solver, read by both test suites. |
| `web/` | React/Vite dashboard with two modes: a guided **Demo story** that walks through a real settled batch (order ledger, sandwich-comparison chart, batch clock, proof rail, and outcome panel), and a **Sepolia sandbox** where you connect a wallet (RainbowKit/wagmi), mint demo tokens, and submit a real EIP-712-signed order to the deployed `OtterOrderBook`, with the batch countdown read live from the contract. No public solver runs against the sandbox yet, so settlement itself is shown through the Demo story's fixture rather than live. See [`deployment.md`](./deployment.md) for the exact contract addresses it talks to. |

## Limitations

Stated up front rather than buried:

- The mechanism's guarantees require **censorship resilience at the consensus
  layer** (Theorem 23). A testnet does not provide this.
- The contract verifies feasibility, individual rationality, budget bounds, and
  curve conservation. **Welfare-optimality of the proposed allocation is
  asserted by the solver, not proven on-chain.**
- The `O(n log n)` pivot algorithm is extracted from the proof of the paper's
  Lemma 16. It is not original to this work.

## Inside the hook

Otter's guarantees hold for a whole batch settled as an order-independent set.
The `OtterHook` exists to make that assumption true on-chain rather than just
in the solver:

- **Batch-only swaps.** `beforeSwap` rejects any caller other than
  `OtterSettlement`. Without this, anyone could slip an ordinary sequential
  swap into the same block, move the pool state the batch was solved against,
  and break order-independence.
- **Full-range liquidity gate.** The paper models the AMM as a constant-product
  curve `F(y) = x0 - k/(y0 + y)`. A v4 pool is concentrated liquidity, not
  constant product — but on the virtual reserves, v3/v4 math *is* constant
  product as long as in-range liquidity `L` doesn't change mid-swap. `beforeAddLiquidity`
  enforces this by requiring every position to span the pool's full range at
  its tick spacing, so a batch can never cross a tick boundary and shift `L`
  underneath the settled curve. Gating adds is sufficient — a position can
  only exist if it was admitted through this same check, so there's nothing
  narrower to remove.
- **Batch-active guards.** `beforeAddLiquidity` and `beforeRemoveLiquidity`
  both revert while a batch is open for the pool, so liquidity is frozen from
  the first accepted order until the batch settles or is refunded. A solver
  prices against one curve; this keeps a different curve from appearing by
  the time it executes.
- **No silent permissions.** Every hook callback the contract doesn't use
  (`beforeInitialize`, `afterSwap`, `beforeDonate`, etc.) explicitly reverts
  rather than returning success, and the hook's address is mined so its low
  bits only carry the three flags it actually implements.
- **Zero LP fee.** A non-zero fee would make the realized swap diverge from
  `F`, breaking curve conservation. LPs are compensated out of the
  redistributed surplus instead — a burn destination the paper explicitly
  permits (§3.6).

## Prior art

Batch AMMs exist and are implemented — CoW Protocol, Angstrom, SPEEDEX, am-AMM,
Penumbra — so this is not the first batch AMM or the first anti-MEV hook.
Existing batch AMMs clear at a uniform price and are not incentive compatible.
Otter is the first design achieving dominant-strategy truthfulness for users
*and* for a builder-as-user, via surplus redistribution.

## Getting started

```bash
# Solver: property tests
cd solver && npm test

# Contracts: Foundry test suite
cd contracts && forge test

# Web dashboard
cd web && yarn && yarn dev
```

## Project documents

- [`deployment.md`](./deployment.md) — full Sepolia deployment record: every contract address (`OtterOrderBook`, `OtterSettlement`, `OtterHook`, demo tokens), pool configuration, the transaction-by-transaction deployment trail, and Etherscan verification links.
- [`CORRECTIONS.md`](./CORRECTIONS.md) — known divergences from the source paper.
- [`FEEDBACK.md`](./FEEDBACK.md) — open feedback and review notes.