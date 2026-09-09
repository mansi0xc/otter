# Uniswap v4 developer experience feedback

Required for the Uniswap Foundation track. The submitted Developer Feedback Form
(https://developers.uniswap.org/hackathon-feedback) must link to this file.

Environment: Foundry, solc 0.8.26, `v4-core` at tag `v4.0.0`
(`e50237c43811bd9b526eff40f26772152a42daba`). `v4-periphery` was evaluated at
`dce236d4e2057422d0791d9a973a58765eb46f65` and subsequently dropped — see below.

---

## `BaseHook` has been removed from both repos with no migration note

This cost the most time of anything in setup. Nearly all v4 hook material — the
docs, the workshop, and every tutorial and template we found — starts from
`BaseHook`. It exists in neither repo at the commits above:

- not in `v4-core` `v4.0.0` (no `src/utils/`, nothing matching `BaseHook`)
- not in `v4-periphery` at `dce236d4` (`src/` contains `base/`, `hooks/`,
  `interfaces/`, `lens/`, `libraries/`, and no hook base contract)

Nothing in either repo's README says it moved or was intentionally dropped, and
the docs still reference it. A hook author following current documentation hits a
missing import with no signal about whether they have the wrong version, the wrong
package, or a genuinely removed API.

Implementing `IHooks` directly turned out to be fine — arguably better for a hook
that only needs one callback. But that was a conclusion we reached by reading
source, not something the docs offered.

**Suggestion:** a line in the v4-periphery README, or a `MIGRATION.md`, saying
`BaseHook` was removed and pointing at `IHooks`. Cheap, and it would have saved us
an hour.

## `HookMiner` is only reachable from `test/`

`HookMiner` survives at `v4-periphery/test/shared/HookMiner.sol`. CREATE2 salt
mining is mandatory for every hook — the permission bits live in the address — so
this is not a testing concern, it is a deployment concern. Putting it under
`test/` means projects either depend on v4-periphery solely for a test helper, or
vendor it, which is what we did.

It has exactly one import (`Hooks` from v4-core) and no state. It would sit
naturally in `v4-core/src/libraries/`.

## Nested-dependency remappings are the first thing that breaks

A fresh `forge init` + `forge install Uniswap/v4-core` does not build. `v4-core`
declares `solmate/=lib/solmate/` in its own `remappings.txt`, which is correct
relative to itself but wrong from a parent project, where solmate lives at
`lib/v4-core/lib/solmate/`. The failure surfaces as a doubled path:

```
Source "lib/solmate/src/src/auth/Owned.sol" not found
 --> lib/v4-core/src/ProtocolFees.sol:9:1
```

Note the `src/src/`. The error points into a dependency's source file, which
reads like a bug in v4-core rather than a remapping problem in the consumer.
Correct value:

```
solmate/=lib/v4-core/lib/solmate/
```

Installing `v4-periphery` also pulls `permit2` plus four nested submodules
(`forge-gas-snapshot`, `forge-std`, `openzeppelin-contracts`, `solmate`), roughly
70MB and a second copy of `v4-core` at a different commit than the top-level one.
Consumers must remap `@uniswap/v4-core/` to the top-level copy or get duplicate
type errors between contracts that look identical.

**Suggestion:** a short "consuming v4-core from your own Foundry project" section
with the four remappings that actually work. This is the first five minutes of
every v4 project and currently everyone rediscovers it.

## What worked well

- `Hooks.sol` permission constants are clearly laid out and easy to verify
  against directly, which is the right way to do it. Reading `BEFORE_SWAP_FLAG`
  out of the library beats trusting a table in a blog post.
- `foundry.lock` pinning `v4-core` to a tag rather than a floating branch made
  the dependency reproducible without extra work.
- `PoolManager`'s constructor taking a single `initialOwner` makes local test
  setup genuinely one line.
- The `unlock` / `unlockCallback` flow is well documented in the interface
  comments — the NatSpec on `IHooks.beforeSwap` explains the delta sign
  convention better than most protocol docs manage.
