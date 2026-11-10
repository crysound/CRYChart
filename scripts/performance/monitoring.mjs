import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export function distribution(values){const v=values.filter(Number.isFinite).sort((a,b)=>a-b),n=v.length;return{count:n,p50:n?(v[Math.floor((n-1)/2)]+v[Math.ceil((n-1)/2)])/2:null,p95:n?v[Math.ceil(n*.95)-1]:null,p99:n?v[Math.ceil(n*.99)-1]:null,max:n?v[n-1]:null};}
export function queueTrend(samples,key='batches'){
  if(samples.length<2)return null;const origin=samples[0].atMs;let sx=0,sy=0,sxx=0,sxy=0;
  for(const s of samples){const x=(s.atMs-origin)/1000,y=s[key];sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
  const n=samples.length,den=n*sxx-sx*sx;return den?(n*sxy-sx*sy)/den:0;
}
function summarize(raw,pointer=[]){return{...Object.fromEntries(Object.entries(raw.metrics).map(([key,rows])=>[key,distribution(rows.map(x=>x.value))])),pointerMs:distribution(pointer.map(x=>x.eventToHandlerMs)),pointerToRafMs:distribution(pointer.map(x=>x.handlerToRafMs)),
  longTasks:Array.isArray(raw.longTasks)?{count:raw.longTasks.length,totalMs:raw.longTasks.reduce((n,t)=>n+t.durationMs,0),maxMs:Math.max(0,...raw.longTasks.map(x=>x.durationMs))}:null,
  longTaskDiagnostic:raw.longTaskDiagnostic??{status:'unverified'},diagnosticUnavailable:raw.diagnosticUnavailable??[],
  queue:{currentBatches:raw.snapshot.queue?.batches,currentSamples:raw.snapshot.queue?.samples,observedPeakBatches:Math.max(0,...raw.queue.map(x=>x.batches)),observedPeakSamples:Math.max(0,...raw.queue.map(x=>x.samples)),slopeBatchesPerSecond:queueTrend(raw.queue),slopeSamplesPerSecond:queueTrend(raw.queue,'samples'),sampleCount:raw.queue.length}};}
function verifySnapshot(s,config){
  assert.equal(s.charts.length,9);assert.equal(s.dpr,1.75);assert.equal(s.visibility,'visible');assert.equal(s.errors.length,0,s.errors.join('\n'));
  for(let i=0;i<9;i++){assert.equal(s.charts[i].axisType,i===2?'linear':config.axisType);assert.ok(Math.abs(s.charts[i].container.width-463)<1);assert.ok(Math.abs(s.charts[i].container.height-119.5535736084)<1);assert.ok(Math.abs(s.charts[i].plot.width-(i===1?347:352))<1);assert.ok(Math.abs(s.charts[i].plot.height-52.5535736084)<1);}
  for(const lines of s.history){assert.equal(lines.length,2);for(const line of lines){assert.equal(line.next,s.seedSamples+s.ingestedSamplesPerChannel);assert.equal(line.count,Math.min(line.next,2880000));assert.equal(line.capacity,2880000);assert.deepEqual(line.mapping,{x:'xValues',y:'renderYValues'});assert.equal(line.rawRenderBuffersIndependent,true);assert.deepEqual(line.storage,{x:'Float64Array',raw:'Float32Array',render:'Float32Array'});}}
  for(const line of s.scope)assert.equal(line.count,9600);
}
async function pointerSamples(page,cdp){await page.evaluate(()=>window.__CRY_MONITOR__.armPointer());for(let i=0;i<24;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:100+i*10,y:70+i%3*10,timestamp:Date.now()/1000});await page.waitForTimeout(20);}await page.waitForTimeout(100);return page.evaluate(()=>window.__CRY_MONITOR__.finishPointer());}
export function compareHistoricalScope({baseline,profile,mode,config,seconds,summary}){
  const reasons=[];
  if(!baseline)reasons.push('没有BScope历史基准');
  if(profile!=='full'||mode!=='short')reasons.push('仅完整短测窗口符合历史统计口径');
  if(config.axisType!=='linear-highPrecision'||config.strokeWidth!==1||seconds!==60)reasons.push('历史汇总仅对应高精度轴、1px、60秒预填');
  const p=baseline?.protocol;
  if(p&&(p.axisType!==config.axisType||p.lineWidthCSSPx!==config.strokeWidth||p.summaryPrefillSeconds!==seconds||p.dpr!==1.75||p.workerBatchMs!==20||p.sampleRate!==48000||p.historyCharts!==2||p.channelsPerHistoryChart!==2||p.scopePointsPerFrame!==19200||p.smallCharts!==6))reasons.push('历史负载协议字段与当前配置不一致');
  if(reasons.length)return{status:'not-comparable',reasons};
  const ratios={};
  for(const key of ['rafMs','pointerMs','scopeSubmitMs']){
    const metric=baseline.metrics?.[key];
    if(metric?.unit!=='ms'||metric.aggregation!=='single-window-quantiles')return{status:'not-comparable',reasons:[`${key}历史单位或统计口径不符`]};
    ratios[key]=Object.fromEntries(['p50','p95'].map(q=>[q,{currentMs:summary[key][q],historicalMs:metric.candidate[q],currentOverHistorical:metric.candidate[q]>0&&Number.isFinite(summary[key][q])?summary[key][q]/metric.candidate[q]:null}]));
  }
  return{status:'historical-ratios-only',ratios,historicalBuildSHA256:baseline.historicalBuildSHA256,historicalBrowser:p.browser,currentPairedComparison:false,qualification:'当前值除以历史值；环境及浏览器版本另列，不是同轮配对或性能验收'};
}
export async function runMonitoring({page,cdp,baseURL,directory:outputRoot,bundleSHA256,sessionId,profile='full',baselines,mode='short',axisProfile='all'}){
  assert.ok(['full','quick'].includes(profile));assert.ok(['short','soak'].includes(mode));assert.ok(['all','ordinary','highPrecision'].includes(axisProfile));
  const directory=join(outputRoot,`monitoring-${mode}`);
  await mkdir(directory,{recursive:true});
  const report={kind:'crychart-monitoring',sessionId,bundleSHA256,profile,mode,startedAt:new Date().toISOString(),status:'running',performanceAcceptance:'unverified',runs:[],errors:[],
    protocol:{chartCount:9,historyCharts:2,activeChannelsPerHistory:2,sampleRateHz:48000,capacityPerChannel:2880000,workerIntervalMs:20,workerPayload:'progress-metadata-only',columns:{x:'Float64Array',raw:'Float32Array',render:'Float32Array',independentRawAndRender:true},scope:{channels:2,frameSamplesPerChannel:9600,replacement:'跨过9600样本边界时替换最新完整帧'},smallCharts:6,containerCSS:{width:463,height:119.5535736084},historyPlotCSS:{widths:[352,347],height:52.5535736084},dpr:1.75},
    baselineComparison:{status:'not-computed',reason:'历史基准只允许同协议明确比值；本驱动不设隐含性能门槛',provided:Boolean(baselines)},qualification:'CPU提交和受控Worker消息延迟；不代表GPU完成、真实采集或屏幕延迟。监视流验证批次序号、摄入计数和独立存储，不宣称逐值检查；逐值核验由channels和资源场景承担。六小图保留固定数据并请求重绘，未声称现场输入节奏。'};
  const save=()=>writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  const configurations=[{id:'ordinary',axisType:'linear',strokeWidth:1.5},{id:'highPrecision',axisType:'linear-highPrecision',strokeWidth:1}].filter(c=>axisProfile==='all'||c.id===axisProfile);
  const onError=error=>report.errors.push(String(error.message??error));page.on('pageerror',onError);
  try{
    await page.setViewportSize({width:1200,height:801});await cdp.send('Emulation.setDeviceMetricsOverride',{width:1200,height:801,deviceScaleFactor:1.75,mobile:false});
    const response=await page.request.get(new URL('/dist/crychart.js',baseURL).href);assert.ok(response.ok());assert.equal(createHash('sha256').update(await response.body()).digest('hex'),bundleSHA256,'服务构建与本轮绑定不符');
    await page.goto(`${baseURL}/scripts/performance/fixture.html?fixture=monitoring`);await page.bringToFront();await page.waitForFunction(()=>window.__CRY_MONITOR__?.ready);
    report.environment=await page.evaluate(()=>{const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');return{userAgent:navigator.userAgent,dpr:devicePixelRatio,crossOriginIsolated,webgl2:Boolean(gl),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};});
    assert.ok(report.environment.crossOriginIsolated,'Worker共享计数需要隔离上下文');assert.ok(report.environment.webgl2);assert.ok(!report.environment.userAgent.includes('Headless'));assert.equal(report.environment.dpr,1.75);
    for(const config of configurations)for(const seconds of mode==='soak'?[0]:[28,60]){
      const input={...config,seedSamples:seconds*48000};const initial=await page.evaluate(options=>window.__CRY_MONITOR__.setup(options),input);verifySnapshot(initial,input);
      const run={configuration:input,initial,checkpoints:[],startedAt:new Date().toISOString()},allPointer=[];report.runs.push(run);await save();
      await page.evaluate(()=>window.__CRY_MONITOR__.start());const wallStart=performance.now();
      const checkpoints=mode==='soak'?(profile==='full'?[60000,300000,600000]:[1000]):[profile==='full'?1200:250];
      for(const checkpointMs of checkpoints){
        while(performance.now()-wallStart<checkpointMs){await page.waitForTimeout(Math.max(1,Math.min(1000,checkpointMs-(performance.now()-wallStart))));}
        const windowStart=await page.evaluate(()=>window.__CRY_MONITOR__.snapshot().elapsedMs),durationMs=profile==='full'?6000:1000;
        await page.waitForTimeout(durationMs);const raw=await page.evaluate(from=>window.__CRY_MONITOR__.collect(from),windowStart);verifySnapshot(raw.snapshot,input);
        const pointer=await pointerSamples(page,cdp);assert.equal(pointer.length,24,'全部24个真实鼠标事件都应被采集');allPointer.push(...pointer);
        const item={requestedCheckpointMs:checkpointMs,actualWallElapsedMs:performance.now()-wallStart,windowStartMs:windowStart,windowDurationMs:durationMs,summary:summarize(raw,pointer),snapshot:raw.snapshot};
        item.historicalComparison=compareHistoricalScope({baseline:baselines?.scenarios?.BScope,profile,mode,config,seconds,summary:item.summary});
        run.checkpoints.push(item);await writeFile(join(directory,`${config.id}-${seconds}s-${checkpointMs}ms-window.json`),JSON.stringify({raw,pointer},null,2)+'\n');await save();
        console.log(JSON.stringify({suite:'monitoring',configuration:config.id,seedSeconds:seconds,checkpointMs,summary:item.summary}));
      }
      run.drained=await page.evaluate(()=>window.__CRY_MONITOR__.stop());verifySnapshot(run.drained,input);assert.equal(run.drained.queue.batches,0);assert.equal(run.drained.queue.samples,0);assert.equal(run.drained.queue.producedBatches,run.drained.receivedBatches);assert.equal(run.drained.queue.producedSamples,run.drained.ingestedSamplesPerChannel);
      const complete=await page.evaluate(()=>window.__CRY_MONITOR__.collect());run.fullDurationMs=run.drained.elapsedMs;run.fullRunSummary=summarize(complete,allPointer);run.completedAt=new Date().toISOString();
      if(mode==='soak'&&profile==='full')assert.ok(run.fullDurationMs>=600000,'长测必须真实运行至少10分钟');
      run.soakClaim=mode==='soak'&&profile==='full'?'真实10分钟，含1/5/10分钟检查点':'短时检查，不是10分钟长测';
      await writeFile(join(directory,`${config.id}-${seconds}s-complete.json`),JSON.stringify({...complete,pointer:allPointer},null,2)+'\n');await page.evaluate(()=>window.__CRY_MONITOR__.cleanup());await save();
    }
    assert.equal(report.errors.length,0,report.errors.join('\n'));report.baselineComparison={status:'per-window',comparisons:report.runs.map(r=>({configuration:r.configuration,windows:r.checkpoints.map(c=>c.historicalComparison)})),currentPairedComparison:false};report.status='passed';
  }catch(error){report.status='failed';report.errors.push(String(error.stack??error));}
  finally{await page.evaluate(()=>window.__CRY_MONITOR__?.cleanup()).catch(error=>report.errors.push(String(error)));page.off('pageerror',onError);if(report.errors.length)report.status='failed';report.functionalStatus=report.status;
    const diagnostics=report.runs.flatMap(run=>[...run.checkpoints.map(point=>point.summary),run.fullRunSummary].filter(Boolean).map(summary=>({configuration:run.configuration,...summary.longTaskDiagnostic,unavailable:summary.diagnosticUnavailable??[]})));
    report.diagnosticUnavailable=diagnostics.flatMap(item=>item.unavailable.map(reason=>({configuration:item.configuration,...reason})));
    report.diagnosticQualification={status:report.diagnosticUnavailable.length?'partial':diagnostics.length&&diagnostics.every(item=>item.status==='available')?'available':'unverified',
      longtask:report.diagnosticUnavailable.length?null:{availableObservations:diagnostics.filter(item=>item.status==='available').length},
      qualification:'诊断只采集证据；不可用不阻断数据、坐标轴和排空检查，不填零，也不能作为性能验收通过依据。'};
    report.finishedAt=new Date().toISOString();await save();}
  return report;
}
