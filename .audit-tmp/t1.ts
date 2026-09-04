import { nonAgingDelay, planRuns, longestRun } from '/home/user/PhD-PWA/src/lib/foreperiod';
import { computeSdt } from '/home/user/PhD-PWA/src/lib/signalDetection';
import { dPrimeSe, rtBlockSeconds } from '/home/user/PhD-PWA/scripts/lib/timingModel';
import { CONFIG } from '/home/user/PhD-PWA/src/experiment/config';

// 1. mean of nonAgingDelay
let s = 0; const N = 2_000_000;
for (let i=0;i<N;i++) s += nonAgingDelay(300,1600,650);
console.log('empirical mean delay:', (s/N).toFixed(2), ' requested mean:', 650);
console.log('total foreperiod mean:', (400 + s/N).toFixed(2));
// analytic
const scale=350, range=1300;
const e=Math.exp(-range/scale);
console.log('analytic truncated mean:', 300 + (scale - range*e/(1-e)));

// mean <= min
console.log('mean<=min  nonAgingDelay(300,1600,300) x5:', Array.from({length:5},()=>nonAgingDelay(300,1600,300).toFixed(3)).join(' '));
console.log('mean<min   nonAgingDelay(300,1600,100) x5:', Array.from({length:5},()=>nonAgingDelay(300,1600,100).toFixed(3)).join(' '));
console.log('u=1        :', nonAgingDelay(300,1600,650,()=>1));
console.log('u=0        :', nonAgingDelay(300,1600,650,()=>0));
console.log('NaN rand   :', nonAgingDelay(300,1600,650,()=>NaN));

// 2. planRuns cap sweep
let bad: string[] = [];
for (let g=0; g<=24; g++) for (let n=0; n<=24; n++) for (let mr=1; mr<=4; mr++) {
  for (let t=0;t<200;t++){
    const {order, capRespected} = planRuns(g,n,mr);
    const lr = longestRun(order);
    const cg = order.filter(Boolean).length;
    if (cg!==g || order.length!==g+n) bad.push(`COUNT g=${g} n=${n} mr=${mr} got ${cg}/${order.length}`);
    if (lr>mr && capRespected) bad.push(`SILENT VIOLATION g=${g} n=${n} mr=${mr} longest=${lr}`);
  }
}
console.log('planRuns problems:', bad.length ? [...new Set(bad)].slice(0,15) : 'none');

// how often relaxation for shipped params
let relax=0; for(let i=0;i<20000;i++) if(!planRuns(20,12,3).capRespected) relax++;
console.log('relaxations at 20/12/3:', relax);

// 3. d_prime_unstable always true?
let anyStable = 0, minSe = Infinity;
for (let h=0; h<=20; h++) for (let f=0; f<=12; f++) {
  const r = computeSdt({hits:h, misses:20-h, falseAlarms:f, correctRejections:12-f});
  if (r.d_prime_se != null) { minSe = Math.min(minSe, r.d_prime_se); if (!r.d_prime_unstable) anyStable++; }
}
console.log('20go/12nogo: min SE =', minSe.toFixed(4), ' cells with unstable=false:', anyStable, '/ 273');

// 4. app vs model d' at operating point
const app = computeSdt({hits:19, misses:1, falseAlarms:1, correctRejections:11});
console.log('app  H=0.95 F=0.0833 -> d\'=', app.d_prime?.toFixed(4), 'SE=', app.d_prime_se?.toFixed(4));
console.log('model dPrimeSe(32,0.625,0.95,0.0833) =', dPrimeSe(32,0.625,0.95,1/12).toFixed(4));
console.log('model dPrimeSe(32,0.625) default    =', dPrimeSe(32,0.625).toFixed(4));

// 5. rt block seconds: model vs truth
console.log('model rtBlockSeconds(32) =', rtBlockSeconds(32).toFixed(2));
const fix=400, delTrue=617.5, iti=400, meanRt=360;
const go=20*(fix+delTrue+meanRt+iti), no=12*(fix+delTrue+CONFIG.RT_RESPONSE_WINDOW_MS+iti);
console.log('true  rtBlockSeconds(32) =', ((go+no)/1000).toFixed(2));
