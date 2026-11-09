import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {loadSpecializedEvidence,resolveCaseEvidence} from './summarize-official-functional.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const plainError=error=>({name:error?.name??'Error',message:String(error?.message??error),stack:error?.stack});

export function parseOptions(argv,env=process.env){
  const options={baseURL:env.CRYCHART_BASE_URL??'http://127.0.0.1:4180',ids:[],out:undefined,expectedSHA:undefined,dryRun:false,evidenceOnly:false,reconcile:undefined};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i],get=name=>arg.startsWith(name+'=')?arg.slice(name.length+1):argv[++i];
    if(arg==='--dry-run')options.dryRun=true;
    else if(arg==='--evidence-only')options.evidenceOnly=true;
    else if(arg==='--reconcile'||arg.startsWith('--reconcile=')){options.reconcile=get('--reconcile');options.evidenceOnly=true;}
    else if(arg==='--all')options.ids=[];
    else if(arg==='--base-url'||arg.startsWith('--base-url='))options.baseURL=get('--base-url');
    else if(arg==='--out'||arg.startsWith('--out='))options.out=get('--out');
    else if(arg==='--expected-sha'||arg.startsWith('--expected-sha='))options.expectedSHA=get('--expected-sha');
    else if(arg==='--ids'||arg.startsWith('--ids='))options.ids.push(...get('--ids').split(',').filter(Boolean));
    else if(arg.startsWith('crychart-example-'))options.ids.push(arg);
    else throw new TypeError(`Unknown argument: ${arg}`);
  }
  const url=new URL(options.baseURL);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new TypeError('Use an explicit HTTP base URL without credentials, query or hash');
  options.baseURL=url.href.replace(/\/$/,'');
  options.ids=[...new Set(options.ids)];
  return options;
}

function replaceOnce(source,before,after,label){
  const first=source.indexOf(before);
  if(first<0||source.indexOf(before,first+before.length)>=0)throw new Error(`Legacy harness adapter anchor is not unique: ${label}`);
  return source.slice(0,first)+after+source.slice(first+before.length);
}

