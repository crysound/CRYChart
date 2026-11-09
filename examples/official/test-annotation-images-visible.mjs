import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const arg=new Map();for(let i=2;i<process.argv.length;i+=2)arg.set(process.argv[i],process.argv[i+1]);
const base=arg.get('--base')??'http://127.0.0.1:4180',cases=(arg.get('--cases')??'0025,0054,0055,0056').split(','),stamp=new Date().toISOString().replace(/[:.]/g,'-'),directory=resolve('codex_artifact/functional-priority/annotation-images',stamp);
await mkdir(directory,{recursive:true});const sha=value=>createHash('sha256').update(value).digest('hex');
const sources=['examples/official/annotation-images.ts','examples/official/annotation-images-data.ts','examples/official/controls.ts','examples/official/helpers.ts'];
const sourceSHA256=Object.fromEntries(await Promise.all(sources.map(async file=>[file,sha(await readFile(file))])));
const fixture=`import {cryChart,Themes} from ${JSON.stringify(resolve('src/index.ts').replaceAll('\\','/'))};
import {annotationImageEntries} from ${JSON.stringify(resolve('examples/official/annotation-images.ts').replaceAll('\\','/'))};
let mounted:any,engine:any,frame=0,elapsed=0,last=0,paused=true;
const host=document.querySelector('#stage') as HTMLElement;
const render=()=>mounted?.charts.forEach((c:any)=>c.renderNow());
function stop(){cancelAnimationFrame(frame);frame=0;if(!mounted)return;const old=mounted;old.dispose?.();const detail=old.snapshot?.();engine.dispose();const result={detail,engineCharts:engine.getChartCount(),canvases:host.querySelectorAll('canvas').length,disposedCharts:old.charts.map((c:any)=>c.isDisposed())};mounted=undefined;host.replaceChildren();return result;}
function tick(time:number){if(!mounted)return;if(!paused){elapsed+=last?(time-last)/1000:0;mounted.update?.(elapsed,0);}last=time;frame=requestAnimationFrame(tick);}
const api={mount(id:string){stop();engine=cryChart();elapsed=0;last=0;paused=true;mounted=annotationImageEntries.find(e=>e.id.includes('-'+id+'-'))!.mount!({host,engine,theme:Themes.darkGold??Themes.dark});render();frame=requestAnimationFrame(tick);},
 get charts(){return mounted?.charts??[];},get traces(){return mounted?.traces??[];},
 snapshot(){return{detail:mounted?.snapshot?.(),charts:mounted?.charts.map((c:any)=>({plot:{...c.plot},width:c.width,height:c.height,x:c.getDefaultAxisX().getInterval(),y:c.getDefaultAxisY().getInterval(),series:c.getSeries().map((s:any)=>({name:s.getName?.(),count:s.getSampleCount?.(),visible:s.getVisible?.()}))})),engineCharts:engine?.getChartCount()};},
 pause(value:boolean){paused=value;last=0;},advance(value:number){elapsed=value;mounted.update?.(elapsed,0);render();},render,dispose:stop};
(window as any).__ANN=api;`;
const buildInputs={};
await writeFile(resolve(directory,'fixture.ts'),fixture);await build({entryPoints:[resolve(directory,'fixture.ts')],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:resolve(directory,'fixture.js'),plugins:[{name:'capture-actual-build-inputs',setup(builder){builder.onLoad({filter:/\.(ts|js|json)$/},async({path})=>{const bytes=await readFile(path),name=relative(process.cwd(),path).replaceAll('\\','/');buildInputs[name]={sha256:sha(bytes),bytes:bytes.length};return{contents:bytes.toString('utf8'),loader:path.endsWith('.ts')?'ts':path.endsWith('.json')?'json':'js'};});}}]});
await writeFile(resolve(directory,'build-inputs.json'),JSON.stringify({inputs:buildInputs,method:'SHA-256 of bytes returned by the esbuild onLoad callback; includes actual core and example imports.'},null,2)+'\n');
const buildInputsManifest={path:'build-inputs.json',sha256:sha(await readFile(resolve(directory,'build-inputs.json'))),files:Object.keys(buildInputs).length};
const bundleSHA256=sha(await readFile(resolve(directory,'fixture.js'))),urlPath='/'+relative(process.cwd(),directory).replaceAll('\\','/'),css=(await readFile('examples/official/index.html','utf8')).match(/<style>([\s\S]*?)<\/style>/)[1];
await writeFile(resolve(directory,'index.html'),`<!doctype html><meta charset="utf-8"><title>Image annotations · functional checks</title><style>${css}body{padding:20px}#stage{position:relative;display:flex;flex-direction:column;width:942px;height:700px;background:#101112;border:1px solid #40544b;margin:auto;overflow:hidden}</style><h1>Original image annotation examples</h1><div id="stage"></div><script type="module" src="${urlPath}/fixture.js"></script>`);
const report={createdAt:new Date().toISOString(),sourceSHA256,buildInputsManifest,bundleSHA256,checks:[],errors:[],screenshots:[],browserVisible:true,headless:false,performanceRun:false,sharedDistModified:false,scope:'Original example-layer functionality. Current public reference descriptions and images define purposes; these assertions do not establish pixel equality or general ImageFill API compatibility.'};
const save=()=>writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
const bytes=await fetch(base+urlPath+'/fixture.js').then(r=>r.arrayBuffer());assert.equal(sha(Buffer.from(bytes)),bundleSHA256);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223'),page=await browser.contexts()[0].newPage();await page.setViewportSize({width:1280,height:960});await page.bringToFront();page.on('pageerror',e=>report.errors.push(String(e)));
let id='';const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const snapshot=()=>page.evaluate(()=>window.__ANN.snapshot());
const details=state=>state.detail.imageLayers?.[0]??state.detail.imageLayer;
async function check(name,run){try{report.checks.push({id,name,passed:true,evidence:await run()});}catch(error){report.checks.push({id,name,passed:false,error:error.stack??String(error)});}await save();}
async function capture(name){const file=`${id}-${name}.png`;await page.screenshot({path:resolve(directory,file)});report.screenshots.push({file,sha256:sha(await readFile(resolve(directory,file)))});}
const overlay=()=>page.locator('#stage .crychart').first().locator(':scope > canvas').last();
async function atMarker(){const s=await snapshot(),layer=details(s),target=layer.rendered.find(r=>r.bounds.left>=r.clip.left+2&&r.bounds.top>=r.clip.top+2&&r.bounds.left+r.bounds.width<=r.clip.left+r.clip.width-2&&r.bounds.top+r.bounds.height<=r.clip.top+r.clip.height-2);assert(target,'At least one complete image must be visible');const box=await overlay().boundingBox();const local={x:target.bounds.left+target.bounds.width/2,y:target.bounds.top+target.bounds.height/2};await page.mouse.move(box.x+local.x,box.y+local.y);await settle();return{target,local,box};}
async function markerPixels(){return page.evaluate(async()=>{
 const api=window.__ANN,c=api.charts[0];c.renderNow();const state=api.snapshot().detail,layer=state.imageLayers?.[0]??state.imageLayer,markerSeries=c.getSeries().filter(s=>s.kind==='points'),clip={...c.plot},overlay=c.overlay,ctx=overlay.getContext('2d');
 const visible=ctx.getImageData(0,0,overlay.width,overlay.height).data;
 const exportPixels=async()=>{const blob=await c.exportToImage(),bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return{blob,data:context.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height};};
 // The exact same PNG/readback sequence precedes both comparison states.
 // Preserve no-op differences rather than attributing them to hide/restore.
 let exported,idleRepeat=visible;const noMutationSequence=[];
 for(let pass=0;pass<4;pass++){exported=await exportPixels();c.renderNow();const next=ctx.getImageData(0,0,overlay.width,overlay.height).data;let differingBytes=0,maximumDifference=0;for(let i=0;i<visible.length;i++)if(idleRepeat[i]!==next[i]){differingBytes++;maximumDifference=Math.max(maximumDifference,Math.abs(idleRepeat[i]-next[i]));}noMutationSequence.push({pass,differingBytes,maximumDifference});idleRepeat=next;}
 const noMutationDifferences=noMutationSequence[0].differingBytes,maximumNoMutationDifference=noMutationSequence[0].maximumDifference,stableNoMutation=noMutationSequence.slice(-2).every(item=>item.differingBytes===0);
 const beforeGeometry={plot:{...c.plot},x:c.getDefaultAxisX().getInterval(),y:c.getDefaultAxisY().getInterval(),markers:layer.rendered},old=markerSeries.map(s=>s.getVisible());markerSeries.forEach(s=>s.setVisible(false));c.renderNow();const hidden=ctx.getImageData(0,0,overlay.width,overlay.height).data,hiddenExport=await exportPixels();let overlayChanged=0,exportChanged=0,outside=0;
 for(let offset=0;offset<visible.length;offset+=4){const changed=idleRepeat[offset]!==hidden[offset]||idleRepeat[offset+1]!==hidden[offset+1]||idleRepeat[offset+2]!==hidden[offset+2]||idleRepeat[offset+3]!==hidden[offset+3];if(changed){overlayChanged++;const pixel=offset/4,x=pixel%overlay.width,y=Math.floor(pixel/overlay.width),left=Math.floor(clip.left*c.dpr),right=Math.ceil((clip.left+clip.width)*c.dpr),top=Math.floor(clip.top*c.dpr),bottom=Math.ceil((clip.top+clip.height)*c.dpr);if(x<left||x>=right||y<top||y>=bottom)outside++;}
  if(exported.data[offset]!==hiddenExport.data[offset]||exported.data[offset+1]!==hiddenExport.data[offset+1]||exported.data[offset+2]!==hiddenExport.data[offset+2]||exported.data[offset+3]!==hiddenExport.data[offset+3])exportChanged++;
 }
 markerSeries.forEach((s,i)=>s.setVisible(old[i]));c.renderNow();const immediate=ctx.getImageData(0,0,overlay.width,overlay.height).data;
 // Compare the actual exported PNG first. The subsequent raw readback uses
 // the same export -> render -> readback sequence as the original baseline.
 const restoredExport=await exportPixels();let exportRestoreDifferences=0;for(let i=0;i<exported.data.length;i++)if(exported.data[i]!==restoredExport.data[i])exportRestoreDifferences++;
 c.renderNow();const restored=ctx.getImageData(0,0,overlay.width,overlay.height).data;let restoreDifferences=0,immediateRestoreDifferences=0,initialRestoreDifferences=0,maximumRestoreDifference=0;const firstRestoreDifferences=[];for(let i=0;i<visible.length;i++){if(idleRepeat[i]!==immediate[i])immediateRestoreDifferences++;if(visible[i]!==restored[i])initialRestoreDifferences++;if(idleRepeat[i]!==restored[i]){restoreDifferences++;maximumRestoreDifference=Math.max(maximumRestoreDifference,Math.abs(idleRepeat[i]-restored[i]));if(firstRestoreDifferences.length<12)firstRestoreDifferences.push({x:Math.floor(i/4)%overlay.width,y:Math.floor(i/4/overlay.width),component:i%4,before:idleRepeat[i],after:restored[i]});}}
 const bytes=new Uint8Array(await exported.blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 const restoredDetail=api.snapshot().detail,restoredLayer=restoredDetail.imageLayers?.[0]??restoredDetail.imageLayer,afterGeometry={plot:{...c.plot},x:c.getDefaultAxisX().getInterval(),y:c.getDefaultAxisY().getInterval(),markers:restoredLayer.rendered};
 return{overlayChanged,exportChanged,outside,restoreDifferences,exportRestoreDifferences,immediateRestoreDifferences,initialRestoreDifferences,maximumRestoreDifference,firstRestoreDifferences,noMutationDifferences,maximumNoMutationDifference,noMutationSequence,stableNoMutation,restoreReference:'actual exportToImage PNG bytes before/after, then symmetric export -> render -> raw readback; immediate pre-export raw differences separately preserved',geometryEqual:JSON.stringify(beforeGeometry)===JSON.stringify(afterGeometry),beforeGeometry,afterGeometry,rendered:layer.rendered.length,canvasCount:c.root.querySelectorAll(':scope > canvas').length,width:exported.width,height:exported.height,png:btoa(binary)};
 });}
try{
 await page.goto(base+urlPath+'/index.html');await page.waitForFunction(()=>!!window.__ANN);
 for(id of cases){await page.evaluate(id=>window.__ANN.mount(id),id);await settle();
  await check('all source values satisfy independent original-data oracles',async()=>{const result=await page.evaluate(id=>{
   const api=window.__ANN,d=api.snapshot().detail;let checked=0,errors=[];
   if(id==='0025'){const values=api.charts[0].getSeries().find(s=>s.getSampleCount()===6300).data;for(let row=0;row<70;row++)for(let col=0;col<90;col++){const x=(col+.5)*100/90,y=(row+.5)*75/70,inPlan=x>=5&&x<90&&y>=5&&y<70,dist=Math.hypot(x-61,y-14)+(x<40?12:0)+(y>42?6:0),expected=!inPlan?0:dist<22?3:dist<43?2:1;if(values[row*90+col]!==expected)errors.push([row,col]);checked++;}}
   if(id==='0054'||id==='0055'){api.traces.forEach((trace,channel)=>{for(let i=0;i<trace.series.getSampleCount();i++){const p=trace.series.getSample(i),index=p.x/20,expected=id==='0054'?50+28*Math.sin(index*.026)+8*Math.sin(index*.109):.5+.35*Math.sin(index*.071+channel)+.1*Math.sin(index*.23+channel*2);if(p.y!==expected)errors.push([channel,i]);checked++;}});if(id==='0054')for(const event of d.events){const prev=50+28*Math.sin((event.id-1)*.026)+8*Math.sin((event.id-1)*.109);if(!(prev<70&&event.y>=70&&event.x===event.id*20))errors.push(['event',event.id]);checked++;}}
   if(id==='0056'){for(const trace of api.traces)for(let i=0;i<trace.series.getSampleCount();i++){const p=trace.series.getSample(i),source=trace.points[i],day=Math.floor(source.id/12),sample=source.id%12,expectedX=6+((source.id*137+day*31)%1020)/60,expectedY=Date.UTC(2026,0,5)+(day+((sample*83+day*17)%1000)/1000)*86400000;if(p.x!==expectedX||p.y!==expectedY)errors.push(source.id);checked++;}}
   return{checked,errors,kind:d.kind};},id);assert.equal(result.errors.length,0);assert(result.checked>0);return result;});
  if(id==='0055'){
   await check('trusted palette drag creates a real timestamped flag in each axis stack',async()=>{
    const results=[];for(const [channel,kind]of['red','green','blue'].entries()){
     const point=await page.evaluate(channel=>{const c=window.__ANN.charts[0],series=c.getSeries().filter(s=>s.kind==='points')[channel],r=c.getSeriesScreenRect(series);return{x:r.left+r.width*.63,y:r.top+r.height*.48};},channel);
     await page.locator(`.annotation-palette [data-kind="${kind}"]`).dragTo(overlay(),{targetPosition:point,timeout:5000});await settle();const s=await snapshot(),flag=s.detail.flags.at(-1);assert.equal(flag?.kind,kind);assert.equal(flag.channel,channel);results.push(flag);
    }assert.equal((await snapshot()).detail.flags.length,3);return{flags:results,input:'Playwright trusted pointer drag with native HTML drag/drop'};
   });
   await check('placed flag drag changes source coordinates while keeping its identity',async()=>{
    const s=await snapshot(),original=s.detail.flags[1],r=details(s).rendered.find(r=>r.id===original.id),box=await overlay().boundingBox(),from={x:box.x+r.bounds.left+r.bounds.width*.6,y:box.y+r.bounds.top+r.bounds.height*.3};
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+35,from.y+8,{steps:5});await page.mouse.up();await settle();const moved=(await snapshot()).detail.flags.find(f=>f.id===original.id);assert(moved.x>original.x);assert(moved.y<original.y);assert.equal(moved.kind,original.kind);assert.equal((await snapshot()).detail.flags.length,3);return{original,moved};
   });
  }
  await check('image hit identifies an actual clipped source record and hidden sources cannot be hit',async()=>{
   const {local}=await atMarker(),s=await snapshot(),layer=details(s),expected=[...layer.rendered].reverse().find(r=>local.x>=Math.max(r.bounds.left,r.clip.left)&&local.x<=Math.min(r.bounds.left+r.bounds.width,r.clip.left+r.clip.width)&&local.y>=Math.max(r.bounds.top,r.clip.top)&&local.y<=Math.min(r.bounds.top+r.bounds.height,r.clip.top+r.clip.height));assert.equal(layer.hover?.id,expected.id);
   await page.evaluate(()=>{const c=window.__ANN.charts[0];c.getSeries().filter(s=>s.kind==='points').forEach(s=>s.setVisible(false));c.renderNow();});assert.equal(details(await snapshot()).hover,undefined);
   await page.evaluate(()=>{const c=window.__ANN.charts[0];c.getSeries().filter(s=>s.kind==='points').forEach(s=>s.setVisible(true));c.renderNow();});await page.mouse.move(1,1);await settle();
   await page.waitForFunction(()=>window.__ANN.charts.flatMap(c=>[...c.axesX,...c.axesY].flatMap(a=>a.annotations)).every(a=>a.getHighlightStrength()===0),null,{timeout:3000});return{expectedId:expected.id,hiddenHit:false,annotationHighlightSettled:true};
  });
  await check('native image pixels occur in exported PNG and restoration is byte-exact',async()=>{const result=await markerPixels();const file=`${id}-export.png`;await writeFile(resolve(directory,file),Buffer.from(result.png,'base64'));delete result.png;(report.pixelDiagnostics??=[]).push({id,...result});await save();assert.equal(result.stableNoMutation,true);assert.equal(result.geometryEqual,true);assert(result.overlayChanged>20);assert(result.exportChanged>20);assert.equal(result.outside,0);assert.equal(result.exportRestoreDifferences,0);assert.equal(result.restoreDifferences,0);assert.equal(result.canvasCount,3);return{...result,file};});
  await check('axis boundary clips images and resize reprojects the unchanged source data',async()=>{
   const initial=await snapshot(),first=details(initial).rendered.find(r=>r.bounds.left>r.clip.left+10&&r.bounds.top>r.clip.top+10);assert(first);const span=initial.charts[0].x.end-initial.charts[0].x.start;
   await page.evaluate(({x,span})=>{const c=window.__ANN.charts[0];c.getDefaultAxisX().setInterval({start:x,end:x+span});c.renderNow();},{x:first.x,span});const clipped=await snapshot(),marker=details(clipped).rendered.find(r=>r.id===first.id);assert(marker.bounds.left<marker.clip.left);assert(marker.bounds.left+marker.bounds.width>marker.clip.left);
   const pixels=await markerPixels();assert.equal(pixels.outside,0);delete pixels.png;
   await page.evaluate(interval=>{window.__ANN.charts[0].getDefaultAxisX().setInterval(interval);document.querySelector('#stage').style.width='760px';},initial.charts[0].x);await page.waitForFunction(()=>window.__ANN.charts[0].width<800);await settle();const resized=await snapshot(),after=details(resized).rendered.find(r=>r.id===first.id);assert(after);assert.notEqual(after.bounds.left,first.bounds.left);assert.equal(after.x,first.x);assert.equal(after.y,first.y);
   await page.evaluate(()=>document.querySelector('#stage').style.width='942px');await settle();return{source:{id:first.id,x:first.x,y:first.y},before:first.bounds,clipped:marker.bounds,resized:after.bounds,clippingOutsideDifferences:pixels.outside};
  });
  if(id==='0054'||id==='0055')await check('streaming advances real samples while image timestamps remain bound to source',async()=>{const before=await snapshot();await page.evaluate(()=>window.__ANN.advance(3));const after=await snapshot();assert.equal(after.detail.nextSample,before.detail.nextSample+150);if(id==='0055')assert.deepEqual(after.detail.flags,before.detail.flags);else for(const event of after.detail.events)assert.equal(event.x,event.id*20);return{beforeSamples:before.detail.nextSample,afterSamples:after.detail.nextSample,images:id==='0055'?after.detail.flags.length:after.detail.events.length};});
  await capture('complete');
  await check('dispose releases image canvases/listeners, native charts, and chart DOM',async()=>{const result=await page.evaluate(()=>window.__ANN.dispose());assert.equal(result.engineCharts,0);assert.equal(result.canvases,0);assert(result.disposedCharts.every(Boolean));const layers=result.detail.imageLayers??[result.detail.imageLayer];for(const layer of layers){assert.equal(layer.disposed,true);assert.equal(layer.images,0);assert.equal(layer.rendered.length,0);}return{engineCharts:result.engineCharts,canvases:result.canvases,images:layers.map(l=>l.images),disposedCharts:result.disposedCharts};});
 }
 await page.evaluate(id=>window.__ANN.mount(id),cases.at(-1));await settle();report.finalVisibleRemountExcludedFromChecks=true;
}catch(error){report.errors.push(error.stack??String(error));}
finally{report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(c=>c.passed).length;report.failed=report.checks.filter(c=>!c.passed).length;await save();await browser.close();console.log(JSON.stringify({directory,passed:report.passed,failed:report.failed,errors:report.errors}));if(report.failed||report.errors.length)process.exitCode=1;}
