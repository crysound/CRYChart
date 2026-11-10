import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {summarizeSamples,summarizeRounds,historicalRatios,evaluateLimits,evaluateCompleteness,evaluatePerformance,REQUIRED_GROUPS,RESOURCE_CASES}=await import(pathToFileURL(resolve('scripts/performance/protocol.mjs')).href);

test('missing performance samples remain null and raw samples retain tail outliers',()=>{
  assert.equal(summarizeSamples([null,undefined,NaN,Infinity]).p95,null);
  assert.equal(summarizeSamples([null,0,1,1000]).max,1000);
  assert.equal(summarizeSamples([null,0,1,1000]).unavailableCount,1);
  assert.equal(summarizeSamples([0]).p50,0);
});

test('round quantile medians never impersonate pooled raw-frame quantiles',()=>{
  const result=summarizeRounds([[1],[100,100,100,100,100,100,100,100,100],[2]]);
  assert.equal(result.medianOfRoundQuantiles.p95,2);
  assert.equal(result.pooledFrames.p95,100);
  assert.equal(result.medianOfRoundQuantiles.aggregation,'median-of-round-quantiles');
  assert.throws(()=>summarizeRounds([{p95:1},{p95:2}]),/原始帧/);
  assert.equal(summarizeRounds([[1],[]]).medianOfRoundQuantiles.p95,null);
});

test('historical ratios require matching profile unit protocol and statistic without awarding acceptance',()=>{
  const baseline={unit:'ms',aggregation:'median-of-round-quantiles',candidate:{p50:4,p95:8},reference:null};
  const options={unit:'ms',aggregation:'median-of-round-quantiles',profile:'full',protocolMatches:true};
  const result=historicalRatios({p50:2,p95:16},baseline,options);
  assert.equal(result.ratios.candidate.p95,2);
  assert.equal(result.ratios.reference.p95,null);
  assert.equal(result.performanceAcceptance,'unconfigured');
  for(const change of [{profile:'quick'},{protocolMatches:false},{unit:'B'},{aggregation:'pooled-raw-samples'}])
    assert.equal(historicalRatios({p95:1},baseline,{...options,...change}).ratios.candidate.p95,null);
  assert.equal(historicalRatios({p95:1},{...baseline,candidate:{p95:0}},options).status,'unavailable');
});

test('explicit limits fail on excess missing measurements and unit mismatch; no limits are unconfigured',()=>{
  const limits={'B64.workMs.p95':{max:20,unit:'ms'}};
  assert.equal(evaluateLimits({},undefined).status,'unconfigured');
  assert.equal(evaluateLimits({},{}).status,'unconfigured');
  assert.equal(evaluateLimits({'B64.workMs.p95':{value:20,unit:'ms'}},limits).status,'passed');
  assert.equal(evaluateLimits({'B64.workMs.p95':{value:21,unit:'ms'}},limits).exitCode,1);
  assert.equal(evaluateLimits({'B64.workMs.p95':{value:null,unit:'ms'}},limits).status,'unavailable');
  assert.equal(evaluateLimits({'B64.workMs.p95':{value:1,unit:'B'}},limits).status,'unavailable');
  assert.throws(()=>evaluateLimits({}, {x:{max:Infinity,unit:'ms'}}));
  assert.throws(()=>evaluateLimits({}, 3));
});

function fullGroups(): any[]{
  const round=()=>({status:'passed',frames:Array.from({length:128},()=>({workMs:1}))});
  const channels={scenarios:['B64','B128'].map(id=>({id,status:'passed',rounds:[round(),round(),round()]}))};
  const monitoring=(mode:string)=>({runs:['ordinary','highPrecision'].flatMap(id=>
    (mode==='short'?[28,60]:[0]).map(seed=>({configuration:{id,seedSamples:seed*48000},
      completedAt:'2026-11-10',fullDurationMs:600001,
      checkpoints:(mode==='short'?[1200]:[60000,300000,600000]).map(requestedCheckpointMs=>({requestedCheckpointMs,windowDurationMs:6000}))}))) });
  const reports: Record<string,unknown>={channels,'monitoring-short':monitoring('short'),'monitoring-soak':monitoring('soak'),resources:{cases:RESOURCE_CASES.map((id:string)=>({id,status:'passed'}))},storage:{}};
  return REQUIRED_GROUPS.map((id:string)=>({id,profile:'full',status:'passed',report:reports[id]}));
}

test('complete performance protocol without configured thresholds has no performance PASS claim',()=>{
  const result=evaluatePerformance({profile:'full',groups:fullGroups()});
  assert.equal(result.exitCode,0);assert.equal(result.protocolCompleteness.fullCoverage,true);
  assert.equal(result.performanceAcceptance,'unconfigured');
});

test('subset quick missing resource case short soak and missing raw frames cannot pass full coverage',()=>{
  const scenarios=[fullGroups().slice(0,4),fullGroups().map(g=>({...g,profile:'quick'})),fullGroups(),fullGroups(),fullGroups()];
  scenarios[2]!.find(g=>g.id==='resources').report.cases.pop();
  scenarios[3]!.find(g=>g.id==='monitoring-soak').report.runs[0].fullDurationMs=599999;
  scenarios[4]!.find(g=>g.id==='channels').report.scenarios[0].rounds[0].frames.pop();
  for(const groups of scenarios){const result=evaluateCompleteness({profile:'full',groups});assert.equal(result.status,'partial');assert.equal(result.exitCode,1);}
  assert.equal(evaluateCompleteness({profile:'quick',groups:scenarios[1]}).fullCoverage,false);
  const failed=fullGroups();failed[0]!.status='failed';assert.equal(evaluateCompleteness({profile:'full',groups:failed}).status,'failed');
  assert.equal(evaluateCompleteness({profile:'full',groups:[...fullGroups(),fullGroups()[0]]}).exitCode,1);
  assert.equal(evaluatePerformance({profile:'full',groups:fullGroups().slice(0,1),metrics:{x:{value:1,unit:'ms'}},limits:{x:{max:2,unit:'ms'}}}).performanceAcceptance,'unverified');
});
