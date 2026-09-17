# Otter frontend

Vite + React + TypeScript, wallet connection via wagmi/RainbowKit.

Three modes, switched from the header nav (or by clicking the wordmark to
return home):

- **Home** — landing page: the problem, the mechanism, on-chain invariants,
  measured stats, architecture, links to the source-verified deployed
  contracts, and stated limitations.
- **Demo story** — a guided walkthrough of one settled batch using the
  solver's own fixture data (`fixtures/demo-batch.json`) and the sandwich
  harness's real measured numbers (`harness/results/sandwich.json`) — not
  hardcoded figures.
- **Sepolia sandbox** — connect a real wallet and submit a real EIP-712-signed
  order to the deployed `OtterOrderBook` on Sepolia. No public solver is
  running, so submitted orders are not currently settled automatically; the
  Demo story mode shows what a settled batch looks like.

```
npm install
npm run dev      # local dev server
npm run build    # tsc + production build to dist/
```
