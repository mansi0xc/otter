/**
 * Offline arithmetic preflight for the current full-range settlement rule.
 * An OK result does not authenticate orders/state or guarantee a successful swap,
 * canonical allocation, truthfulness, or funded asset delivery.
 */
import { WAD, mulDivDown, mulDivUp, verify, ERR_IR, type Fill, type Verdict } from './fixed.ts';
import type { Order, Outcome } from './exact.ts';

// Codes 0–6 remain the unchanged fixed.ts / CrossCheck.t.sol mapping.
export const ERR_LENGTH = 7;
export const ERR_DOMAIN = 8;
export const ERR_INELIGIBLE = 9;
export const ERR_MINORITY = 10;
export const MAX_ORDERS = 32;
export const MAX_BUDGET = (1n << 96n) - 1n;
export const MAX_ASK = (1n << 128n) - 1n;
export const MAX_UINT256 = (1n << 256n) - 1n;
// Superset of positive virtual reserves in the admitted price/liquidity domain:
// 2^64 <= sqrtPriceX96 < 2^128, total liquidity <= 2^88 - 1.
// A reserve pair within this bound is not proof of a real supported pool.
export const MAX_RESERVE = (1n << 120n) - 1n;

export type SettlementOutcome = Pick<Outcome, 'dominantSellsCurrency0' | 'y' | 'x'>;

const fail = (code: number, index = 0): Verdict => ({
  code, index, arg0: 0n, arg1: 0n, totalIn: 0n, totalPaid: 0n, burn: 0n,
});
const uint = (value: unknown, max: bigint): value is bigint =>
  typeof value === 'bigint' && value >= 0n && value <= max;

/**
 * Input-domain checks precede classification. For admitted numeric inputs,
 * classification/error order matches OtterSettlement._classify then OtterMath.
 * Trader identity, signatures, configuration, clocks, snapshot, fees, actual
 * consumption/output and payout backing must be checked independently on-chain.
 * Only direction/y/x are outcome inputs; diagnostics, clamps and claimed burn
 * are ignored, just as they are absent from the contract's outcome ABI.
 * Success totals and burn describe the dominant model, not realised swap surplus.
 */
export function checkLegacyOutcome(
  r0: bigint, r1: bigint, orders: Order[], out: SettlementOutcome,
): Verdict {
  if (!Array.isArray(orders) || !out || !Array.isArray(out.y) || !Array.isArray(out.x)
      || out.y.length !== orders.length || out.x.length !== orders.length) return fail(ERR_LENGTH);
  if (!uint(r0, MAX_RESERVE) || !uint(r1, MAX_RESERVE) || r0 === 0n || r1 === 0n
      || orders.length === 0 || orders.length > MAX_ORDERS
      || typeof out.dominantSellsCurrency0 !== 'boolean') return fail(ERR_DOMAIN);

  let budget0 = 0n, budget1 = 0n;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (!o || typeof o.sellingCurrency0 !== 'boolean' || !uint(o.ask, MAX_ASK)
        || !uint(o.budget, MAX_BUDGET) || o.budget === 0n
        || !uint(out.y[i], MAX_UINT256) || !uint(out.x[i], MAX_UINT256)) return fail(ERR_DOMAIN, i);
    if (o.sellingCurrency0) budget0 += o.budget;
    else budget1 += o.budget;
    if (budget0 > MAX_BUDGET || budget1 > MAX_BUDGET) return fail(ERR_DOMAIN, i);
  }

  const c = out.dominantSellsCurrency0
    ? { x0: r1, y0: r0, M: 0n }
    : { x0: r0, y0: r1, M: 0n };
  const fills: Fill[] = [];
  let dMinority = 0n;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (o.sellingCurrency0 === out.dominantSellsCurrency0) {
      fills.push({ ask: o.ask, budget: o.budget, y: out.y[i], x: out.x[i] });
      continue;
    }
    fills.push({ ask: 0n, budget: 0n, y: 0n, x: 0n });
    if (mulDivUp(o.ask, c.x0, WAD) > c.y0) {
      if (out.y[i] !== 0n || out.x[i] !== 0n) return fail(ERR_INELIGIBLE, i);
      continue;
    }
    const owed = mulDivDown(c.y0, o.budget, c.x0);
    if (out.y[i] !== o.budget || out.x[i] !== owed) return fail(ERR_MINORITY, i);
    if (owed < mulDivUp(o.ask, o.budget, WAD)) return fail(ERR_IR, i);
    dMinority += o.budget;
  }
  c.M = mulDivDown(c.y0, dMinority, c.x0);
  return verify(c, fills);
}