/** Reuse the exact specialized checks. Only host/output/selection/lifecycle seams change. */
export function adaptLegacyHarness(input,{directory,baseURL,ids,helperURL}){
  let source=input.replaceAll('\r\n','\n');
  source=replaceOnce(source,"from '../../scripts/visible-browser.mjs'",`from ${JSON.stringify(helperURL)}`,'helper import');
  source=replaceOnce(source,"const directory = resolve('codex_artifact/official-candidates-visible');",`const directory = ${JSON.stringify(directory)};`,'isolated report directory');
  source=replaceOnce(source,'const server = await ensureTestServer(), connected = await connectVisibleChrome(), { browser, page } = connected;',
    'const server = {close:async()=>{}}, connected = await connectVisibleChrome(), browser = connected.browser, page = await browser.contexts()[0].newPage(); await page.bringToFront(); await globalThis.__officialFunctionalHook.preparePage(page);','fresh visible page');
  source=replaceOnce(source,'const selectedCases=new Set(process.argv.slice(2));',`const selectedCases=new Set(${JSON.stringify(ids)});`,'exact selected IDs');
  source=replaceOnce(source,"const priorText=await readFile(resolve(directory,'report.json'),'utf8').catch(()=>undefined),priorReport=priorText?JSON.parse(priorText):undefined;",
    'const priorText=undefined,priorReport=undefined;','no historical aggregation');
  source=replaceOnce(source,'if(skipped)return undefined;pageErrors = []; consoleErrors = [];',
    'if(skipped)return undefined; await globalThis.__officialFunctionalHook.beforeMount({id,page}); try { pageErrors = []; consoleErrors = [];','finish preceding case');
  source=replaceOnce(source,'  return initial;\n}\nasync function check(name, action)',
    '  return initial;\n  } catch(error) { report.errors.push({example:id,name:"mount",error:String(error?.message??error)}); await globalThis.__officialFunctionalHook.onMountFailure({id,error}); skipped=true; return undefined; }\n}\nasync function check(name, action)','per-case mount failure containment');
  source=replaceOnce(source,"  const loadedDetails=(await snapshot()).moduleDetails;assert.ok(!loadedDetails?.error,loadedDetails?.error);assert.notEqual(loadedDetails?.status,'failed');",
    "  const loadedDetails=(await snapshot()).moduleDetails;assert.ok(!loadedDetails?.error,loadedDetails?.error);assert.notEqual(loadedDetails?.status,'failed'); await globalThis.__officialFunctionalHook.prepareExample({id,page});",'explicit consumer startup seam');
  source=replaceOnce(source,"const dataPaint = initial.moduleDetails?.rendering === 'Canvas2D polar paths'||canvasGeometry ? paint.filter(canvas => canvas.backend === '2d') : geometry.length ? geometry : paint;",
    `const cpuDataPaint=await page.evaluate(()=>{const kinds=new Set(['range','rectangles','polygons','segments','ohlc','boxes']),out=[];for(const c of window.__CRY_OFFICIAL__?.inspect?.().charts??[]){const series=(c.getSeries?.()??[]).filter(s=>kinds.has(s.kind)&&s.getVisible?.()!==false&&s.getSampleCount?.()>0);if(!series.length||!c.plot)continue;for(const layer of new Set(series.map(s=>s.kind==='segments'?c.overlay:c.underlay))){if(!layer)continue;const p=c.plot,sx=layer.width/c.width,sy=layer.height/c.height,left=Math.max(0,Math.ceil(p.left*sx)),top=Math.max(0,Math.ceil(p.top*sy)),right=Math.min(layer.width,Math.floor((p.left+p.width)*sx)),bottom=Math.min(layer.height,Math.floor((p.top+p.height)*sy));if(right<=left||bottom<=top)continue;const rgba=layer.getContext('2d').getImageData(left,top,right-left,bottom-top).data;let chromatic=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>100&&Math.max(rgba[i],rgba[i+1],rgba[i+2])-Math.min(rgba[i],rgba[i+1],rgba[i+2])>45)chromatic++;out.push({backend:'canvas-data-plot-ROI',chromatic,kinds:series.map(s=>s.kind),roi:{left,top,right,bottom},scope:'Visible retained Canvas geometry in the physical plot; excludes outside-plot axis text'});}}return out;});
  const dataPaint = cpuDataPaint.length ? [...cpuDataPaint,...geometry] : initial.moduleDetails?.rendering === 'Canvas2D polar paths'||canvasGeometry ? paint.filter(canvas => canvas.backend === '2d') : geometry.length ? geometry : paint;
  if(dataPaint.reduce((sum,item)=>sum+item.chromatic,0)<=25){
    const composed=await page.evaluate(()=>{const out=[];for(const [chartIndex,c]of (window.__CRY_OFFICIAL__?.inspect?.().charts??[]).entries()){
      if(typeof c.captureCanvas!=='function'||!c.plot||!(c.getSeries?.()??[]).some(s=>s.getVisible?.()!==false&&s.getSampleCount?.()>0))continue;
      const image=c.captureCanvas(),p=c.plot,sx=image.width/c.width,sy=image.height/c.height,left=Math.max(0,Math.ceil(p.left*sx)),top=Math.max(0,Math.ceil(p.top*sy)),right=Math.min(image.width,Math.floor((p.left+p.width)*sx)),bottom=Math.min(image.height,Math.floor((p.top+p.height)*sy));
      if(right<=left||bottom<=top)continue;const rgba=image.getContext('2d').getImageData(left,top,right-left,bottom-top).data;let chromatic=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>100&&Math.max(rgba[i],rgba[i+1],rgba[i+2])-Math.min(rgba[i],rgba[i+1],rgba[i+2])>45)chromatic++;
      out.push({backend:'native-export-composed-plot-ROI',chartIndex,chromatic,roi:{left,top,right,bottom},scope:'CRY native compositor with retained source data: background/underlay/GPU/overlay within the physical plot; initialization evidence only'});image.width=image.height=0;
    }return out;});dataPaint.push(...composed);
  }`,'actual Canvas geometry mount seam');
  source=replaceOnce(source,"  const shot = await screenshotSession.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { ...bounds, scale: 1 } });\n  const buffer = Buffer.from(shot.data, 'base64'); await writeFile(resolve(directory, name), buffer);",
    "  const captureEnvironment = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio, scrollX, scrollY, visualViewportScale: visualViewport?.scale }));\n  const shot = await screenshotSession.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });\n  const buffer = Buffer.from(shot.data, 'base64'); await writeFile(resolve(directory, name), buffer);\n  const captureEnvironmentAfter = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio, scrollX, scrollY, visualViewportScale: visualViewport?.scale }));\n  assert.deepEqual(captureEnvironmentAfter, captureEnvironment, 'Capture must preserve viewport, DPR and scroll');",'stable-viewport capture seam');
  source=replaceOnce(source,'report.captures.push({ name, cursorRowsBefore: before.cursorRows, cursorRowsAfter: after.cursorRows, bounds,',"report.captures.push({ name, cursorRowsBefore: before.cursorRows, cursorRowsAfter: after.cursorRows, bounds, stageBounds: bounds, captureScope: 'visible viewport; no clip or emulation override', captureMethod: 'Page.captureScreenshot fromSurface=true without clip', captureEnvironment, captureEnvironmentAfter,",'explicit viewport capture scope');
  source=replaceOnce(source,"report.examples.push({ id, initial, canvas: paint, status: 'candidate-ran', officialEquivalence: 'pending' });",
    "report.examples.push({ id, initial, canvas: paint, status: 'candidate-ran', officialEquivalence: 'pending' }); await globalThis.__officialFunctionalHook.afterMount({id,page,initial,paint});",'mounted snapshot');
  source=replaceOnce(source,'  report.passed = report.errors.length === 0;',
    '  await globalThis.__officialFunctionalHook.finish({page});\n  await globalThis.__officialFunctionalHook.runUnvisited({page,mount});\n  report.passed = report.errors.length === 0;','final case and new IDs');
  source=replaceOnce(source,'finally {\n  const reportName=',
    'finally {\n  await globalThis.__officialFunctionalHook.finish({page});\n  await globalThis.__officialFunctionalHook.onLegacyReport(report);\n  const reportName=','preserve raw checks');
  source=replaceOnce(source,'  await browser.close();await server.close();',
    '  await screenshotSession.detach().catch(()=>{}); await page.close(); await browser.close();await server.close();','close owned page only');
  source=source.replaceAll('http://127.0.0.1:4178',baseURL);
  return source;
}

