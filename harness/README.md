# Demo harness

1. `SandwichHarness.t.sol` — `test_sandwichComparison`: a searcher sandwiches a
   victim swap on a plain v4 pool, and the identical victim order goes through
   the Otter pool instead (the hook rejects the searcher's swap outright).
   Reports TWO vanilla-pool numbers, not one: the unrealistic CEILING (victim
   has no slippage protection at all) and the REALISTIC figure at 0.5% / 1% / 5%
   slippage tolerance, since a searcher who exceeds the victim's real tolerance
   gets a reverted transaction, not more profit. `test_surplusRedistribution` in
   the same file covers the burn separately. Emits `results/sandwich.json`.
2. `GasCurve.t.sol` — settlement cost at batch sizes 2, 5, 10, 25, 50, 100, ... to
   failure. Emit CSV to `results/`.

Note: there is no mempool in a Foundry test. The "searcher bot" computes the optimal
front-run size in closed form for constant product and executes front / victim / back
directly. Say that plainly in the README rather than implying mempool detection.
