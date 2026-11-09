import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const label=args.get('--label')??'candidate',base=args.get('--base')??'http://127.0.0.1:4180';
const selected=new Set((args.get('--cases')??'0010,0550,0003,0901,1001,0701,0702,1402,0803').split(','));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const directory=resolve('codex_artifact/functional-priority/current',`${stamp}-${label}`);
await mkdir(directory,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=['examples/official/main.ts','examples/official/controls.ts','examples/official/statistics.ts','examples/official/interactions.ts','examples/official/interactions-data.ts','examples/official/spatial.ts','examples/official/spectrograms.ts','examples/official/spectrogram-data.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sources.map(async path=>[path,hash(await readFile(path))])));
const entry=resolve('examples/official/main.ts'),anchor='  (window as any).__CRY_OFFICIAL__ =';
await build({entryPoints:[entry],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:resolve(directory,'official.js'),plugins:[{
  name:'expose-local-public-chart-handles-for-functional-oracle',setup(b){b.onLoad({filter:/examples[\\/]official[\\/]main\.ts$/},async({path})=>{
    const original=await readFile(path,'utf8');assert.equal(original.split(anchor).length,2);
    const expose=original.includes('activeCharts()')?'get charts() { return activeCharts(); }, traces':'charts, traces';
    return{contents:original.replace(anchor,'  (window as any).__PRIORITY_HANDLES__ = {'+expose+'};\n'+anchor),loader:'ts',resolveDir:resolve('examples/official')};
  });}
}]});
const bundle=await readFile(resolve(directory,'official.js')),bundleSHA256=hash(bundle);
const path='/'+relative(process.cwd(),directory).replaceAll('\\','/');
const html=await readFile('examples/official/index.html','utf8');
assert.equal(html.split('src="/dist/official.js"').length,2);
await writeFile(resolve(directory,'index.html'),html.replace('src="/dist/official.js"',`src="${path}/official.js"`));
const report={createdAt:new Date().toISOString(),label,sourceHashes,bundleSHA256,base,directory,checks:[],errors:[],captures:[],
  scope:'New example-level functionality assertions. No reference equivalence or performance claim.',
  instrumentation:'Private build exposes existing chart/trace handles for public API readback; no data, geometry, selection, controls or source file changes are injected.',
  sharedDistModified:false,openTestExecuted:false,performanceRun:false};
const save=()=>writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
const serverBytes=await fetch(base+path+'/official.js').then(async r=>{assert(r.ok,'Final-root server must be running on '+base);return Buffer.from(await r.arrayBuffer());});
assert.equal(hash(serverBytes),bundleSHA256,'Served bytes differ from private frozen bundle');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=await browser.contexts()[0].newPage();
await page.setViewportSize({width:1360,height:1180});await page.bringToFront();
page.on('pageerror',e=>report.errors.push(String(e)));
const ids={
  '0010':'multiChannelLineProgressive','0550':'zoomBandChart','0003':'pointLinePlot','0901':'3dLineSeries','1001':'polarMicrophoneSensitivity',
  '0701':'bandsConstantlines','0702':'customCursor','1402':'histogram','0803':'scrollingHeatmap','0805':'spectrogramProjection'};
let current,mountSequence=0;
const settle=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const snapshot=()=>page.evaluate(()=>window.__CRY_OFFICIAL__.snapshot());
async function mount(id){current=id;await page.goto(base+path+'/index.html?mount='+(++mountSequence)+'#crychart-example-'+id+'-'+ids[id]);await page.waitForFunction(id=>window.__CRY_OFFICIAL__?.snapshot().referenceId.includes('-'+id+'-'),id);await settle();return snapshot();}
async function capture(name){const filename=`${current}-${name}.png`;await page.screenshot({path:resolve(directory,filename)});report.captures.push({file:filename,sha256:hash(await readFile(resolve(directory,filename)))});}
async function check(name,run){try{const evidence=await run();report.checks.push({id:current,name,passed:true,evidence});}catch(error){report.checks.push({id:current,name,passed:false,error:{name:error.name,message:error.message}});}await save();}
async function client(x,y,index=0){return page.evaluate(({x,y,index})=>{const chart=window.__PRIORITY_HANDLES__.charts[index],box=chart.overlay.getBoundingClientRect(),plot=chart.plot;return{x:box.left+plot.left+chart.getDefaultAxisX().valueToFraction(x)*plot.width,y:box.top+plot.top+(1-chart.getDefaultAxisY().valueToFraction(y))*plot.height};},{x,y,index});}
async function moveTo(x,y,index=0){const p=await client(x,y,index);await page.mouse.move(p.x,p.y);await settle();return p;}
async function visibleText(){return page.locator('#official-stage .shared-cursor-table:not([hidden])').allTextContents();}
async function drag(from,to){await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();await settle();}
const near=(actual,expected,tolerance=1e-8)=>assert(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
try{
 if(selected.has('1402')){
  const initial=await mount('1402'),bins=initial.moduleDetails.bins;
  await check('all bin centers display their independent recorded integer count',async()=>{for(let i=0;i<20;i++){await moveTo(-4+(i+.5)*.4,bins[i]/2);assert.match((await visibleText()).join(' '),new RegExp(`Count ${bins[i]}(?:\\D|$)`));}assert.equal(bins.reduce((a,b)=>a+b,0)+initial.moduleDetails.excluded,50000);return{bins:bins.length,counted:initial.moduleDetails.counted,excluded:initial.moduleDetails.excluded};});
  await check('legend-hidden histogram has no hit after pointer re-enters a former bar',async()=>{
   await page.locator('#official-stage .official-legend button').click();assert.equal((await snapshot()).traces[0].visible,false);
   await moveTo(.2,bins[10]/2);const visible=await visibleText();await capture('hidden-hover');assert.deepEqual(visible,[]);return{visible};
  });
  await page.locator('#official-stage .official-legend button').click();
  await check('rightmost closed bin edge resolves to final bin without accepting outside points',async()=>{
   const target=await client(4,bins[19]/2);const observed=await page.evaluate(({x,y})=>{const c=window.__PRIORITY_HANDLES__.charts[0],b=c.overlay.getBoundingClientRect();const actualX=c.getDefaultAxisX().fractionToValue((x-b.left-c.plot.left)/c.plot.width);c.overlay.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,pointerId:1}));return actualX;},target);
   near(observed,4,1e-12);assert.match((await visibleText()).join(' '),new RegExp(`Count ${bins[19]}(?:\\D|$)`));await capture('right-edge');
   await moveTo(4.001,bins[19]/2);assert.deepEqual(await visibleText(),[]);return{targetX:4,observedX:observed,expectedCount:bins[19]};
  });
 }
 if(selected.has('0701')){
  for(const event of ['pointercancel','lostpointercapture']){
   await mount('0701');
   await check(`${event} ends annotation drag; subsequent no-button move cannot mutate it`,async()=>{
    const start=await client(10,-7);await page.evaluate(()=>{const overlay=window.__PRIORITY_HANDLES__.charts[0].overlay;overlay.addEventListener('pointerdown',e=>window.__priorityPointerId=e.pointerId,{capture:true,once:true});});
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+12,start.y,{steps:3});
    const before=(await snapshot()).moduleDetails.annotations.find(x=>x.id==='x-band').bounds;assert(before.start>10&&before.start<14,'Initial trusted drag must move this fresh band');
    await page.evaluate(event=>{const el=window.__PRIORITY_HANDLES__.charts[0].overlay;el.dispatchEvent(new PointerEvent(event,{bubbles:true,pointerId:window.__priorityPointerId,buttons:0}));},event);
    await page.evaluate(({x,y})=>window.__PRIORITY_HANDLES__.charts[0].overlay.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:window.__priorityPointerId,clientX:x,clientY:y,buttons:0})),{x:start.x+55,y:start.y});
    const after=(await snapshot()).moduleDetails.annotations.find(x=>x.id==='x-band').bounds;await page.mouse.up();await capture(event);assert.deepEqual(after,before);return{before,after,input:'trusted initial drag plus explicit standard cancellation event and no-button move'};
   });
  }
  await mount('0701');await check('Y band both edges and center update values with independent pixel-to-axis oracle',async()=>{
   const read=async()=>(await snapshot()).moduleDetails.annotations.find(x=>x.id==='y-band').bounds;
   const a=await read(),p=await client(60,a.start),to=await client(60,a.start+1);await drag(p,to);let b=await read();near(b.start,a.start+1,.03);near(b.end,a.end);
   await drag(await client(60,b.end),await client(60,b.end+1));const c=await read();near(c.start,b.start);near(c.end,b.end+1,.03);
   await drag(await client(60,(c.start+c.end)/2),await client(60,(c.start+c.end)/2-1));const d=await read();near(d.end-d.start,c.end-c.start);return{initial:a,afterStart:b,afterEnd:c,afterCenter:d};
  });
 }
 if(selected.has('0003')){
  await mount('0003');await check('all 24 source markers return the closest real visible source value',async()=>{
   const traces=await page.evaluate(()=>window.__PRIORITY_HANDLES__.traces.map(t=>({name:t.name,points:t.points})));
   let checked=0;for(const trace of traces)for(const point of trace.points){if(point.x===0)continue;await moveTo(point.x,point.y);const text=(await visibleText()).join(' ');assert(text.includes(trace.name));assert(text.includes(point.y.toFixed(2)));checked++;}
   return{checkedNoncoincidentMarkers:checked,coincidentOriginRequiresReferenceTieRule:true};
  });
 }
 if(selected.has('0010')){
  await mount('0010');await check('manual viewport stays fixed during append; double-click resumes following',async()=>{
   const s=await snapshot(),p=await client(s.charts[0].x.end-2000,5);await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,-250);await settle();const fixed=(await snapshot()).charts[0].x,old=(await snapshot()).moduleDetails.sampleIndex;
   await page.waitForFunction(old=>window.__CRY_OFFICIAL__.snapshot().moduleDetails.sampleIndex>old+100,old);assert.deepEqual((await snapshot()).charts[0].x,fixed);
   await page.mouse.dblclick(p.x,p.y);await settle();const resumed=await snapshot();near(resumed.charts[0].x.end-resumed.charts[0].x.start,26000);near(resumed.charts[0].x.end,resumed.moduleDetails.sampleIndex+1000);
   return{fixed,resumed:resumed.charts[0].x,samples:resumed.moduleDetails.sampleIndex};
  });
 }
 if(selected.has('0550')){
  const s=await mount('0550');await check('main viewport Y fit equals visible-source extrema and overview remains full range',async()=>{
   const p=await client((s.charts[0].x.start+s.charts[0].x.end)/2,0);await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,-180);await settle();
   const result=await page.evaluate(()=>{const {charts,traces}=window.__PRIORITY_HANDLES__,x=charts[0].getDefaultAxisX().getInterval(),values=traces.flatMap(t=>t.points.filter(p=>p.x>=x.start&&p.x<=x.end).map(p=>p.y));return{x,y:charts[0].getDefaultAxisY().getInterval(),min:Math.min(...values),max:Math.max(...values),overview:charts[1].getDefaultAxisX().getInterval()};});
   near(result.y.start,result.min-1);near(result.y.end,result.max+1);assert.deepEqual(result.overview,s.charts[1].x);return{...result,scope:'Current example axis-fit policy remains reference observation pending'};
  });
 }
 if(selected.has('0901')){
  const s=await mount('0901');await check('all XYZ source values survive camera navigation and each legend toggle',async()=>{
   const before=await page.evaluate(()=>window.__PRIORITY_HANDLES__.traces.map(t=>Array.from({length:t.series.getSampleCount()},(_,i)=>t.series.getSample(i))));
   assert.equal(before.flat().length,150);const box=await page.locator('#official-stage .crychart').boundingBox();await drag({x:box.x+box.width*.45,y:box.y+box.height*.4},{x:box.x+box.width*.62,y:box.y+box.height*.55});
   for(const button of await page.locator('#official-stage .official-legend button').all()){await button.click();await settle();await button.click();await settle();}
   const after=await page.evaluate(()=>window.__PRIORITY_HANDLES__.traces.map(t=>Array.from({length:t.series.getSampleCount()},(_,i)=>t.series.getSample(i))));assert.deepEqual(after,before);return{sourcePoints:150,initialCamera:s.moduleDetails.camera,finalCamera:(await snapshot()).moduleDetails.camera,xyzPickingNotCovered:true};
  });
 }
 if(selected.has('1001')){
  await mount('1001');await check('six polar curves retain exact source closure and hide all tooltip targets when all curves hidden',async()=>{
   const data=await page.evaluate(()=>window.__PRIORITY_HANDLES__.traces.map(t=>({name:t.name,first:t.points[0],last:t.points.at(-1)})));for(const t of data){assert.equal(t.first.x,0);assert.equal(t.last.x,360);assert.equal(t.first.y,t.last.y);}
   for(const button of await page.locator('#official-stage .official-legend button').all())await button.click();
   const p=await page.evaluate(()=>{const {charts,traces}=window.__PRIORITY_HANDLES__,c=charts[0],b=c.overlay.getBoundingClientRect(),p=c.projectPolarPoint({angle:60,amplitude:traces[0].points[60].y});return{x:b.left+p.x,y:b.top+p.y};});await page.mouse.move(p.x,p.y);await settle();assert.deepEqual(await visibleText(),[]);return{curves:6,endpointClosure:true,hiddenHover:[]};
  });
 }
 if(selected.has('0702')){
  await mount('0702');await check('stationary shared cursor tracks real data while streaming and clears outside retained data',async()=>{
   const s=await snapshot(),x=s.moduleDetails.nextSample-200;await moveTo(x,1.5);let hit=(await snapshot()).moduleDetails.hoverValues;assert.equal(hit.length,3);
   for(const row of hit){const channel=Number(row.name.split(' ').at(-1))-1;const expected=.5+.28*Math.sin(row.time*.008*(channel+1)+channel)+.12*Math.sin(row.time*.019+channel*.7);near(row.value,expected,1e-12);}
   const before=hit[0].time;await page.waitForFunction(before=>window.__CRY_OFFICIAL__.snapshot().moduleDetails.hoverValues[0]?.time>before,before);hit=(await snapshot()).moduleDetails.hoverValues;assert.equal(new Set(hit.map(x=>x.time)).size,1);
   const now=await snapshot();await moveTo(now.moduleDetails.nextSample+1000,1.5);assert.deepEqual((await snapshot()).moduleDetails.hoverValues,[]);return{initialTime:before,advancedTime:hit[0].time,rawSignalFormulaMatched:true};
  });
 }
 if(selected.has('0803')){
  await mount('0803');await check('heatmap cursor remains consistent with the cell under a stationary pointer during scrolling',async()=>{
   const s=await snapshot();await page.evaluate(()=>window.__PRIORITY_HANDLES__.charts[0].overlay.addEventListener('pointermove',event=>{window.__priorityActualPointer={x:event.clientX,y:event.clientY};},{once:true,capture:true}));
   const requested=await moveTo(s.charts[0].x.end-300,240),p=await page.evaluate(()=>window.__priorityActualPointer);await page.waitForFunction(()=>!!window.__CRY_OFFICIAL__.snapshot().moduleDetails.hover);const old=(await snapshot()).moduleDetails.hover;
   // Compare the displayed frame atomically. A snapshot between an append and
   // its scheduled render legitimately contains the next axis interval.
   const frame=await page.evaluate(({p,minimumVectors})=>new Promise((resolve,reject)=>{
    const chart=window.__PRIORITY_HANDLES__.charts[0],timer=setTimeout(()=>{chart.off(token);reject(new Error('No completed heatmap frame'));},3000);
    const token=chart.on('render',()=>{const now=window.__CRY_OFFICIAL__.snapshot();if(now.moduleDetails.vectors<minimumVectors)return;const bounds=chart.overlay.getBoundingClientRect(),sourceX=chart.getDefaultAxisX().fractionToValue((p.x-bounds.left-chart.plot.left)/chart.plot.width);clearTimeout(timer);chart.off(token);resolve({hover:now.moduleDetails.hover,expectedColumn:Math.floor((sourceX-Date.UTC(2026,0,1,12))/(1000/30)),vectors:now.moduleDetails.vectors});});
   }),{p,minimumVectors:s.moduleDetails.vectors+5});
   assert.equal(frame.hover.column,frame.expectedColumn);return{previous:old.column,current:frame.hover.column,expectedColumn:frame.expectedColumn,vectors:frame.vectors,requestedPointer:requested,actualPointer:p,observation:'same completed render event, actual trusted PointerEvent client coordinates'};
  });
  await check('pointer leaving the streaming heatmap stays cleared on subsequent renders',async()=>{
   await page.mouse.move(1,1);await settle();const before=(await snapshot()).moduleDetails.vectors;
   await page.waitForFunction(v=>window.__CRY_OFFICIAL__.snapshot().moduleDetails.vectors>v+2,before);
   assert.equal((await snapshot()).moduleDetails.hover,undefined);assert.deepEqual(await visibleText(),[]);return{vectorsAdvanced:true,hoverCleared:true};
  });
 }
 if(selected.has('0805')){
  await mount('0805');await check('projection cursor updates once per source selection and stationary redraws do not feed back',async()=>{
   await moveTo(650.25,410.25);const before=(await snapshot()).moduleDetails;
   assert.equal(before.selection.column,650);assert.equal(before.selection.row,410);near(before.selection.value,before.selection.horizontalValue);near(before.selection.value,before.selection.verticalValue);
   await page.evaluate(async()=>{const c=window.__PRIORITY_HANDLES__.charts[0];for(let i=0;i<6;i++){c.invalidate();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}});
   const after=(await snapshot()).moduleDetails;assert.equal(after.revision,before.revision);assert.deepEqual(after.selection,before.selection);
   await page.mouse.move(1,1);await settle();assert.equal((await snapshot()).moduleDetails.hover,undefined);return{selection:before.selection,revisionBefore:before.revision,revisionAfter:after.revision,forcedRedraws:6};
  });
 }
 await capture('finished');
}catch(error){report.errors.push(error.stack??String(error));}
finally{report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(x=>x.passed).length;report.failed=report.checks.filter(x=>!x.passed).length;report.browserVisible=true;await save();await browser.close();console.log(JSON.stringify({directory,passed:report.passed,failed:report.failed,errors:report.errors}));if(report.failed||report.errors.length)process.exitCode=1;}