function installStandardResourceProbe(){
  const kinds=['Buffer','Texture','Framebuffer','Renderbuffer','VertexArray','Program','Shader','Query','Sampler','TransformFeedback'];
  const live=Object.fromEntries(kinds.map(k=>[k,new Set()])),created=Object.fromEntries(kinds.map(k=>[k,0])),deleted=Object.fromEntries(kinds.map(k=>[k,0]));
  for(const C of [globalThis.WebGLRenderingContext,globalThis.WebGL2RenderingContext].filter(Boolean))for(const kind of kinds){
    const create='create'+kind,remove='delete'+kind,originalCreate=C.prototype[create],originalDelete=C.prototype[remove];
    if(typeof originalCreate==='function'&&!originalCreate.__officialFunctional){const wrapped=function(...args){const value=originalCreate.apply(this,args);if(value){live[kind].add(value);created[kind]++;}return value;};wrapped.__officialFunctional=true;C.prototype[create]=wrapped;}
    if(typeof originalDelete==='function'&&!originalDelete.__officialFunctional){const wrapped=function(value,...args){const result=originalDelete.call(this,value,...args);if(value&&live[kind].delete(value))deleted[kind]++;return result;};wrapped.__officialFunctional=true;C.prototype[remove]=wrapped;}
  }
  const callbacks=new Set(),raf=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;
  window.requestAnimationFrame=function(callback){let id;id=raf.call(this,function(time){callbacks.delete(id);return callback.call(this,time);});callbacks.add(id);return id;};
  window.cancelAnimationFrame=function(id){callbacks.delete(id);return cancel.call(this,id);};
  const contextEvents=[];
  document.addEventListener('webglcontextlost',()=>contextEvents.push({type:'lost',at:performance.now()}),true);
  document.addEventListener('webglcontextrestored',()=>contextEvents.push({type:'restored',at:performance.now()}),true);
  window.__officialFunctionalProbe={snapshot:()=>({live:Object.fromEntries(kinds.map(k=>[k,live[k].size])),created:{...created},deleted:{...deleted},pendingRAF:callbacks.size,contextEvents:[...contextEvents]})};
}

