#!/usr/bin/env bash
# Scaffold the otter project structure.
# Run once from the root of your cloned https://github.com/mansi0xc/otter.
# Safe to re-run: never overwrites a file that already exists.

set -euo pipefail

if [ ! -d .git ]; then
  echo "error: run this from the root of the otter repo (no .git found here)" >&2
  exit 1
fi

# write <path> <<'EOF' ... EOF   -- skips if the file already exists
write() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  if [ -e "$path" ]; then
    echo "  skip   $path (exists)"
    cat > /dev/null
  else
    cat > "$path"
    echo "  write  $path"
  fi
}

echo "==> directories"
mkdir -p fixtures \
         solver/src solver/test \
         contracts/src contracts/test contracts/script \
         harness harness/results \
         cre \
         web

echo "==> root files"

write .gitignore <<'EOF'
node_modules/
contracts/out/
contracts/cache/
contracts/broadcast/
harness/results/*.tmp
.env
.env.*
!.env.example
.DS_Store
EOF

write LICENSE <<'EOF'
MIT License

Copyright (c) 2026 mansi0xc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF

write README.md <<'EOF'
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
  solver, not proven on-chain.**
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
EOF

write AI_DISCLOSURE.md <<'EOF'
# AI usage disclosure

Required by ETHGlobal submission rules. Keep this updated as you go — not at the end.

Precedent for the level of specificity expected: the Otter paper's own acknowledgements
state that the mechanism and some proofs were developed with assistance from ChatGPT 5.6,
other results were written up with ChatGPT 5.6 and Claude Fable 5, and the authors
reviewed and substantially edited all AI-generated text.

## Per-file

| File | Tool | What the tool did | What I did |
|---|---|---|---|
| | | | |

## Not AI-assisted

-
EOF

write FEEDBACK.md <<'EOF'
# Uniswap v4 developer experience feedback

Required for the Uniswap Foundation track. The submitted Developer Feedback Form
(https://developers.uniswap.org/hackathon-feedback) must link to this file.

Write entries as you hit things, not from memory at the end.

## What worked

## What was confusing

## What was missing

## Documentation gaps

## Suggestions
EOF

echo "==> solver"

write solver/package.json <<'EOF'
{
  "name": "otter-solver",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --experimental-strip-types test/properties.ts",
    "mutation": "node --experimental-strip-types test/mutation.ts",
    "bench": "node --experimental-strip-types test/bench.ts",
    "vectors": "node --experimental-strip-types src/cli.ts --emit-vectors ../fixtures/vectors.json"
  }
}
EOF

write fixtures/README.md <<'EOF'
# Shared test vectors

`vectors.json` is written by the TypeScript solver and read by **both** test suites:

- `solver/test/` asserts the reference implementation reproduces them
- `contracts/test/CrossCheck.t.sol` asserts the Solidity fixed-point port agrees

This is the only mechanism that catches rounding divergence between the two. A
rounding difference that flips an invariant is a silent failure: the demo still runs
and proves nothing. Round *against* the party being paid, in both implementations.

Regenerate with `cd solver && npm run vectors`. Commit the result.
EOF

echo "==> contracts (foundry)"

write contracts/foundry.toml <<'EOF'
[profile.default]
src = "src"
test = "test"
out = "out"
libs = ["lib"]
solc = "0.8.26"
evm_version = "cancun"
via_ir = true
optimizer = true
optimizer_runs = 200
ffi = true
fs_permissions = [{ access = "read", path = "../fixtures" }]

[profile.default.fuzz]
runs = 512
EOF

write contracts/remappings.txt <<'EOF'
forge-std/=lib/forge-std/src/
@uniswap/v4-core/=lib/v4-core/
@uniswap/v4-periphery/=lib/v4-periphery/
v4-core/=lib/v4-core/src/
v4-periphery/=lib/v4-periphery/src/
solmate/=lib/solmate/src/
permit2/=lib/permit2/
EOF

echo "==> harness / cre / web placeholders"
write harness/results/.gitkeep <<'EOF'
EOF
write harness/README.md <<'EOF'
# Demo harness

1. `SandwichVanilla.t.sol` — searcher sandwiches a victim swap on a plain v4 pool.
   Record bot profit and victim realized price.
2. `SandwichOtter.t.sol` — identical order set through the Otter pool. Bot profit
   should be exactly zero. Record victim price and the burn.
3. `GasCurve.t.sol` — settlement cost at batch sizes 2, 5, 10, 25, 50, 100, ... to
   failure. Emit CSV to `results/`.

Note: there is no mempool in a Foundry test. The "searcher bot" computes the optimal
front-run size in closed form for constant product and executes front / victim / back
directly. Say that plainly in the README rather than implying mempool detection.
EOF

write cre/README.md <<'EOF'
# Chainlink CRE Confidential Workflow

Target: Best Confidential Workflow, $2,000 (up to 2 teams at $1,000).

The solver runs inside a TEE handler so batch order flow is never visible to the
solver operator before it computes on it. This addresses the trust limitation stated
in the root README — it does not make welfare-optimality provable.

Requirements to satisfy:
- register and use a confidential TEE handler (`handlerInTee` in TypeScript)
- process at least one sensitive input inside the enclave (the batch itself)
- the confidential portion must be load-bearing, not a placeholder
- demonstrate a successful CRE CLI simulation, with evidence in the submission
EOF

write web/README.md <<'EOF'
# Static results page

Renders a real testnet batch: orders in, allocation and compensation out, burn counter,
and the sandwich comparison numbers. Reads committed JSON. No wallet connector.
EOF

echo
if [ -f contracts/foundry.toml ] && ! grep -q via_ir contracts/foundry.toml; then
  echo "WARNING: contracts/foundry.toml exists but is not the Otter config."
  echo "         forge init probably overwrote it. Delete it and re-run this script."
fi
echo "==> done. Remaining Foundry step (needs network):"
cat <<'EOF'

    cd contracts
    forge install foundry-rs/forge-std
    forge install Uniswap/v4-core
    forge install Uniswap/v4-periphery
    forge remappings      # <-- CHECK against remappings.txt, fix by hand if they differ
    forge build

EOF
