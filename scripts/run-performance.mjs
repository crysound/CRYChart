import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname,extname,sep,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {connectVisibleChrome} from './visible-browser.mjs';
import {scanMaintainedNames} from './performance/name-policy.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const GROUPS=['channels','monitoring-short','monitoring-soak','resources','storage'];
export function parsePerformanceOptions(argv){
  const options={profile:'full',groups:[...GROUPS],out:undefined,limits:undefined,dryRun:false};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i],value=key=>arg.startsWith(key+'=')?arg.slice(key.length+1):argv[++i];
    if(arg==='--quick')options.profile='quick';
    else if(arg==='--dry-run')options.dryRun=true;
    else if(arg==='--profile'||arg.startsWith('--profile='))options.profile=value('--profile');
    else if(arg==='--groups'||arg.startsWith('--groups='))options.groups=value('--groups').split(',');
    else if(arg==='--out'||arg.startsWith('--out='))options.out=value('--out');
    else if(arg==='--limits'||arg.startsWith('--limits='))options.limits=value('--limits');
    else throw new TypeError('未知性能测试参数：'+arg);
  }
  assert.ok(['full','quick'].includes(options.profile),'profile必须为full或quick');
  assert.ok(options.groups.length&&new Set(options.groups).size===options.groups.length,'性能组必须非空且不重复');
  for(const group of options.groups)assert.ok(GROUPS.includes(group),'未知性能组：'+group);
  return options;
}

export async function startPerformanceServer({frozen=new Map()}={}){
  const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav','.obj':'text/plain; charset=utf-8'};
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),path=resolve(root,'.'+pathname);
      if(!path.startsWith(root+sep)||pathname.startsWith('/.git/')||pathname.startsWith('/node_modules/')){res.writeHead(403).end();return;}
      const bytes=frozen.get(path)??await readFile(path);
      res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'}).end(bytes);
    }catch{res.writeHead(404).end();}
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  return{baseURL:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(done=>{server.close(done);server.closeAllConnections();})};
}

const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const statusLabel=value=>({passed:'通过',failed:'失败',partial:'未完成',running:'执行中',unconfigured:'未配置限值',unverified:'尚未验证',unavailable:'不可用',full:'完整',quick:'快速',available:'可用','not-comparable':'协议不可直接比较','not-computed':'尚未计算','per-window':'按窗口记录'}[value]??value);

// Unit recognition is deliberately explicit. Unknown numeric fields are not
// turned into measurements or silently assigned milliseconds.
export function measurementUnit(name,parent=''){
  if(/SamplesPerSecond/i.test(name))return 'samples/s';
  if(/BatchesPerSecond/i.test(name))return 'batches/s';
  if(/Bytes$|ByteLength$|^(rss|heapUsed|external|arrayBuffers|usedJSHeapSize|totalJSHeapSize|jsHeapSizeLimit|usedSize|totalSize|embedderHeapUsedSize|backingStorageSize)$/i.test(name))return 'B';
  if(parent==='bytes'&&['unique','pooled','allocated','logicalPages','logicalSamples','poolTarget','denseTypedArrays','snapshots'].includes(name))return 'B';
  if(/Ms$/.test(name)&&!/^atMs$/.test(name))return 'ms';
  if(/Seconds$/.test(name))return 's';
  if(/Samples$/.test(name))return 'samples';
  if(/Batches$/.test(name))return 'batches';
  if(parent==='queue'&&name==='samples')return 'samples';
  if(parent==='queue'&&name==='batches')return 'batches';
  return undefined;
}

