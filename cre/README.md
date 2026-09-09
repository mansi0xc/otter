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
