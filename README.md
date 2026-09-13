# Otter

An implementation of **Otter: A Provably MEV-Resilient Automated Market Maker via
Surplus Redistribution** (Shi, Zhang, Chung, Li — IACR ePrint 2026/1877, posted
3 September 2026) as a Uniswap v4 hook with an off-chain VCG solver.

No public implementation of this mechanism was found as of 9 September 2026.

## Status

Work in progress. See `CORRECTIONS.md` for where this repo's understanding of the
paper diverges from the notes it was planned from.

## Layout

| Path | What |
|---|---|
| `solver/` | Reference implementation of the mechanism, TypeScript. Property tests. |
| `contracts/` | `OtterOrderBook`, `OtterSettlement`, `OtterHook`, fixed-point invariant checks. |
| `harness/` | Sandwich comparison (vanilla v4 vs Otter) and settlement-cost benchmarks. |
| `fixtures/` | Shared test vectors. Written by the solver, read by both test suites. |
| `cre/` | Chainlink CRE Confidential Workflow: solver inside a TEE handler. |
| `web/` | Static results page over a real testnet batch. |

## Limitations

Stated up front rather than buried:

- The mechanism's guarantees require **censorship resilience at the consensus layer**
  (Theorem 23). A testnet does not provide this.
- The contract verifies feasibility, individual rationality, budget bounds and curve
  conservation. **Welfare-optimality of the proposed allocation is asserted by the
  solver, not proven on-chain.** Off-chain, `solver/test/properties.ts` §8
  grid-searches the allocation space directly (independent of `allocate`'s own
  logic) for small instances (n ≤ 4) and checks nothing on the grid beats what
  the solver actually returns. That is evidence for small n, not a proof for
  arbitrary n — see the section's comment for exactly what it does and does not
  establish.
- The `O(n log n)` pivot algorithm is extracted from the proof of the paper's Lemma 16.
  It is not original to this work.

## Prior art

Batch AMMs exist and are implemented: CoW Protocol, Angstrom, SPEEDEX, am-AMM,
Penumbra. This is not the first batch AMM or the first anti-MEV hook. Existing batch
AMMs clear at a uniform price and are not incentive compatible. Otter is the first
design achieving dominant-strategy truthfulness for users *and* for a builder-as-user,
via surplus redistribution. This is its first implementation.

## Running

```bash
cd solver && npm test
cd contracts && forge test
```

## Sepolia deployment

The deployment script is deliberately restricted to Ethereum Sepolia. It deploys
the order book, settlement contract, hook, a zero-fee full-range v4 pool, and a
small LP position. With no token addresses supplied, it deploys two mintable demo
tokens; this is the appropriate starting point for the hackathon demo.

```bash
cd contracts
cp .env.example .env
# Edit .env: add SEPOLIA_RPC_URL and PRIVATE_KEY. Keep .env private.
set -a && source .env && set +a
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast -vvvv
```

`SOLVER` is optional. If unset, the deployer is the solver. For a public demo,
use a separate, funded hot-wallet address once the off-chain relayer is running;
the solver is only the address allowed to submit a settlement during the initial
exclusivity window, and pays its own transaction gas.

The script prints the deployed addresses. Record those only after the broadcast
transactions have confirmed. Never put a private key in the repository or in a
terminal transcript.