export function collectPerformanceMetrics(groups){
  const metrics={};
  const put=(path,value,unit,provenance)=>{
    if(unit&&(value===null||typeof value==='number'))metrics[path]={value:typeof value==='number'&&Number.isFinite(value)?value:null,unit,provenance};
  };
  const walk=(prefix,value,provenance,key='',parent='',inheritedUnit)=>{
    const unit=measurementUnit(key,parent)??inheritedUnit;
    if(value===null||typeof value==='number'){put(prefix,value,unit,provenance);return;}
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach((row,index)=>walk(`${prefix}.${index}`,row,provenance,'',key,unit));return;}
    for(const [name,item]of Object.entries(value)){
      if(/diagnostic/i.test(name)||['config','configuration','expected','limits','environment','sourceHashes','sourceSHA256','validation','correctness','protocol','baselineReference','historicalComparison'].includes(name))continue;
      if(['p50','p95','p99','max','min'].includes(name))put(`${prefix}.${name}`,item,unit,provenance);
      else walk(`${prefix}.${name}`,item,provenance,name,key);
    }
  };
  const distributions=(prefix,values,provenance)=>{for(const [name,value]of Object.entries(values??{}))walk(`${prefix}.${name}`,value,provenance,name);};
  for(const group of groups){
    const provenance={group:group.id,reportPath:group.reportPath,profile:group.profile};
    if(group.id==='channels')for(const scenario of group.report?.scenarios??[]){
      distributions(scenario.id,scenario.metrics??scenario.summary,{...provenance,aggregation:'median-of-round-quantiles'});
      distributions(`${scenario.id}.pooled`,scenario.pooledSummary,{...provenance,aggregation:'pooled-raw-samples'});
      scenario.rounds?.forEach((round,index)=>{
        walk(`${scenario.id}.rounds.${index}.memory`,round.memory,provenance,'memory');
        walk(`${scenario.id}.rounds.${index}.disposed`,round.disposed,provenance,'disposed');
        // A maximum of actual frame-boundary observations is a sampled peak,
        // never continuous process RSS or physical GPU residency.
        const names=new Set(round.frames?.flatMap(frame=>Object.keys(frame.memory??{}))??[]);
        for(const name of names){
          const values=(round.frames??[]).map(frame=>frame.memory?.[name]).filter(value=>typeof value==='number'&&Number.isFinite(value));
          put(`${scenario.id}.rounds.${index}.sampledMemoryPeak.${name}`,values.length?Math.max(...values):null,measurementUnit(name),{...provenance,aggregation:'max-of-frame-boundary-observations'});
        }
      });
    }
    if(group.id.startsWith('monitoring-'))for(const run of group.report?.runs??[]){
      const config=run.configuration,prefix=`${group.id}.${config?.id}.${config?.seedSamples/48000}s`;
      run.checkpoints?.forEach((point,index)=>distributions(`${prefix}.checkpoints.${index}`,point.summary,{...provenance,requestedCheckpointMs:point.requestedCheckpointMs}));
      distributions(`${prefix}.fullRun`,run.fullRunSummary,provenance);
      if(group.id==='monitoring-short'){
        distributions(`${config?.id}.${config?.seedSamples/48000}s`,run.checkpoints?.at(-1)?.summary,provenance);
        if(config?.id==='highPrecision'&&config.seedSamples===2880000)distributions('BScope',run.checkpoints?.at(-1)?.summary,provenance);
      }
    }
    if(group.id==='storage'){
      walk('storage.profile',group.report?.profileReport?.results,provenance);
      walk('storage.rounds',group.report?.benchmarkReport?.rows,provenance);
      walk('storage.summaries',group.report?.benchmarkReport?.summaries,provenance);
    }
    if(group.id==='resources')for(const item of group.report?.cases??[]){
      const evidence={...provenance,case:item.id,reportSHA256:item.reportSHA256};
      for(const key of ['samples','cycles','summary','processMemory'])walk(`resources.${item.id}.${key}`,item.measurements?.[key],evidence,key);
    }
  }
  return metrics;
}

export function collectPerformanceComparisons(groups){
  return Object.fromEntries(groups.map(row=>[row.id,row.id==='channels'
    ?{status:'per-scenario',scenarios:(row.report?.scenarios??[]).map(scenario=>({id:scenario.id,...scenario.historicalComparison}))}
    :row.report?.historicalComparison??row.report?.baselineComparison??row.report?.comparison??{status:'not-computed'}]));
}

