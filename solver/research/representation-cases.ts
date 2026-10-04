/** Reproducible offline representation evidence; no transactions or token asset. */
import { Q96, sqrtPriceAtTick } from '../src/execution.ts';
import { WAD } from '../src/discrete-research.ts';
import { createCreditLedger, ledgerAccounting, redeemCommunity, redeemCredit, transferCredit,
  creditPrecision, spotCompensation, diagnoseBridge, integerPaymentConflict, type CreditLedger } from '../src/representation-research.ts';
import { fullPool } from './discrete-cases.ts';
import { lotBid, scarceLotFrame } from './lot-cases.ts';
import { solveLotCandidate } from '../src/lot-candidate.ts';

export const ledgerView = (l: CreditLedger) => ({ scale: l.scale, cash: l.cash,
  escrow: [...l.escrow], claims: [...l.claims], community: l.community, accounting: ledgerAccounting(l) });

export function representationCases() {
  const frame = scarceLotFrame();
  const highAsk = WAD * 3n / 16n, lowAsk = WAD / 16n;
  const honest = [lotBid(1, true, highAsk, 4n), lotBid(2, true, WAD / 8n, 4n),
    lotBid(3, true, WAD / 8n, 4n), lotBid(4, false, WAD * 2n / 5n, 9n)];
  const lowerReport = honest.map((b, i) => i === 0 ? { ...b, ask: lowAsk } : { ...b });
  const truth = solveLotCandidate(frame, honest), deviation = solveLotCandidate(frame, lowerReport);
  const initial = createCreditLedger(WAD, 17n,
    [['trader-b', truth.paymentNumerator[1]], ['trader-c', truth.paymentNumerator[2]]],
    truth.claimResidualNumerator[1]);
  const afterCommunity = redeemCommunity(initial, 15n);
  const afterAggregation = transferCredit(afterCommunity, 'trader-b', 'trader-c', WAD * 3n / 4n);
  const afterRedemption = redeemCredit(afterAggregation, 'trader-c', 1n);
  const price = Q96 * 3n / 2n, s = fullPool(1000n, 60, price);
  const tickOne = fullPool(1000n, 60, sqrtPriceAtTick(1));
  const bridges = [
    { label: 'spot 9/4; dominant sells currency0; Q=1, minority=1', snapshot: s, down: true, input: 1n,
      minority: 1n, limit: sqrtPriceAtTick(7000) },
    { label: 'spot 9/4; dominant sells currency1; Q=3, minority=1', snapshot: s, down: false, input: 3n,
      minority: 1n, limit: sqrtPriceAtTick(9000) },
    { label: 'ordinary tick 1; dominant sells currency0; Q=10, minority=1', snapshot: tickOne, down: true,
      input: 10n, minority: 1n, limit: sqrtPriceAtTick(-1000) },
  ].map(c => ({ label: c.label, price: c.snapshot.sqrtPriceX96,
    floor: diagnoseBridge(c.snapshot, c.down, c.input, c.minority, c.limit, 'floor'),
    ceil: diagnoseBridge(c.snapshot, c.down, c.input, c.minority, c.limit, 'ceil') }));
  const precisions = [price, tickOne.sqrtPriceX96].flatMap(p => [true, false].map(down => {
    const value = spotCompensation(p, down, 1n);
    return { price: p, sellingCurrency0: down, exactSpotPayment: value,
      wad: creditPrecision(value, WAD), decimal36: creditPrecision(value, 10n ** 36n),
      binary192: creditPrecision(value, 1n << 192n) };
  }));
  return {
    schema: 'otter/representation-research/v1',
    qualification: 'Offline arithmetic and ledger diagnostics, not a production claim asset, auction, adapter, or full incentive proof.',
    fixedAllocationPaymentConflict: { honest, lowerReport,
      truthfulFill: truth.spend[0], lowerReportFill: deviation.spend[0],
      truthfulCompensation: truth.paymentNumerator[0], lowerReportNominalCompensation: deviation.paymentNumerator[0],
      zeroLosingCompensationAssumed: true, witness: integerPaymentConflict(lowAsk, highAsk, deviation.spend[0]) },
    creditRedemption: { individualWholeRedemption: [truth.floorPayment[1], truth.floorPayment[2]],
      promisedMinimumWhole: [truth.minimumPayment[1], truth.minimumPayment[2]],
      initial: ledgerView(initial), afterCommunity: ledgerView(afterCommunity),
      afterVoluntaryAggregation: ledgerView(afterAggregation), afterTraderRedemption: ledgerView(afterRedemption),
      naiveSweep: { withdrawal: 17n, remainingCash: 0n,
        stillOwedTraderCredits: truth.paymentNumerator[1] + truth.paymentNumerator[2] },
      scope: 'Voluntary credit transfer can aggregate dust. It does not guarantee each original order immediate underlying-token IR or a market price.' },
    spotPrecision: precisions,
    residualAdapters: bridges,
  };
}

export const renderRepresentationCases = (): string => JSON.stringify(representationCases(), (_k, value) =>
  typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
