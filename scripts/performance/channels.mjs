import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {summarizeRounds,historicalRatios} from './protocol.mjs';

export function summarize(values){
  const ordered=values.filter(Number.isFinite).sort((a,b)=>a-b),at=p=>ordered[Math.max(0,Math.ceil(ordered.length*p)-1)]??null;
  return{samples:ordered.length,min:ordered[0]??null,p50:at(.5),p95:at(.95),p99:at(.99),max:ordered.at(-1)??null};
}
export function channelConfiguration(profile,channels){
  assert.ok(['full','quick'].includes(profile));assert.ok([64,128].includes(channels));
  return{channels,sampleRate:48000,batchSize:960,historySeconds:profile==='full'?15:1,warmupFrames:profile==='full'?30:2,measureFrames:profile==='full'?128:4,repeats:profile==='full'?3:1,lineWidth:2,rawStorage:'Float64Array',renderStorage:'Float64Array',columnStorage:'independent-dense',x:'automatic',yLayout:'independent-stacks',experimentalOptions:{}};
}
export function compareHistorical(scenario,baseline,profile){
  const differences=[],protocol=baseline?.protocol;
  if(!protocol)differences.push('缺少对应历史负载协议');
  if(profile!=='full')differences.push('快速模式不是完整历史负载');
  if(scenario.rounds.length!==scenario.config.repeats||scenario.rounds.some(round=>round.frames?.length!==scenario.config.measureFrames||round.warmup?.length!==scenario.config.warmupFrames))differences.push('实际完整轮次、暖帧或测量帧数量不符合协议');
  if(protocol){
    for(const key of ['channels','sampleRate','batchSize','historySeconds','rawStorage','renderStorage','columnStorage','x','yLayout','warmupFrames','measureFrames','repeats'])if(scenario.config[key]!==protocol[key])differences.push(`${key}与历史协议不同`);
    if(scenario.config.lineWidth!==protocol.lineWidthCSSPx)differences.push('线宽与历史协议不同');
    for(const [index,round]of scenario.rounds.entries()){
      const env=round.environment;
      if(!env){differences.push(`第${index+1}轮缺少实际环境`);continue;}
      for(const key of ['width','height']){
        if(Math.abs(env.container[key]-protocol.containerCSS?.[key])>.5)differences.push(`第${index+1}轮容器${key}不同`);
        if(Math.abs(env.plot[key]-protocol.plotCSS?.[key])>.5)differences.push(`第${index+1}轮绘图区${key}不同`);
      }
      if(!Number.isFinite(protocol.dpr))differences.push('历史DPR未在基准清单中声明，不能证明一致');
      else if(env.devicePixelRatio!==protocol.dpr)differences.push(`第${index+1}轮DPR不同`);
    }
    if(typeof protocol.experimentalOptions!=='object'||protocol.experimentalOptions===null)differences.push('历史实验选项未结构化绑定，不能与当前默认选项视为一致');
    else if(JSON.stringify(protocol.experimentalOptions)!==JSON.stringify(scenario.config.experimentalOptions))differences.push('实验选项与历史协议不同');
  }
  const eligible=differences.length===0&&scenario.status==='passed';
  const metrics=Object.fromEntries(Object.entries(baseline?.metrics??{}).map(([name,entry])=>[name,{unit:name==='uploadedBytes'?'B':'ms',aggregation:'median-of-round-quantiles',
    current:scenario.medianOfRoundPercentiles[name]??null,historicalCandidate:entry.candidate,historicalReference:entry.reference,
    ratios:eligible?historicalRatios(scenario.medianOfRoundPercentiles[name],entry,{protocolMatches:true,profile,aggregation:'median-of-round-quantiles',unit:name==='uploadedBytes'?'B':'ms'}).ratios:null}]));
  return{eligible,currentPairedComparison:false,differences:[...new Set(differences)],metrics,qualification:'仅在已声明的负载协议匹配时提供历史静态比值；无同轮对照执行，历史比值不是性能验收。'};
}
export async function runChannels({page,baseURL,directory,bundleSHA256,sessionId,profile='full',baselines}){
  const target=resolve(directory,'channels');await mkdir(target,{recursive:true});
  const report={kind:'crychart-channels-performance',sessionId,bundleSHA256,profile,startedAt:new Date().toISOString(),status:'running',scenarios:[],errors:[],
    performanceAcceptance:'unverified',baselineReference:baselines??null,currentPairedComparison:false,sustainedRealtimeClaim:false,
    qualifications:['当前CRYChart单库测量；历史数据仅为静态参照，没有本轮对照库配对。','20毫秒为每批名义数据跨度；按实际绘制完成逐批推进，不证明墙钟持续吞吐。','单像素readPixels同步等待与GPU查询区间分别记录，不得相加解释为端到端延迟。','GL buffer为标准API申请跟踪，不含纹理、驱动和完整显存；JS堆为帧边界采样，不代表RSS或连续峰值。','探针包装标准API会产生测量开销；预填、输入生成和完整源值核对不计入稳态计时。']};
  const save=()=>writeFile(resolve(target,'report.json'),JSON.stringify(report,null,2)+'\n');
  const pageErrors=[];const onError=error=>pageErrors.push(String(error));page.on('pageerror',onError);
  try{
    for(const channels of [64,128]){
      const config=channelConfiguration(profile,channels),scenario={id:`B${channels}`,config,rounds:[],status:'running'};report.scenarios.push(scenario);
      for(let repeat=0;repeat<config.repeats;repeat++){
        const errorsBefore=pageErrors.length;
        const url=new URL('/scripts/performance/fixture.html',baseURL);url.searchParams.set('fixture','channels');url.searchParams.set('round',`${channels}-${repeat}-${sessionId}`);
        await page.goto(url.href,{waitUntil:'load'});await page.waitForFunction(()=>typeof window.__CRY_CHANNEL_PERF__?.runRound==='function');
        const response=await page.request.get(new URL('/dist/crychart.js',baseURL).href);assert.ok(response.ok());
        assert.equal(createHash('sha256').update(await response.body()).digest('hex'),bundleSHA256,'服务构建与本轮绑定不符');
        const round=await page.evaluate(config=>window.__CRY_CHANNEL_PERF__.runRound(config),config);round.repeat=repeat;
        round.pageErrors=pageErrors.slice(errorsBefore);if(round.pageErrors.length)round.status='failed';scenario.rounds.push(round);
        await writeFile(resolve(target,`B${channels}-round-${repeat+1}.json`),JSON.stringify(round,null,2)+'\n');await save();
      }
      const rows=scenario.rounds.flatMap(r=>r.frames),metrics=['mutationMs','callbackCpuMs','syncWaitMs','workMs','requestLatencyMs','activeWorkMs','uploadedBytes'];
      scenario.summary=Object.fromEntries(metrics.map(name=>[name,summarize(rows.map(row=>row[name]))]));
      scenario.summary.gpuElapsedMs=summarize(rows.filter(row=>row.gpuTimer?.status==='available').map(row=>row.gpuTimer.elapsedMs));
      scenario.pooledSummary=scenario.summary;
      scenario.roundSummaries=scenario.rounds.map(round=>({repeat:round.repeat,...Object.fromEntries(metrics.map(name=>[name,summarize(round.frames.map(row=>row[name]))])),gpuElapsedMs:summarize(round.frames.filter(row=>row.gpuTimer?.status==='available').map(row=>row.gpuTimer.elapsedMs))}));
      scenario.medianOfRoundPercentiles=Object.fromEntries([...metrics,'gpuElapsedMs'].map(name=>[name,summarizeRounds(scenario.rounds.map(round=>round.frames.map(row=>({...row,gpuElapsedMs:row.gpuTimer?.status==='available'?row.gpuTimer.elapsedMs:null}))),name).medianOfRoundQuantiles]));
      scenario.metrics=scenario.medianOfRoundPercentiles;
      scenario.aggregationQualification='pooledSummary汇总全部测量帧；medianOfRoundPercentiles先逐轮算分位数，再取各轮分位数的中位数。两种结果分别保留，不混用。';
      scenario.retainedMeasurementFrames=rows.length;scenario.expectedMeasurementFrames=config.repeats*config.measureFrames;
      scenario.status=scenario.rounds.every(r=>r.status==='passed')&&rows.length===scenario.expectedMeasurementFrames?'passed':'failed';
      scenario.historicalComparison=compareHistorical(scenario,baselines?.scenarios?.[scenario.id],profile);
      scenario.comparability={historicalProtocolEligible:scenario.historicalComparison.eligible,currentPairedComparison:false,experimentalOptionsMatch:'未宣称一致，当前使用默认产品选项',
        actualEnvironments:scenario.rounds.map(r=>r.environment),historicalContainerCSS:{width:1000,height:600},historicalPlotCSS:{width:800,height:420},
        differences:profile==='quick'?['快速模式仅验证执行链，不符合历史负载协议']:['当前构建、设备、DPR及默认优化选项应按实际记录与历史分别核对；不可宣称同轮配对']};
      await save();
    }
    report.status=report.scenarios.every(s=>s.status==='passed')?'passed':'failed';
    report.functionalStatus=report.status;report.performanceAcceptance='unverified';
  }catch(error){report.status='failed';report.errors.push({message:error.message,stack:error.stack});}
  finally{page.off('pageerror',onError);report.finishedAt=new Date().toISOString();await save();}
  return report;
}