export async function loadResourceMeasurements(groups,sessionId,bundleSHA256){
  for(const group of groups.filter(row=>row.id==='resources'))for(const item of group.report?.cases??[]){
    if(!item.reportPath||!item.reportSHA256)continue;
    const bytes=await readFile(resolve(item.reportPath));
    assert.equal(sha(bytes),item.reportSHA256,'资源报告在计时结束后发生变化');
    const raw=JSON.parse(bytes);
    assert.equal(raw.sessionId,sessionId,'资源测量会话不符');
    assert.equal(raw.coreSHA256??raw.bundleSHA256,bundleSHA256,'资源测量构建不符');
    item.measurements=Object.fromEntries(['samples','cycles','summary','processMemory'].filter(key=>raw[key]!==undefined).map(key=>[key,raw[key]]));
  }
}

export async function verifySourceHashes(expected,read=path=>readFile(resolve(root,path))){
  const differences=[];
  for(const [path,beforeSHA256]of Object.entries(expected)){
    let actual=null;try{actual=sha(await read(path));}catch{}
    if(actual!==beforeSHA256)differences.push({path,beforeSHA256,afterSHA256:actual});
  }
  return{status:differences.length?'failed':'passed',checkedFiles:Object.keys(expected).length,differences};
}
export async function writeSummary(directory,report,baselines){
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  const names={channels:'64/128通道基准','monitoring-short':'九图与Scope短测','monitoring-soak':'两组10分钟长测',resources:'容量、回绕与生命周期',storage:'Node存储计时'};
  const rows=report.groups.map(g=>`<tr><td>${names[g.id]??htmlEscape(g.id)}</td><td>${htmlEscape(statusLabel(g.status))}</td><td>${htmlEscape(g.durationSeconds??'')}</td><td><a href="${htmlEscape(g.reportPath??'report.json')}">原始报告</a></td></tr>`).join('');
  const historic=Object.entries(baselines.scenarios??{}).flatMap(([id,scenario])=>Object.entries(scenario.metrics??{}).map(([metric,value])=>`<tr><td>${htmlEscape(id)}</td><td>${htmlEscape(metric)}</td><td>${htmlEscape(value.unit)}</td><td>${htmlEscape(value.candidate?.p50??'未测')}</td><td>${htmlEscape(value.candidate?.p95??'未测')}</td><td>${htmlEscape(value.reference?.p50??'无同轮数据')}</td><td>${htmlEscape(value.reference?.p95??'无同轮数据')}</td></tr>`)).join('');
  const metricRows=[];
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(3):'未测';
  for(const scenario of report.groups.find(g=>g.id==='channels')?.report?.scenarios??[]){
    const current=scenario.metrics?.workMs,baseline=baselines.scenarios?.[scenario.id]?.metrics?.workMs?.candidate;
    metricRows.push(`<tr><td>${htmlEscape(scenario.id)}：整帧工作耗时</td><td>${number(current?.p50)}</td><td>${number(current?.p95)}</td><td>${number(baseline?.p50)}</td><td>${number(baseline?.p95)}</td><td>${scenario.historicalComparison?.eligible?'仅历史静态参照，非同轮配对':'协议有差异，仅并列展示'}</td></tr>`);
  }
  const scope=report.groups.find(g=>g.id==='monitoring-short')?.report?.runs?.find(r=>r.configuration?.id==='highPrecision'&&r.configuration.seedSamples===2880000);
  if(scope){const current=scope.checkpoints.at(-1)?.summary?.scopeSubmitMs,baseline=baselines.scenarios?.BScope?.metrics?.scopeSubmitMs?.candidate;metricRows.push(`<tr><td>BScope：满窗CPU提交延迟</td><td>${number(current?.p50)}</td><td>${number(current?.p95)}</td><td>${number(baseline?.p50)}</td><td>${number(baseline?.p95)}</td><td>受控Worker，非现场端到端延迟</td></tr>`);}
  await writeFile(resolve(directory,'report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRYChart 性能自动测试报告</title><style>body{font:15px/1.7 system-ui;margin:32px;color:#18243c;background:#f5f7fb}table{border-collapse:collapse;background:white;width:100%;margin:16px 0}td,th{padding:8px;border:1px solid #cad5e5;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style><h1>CRYChart 性能自动测试</h1><p>测试执行：${htmlEscape(statusLabel(report.executionStatus))}；完整性：${htmlEscape(statusLabel(report.completeness?.status??report.status))}；性能限值验收：${htmlEscape(statusLabel(report.performanceAcceptance?.status??report.performanceAcceptance??'unconfigured'))}。</p><p>模式：${htmlEscape(statusLabel(report.profile))}；时间：${htmlEscape(report.finishedAt)}；构建：<code>${htmlEscape(report.bundleSHA256)}</code></p><p>本轮仅执行CRYChart。历史参照不是本轮配对结果。无显式限值时不宣称性能达标；快速或子集运行不代表完整验收。CPU提交、同步读回、GPU查询及现场端到端延迟分别解释。</p><table><tr><th>测试组</th><th>执行状态</th><th>秒</th><th>证据</th></tr>${rows}</table><h2>主要指标（毫秒）</h2><table><tr><th>负载与指标</th><th>本轮P50</th><th>本轮P95</th><th>历史CRYChart P50</th><th>历史CRYChart P95</th><th>解释</th></tr>${metricRows.join('')}</table><h2>本轮结果与基准变化</h2><p>详细时延、资源、全帧分布及资格差异见各组原始报告；不能混用每轮百分位中位数与全帧合并分布。</p><pre>${htmlEscape(JSON.stringify(report.comparison??{},null,2))}</pre><h2>历史基准快照</h2><table><tr><th>场景</th><th>指标</th><th>单位</th><th>CRYChart P50</th><th>CRYChart P95</th><th>对照库 P50</th><th>对照库 P95</th></tr>${historic}</table><p><a href="report.json">完整JSON</a> · <a href="baselines.json">带来源指纹的基准快照</a></p></html>\n`);
}

export async function main(argv=process.argv.slice(2)){
  const options=parsePerformanceOptions(argv);
  if(options.dryRun){console.log(JSON.stringify({...options,fullGroups:GROUPS,soakSecondsPerConfiguration:600,soakConfigurations:2,currentPairedComparison:false}));return;}
  const sessionId=randomUUID(),directory=resolve(options.out??resolve(root,'codex_artifact/performance-current',new Date().toISOString().replace(/[:.]/g,'-')));
  await mkdir(directory,{recursive:true});
  const baselines=JSON.parse(await readFile(resolve(root,'docs/performance-baselines.json'),'utf8'));
  const bundleSHA256=sha(await readFile(resolve(root,'dist/crychart.js')));
  const limits=options.limits?JSON.parse(await readFile(resolve(options.limits),'utf8')):undefined;
  const sourcePaths=['scripts/run-performance.mjs','tests/paged-columns.test.ts','scripts/visible-browser.mjs','src/core/paged-columns.ts','src/core/data.ts','scripts/test-paged-capacity-visible.mjs','scripts/test-paged-coverage-lifecycle-visible.mjs','examples/channel-lab/test-memory-visible.mjs',...(await readdir(resolve(root,'scripts/performance'))).filter(name=>/\.(mjs|html)$/.test(name)).map(name=>'scripts/performance/'+name)];
  const frozen=new Map();
  const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>{const bytes=await readFile(resolve(root,path));frozen.set(resolve(root,path),bytes);return[path,sha(bytes)];})));
  frozen.set(resolve(root,'dist/crychart.js'),await readFile(resolve(root,'dist/crychart.js')));
  for(const [path,bytes]of frozen){const target=resolve(directory,'frozen-sources',relative(root,path));await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
  await writeFile(resolve(directory,'source-snapshot.json'),JSON.stringify({sourceHashes,bundleSHA256},null,2)+'\n');
  const report={schemaVersion:1,kind:'crychart-performance-suite',sessionId,profile:options.profile,selectedGroups:options.groups,startedAt:new Date().toISOString(),bundleSHA256,sourceHashes,baselineSHA256:sha(await readFile(resolve(root,'docs/performance-baselines.json'))),groups:[],errors:[],status:'running',executionStatus:'running',currentPairedComparison:false,performanceAcceptance:'unconfigured'};
  let service,browser;
  await writeFile(resolve(directory,'baselines.json'),JSON.stringify(baselines,null,2)+'\n');
  try{
    report.namePolicy=await scanMaintainedNames(root);assert.equal(report.namePolicy.status,'passed','工程维护文本有禁止的名称，详见报告中的路径和行号');
    service=await startPerformanceServer({frozen});report.baseURL=service.baseURL;
    if(options.groups.some(g=>g!=='storage')){
      const connection=await connectVisibleChrome();browser=connection.browser;report.browser=connection.metadata;
    }
    for(const id of options.groups){
      console.log('性能测试组：'+id);const start=Date.now(),row={id,profile:options.profile,status:'running'};report.groups.push(row);
      let page,cdp;
      try{
        assert.equal(sha(await readFile(resolve(root,'dist/crychart.js'))),bundleSHA256,'测试中构建发生变化');
        if(id!=='storage'){page=await browser.contexts()[0].newPage();await page.bringToFront();cdp=await page.context().newCDPSession(page);}
        const context={root,page,cdp,browser,baseURL:service.baseURL,directory,bundleSHA256,sessionId,profile:options.profile,baselines};
        let result;
        if(id==='channels')result=await(await import('./performance/channels.mjs')).runChannels(context);
        else if(id==='resources')result=await(await import('./performance/resources.mjs')).runResources(context);
        else if(id==='storage')result=await(await import('./performance/storage.mjs')).runStorage(context);
        else result=await(await import('./performance/monitoring.mjs')).runMonitoring({...context,mode:id==='monitoring-soak'?'soak':'short'});
        row.report=result;row.status=result.status;
        const subdirectory=id==='channels'?'channels':id==='resources'?'resources':id==='storage'?'storage':id;
        row.reportPath=`${subdirectory}/report.json`;
      }catch(error){row.status='failed';row.error=String(error.stack??error);report.errors.push({group:id,error:row.error});}
      finally{await cdp?.detach().catch(()=>{});await page?.close().catch(()=>{});row.durationSeconds=(Date.now()-start)/1000;await writeSummary(directory,report,baselines);}
    }
    report.sourceVerification=await verifySourceHashes({...sourceHashes,'dist/crychart.js':bundleSHA256,'docs/performance-baselines.json':report.baselineSHA256});
    assert.equal(report.sourceVerification.status,'passed','测试期间执行源码、构建或基准发生变化');
    await loadResourceMeasurements(report.groups,sessionId,bundleSHA256);
    const {evaluatePerformance}=await import('./performance/protocol.mjs');
    report.metrics=collectPerformanceMetrics(report.groups);
    const evaluation=evaluatePerformance({profile:options.profile,groups:report.groups,metrics:report.metrics,limits});
    report.evaluation=evaluation;report.completeness=evaluation.protocolCompleteness;
    report.performanceAcceptance=evaluation.performanceAcceptance??evaluation.limits??'unconfigured';
    report.comparison=collectPerformanceComparisons(report.groups);
    report.executionStatus=report.errors.length===0&&report.groups.every(g=>g.status==='passed')?'passed':'failed';
    report.status=report.executionStatus==='failed'?'failed':evaluation.status??(options.profile==='full'?'passed':'partial');
    process.exitCode=report.executionStatus==='failed'?1:evaluation.exitCode??(report.status==='passed'?0:2);
  }catch(error){report.errors.push({error:String(error.stack??error)});report.status='failed';report.executionStatus='failed';process.exitCode=1;}
  finally{
    const cleanupFailure=(resource,error)=>{report.errors.push({resource,error:String(error.stack??error)});report.status='failed';report.executionStatus='failed';if(report.performanceAcceptance==='passed')report.performanceAcceptance='unverified';process.exitCode=1;};
    try{await browser?.close();}catch(error){cleanupFailure('browser-connection',error);}
    finally{try{await service?.close();}catch(error){cleanupFailure('test-server',error);}}
    report.finishedAt=new Date().toISOString();
    // All owned resources have already been released even if report writing fails.
    await writeSummary(directory,report,baselines);
    console.log(JSON.stringify({report:resolve(directory,'report.json'),status:report.status,executionStatus:report.executionStatus,performanceAcceptance:report.performanceAcceptance,groups:report.groups.map(({id,status,durationSeconds})=>({id,status,durationSeconds}))}));
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
