// Sandwich fixture data — inlined from harness/results/sandwich.json

const raw = {
  victimSize: 50000000000000000000n,
  fairOut: 47619047619047619043n,
  sandwichedOut: 1377410468319559228n,
  otterOut: 48461538461538461528n,
  searcherCapital: 5000000000000000000000n,
  searcherProfit: 48620689655172413517n,
  victimLoss: 46241637150728059815n,
  spotClearedM: 10000000000000000000n,
  realistic: [
    {
      bps: 50,
      searcherCapital: 2570621373297399255n,
      searcherProfit: 262434391400011244n,
      victimOut: 47380952380954321343n,
    },
    {
      bps: 100,
      searcherCapital: 5160696496432137788n,
      searcherProfit: 524737631182134440n,
      victimOut: 47142857142859206914n,
    },
    {
      bps: 500,
      searcherCapital: 26612170857060846170n,
      searcherProfit: 2618453865335010112n,
      victimOut: 45238095238096740575n,
    },
  ],
}

const WAD = 10n ** 18n

function toEther(wei: bigint): number {
  return Number((wei * 10000n) / WAD) / 10000
}

export interface SandwichResult {
  victimSizeEther: number
  fairOutEther: number
  sandwichedOutEther: number
  otterOutEther: number
  victimLossPct: number   // percent of victim's trade lost on plain pool
  otterDeltaPct: number   // Otter vs fair, as signed percent
  searcherProfitEther: number
  bars: Array<{ label: string; value: bigint; valueEther: number; color: 'neutral' | 'alarm' | 'flow' }>
}

export function parseSandwich(): SandwichResult {
  const victimLossPct =
    Number((raw.victimLoss * 1000n) / raw.victimSize) / 10
  const otterDeltaPct =
    (toEther(raw.otterOut) / toEther(raw.fairOut) - 1) * 100

  return {
    victimSizeEther: toEther(raw.victimSize),
    fairOutEther: toEther(raw.fairOut),
    sandwichedOutEther: toEther(raw.sandwichedOut),
    otterOutEther: toEther(raw.otterOut),
    victimLossPct,
    otterDeltaPct,
    searcherProfitEther: toEther(raw.searcherProfit),
    bars: [
      { label: 'No attacker', value: raw.fairOut, valueEther: toEther(raw.fairOut), color: 'neutral' },
      { label: 'Sandwiched', value: raw.sandwichedOut, valueEther: toEther(raw.sandwichedOut), color: 'alarm' },
      { label: 'Otter pool', value: raw.otterOut, valueEther: toEther(raw.otterOut), color: 'flow' },
    ],
  }
}

export const SANDWICH = parseSandwich()
