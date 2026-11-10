import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {connectVisibleChrome,showStep} from './visible-browser.mjs';

const option=(name,fallback)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.split('=').slice(1).join('=')??fallback;
const config={channels:Number(option('channels','4')),rate:48000,retainedSeconds:Number(option('history','1')),visibleSeconds:Number(option('visible','1')),rollSeconds:Number(option('roll','1')),storage:option('storage','f64'),layout:option('layout','stacked'),pageSize:1024,batchSize:4800};
for(const name of ['channels','retainedSeconds','visibleSeconds','rollSeconds'])assert.ok(Number.isInteger(config[name])&&config[name]>=1,`Invalid ${name}`);
assert.ok(config.channels<=128&&config.retainedSeconds<=60&&config.visibleSeconds<=config.retainedSeconds&&['f32','f64'].includes(config.storage)&&['stacked','shared'].includes(config.layout));
const maxBackingMiB=Number(option('max-backing-mib','4096'));assert.ok(Number.isFinite(maxBackingMiB)&&maxBackingMiB>=256&&maxBackingMiB<=6144);
const gcEverySeconds=Number(option('gc-every','0'));assert.ok(Number.isInteger(gcEverySeconds)&&gcEverySeconds>=0);
const library=resolve(option('library','dist/crychart.js')),bytes=await readFile(library),fixture=await readFile('scripts/paged-capacity-fixture.mjs');
const hash=b=>createHash('sha256').update(b).digest('hex'),output=resolve(option('out',`codex_artifact/paged-data-visible/${new Date().toISOString().replaceAll(/[:.]/g,'-')}`));await mkdir(output,{recursive:true});
let host;try{host=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}));}catch(error){host={unavailable:String(error.message??error)}}
const report={sessionId:process.env.CRYCHART_PERFORMANCE_SESSION_ID,resourceLayers:{"source": "\u5b8c\u6574\u4fdd\u7559\u7684\u539f\u59cb\u5217\u548c\u6e32\u67d3\u5217", "javascript": "V8\u5806\u548cbacking storage", "graphics": "GL\u5206\u914d\u8ba1\u6570\uff0c\u4e0d\u4ee3\u8868GPU\u7269\u7406\u9a7b\u7559\u91cf", "process": "\u8be6\u89c1\u62a5\u544a\u7684\u91c7\u6837\u8303\u56f4\u6216\u4e0d\u53ef\u7528\u72b6\u6001"},createdAt:new Date().toISOString(),config,bundle:library,bundleSHA256:hash(bytes),fixtureSHA256:hash(fixture),runnerSHA256:hash(await readFile(new URL(import.meta.url))),host,visibleChrome:true,headless:false,applicationRun:false,performanceAcceptance:false,visualEquivalence:false,scope:'Real retained data and rendering capacity. Data time advances in 100ms batches as fast as execution allows; this is not sustained realtime throughput. Explicit final GC is diagnostic. Heap backing bytes exclude process/GPU memory.',samples:[],validation:[],errors:[]};
report.gcEveryDataSeconds=gcEverySeconds;report.gcCheckpoints=[];
report.processMemoryScope='Chrome processes reported by this browser CDP connection, including other tabs and the GPU process. Windows private bytes are commit; summed working sets may count shared pages repeatedly. Neither isolates this chart nor measures GPU residency.';
const dataMinimum=config.channels*config.rate*config.retainedSeconds*(config.storage==='f64'?8:4);
const availableCommit=Number.isFinite(host.FreeVirtualMemory)?host.FreeVirtualMemory*1024:Infinity,backingBudget=Math.min(maxBackingMiB*1048576,availableCommit-1536*1048576);
report.budget={maximumAdditionalBackingBytes:backingBudget,minimumOneYColumnBytes:dataMinimum,expectedDenseDualYBytes:dataMinimum*2,guardReserveBytes:1536*1048576};
if(backingBudget<dataMinimum+256*1048576){report.errors.push('Insufficient current host commit headroom for the requested capacity plus derived data');await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(output,'report.json'),blockedByCapacityBudget:true}));process.exit(1);}
const html='<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>CRYChart paged history capacity</title><style>body{margin:0;background:#101827;color:#edf5ff;font:15px system-ui}h1{font-size:20px;margin:12px 22px}#status{margin:10px 22px}#chart{height:850px;width:1480px;margin:0 20px}</style><h1>CRYChart · 分页历史数据容量测试</h1><div id="status">准备真实图表与数据</div><div id="chart"></div><script type="module">window.setupCapacity=(await import("/fixture.js")).setupCapacity</script>';
const externalBase=option('base-url',undefined);
const server=http.createServer((req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname;const selected=path==='/library.js'?bytes:path==='/fixture.js'?fixture:path==='/fixture.html'?html:undefined;res.writeHead(selected?200:404,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript','Cache-Control':'no-store'}).end(selected);});
if(!externalBase)await new Promise(r=>server.listen(0,'127.0.0.1',r));
const baseURL=externalBase??`http://127.0.0.1:${server.address().port}`;report.baseURL=baseURL;let browser,page,cdp,browserCDP;
const save=()=>writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const diagnostic=async method=>{try{return await cdp.send(method)}catch(error){report.diagnosticsUnavailable??=[];report.diagnosticsUnavailable.push({method,reason:String(error.message??error)});return{unavailable:true,method}}};
async function processMemory(){
  try{
    browserCDP??=await browser.newBrowserCDPSession();
    const {processInfo}=await browserCDP.send('SystemInfo.getProcessInfo'),ids=processInfo.map(p=>Number(p.id)).filter(id=>Number.isSafeInteger(id)&&id>0);
    assert.ok(ids.length,'No browser process IDs');
    const command=`Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
    const json=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true})),rows=Array.isArray(json)?json:[json];
    const processes=rows.map(row=>({id:row.Id,type:processInfo.find(p=>Number(p.id)===row.Id)?.type,workingSetBytes:row.WorkingSet64,privateBytes:row.PrivateMemorySize64}));
    return{sampledAt:new Date().toISOString(),processes,workingSetBytes:processes.reduce((n,p)=>n+p.workingSetBytes,0),privateBytes:processes.reduce((n,p)=>n+p.privateBytes,0)};
  }catch(error){return{unavailable:String(error.message??error)};}
}
try{
  const connected=await connectVisibleChrome();browser=connected.browser;page=await browser.contexts()[0].newPage();report.browser=connected.metadata;await page.setViewportSize({width:1560,height:1080});await page.bringToFront();cdp=await page.context().newCDPSession(page);page.on('pageerror',e=>report.errors.push(e.message));
  if(externalBase){await page.route('**/library.js',r=>r.fulfill({contentType:'text/javascript',body:bytes}));await page.route('**/fixture.js',r=>r.fulfill({contentType:'text/javascript',body:fixture}));await page.route('**/__cry_capacity.html*',r=>r.fulfill({contentType:'text/html',body:html}));}
  await page.goto(baseURL+(externalBase?'/__cry_capacity.html?sha=':'/fixture.html?sha=')+report.bundleSHA256);await page.waitForFunction(()=>window.setupCapacity);const served=await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch('/library.js')).arrayBuffer())));assert.equal(hash(Buffer.from(served)),report.bundleSHA256,'Executed capacity library bytes must match the frozen build');await diagnostic('HeapProfiler.collectGarbage');report.baselineHeap=await diagnostic('Runtime.getHeapUsage');report.baselineProcesses=await processMemory();
  await page.evaluate(async config=>{window.capacity=await window.setupCapacity(config);},config);
  const total=config.rate*(config.retainedSeconds+config.rollSeconds),sampleEvery=config.rate;
  for(let next=0;next<total;){
    const count=Math.min(config.batchSize,total-next),state=await page.evaluate(count=>window.capacity.append(count),count);next+=count;
    const numeric=state.totals.ownedNumericBytes+state.totals.displaySummaryBytes+state.totals.displaySelectionBytes+state.totals.displayProjectionBytes+state.totals.displayCachedSelectionBytes+state.totals.displayCachedProjectionBytes+(state.totals.displayCachedTopologyBytes??0);
    if(numeric>backingBudget)throw new Error(`Owned numeric budget exceeded at ${state.elapsedDataSeconds}s: ${numeric}`);
    if(next%sampleEvery===0||next===total){const heap=await diagnostic('Runtime.getHeapUsage'),record={dataSeconds:state.elapsedDataSeconds,heap,state};report.samples.push(record);await save();console.log(JSON.stringify({dataSeconds:state.elapsedDataSeconds,retained:state.totalRetainedSamples,numericMiB:state.totals.ownedNumericBytes/1048576,backingMiB:heap.backingStorageSize/1048576,submitted:state.totals.submittedDisplaySamples}));record.backingBudgetExceeded=Number.isFinite(heap.backingStorageSize)?heap.backingStorageSize-report.baselineHeap.backingStorageSize>backingBudget:null;}
    if(gcEverySeconds&&next>=config.rate*config.retainedSeconds&&(next-config.rate*config.retainedSeconds)%(gcEverySeconds*config.rate)===0){
      const before=await diagnostic('Runtime.getHeapUsage');await diagnostic('HeapProfiler.collectGarbage');
      const after=await diagnostic('Runtime.getHeapUsage');report.gcCheckpoints.push({dataSeconds:state.elapsedDataSeconds,before,after,ownedNumericBytes:state.totals.ownedNumericBytes,processes:await processMemory()});await save();
      console.log(JSON.stringify({gcCheckpoint:state.elapsedDataSeconds,backingBeforeMiB:before.backingStorageSize/1048576,backingAfterMiB:after.backingStorageSize/1048576}));
    }
  }
  await showStep(page,'CRYChart 分页数据验证','逐个通道检查全部保留原始值、渲染值和自动时间列；不复制完整历史数组。');
  for(let i=0;i<config.channels;i++){const result=await page.evaluate(i=>window.capacity.validateChannel(i),i);assert.equal(result.count,config.rate*config.retainedSeconds);assert.equal(result.snapshotBytes,0);report.validation.push(result);if(i%16===15)await save();}
  report.graphics=await page.evaluate(()=>window.capacity.health());assert.equal(report.graphics.contextLost,false);assert.equal(report.graphics.error,0);assert.ok(report.graphics.panes.every(p=>p.colored>0),'Every channel pane must contain actual rendered color');
  const {data}=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await writeFile(resolve(output,'full-history.png'),Buffer.from(data,'base64'));report.activeAfterValidation=await diagnostic('Runtime.getHeapUsage');report.activeProcesses=await processMemory();
  await page.evaluate(()=>window.capacity.dispose());report.disposedBeforeGC=await diagnostic('Runtime.getHeapUsage');await diagnostic('HeapProfiler.collectGarbage');report.disposedAfterGC=await diagnostic('Runtime.getHeapUsage');report.disposedProcesses=await processMemory();assert.equal(await page.locator('#chart canvas').count(),0);report.disposedBackingWithinHistoricalAllowance=Number.isFinite(report.disposedAfterGC.backingStorageSize)?report.disposedAfterGC.backingStorageSize<=report.baselineHeap.backingStorageSize+32*1048576:null;report.passed=true;
}catch(error){report.passed=false;report.errors.push(String(error.stack??error));await page?.evaluate(()=>window.capacity?.dispose()).catch(()=>{});}
finally{
  const steady=report.samples.filter(sample=>sample.dataSeconds>=config.retainedSeconds),checkpoints=report.gcCheckpoints;
  if(steady.length)report.rollingMemory={samples:steady.length,dataSeconds:steady.at(-1).dataSeconds-config.retainedSeconds,ownedNumericMin:Math.min(...steady.map(sample=>sample.state.totals.ownedNumericBytes)),ownedNumericMax:Math.max(...steady.map(sample=>sample.state.totals.ownedNumericBytes)),postGCBackingMin:checkpoints.length?Math.min(...checkpoints.map(sample=>sample.after.backingStorageSize)):null,postGCBackingMax:checkpoints.length?Math.max(...checkpoints.map(sample=>sample.after.backingStorageSize)):null,firstToLastPostGCBackingDelta:checkpoints.length>1?checkpoints.at(-1).after.backingStorageSize-checkpoints[0].after.backingStorageSize:null,scope:'Bounded accelerated data-time observation; explicit GC checkpoints are diagnostic and do not establish long-running realtime or whole-process memory acceptance.'};
  report.finishedAt=new Date().toISOString();report.sampledPeakBackingBytes=Math.max(0,...report.samples.map(r=>r.heap.backingStorageSize));if(report.errors.length)report.passed=false;await save();
  if(page)await page.close().catch(()=>{});if(browser)await browser.close();if(server.listening)await new Promise(r=>{server.close(r);server.closeAllConnections();});console.log(JSON.stringify({report:resolve(output,'report.json'),passed:report.passed,validatedChannels:report.validation.length,errors:report.errors.length}));if(!report.passed)process.exitCode=1;
}
