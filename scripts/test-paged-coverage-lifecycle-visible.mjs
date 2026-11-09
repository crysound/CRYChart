import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {connectVisibleChrome,showStep} from './visible-browser.mjs'

const option=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)
const libraryOption=option('library'),expectedSHA=option('sha256'),iterations=Number(option('iterations')??'3')
assert.ok(libraryOption&&/^[a-fA-F0-9]{64}$/.test(expectedSHA??''),'Required: --library=<frozen.js> --sha256=<expected SHA-256>')
assert.equal(iterations,3,'This bounded lifecycle fixture specifies exactly three iterations of each layout/storage scenario')
const library=resolve(libraryOption),bytes=await readFile(library),fixturePath='scripts/paged-coverage-lifecycle-fixture.mjs',fixture=await readFile(fixturePath),hash=value=>createHash('sha256').update(value).digest('hex'),bundleSHA256=hash(bytes)
assert.equal(bundleSHA256,expectedSHA.toLowerCase(),'Frozen candidate SHA does not match the explicitly requested library')
const directory=resolve('codex_artifact/paged-coverage-lifecycle-visible',new Date().toISOString().replaceAll(/[:.]/g,'-'));await mkdir(directory,{recursive:true})
const report={createdAt:new Date().toISOString(),bundle:library,bundleSHA256,fixtureSHA256:hash(fixture),runnerSHA256:hash(await readFile('scripts/test-paged-coverage-lifecycle-visible.mjs')),visibleChrome:true,headless:false,applicationRun:false,performanceAcceptance:false,fullHistoryAcceptance:false,iterations,scenarios:[{storage:'f32',layout:'shared'},{storage:'f64',layout:'stacked'}],cycles:[],errors:[],limits:['Each scenario retains exactly 48,000 real source points per channel, one second at 48 kHz. This is lifecycle/capacity diagnostics, not realtime throughput.','Explicit GC is diagnostic. V8 heap/backing bytes and counted GL API allocations are not process RSS, driver storage or GPU residency.','External DataSets intentionally survive all series/chart bindings until their explicit owner disposes them.','Three iterations run both storage/layout scenarios: six disposed/rebuilt chart lifecycles; no 60-second allocation is performed.'],disposedBackingAllowanceBytes:16*1048576,maximumAdditionalBackingBytes:512*1048576}
const html='<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>CRYChart paged + coverage lifecycle</title><style>body{margin:0;background:#101827;color:#eaf4ff;font:15px system-ui}h1{font-size:21px;margin:16px 22px}#status{margin:10px 22px}#chart{height:900px;width:1480px;margin:0 20px}</style><h1>CRYChart · 128-channel paged storage and coverage lifecycle</h1><div id="status">Frozen candidate; preparing bounded lifecycle checks</div><div id="chart"></div><script type="module">window.lifecycle=await(await import("/fixture.mjs")).createLifecycleFixture()</script>'
const server=http.createServer((request,response)=>{const path=new URL(request.url,'http://127.0.0.1').pathname,value=path==='/library.js'?bytes:path==='/fixture.mjs'?fixture:path==='/fixture.html'?html:undefined;response.writeHead(value?200:404,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'}).end(value)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
const save=()=>writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n')
let browser,page,cdp
try{
  const connected=await connectVisibleChrome();browser=connected.browser;page=connected.page;report.browser=connected.metadata
  await page.setViewportSize({width:1560,height:1100});await page.bringToFront();cdp=await page.context().newCDPSession(page)
  page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message}))
  await page.goto(origin+'/fixture.html?sha='+bundleSHA256,{waitUntil:'load'});await page.waitForFunction(()=>window.lifecycle)
  assert.equal(hash(await(await page.request.get(origin+'/library.js')).body()),bundleSHA256,'HTTP-served library bytes differ from the frozen candidate')
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const state=()=>page.evaluate(()=>window.lifecycle.snapshot())
  const heap=()=>cdp.send('Runtime.getHeapUsage')
  const checkpoint=async(label,gc=false)=>{const before=await heap();if(gc){await cdp.send('HeapProfiler.collectGarbage');await settle()}const after=gc?await heap():before;assert.ok(after.backingStorageSize-report.baselineHeap.backingStorageSize<=report.maximumAdditionalBackingBytes,'Bounded one-second lifecycle exceeded its backing-storage guard');return{label,beforeGC:gc?before:undefined,heap:after,state:await state()}}
  await cdp.send('HeapProfiler.collectGarbage');await settle();report.baselineHeap=await heap();report.baselineState=await state()
  for(let iteration=1;iteration<=iterations;iteration++)for(const scenario of report.scenarios){
    const record={iteration,...scenario,status:'running',checkpoints:[]};report.cycles.push(record)
    await showStep(page,`Lifecycle ${iteration}/3 · ${scenario.storage} ${scenario.layout}`,'48,000 real samples per channel; 128↔16 channels; external sharing; clear/refill; dispose and rebuild')
    await page.evaluate(config=>window.lifecycle.create(config),{iteration,...scenario});record.initialAudit=await page.evaluate(()=>window.lifecycle.audit());assert.equal(record.initialAudit.checkedSamples,128*48000)
    record.graphics=await page.evaluate(()=>window.lifecycle.health());record.checkpoints.push(await checkpoint('128 live; after explicit GC',true))
    if(iteration===1){const image=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await writeFile(directory+`/${scenario.storage}-${scenario.layout}-128.png`,Buffer.from(image.data,'base64'))}
    const initial=record.checkpoints.at(-1).state
    await page.evaluate(()=>window.lifecycle.switchChannels(16));record.checkpoints.push(await checkpoint('16 active; 128 external DataSets retained',true));const reduced=record.checkpoints.at(-1).state
    assert.equal(reduced.totalSamples,128*48000);assert.equal(reduced.storage.ownedNumericBytes,initial.storage.ownedNumericBytes);assert.ok(reduced.gpu.allocatedBufferBytes<initial.gpu.allocatedBufferBytes,'Removing channels must release obsolete GL geometry')
    await page.evaluate(()=>window.lifecycle.switchChannels(128));record.checkpoints.push(await checkpoint('128 restored using identical external DataSets',true));record.restoredAudit=await page.evaluate(()=>window.lifecycle.audit())
    assert.deepEqual(record.restoredAudit.channels.map(row=>[row.rawHash,row.renderHash]),record.initialAudit.channels.map(row=>[row.rawHash,row.renderHash]))
    record.sharing=await page.evaluate(()=>window.lifecycle.sharedOwnership())
    await page.evaluate(()=>window.lifecycle.clear());record.checkpoints.push(await checkpoint('cleared data; bounded pools and reusable scratch may remain',true))
    await page.evaluate(()=>window.lifecycle.refill());record.refillAudit=await page.evaluate(()=>window.lifecycle.audit());record.refillGraphics=await page.evaluate(()=>window.lifecycle.health());record.checkpoints.push(await checkpoint('one-second history refilled after clear',true))
    await page.evaluate(()=>window.lifecycle.disposeChartKeepData());record.checkpoints.push(await checkpoint('chart disposed; external owner intentionally retains all samples',true));assert.equal(record.checkpoints.at(-1).state.totalSamples,128*48000)
    await page.evaluate(()=>window.lifecycle.disposeDataOwner());record.disposed=await checkpoint('external owner disposed; after explicit GC',true)
    assert.ok(record.disposed.heap.backingStorageSize<=report.baselineHeap.backingStorageSize+report.disposedBackingAllowanceBytes,'Disposed backing storage exceeds the explicit diagnostic allowance')
    assert.deepEqual(record.disposed.state.contextEvents,[]);assert.equal(record.disposed.state.canvasCount,0);assert.equal(record.disposed.state.engineCharts,0);assert.equal(record.disposed.state.storage.ownedNumericBytes,0)
    record.status='passed';await save();console.log(JSON.stringify({iteration,...scenario,status:record.status,disposedBackingBytes:record.disposed.heap.backingStorageSize,liveOwnedBytes:initial.storage.ownedNumericBytes}))
  }
  const disposed=report.cycles.map(record=>record.disposed.heap.backingStorageSize)
  report.summary={passedCycles:report.cycles.filter(record=>record.status==='passed').length,disposedAfterGCBackingBytes:disposed,baselineBackingBytes:report.baselineHeap.backingStorageSize,firstToLastBackingDifference:disposed.at(-1)-disposed[0],backingSpread:Math.max(...disposed)-Math.min(...disposed),allGPUResourceCountersZero:report.cycles.every(record=>{const value=record.disposed.state.lastDisposal.gpu;return[value.liveBuffers,value.allocatedBufferBytes,value.liveTextures,value.allocatedTextureBytes,value.liveFramebuffers,value.liveVertexArrays,value.livePrograms,value.liveShaders].every(n=>n===0)})}
  assert.equal(report.summary.passedCycles,6);assert.ok(report.summary.backingSpread<=8*1048576,'Disposed backing-storage spread exceeded the bounded 8 MiB diagnostic threshold');assert.equal(report.errors.length,0)
  report.passed=true
}catch(error){report.passed=false;if(report.cycles.at(-1)?.status==='running')report.cycles.at(-1).status='failed';report.errors.push({kind:'runner',message:String(error.stack??error)});if(page)report.failureState=await page.evaluate(()=>window.lifecycle?.snapshot()).catch(()=>undefined)}
finally{
  if(page)await page.evaluate(()=>window.lifecycle?.cleanup()).catch(error=>report.errors.push({kind:'cleanup',message:error.message}))
  report.completedAt=new Date().toISOString();if(report.errors.length)report.passed=false;await save()
  if(cdp)await cdp.detach().catch(()=>{});if(browser)await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})
}
console.log(JSON.stringify({report:directory+'/report.json',passed:report.passed,cycles:report.cycles.length,bundleSHA256,errors:report.errors}))
if(!report.passed)process.exitCode=1
