// Gas curve data — inlined from harness/results/gas-curve.csv and block-ceiling.csv

export interface GasPoint {
  orders: number
  submitGas: number
  settleGas: number
  calldataGas: number
  totalGas: number
  totalPerOrder: number
  pctOfBlock: number
}

export interface CeilingPoint extends GasPoint {
  fits: boolean
}

// Inlined from gas-curve.csv
export const GAS_CURVE: GasPoint[] = [
  { orders: 1,   submitGas: 109966,   settleGas: 201524,   calldataGas: 4748,   totalGas: 227272,  totalPerOrder: 227272, pctOfBlock: 0 },
  { orders: 2,   submitGas: 144259,   settleGas: 238022,   calldataGas: 6824,   totalGas: 265846,  totalPerOrder: 132923, pctOfBlock: 0 },
  { orders: 5,   submitGas: 247180,   settleGas: 346415,   calldataGas: 13028,  totalGas: 380443,  totalPerOrder: 76088,  pctOfBlock: 1 },
  { orders: 10,  submitGas: 419284,   settleGas: 527626,   calldataGas: 23348,  totalGas: 571974,  totalPerOrder: 57197,  pctOfBlock: 1 },
  { orders: 25,  submitGas: 938686,   settleGas: 1073673,  calldataGas: 54284,  totalGas: 1148957, totalPerOrder: 45958,  pctOfBlock: 3 },
  { orders: 50,  submitGas: 1817262,  settleGas: 1993158,  calldataGas: 105896, totalGas: 2120054, totalPerOrder: 42401,  pctOfBlock: 7 },
  { orders: 100, submitGas: 3620418,  settleGas: 3865594,  calldataGas: 209060, totalGas: 4095654, totalPerOrder: 40956,  pctOfBlock: 13 },
  { orders: 200, submitGas: 7410913,  settleGas: 7744913,  calldataGas: 415352, totalGas: 8181265, totalPerOrder: 40906,  pctOfBlock: 27 },
  { orders: 300, submitGas: 11626202, settleGas: 11924934, calldataGas: 621716, totalGas: 12567650,totalPerOrder: 41892,  pctOfBlock: 41 },
  { orders: 400, submitGas: 16444658, settleGas: 16524729, calldataGas: 828008, totalGas: 17373737,totalPerOrder: 43434,  pctOfBlock: 57 },
  { orders: 500, submitGas: 22044913, settleGas: 21663386, calldataGas: 1034372,totalGas: 22718758,totalPerOrder: 45437,  pctOfBlock: 75 },
]

// Inlined from block-ceiling.csv
export const BLOCK_CEILING: CeilingPoint[] = [
  { orders: 610, submitGas: 0, settleGas: 0, calldataGas: 0, totalGas: 25313991, totalPerOrder: 41498, pctOfBlock: 84,  fits: true },
  { orders: 630, submitGas: 0, settleGas: 0, calldataGas: 0, totalGas: 27740124, totalPerOrder: 44031, pctOfBlock: 92,  fits: true },
  { orders: 650, submitGas: 0, settleGas: 0, calldataGas: 0, totalGas: 30319210, totalPerOrder: 46644, pctOfBlock: 101, fits: false },
  { orders: 670, submitGas: 0, settleGas: 0, calldataGas: 0, totalGas: 33055954, totalPerOrder: 49337, pctOfBlock: 110, fits: false },
  { orders: 690, submitGas: 0, settleGas: 0, calldataGas: 0, totalGas: 35955191, totalPerOrder: 52108, pctOfBlock: 119, fits: false },
]

export const BLOCK_LIMIT = 30_000_000
export const MAX_ORDERS_PER_BLOCK = BLOCK_CEILING.filter(p => p.fits).reduce((m, p) => Math.max(m, p.orders), 0)
