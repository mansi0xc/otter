import { capitalWeight } from './rewards.ts';
const [price, lower, upper, liquidity] = process.argv.slice(2);
const r = capitalWeight(BigInt(price), Number(lower), Number(upper), BigInt(liquidity));
process.stdout.write('0x' + r.weight.toString(16).padStart(64, '0'));