async function twoFrames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function ready(page,id){
  await page.waitForFunction(id=>{
    const api=window.__CRY_OFFICIAL__,s=api?.snapshot();if(!s||s.referenceId!==id)return false;
    const d=s.moduleDetails;return d?.ready!==false&&d?.status!=='loading'||Boolean(d?.error);
  },id,{timeout:120000});
  const result=await page.evaluate(()=>window.__CRY_OFFICIAL__.snapshot());
  assert.ok(!result.moduleDetails?.error,String(result.moduleDetails?.error));assert.notEqual(result.moduleDetails?.status,'failed');return result;
}

async function auditIndependentTraces(page){
  const description=await page.evaluate(()=>{
    const api=window.__CRY_OFFICIAL__,inspection=api?.inspect?.();
    if(!inspection||typeof api.auditData!=='function')return{supported:false,reason:'contractVersion 1 inspect/auditData unavailable'};
    const covered=new Set(inspection.traces.map(t=>t.series)),uncovered=[];
    for(const [chartIndex,c]of inspection.charts.entries()){
      if(!Array.isArray(c.series)){uncovered.push({chartIndex,reason:'Chart does not expose a series-list audit scope'});continue;}
      for(const [seriesIndex,s]of c.series.entries())if(!covered.has(s)&&(!s.isDisposed?.())&&(typeof s.getSampleCount!=='function'||s.getSampleCount()>0))uncovered.push({chartIndex,seriesIndex,name:s.getName?.(),reason:'Rendered series has no independent trace source in this audit'});
    }
    return{supported:true,uncovered,traces:inspection.traces.map((t,index)=>{const points=Array.isArray(t.points)?t.points:undefined,expected=t.pointCount??points?.length;return{index,name:t.name,independentArray:!!points?.length,expected,sourceArrayLength:points?.length,declaredPointCount:t.pointCount,declaredPointCountValid:t.pointCount===undefined||!!points&&Number.isInteger(t.pointCount)&&t.pointCount>=0&&t.pointCount<=points.length,expectedFields:points?.length&&expected>0?['x','y','z','low','high','value'].filter(k=>k in points[0]):[]};})};
  });
  if(!description.supported||!description.traces.length)return{status:'unsupported',reason:description.reason??'No independently sourced traces; module-specific oracle required',traces:[]};
  const traces=[];
  for(const trace of description.traces){
    let offset=0,total=0,mismatches=0,firstMismatch,actualCount,expectedCount,countMatches,comparedFields;
    for(;;){
      const chunk=await page.evaluate(options=>window.__CRY_OFFICIAL__.auditData(options),{traceIndex:trace.index,offset,chunkSize:16384});
      if(!chunk.supported){traces.push({...trace,status:'unsupported',reason:chunk.reason});break;}
      assert.equal(chunk.oracle,'independent-input-point-array','Only independent input arrays qualify for this generic data oracle');
      actualCount=chunk.actualCount;expectedCount=chunk.expectedCount;countMatches=chunk.countMatches;
      comparedFields=chunk.comparedFields??['x','y'];total+=chunk.countCompared;mismatches+=chunk.mismatchCount;firstMismatch??=chunk.firstMismatch;
      if(chunk.done){
        const unverifiedFields=trace.expectedFields.filter(f=>!comparedFields.includes(f));
        traces.push({...trace,status:!countMatches||mismatches||total!==expectedCount?'failed':unverifiedFields.length?'pending':'passed',oracle:chunk.oracle,actualCount,expectedCount,countCompared:total,countMatches,mismatchCount:mismatches,firstMismatch,comparedFields,unverifiedFields});break;
      }
      if(!(chunk.nextOffset>offset))throw new Error('Bounded source audit did not advance');offset=chunk.nextOffset;
    }
  }
  return{status:traces.some(t=>t.status==='failed')?'failed':traces.every(t=>t.status==='passed')&&!description.uncovered.length?'passed':traces.every(t=>t.status==='unsupported')?'unsupported':'pending',countCompared:traces.reduce((n,t)=>n+(t.countCompared??0),0),uncoveredRenderedSeries:description.uncovered,scope:'Only independently supplied trace fields, not all chart values or all metadata',traces};
}

export const deriveCaseResult=resolveCaseEvidence;

