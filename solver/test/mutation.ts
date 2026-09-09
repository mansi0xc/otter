import { AugmentedCurve } from "../src/curve.ts";
import type { Bid } from "../src/onesided.ts";
import { pivotsNaive } from "../src/onesided.ts";
import type { Pool, SellY, SellX, Flows } from "../src/otter.ts";
import { solve } from "../src/otter.ts";

let s = 99; const rnd = () => { s^=s<<13; s^=s>>>17; s^=s<<5; s|=0; return (s>>>0)/4294967296; };
const uni=(a:number,b:number)=>a+rnd()*(b-a);

// --- MUTATION A: idea.md's utility phrasing ("-inf if trade is opposite direction")
function utilWRONG(f: Flows, v: number, q: number): number {
  const dX=f.RX-f.SX, dY=f.RY-f.SY;
  if (-dY > q+1e-9) return -Infinity;
  if (-dY < -1e-9) return -Infinity;          // <-- drops the "&& dX < 0" conjunct
  return dX + v*dY;
}
function utilRIGHT(f: Flows, v: number, q: number): number {
  const dX=f.RX-f.SX, dY=f.RY-f.SY;
  if (-dY > q+1e-9) return -Infinity;
  if (-dY < -1e-9 && dX < -1e-9) return -Infinity;
  return dX + v*dY;
}
let nWrongInf=0, nRightInf=0, total=0;
for (let t=0;t<4000;t++){
  const pool:Pool={x0:uni(1e3,1e6),y0:uni(1e3,1e6)};
  const s0=pool.x0/pool.y0, r0=1/s0;
  const others:SellY[]=Array.from({length:Math.floor(rnd()*4)},()=>({ask:uni(0,s0),budget:uni(0,300)}));
  const oX:SellX[]=Array.from({length:Math.floor(rnd()*4)},()=>({ask:uni(0,r0),budget:uni(0,300)}));
  const v=uni(0,s0), q=uni(1,300);
  const dev=solve(pool,[{ask:uni(0,s0),budget:uni(0,q*2)},...others],[{ask:uni(0,r0),budget:uni(0,300)},...oX]);
  const f:Flows={SY:dev.sellY[0].y,RX:dev.sellY[0].x,SX:dev.sellX[0].x,RY:dev.sellX[0].y};
  total++;
  if(!Number.isFinite(utilWRONG(f,v,q)))nWrongInf++;
  if(!Number.isFinite(utilRIGHT(f,v,q)))nRightInf++;
}
console.log(`A) cross-direction deviations scored -inf:`);
console.log(`   idea.md phrasing : ${nWrongInf}/${total}  (${(100*nWrongInf/total).toFixed(1)}% never evaluated)`);
console.log(`   paper eq.(2)     : ${nRightInf}/${total}  (${(100*nRightInf/total).toFixed(1)}%)`);
console.log(`   => ${nWrongInf-nRightInf} attack outcomes the wrong version silently skips\n`);

// --- MUTATION B: naive stopping rule instead of the K(v) quantity-maximising rule
function allocBROKEN(c:AugmentedCurve,bids:Bid[]){
  const idx=bids.map((_,i)=>i).sort((a,b)=>bids[a].ask-bids[b].ask);
  const alloc=new Array(bids.length).fill(0); let cum=0;
  for(const i of idx){
    const {ask,budget}=bids[i];
    if(c.Fprime(cum) <= ask) break;            // strict-improvement stop, drops equality
    const room=c.K(ask)-cum; if(room<=0)break;
    const fill=Math.min(budget,room); alloc[i]=fill; cum+=fill;
  }
  return cum;
}
let viol=0, tot=0;
for(let t=0;t<4000;t++){
  const pool:Pool={x0:uni(1e3,1e6),y0:uni(1e3,1e6)};
  const s0=pool.x0/pool.y0;
  const M=uni(1,200);
  const c=new AugmentedCurve(pool.x0,pool.y0,M);
  // eligible capacity >= M, and asks concentrated at exactly sigma0 (the boundary case)
  const bids:Bid[]=Array.from({length:3},()=>({ask: rnd()<0.7 ? s0 : uni(0,s0), budget:uni(M/2,M)}));
  const cap=bids.reduce((a,b)=>a+b.budget,0); if(cap<M)continue;
  tot++;
  if(allocBROKEN(c,bids) < M-1e-6) viol++;
}
console.log(`B) Fact 13 (Q_Y >= M) violations under the strict-inequality stopping rule:`);
console.log(`   ${viol}/${tot} batches  => feasibility breaks, burn goes negative`);
