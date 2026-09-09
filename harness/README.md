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
