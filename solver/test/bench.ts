import { AugmentedCurve } from "../src/curve.ts";
import type { Bid } from "../src/onesided.ts";
import { pivotsNaive, runOneSided } from "../src/onesided.ts";
let s=7; const rnd=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;s|=0;return (s>>>0)/4294967296;};
const c=new AugmentedCurve(500000,500000,1000);
console.log("   n      naive(ms)   layercake(ms)   speedup");
for(const n of [10,50,100,500,1000,5000,20000]){
  const bids:Bid[]=Array.from({length:n},()=>({ask:rnd()*1.1,budget:rnd()*50}));
  let t0=performance.now(); if(n<=5000) pivotsNaive(c,bids); let tN=performance.now()-t0;
  t0=performance.now(); runOneSided(c,bids); const tF=performance.now()-t0;
  const nStr = n<=5000 ? tN.toFixed(1).padStart(9) : "        -";
  const sp = n<=5000 ? (tN/tF).toFixed(0)+"x" : "-";
  console.log(`${String(n).padStart(6)}  ${nStr}   ${tF.toFixed(2).padStart(13)}   ${sp.padStart(7)}`);
}
