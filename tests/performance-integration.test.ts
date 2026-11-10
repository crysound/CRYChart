import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const runner=await import(pathToFileURL(resolve('scripts/run-performance.mjs')).href);
const {evaluateLimits}=await import(pathToFileURL(resolve('scripts/performance/protocol.mjs')).href);

test('performance entry defaults to all five full groups and rejects ambiguous selection',()=>{
  assert.deepEqual(runner.parsePerformanceOptions([]).groups,runner.GROUPS);
  assert.equal(runner.parsePerformanceOptions([]).profile,'full');
  assert.equal(runner.parsePerformanceOptions(['--quick']).profile,'quick');
  assert.throws(()=>runner.parsePerformanceOptions(['--groups','channels,channels']));
  assert.throws(()=>runner.parsePerformanceOptions(['--groups','unknown']));
});

test('performance metrics keep units, missing values and distinct aggregation identities',()=>{
  const metrics=runner.collectPerformanceMetrics([
    {id:'channels',profile:'full',report:{scenarios:[{id:'B64',metrics:{workMs:{p95:12},gpuElapsedMs:{p95:null},uploadedBytes:{p95:16000}},pooledSummary:{workMs:{p95:18}},rounds:[{frames:[{memory:{usedJSHeapSize:100}},{memory:{usedJSHeapSize:200}}]}]}]}},
    {id:'storage',report:{benchmarkReport:{rows:[{memoryAfterFill:{rss:123,arrayBuffers:55},warmSamplesPerSecondDuringAppend:4000}]}}},
    {id:'resources',report:{cases:[{id:'capacity',measurements:{summary:{maximumBytes:77,mystery:8}}}]}}
  ]);
  assert.deepEqual({value:metrics['B64.workMs.p95'].value,unit:metrics['B64.workMs.p95'].unit},{value:12,unit:'ms'});
  assert.equal(metrics['B64.pooled.workMs.p95'].value,18);
  assert.equal(metrics['B64.uploadedBytes.p95'].unit,'B');
  assert.equal(metrics['B64.gpuElapsedMs.p95'].value,null);
  assert.equal(evaluateLimits(metrics,{'B64.gpuElapsedMs.p95':{max:10,unit:'ms'}}).status,'unavailable');
  assert.equal(metrics['storage.rounds.0.memoryAfterFill.rss'].unit,'B');
  assert.equal(metrics['storage.rounds.0.warmSamplesPerSecondDuringAppend'].unit,'samples/s');
  assert.equal(metrics['resources.capacity.summary.maximumBytes'].value,77);
  assert.equal(metrics['resources.capacity.summary.mystery'],undefined);
  assert.equal(runner.measurementUnit('mystery'),undefined);
});

test('performance comparison summary retains each channel eligibility and history',()=>{
  const result=runner.collectPerformanceComparisons([{id:'channels',report:{scenarios:[{id:'B64',historicalComparison:{eligible:false,differences:['DPR'],metrics:{workMs:{current:{p95:12}}}}}]}}]);
  assert.equal(result.channels.scenarios[0].id,'B64');
  assert.equal(result.channels.scenarios[0].eligible,false);
  assert.deepEqual(result.channels.scenarios[0].differences,['DPR']);
  assert.equal(result.channels.scenarios[0].metrics.workMs.current.p95,12);
});

test('performance source binding detects changed and missing execution bytes',async()=>{
  const original=Buffer.from('original'),digest=createHash('sha256').update(original).digest('hex');
  assert.equal((await runner.verifySourceHashes({fixture:digest},async()=>original)).status,'passed');
  const changed=await runner.verifySourceHashes({fixture:digest},async()=>Buffer.from('changed'));
  assert.equal(changed.status,'failed');assert.equal(changed.differences[0].path,'fixture');
  assert.equal((await runner.verifySourceHashes({fixture:digest},async()=>{throw new Error('missing');})).status,'failed');
});