export async function run(options){
  const contractPath=join(ROOT,'examples/official/functional-contracts.json'),contractBytes=await readFile(contractPath),contracts=JSON.parse(contractBytes);
  const sourcePath=join(ROOT,'examples/official/test-visible.mjs'),sourceBytes=await readFile(sourcePath),source=sourceBytes.toString('utf8');
  const known=new Map(contracts.examples.map(e=>[e.id,e])),ids=options.ids.length?options.ids:[...known.keys()];
  for(const id of ids)if(!known.has(id))throw new RangeError(`Unknown exact catalog ID: ${id}`);
  const officialPath=join(ROOT,'dist/official.js'),bundleSHA256=hash(await readFile(officialPath));
  if(options.expectedSHA)assert.equal(bundleSHA256,options.expectedSHA,'Requested official bundle SHA differs from disk');
  const directory=resolve(options.out??join(ROOT,'codex_artifact/official-functional-visible',stamp()));
  const adapter=adaptLegacyHarness(source,{directory,baseURL:options.baseURL,ids,helperURL:pathToFileURL(join(ROOT,'scripts/visible-browser.mjs')).href});
  const identity={sessionId:contracts.sessionId,coreSHA256:hash(await readFile(join(ROOT,'dist/crychart.js'))),bundleSHA256,executedBundle:'dist/official.js',coreFileRole:'disk build metadata; the standalone core file is not separately executed by the official page',contractsSHA256:hash(contractBytes),legacyHarnessSHA256:hash(sourceBytes),adapterSHA256:hash(adapter),driverSHA256:hash(await readFile(fileURLToPath(import.meta.url)))};
  if(options.dryRun){console.log(JSON.stringify({mode:'dry-run-no-browser',identity,baseURL:options.baseURL,selected:ids.length,legacyMapped:ids.filter(id=>known.get(id).legacyChecks.length>0).length,IDs:ids,output:directory}));return;}
  const specialized=await loadSpecializedEvidence(ids.map(id=>known.get(id)),ROOT);
  if(options.evidenceOnly){
    let previous,legacy={examples:[],checks:[]};
    if(options.reconcile){previous=JSON.parse(await readFile(resolve(options.reconcile),'utf8'));assert.equal(previous.identity?.bundleSHA256,bundleSHA256,'Reconcile must use the same current executed official bundle');assert.equal(previous.identity?.legacyHarnessSHA256,identity.legacyHarnessSHA256,'Legacy check source changed');legacy=JSON.parse(await readFile(join(dirname(resolve(options.reconcile)),'legacy-checks.json'),'utf8'));}
    const cases=ids.map(id=>deriveCaseResult(previous?.cases.find(c=>c.id===id)??{id,errors:[]},known.get(id),legacy,specialized.get(id)));
    const summary={selected:ids.length,functionallyComplete:cases.filter(c=>c.functionalComplete).length,failed:cases.filter(c=>c.status==='failed').length,incomplete:cases.filter(c=>c.status==='incomplete').length};
    const report={schemaVersion:2,kind:'official-functional-visible',mode:'offline-source-evidence-reconciliation',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),identity,selectedIds:ids,browserVisible:false,evidenceBrowserVisible:true,performanceAcceptance:false,fullReferenceEquivalence:false,reconciledLiveReport:options.reconcile&&resolve(options.reconcile),cases,summary,status:summary.failed?'failed':summary.functionallyComplete===ids.length?'passed':'incomplete',scope:'No new browser run. Prior visible specialized checks are eligible only under their pinned report/bundle and reviewed current-source bindings. Source-function validation is separate from reference/pixel parity.'};
    await mkdir(directory,{recursive:true});await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:join(directory,'report.json'),summary,status:report.status}));process.exitCode=summary.failed?1:summary.incomplete?2:0;return;
  }
  const response=await fetch(options.baseURL+'/examples/official/index.html');assert.ok(response.ok,`Official server unavailable: ${response.status}`);
  const served=await fetch(options.baseURL+'/dist/official.js');assert.ok(served.ok);assert.equal(hash(Buffer.from(await served.arrayBuffer())),bundleSHA256,'Served official bundle differs before run');
  await mkdir(directory,{recursive:true});await writeFile(join(directory,'legacy-adapter.mjs'),adapter);await writeFile(join(directory,'contracts.json'),contractBytes);
  const report={schemaVersion:1,kind:'official-functional-visible',startedAt:new Date().toISOString(),identity,baseURL:options.baseURL,selectedIds:ids,browserVisible:true,performanceAcceptance:false,fullReferenceEquivalence:false,protocol:{reuse:'Unmodified specialized check bodies from the SHA-pinned legacy harness',data:'Bounded independent trace source audit; unsupported is retained',lifecycle:'Explicit dispose twice, rebuild, dispose; standard GL object counters are not GPU resident memory',completion:'Every required feature must have a reviewed mapping; colored pixels do not establish interaction or equivalence'},cases:[],errors:[]};
  const records=new Map(),visited=new Set();let active,legacy={examples:[],checks:[],errors:[],captures:[]};
  const save=()=>writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  async function finish({page}){
    if(!active)return;const current=active;active=undefined;const record=records.get(current);
    try{
      const contract=await page.evaluate(()=>({version:window.__CRY_OFFICIAL__?.contractVersion,methods:['dispose','lifecycle','inspect','auditData'].filter(k=>typeof window.__CRY_OFFICIAL__?.[k]==='function')}));
      record.testInterface=contract;
      if(contract.version!==1||contract.methods.length!==4){record.data={status:'unsupported',reason:'Required test interface version 1 is unavailable'};record.lifecycle={status:'unsupported',reason:'Required test interface version 1 is unavailable'};return;}
      // Real pause control prevents a live producer from changing data during a bounded audit.
      const before=await page.evaluate(()=>window.__CRY_OFFICIAL__.snapshot());
      if(!before.paused&&await page.locator('#official-pause').isEnabled())await page.locator('#official-pause').click();
      await twoFrames(page);
      const declared=known.get(current)?.dataAudit;
      record.data=declared?.genericUnsupportedReason?{status:'unsupported',reason:declared.genericUnsupportedReason,requiredOracle:declared.requiredOracle}:await auditIndependentTraces(page);
      record.beforeDispose=await page.evaluate(()=>({snapshot:window.__CRY_OFFICIAL__.snapshot(),lifecycle:window.__CRY_OFFICIAL__.lifecycle(),resources:window.__officialFunctionalProbe.snapshot()}));
      await page.evaluate(()=>window.__CRY_OFFICIAL__.dispose());await twoFrames(page);
      const once=await page.evaluate(()=>({lifecycle:window.__CRY_OFFICIAL__.lifecycle(),resources:window.__officialFunctionalProbe.snapshot(),canvasCount:document.querySelectorAll('#official-stage canvas').length}));
      assert.equal(once.lifecycle.mounted,false);assert.equal(once.lifecycle.pendingOwnRAF,false);assert.equal(once.lifecycle.chartCount,0);assert.equal(once.canvasCount,0);
      assert.equal(once.lifecycle.lastDisposal?.ownedAfter,0);assert.equal(once.lifecycle.lastDisposal?.contextDisposed,true);assert.equal(once.lifecycle.lastDisposal?.chartsDisposed,true);assert.deepEqual(once.lifecycle.lastDisposal?.errors,[]);
      assert.ok(Object.values(once.resources.live).every(n=>n===0),'All tracked standard GL objects must be released');
      assert.equal(once.resources.pendingRAF,0,'No case-owned queued animation frame may survive disposal');
      await page.evaluate(()=>window.__CRY_OFFICIAL__.dispose());await twoFrames(page);
      const twice=await page.evaluate(()=>window.__CRY_OFFICIAL__.lifecycle());assert.equal(twice.disposals,once.lifecycle.disposals,'Dispose must be idempotent');
      await page.evaluate(id=>window.__CRY_OFFICIAL__.mount(id),current);const restored=await ready(page,current);await twoFrames(page);
      assert.ok(restored.charts.length>0);assert.equal(restored.referenceId,current);
      await page.evaluate(()=>window.__CRY_OFFICIAL__.dispose());await twoFrames(page);
      const last=await page.evaluate(()=>({lifecycle:window.__CRY_OFFICIAL__.lifecycle(),resources:window.__officialFunctionalProbe.snapshot(),canvasCount:document.querySelectorAll('#official-stage canvas').length}));
      assert.equal(last.lifecycle.chartCount,0);assert.equal(last.lifecycle.pendingOwnRAF,false);assert.equal(last.canvasCount,0);assert.equal(last.resources.pendingRAF,0);assert.ok(Object.values(last.resources.live).every(n=>n===0));
      record.lifecycle={status:'passed',once,twice,restored:{id:restored.referenceId,charts:restored.charts.length},last,scope:'Case-owned chart/RAF/DOM and intercepted GL object lifetimes; heap/RSS and module-external listeners are not certified'};
    }catch(error){record.errors.push(plainError(error));record.lifecycle={status:'failed',error:plainError(error)};await page.evaluate(()=>window.__CRY_OFFICIAL__?.dispose?.()).catch(()=>{});}
    finally{record.finishedAt=new Date().toISOString();report.cases=[...records.values()];await save();}
  }
  const previousHook=globalThis.__officialFunctionalHook,previousExitCode=process.exitCode;
  globalThis.__officialFunctionalHook={
    async preparePage(page){await page.addInitScript(installStandardResourceProbe);},
    async beforeMount({id,page}){await finish({page});active=id;visited.add(id);records.set(id,{id,startedAt:new Date().toISOString(),errors:[]});},
    async prepareExample({id,page}){
      if(id!=='crychart-example-0039-audioVisualization')return;
      const before=await page.evaluate(()=>window.__CRY_OFFICIAL__.snapshot().moduleDetails);
      if(!before.playing)await page.locator('[data-control="audio-toggle"]').click();
      await page.waitForFunction(()=>{const d=window.__CRY_OFFICIAL__.snapshot().moduleDetails;return d.playing&&d.currentTime>.08&&d.samples>0;},undefined,{timeout:15000});
      records.get(id).mountActions=[{action:'real audio play button',before,after:await page.evaluate(()=>window.__CRY_OFFICIAL__.snapshot().moduleDetails),scope:'Required click-to-start consumer flow; does not replace the independent audio PCM/interaction oracle'}];
    },
    async onMountFailure({id,error}){const record=records.get(id)??{id,errors:[]};record.errors.push(plainError(error));record.mountFailure=plainError(error);records.set(id,record);await save();},
    async afterMount({id,page,initial,paint}){const record=records.get(id);record.initial=initial;record.paint=paint;record.capabilities=await page.evaluate(()=>({contractVersion:window.__CRY_OFFICIAL__?.contractVersion,definition:window.__CRY_OFFICIAL__?.inspect?.().definition?.id}));},
    finish,
    async runUnvisited({page,mount}){
      const available=new Set(await page.evaluate(()=>window.__CRY_OFFICIAL__?.definitions?.map(x=>x.id)??[]));
      for(const id of ids){if(visited.has(id))continue;if(!available.has(id)){records.set(id,{id,errors:[],status:'not-implemented',unavailableReason:'Exact ID is absent from this executed official bundle'});continue;}
        try{await mount(id);await finish({page});}catch(error){const record=records.get(id)??{id,errors:[]};record.errors.push(plainError(error));records.set(id,record);await finish({page});}
      }
    },
    async onLegacyReport(value){legacy=value;await writeFile(join(directory,'legacy-checks.json'),JSON.stringify(value,null,2)+'\n');}
  };
  try{await import(pathToFileURL(join(directory,'legacy-adapter.mjs')).href+'?sha='+identity.adapterSHA256);}
  catch(error){report.errors.push(plainError(error));}
  finally{
    globalThis.__officialFunctionalHook=previousHook;process.exitCode=previousExitCode;
    report.finishedAt=new Date().toISOString();
    report.cases=ids.map(id=>deriveCaseResult(records.get(id)??{id,errors:[],unavailableReason:'Not reached by the harness'},known.get(id),legacy,specialized.get(id)));
    report.legacyErrors=legacy.errors;report.legacyCaptures=legacy.captures;report.browser=legacy.browser;report.viewport=legacy.viewport;
    report.summary={selected:ids.length,mounted:legacy.examples.length,legacyChecks:legacy.checks.length,legacyPassed:legacy.checks.filter(c=>c.status==='passed').length,functionallyComplete:report.cases.filter(c=>c.functionalComplete).length,failed:report.cases.filter(c=>c.status==='failed').length,incomplete:report.cases.filter(c=>c.status==='incomplete').length};
    report.status=report.errors.length||report.summary.failed||legacy.errors.length?'failed':report.summary.functionallyComplete===ids.length?'passed':'incomplete';await save();
  }
  console.log(JSON.stringify({report:join(directory,'report.json'),status:report.status,summary:report.summary,identity}));
  if(report.status==='failed')process.exitCode=1;else if(report.status==='incomplete')process.exitCode=2;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await run(parseOptions(process.argv.slice(2)));
