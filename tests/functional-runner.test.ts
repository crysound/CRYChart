import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const {parseOptions,currentContracts,canReuseCurrentSpecialized}=await import(pathToFileURL(resolve('scripts/test-official-functional-visible.mjs')).href);
const {bindCurrentReports}=await import(pathToFileURL(resolve('scripts/run-functional.mjs')).href);
const {projectFunctionalReport}=await import(pathToFileURL(resolve('scripts/write-functional-report.mjs')).href);
const fixture=()=>({examples:[{id:'crychart-example-0000-lineSeries',specializedEvidence:[{path:'old-pass.json'}],specializedSourceExclusions:[{path:'src/chart.ts'}]}]});

test('only complete current specialized cases without any legacy requirements avoid duplicate mounting',()=>{
  const contract={id:'crychart-example-9999-specialized',legacyChecks:[],specializedEvidence:[{path:'current.json'}],contractReviewed:true,
    requirements:[{id:'values',required:true,checkNames:['value']},{id:'lifecycle',required:true,checkNames:['dispose']}],
    validationDimensions:{mount:['mount'],data:['value'],interaction:['interact'],lifecycle:['dispose']}};
  const checks=['mount','value','interact','dispose'].map(name=>({name,status:'passed'}));
  const evidence={checks,attempts:checks,diagnostics:[{eligible:true}],unresolvedBlockingErrors:[]};
  const session={currentRun:true,sessionId:'current',contractSessionId:'current',fresh:true};
  assert.equal(canReuseCurrentSpecialized(contract,evidence,session),true);
  assert.equal(canReuseCurrentSpecialized({...contract,legacyChecks:['legend swatches update']},evidence,session),false);
  for(const change of [{fresh:false},{currentRun:false},{sessionId:'old'},{contractSessionId:undefined}])
    assert.equal(canReuseCurrentSpecialized(contract,evidence,{...session,...change}),false);
  assert.equal(canReuseCurrentSpecialized(contract,{...evidence,checks:checks.filter(c=>c.name!=='interact')},session),false);
  assert.equal(canReuseCurrentSpecialized(contract,{...evidence,checks:checks.map(c=>c.name==='value'?{...c,status:'failed'}:c)},session),false);
  assert.equal(canReuseCurrentSpecialized(contract,{...evidence,attempts:[...checks,{name:'value',status:'failed'}]},session),false);
  assert.equal(canReuseCurrentSpecialized(contract,{...evidence,diagnostics:[{eligible:false}]},session),false);
  assert.equal(canReuseCurrentSpecialized(contract,{...evidence,unresolvedBlockingErrors:[{error:'runtime'}]},session),false);
  assert.equal(canReuseCurrentSpecialized(contract,evidence,session,{id:contract.id,errors:['live failure']}),false);
});

test('fresh functional acceptance removes historical reports and source exceptions by default',()=>{
  const input=fixture(),options=parseOptions([]),result=currentContracts(input,options);
  assert.equal(options.fresh,true);
  assert.deepEqual(result.examples[0].specializedEvidence,[]);
  assert.deepEqual(result.examples[0].specializedSourceExclusions,[]);
  assert.equal(input.examples[0].specializedEvidence.length,1,'The source contract is not mutated');
  assert.equal(currentContracts(input,parseOptions(['--allow-historical-evidence'])).examples[0].specializedEvidence.length,1);
});

test('published current acceptance cannot inherit old passes or promote contradictory failures',()=>{
  const previous={cases:[{id:'first',title:'第一项',status:'passed',functionalComplete:true},{id:'second',title:'第二项',status:'passed',functionalComplete:true}],history:{functionallyComplete:2}};
  const report={kind:'official-functional-visible',identity:{sessionId:'current',bundleSHA256:'a'.repeat(64)},cases:[{id:'first',status:'failed',functionalComplete:true}],finishedAt:'2026-11-10'};
  const result=projectFunctionalReport(previous,report,'current/report.json');
  assert.equal(result.functionallyComplete,0);
  assert.equal(result.failed,1);
  assert.equal(result.cases[1].status,'pending');
  assert.equal(result.history.functionallyComplete,2);
  assert.throws(()=>projectFunctionalReport(previous,{...report,cases:[...report.cases,...report.cases]},'x'),/重复/);
  assert.throws(()=>projectFunctionalReport(previous,{...report,cases:[{id:'unknown'}]},'x'),/未知/);
});

test('a current contract cohort must match the explicitly selected execution session',()=>{
  const input={...fixture(),currentRun:true,sessionId:'new-run'};
  assert.equal(currentContracts(input,{fresh:true,sessionId:'new-run'}).examples[0].specializedEvidence.length,1);
  assert.equal(currentContracts(input,{fresh:true,sessionId:'another-run'}).examples[0].specializedEvidence.length,0);
  assert.equal(currentContracts(input,{fresh:true}).examples[0].specializedEvidence.length,0);
});

test('current report binding rejects stale or changed files and only assigns exact case checks',async()=>{
  const report={sessionId:'new-run',bundleSHA256:'a'.repeat(64),checks:[{id:'0000',name:'value',status:'passed'}]};
  const bytes=Buffer.from(JSON.stringify(report)),descriptor={path:'memory-only.json',sha256:createHash('sha256').update(bytes).digest('hex'),bundleSHA256:report.bundleSHA256};
  const options={sessionId:'new-run',startedAt:100,read:async()=>bytes,metadata:async()=>({mtimeMs:101})};
  const input={examples:[...fixture().examples,{id:'crychart-example-0001-simpleScatter',specializedEvidence:[]}]};
  const bound=await bindCurrentReports(input,[descriptor],options);
  assert.equal(bound.examples[0].specializedEvidence.length,1);
  assert.equal(bound.examples[1].specializedEvidence.length,0);
  assert.deepEqual(bound.examples[0].specializedSourceExclusions,[]);
  await assert.rejects(bindCurrentReports(input,[descriptor],{...options,metadata:async()=>({mtimeMs:99})}),/本轮/);
  await assert.rejects(bindCurrentReports(input,[descriptor],{...options,sessionId:'another-run'}),/会话/);
  await assert.rejects(bindCurrentReports(input,[{...descriptor,sha256:'b'.repeat(64)}],options),/指纹/);
  await assert.rejects(bindCurrentReports(input,[{...descriptor,bundleSHA256:'b'.repeat(64)}],options),/构建指纹/);
});
