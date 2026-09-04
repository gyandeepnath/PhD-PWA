import { computeSdt } from '/home/user/PhD-PWA/src/lib/signalDetection';
console.log('all no-go anticipated:', JSON.stringify(computeSdt({hits:18,misses:2,falseAlarms:0,correctRejections:0})));
console.log('all go anticipated  :', JSON.stringify(computeSdt({hits:0,misses:0,falseAlarms:3,correctRejections:9})));
console.log('block never ran     :', JSON.stringify(computeSdt({hits:0,misses:0,falseAlarms:0,correctRejections:0})));
