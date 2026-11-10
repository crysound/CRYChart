import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromeEndpoint} from '../visible-browser.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const resourceJobs=[
  {id:'capacity-f64-128-60-12',script:'scripts/test-paged-capacity-visible.mjs',parameters:{channels:128,history:60,visible:1,roll:12,storage:'f64',layout:'stacked','max-backing-mib':6144,'gc-every':6},expected:{channels:128,retainedPerChannel:2880000,advancedDataSeconds:72}},
  {id:'capacity-f32-shared-128-60-120',script:'scripts/test-paged-capacity-visible.mjs',parameters:{channels:128,history:60,visible:1,roll:120,storage:'f32',layout:'shared','max-backing-mib':6144,'gc-every':10},expected:{channels:128,retainedPerChannel:2880000,advancedDataSeconds:180}},
  {id:'memory-eight-cycles',script:'examples/channel-lab/test-memory-visible.mjs',parameters:{},expected:{cycles:8,channels:128,retainedPerChannel:48000}},
  {id:'paged-six-lifecycles',script:'scripts/test-paged-coverage-lifecycle-visible.mjs',parameters:{iterations:3},expected:{cycles:6,channels:128,retainedPerChannel:48000}},
];

export async function runResources({baseURL,directory,bundleSHA256,sessionId,profile='full'}) {
  assert.ok(['full','quick'].includes(profile));
  const library=resolve(root,'dist/crychart.js');
  assert.equal(hash(await readFile(library)),bundleSHA256,'资源测试必须使用本轮固定构建');
  const output=resolve(directory,'resources');await mkdir(output,{recursive:true});
  const cases=[],full=profile==='full';
  const jobs=full?resourceJobs:[{id:'capacity-quick-smoke',script:'scripts/test-paged-capacity-visible.mjs',parameters:{channels:4,history:1,visible:1,roll:1,storage:'f32',layout:'shared','max-backing-mib':4096},expected:{channels:4,retainedPerChannel:48000,advancedDataSeconds:2}}];
  const report={kind:'crychart-resource-verification',sessionId,profile,fullCoverage:full,bundleSHA256,startedAt:new Date().toISOString(),cases,
    qualifications:{dataIntegrity:'每通道逐值校验完整保留的原始列和渲染列；自动时间列检查覆盖范围与运算参数',dataTime:'容量测试按批次加速推进数据时间，不是持续实时吞吐',resources:'V8堆、backing storage、自有数值数组、GL分配计数与浏览器进程采样分层记录；不是GPU物理驻留量',realtimeThroughputAcceptance:'not-assessed',wholeProcessLongTermStability:'not-assessed',performanceBaselineComparison:'not-configured',quick:full?undefined:'仅小规模冒烟；完整128通道和8/6轮生命周期未执行'},
    notExecuted:full?[]:resourceJobs.map(job=>({id:job.id,reason:'quick-profile-not-full'}))};
  const save=()=>writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  for(const job of jobs){
    const jobDirectory=resolve(output,job.id);await mkdir(jobDirectory); // no stale-report reuse
    const parameters={...job.parameters,library,out:jobDirectory,'base-url':baseURL};
    if(job.id==='paged-six-lifecycles')parameters.sha256=bundleSHA256;
    const command=[resolve(root,job.script),...Object.entries(parameters).map(([key,value])=>`--${key}=${value}`)];
    const record={id:job.id,parameters:job.parameters,expected:job.expected,command,startedAt:new Date().toISOString(),status:'running'};cases.push(record);await save();
    console.log(`资源检查：${job.id}`);
    const log=createWriteStream(resolve(jobDirectory,'execution.log'));
    try{
      const result=await new Promise((done,reject)=>{
        const child=spawn(process.execPath,command,{cwd:root,windowsHide:true,env:{...process.env,CRYCHART_CDP:chromeEndpoint,CRYCHART_PERFORMANCE_SESSION_ID:sessionId},stdio:['ignore','pipe','pipe']});
        child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
        let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},30*60_000);
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('close',(code,signal)=>{clearTimeout(timer);done({code,signal,timedOut});});
      });
      Object.assign(record,result);
      const path=resolve(jobDirectory,'report.json'),bytes=await readFile(path),resultReport=JSON.parse(bytes);
      record.reportPath=path;record.reportSHA256=hash(bytes);record.resourceLayers=resultReport.resourceLayers;
      assert.equal(resultReport.sessionId,sessionId,'资源报告会话不匹配');
      assert.equal(resultReport.coreSHA256??resultReport.bundleSHA256,bundleSHA256,'资源报告构建不匹配');
      assert.equal(result.code,0,'资源子测试退出失败');assert.equal(result.timedOut,false);assert.equal(resultReport.passed,true,'资源子测试断言未全部通过');
      if(job.expected.advancedDataSeconds){
        assert.equal(resultReport.validation.length,job.expected.channels);
        assert.ok(resultReport.validation.every(value=>value.count===job.expected.retainedPerChannel&&value.rawAndRenderExact===true));
        assert.equal(resultReport.samples.at(-1).dataSeconds,job.expected.advancedDataSeconds);
        record.checks={validatedChannels:resultReport.validation.length,retainedSamples:job.expected.channels*job.expected.retainedPerChannel,advancedDataSeconds:resultReport.samples.at(-1).dataSeconds,fullRawAndRenderExact:true};
      }else{
        const passedCycles=resultReport.summary.cyclesPassed??resultReport.summary.passedCycles;
        assert.equal(passedCycles,job.expected.cycles);record.checks={passedCycles};
      }
      record.status='passed';
    }catch(error){record.status='failed';record.error=String(error.stack??error);}
    finally{log.end();record.finishedAt=new Date().toISOString();await save();}
    assert.equal(hash(await readFile(library)),bundleSHA256,'运行期间库构建发生变化');
  }
  report.finishedAt=new Date().toISOString();report.status=cases.every(value=>value.status==='passed')?'passed':'failed';
  report.reportPath=resolve(output,'report.json');await save();return report;
}
