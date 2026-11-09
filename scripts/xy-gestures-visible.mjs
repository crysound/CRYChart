import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {connectVisibleChrome,showStep} from './visible-browser.mjs';

const library=resolve(process.env.CRYCHART_TEST_BUNDLE??'dist/crychart.js'),bytes=await readFile(library);
const output=resolve('codex_artifact/xy-gestures-visible',new Date().toISOString().replaceAll(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const report={createdAt:new Date().toISOString(),bundle:library,bundleSHA256:createHash('sha256').update(bytes).digest('hex'),visibleChrome:true,headless:false,applicationRun:false,fullReferenceEquivalence:false,checks:[],errors:[]};
const html='<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>CRYChart XY interaction verification</title><style>html,body{margin:0;background:#111a28;color:#e8eef8;font:16px system-ui}h1{font-size:20px;margin:15px 22px}#chart{width:1100px;height:620px;margin:0 22px;border:1px solid #435773}</style><h1>CRYChart · OpenTest 图表交互验证</h1><div id="chart"></div><script type="module">window.api=await import("/library.js")</script>';
const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/fixture.html')res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(html);
  else if(path==='/library.js')res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(bytes);
  else res.writeHead(404).end();
});
await new Promise(r=>server.listen(4187,'127.0.0.1',r));
let browser,page,cdp;
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected} +/- ${tolerance}`);
try{
  const connected=await connectVisibleChrome();browser=connected.browser;page=connected.page;report.browser=connected.metadata;
  page.setDefaultTimeout(15000);await page.setViewportSize({width:1240,height:820});await page.bringToFront();cdp=await page.context().newCDPSession(page);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:4187/fixture.html?sha='+report.bundleSHA256);await page.waitForFunction(()=>window.api);
  await page.evaluate(()=>{
    const {api}=window,engine=api.cryChart(),chart=engine.ChartXY({container:document.getElementById('chart'),legend:{visible:false}}).setTitle('XY gestures: pointer, wheel and annotations');
    const x=chart.axisX.setTitle('Time').setUnits('ms'),y=chart.axisY.setTitle('Amplitude').setUnits('V');
    chart.addLineSeries().setName('Signal').add(Array.from({length:101},(_,i)=>({x:i,y:50+25*Math.sin(i/5)})));
    const defaults={pan:{lmb:{drag:{x:true,y:false}},wheel:false,rmb:false},zoom:{wheel:false,y:false},xAxis:{zoom:{wheel:false}},yAxis:{zoom:{wheel:false}},rectangleZoom:false,restoreDefault:{doubleClick:false}};
    const state={api,engine,chart,x,y,defaults,events:[],changes:[],line:undefined,band:undefined};
    for(const type of ['pointerdown','pointermove','pointerup','wheel','dblclick'])chart.addEventListener(type,e=>state.events.push({type,isTrusted:e.isTrusted,constructor:e.constructor.name,deltaY:e.deltaY,deltaMode:e.deltaMode,clientX:e.clientX,clientY:e.clientY}));
    state.settle=async()=>{for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);};
    state.reset=async(config=defaults)=>{state.line?.dispose();state.band?.dispose();state.line=undefined;state.band=undefined;state.changes=[];x.setUserInteractions({});y.setUserInteractions({});x.setInterval({start:0,end:100,stopAxisAfter:true});y.setInterval({start:0,end:100,stopAxisAfter:true});chart.setUserInteractions(config);chart.invalidate();await state.settle();};
    state.point=(vx,vy)=>{const p=chart.translateCoordinate({x:vx,y:vy},{x,y},chart.coordsClient);return {x:p.clientX,y:p.clientY};};
    state.snapshot=()=>({x:x.getInterval(),y:y.getInterval(),stopped:{x:x.stopped,y:y.stopped},plot:{...chart.plot},events:state.events.slice(-24),line:state.line?.getValue(),band:state.band?{start:state.band.getValueStart(),end:state.band.getValueEnd()}:undefined,changes:[...state.changes]});
    window.state=state;
  });
  const settle=()=>page.evaluate(()=>window.state.settle()),snapshot=()=>page.evaluate(()=>window.state.snapshot());
  const reset=config=>page.evaluate(config=>window.state.reset(config),config);
  const point=(x,y)=>page.evaluate(([x,y])=>window.state.point(x,y),[x,y]);
  const capture=async name=>{const {data}=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=resolve(output,name+'.png');await writeFile(file,Buffer.from(data,'base64'));return file;};
  const drag=async(a,b)=>{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();await settle();};
  const wheel=async(p,delta)=>{const count=await page.evaluate(()=>window.state.events.filter(e=>e.type==='wheel').length);await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,delta);await page.waitForFunction(n=>window.state.events.filter(e=>e.type==='wheel').length>n,count);await settle();return page.evaluate(()=>window.state.events.filter(e=>e.type==='wheel').at(-1));};
  // Chrome/OS scale may normalize injected wheel deltas. The public DOM event
  // is the chart's input; preserve both it and the requested CDP displacement.
  const wheelFactor=(event,sensitivity,pagePixels)=>Math.exp(Math.max(-1,Math.min(1,event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?pagePixels:1)*.001*sensitivity)));
  const check=async(name,run)=>{if(process.argv.includes('--focus-wheel')&&!name.startsWith('Real wheel')&&!name.startsWith('Axis-lane'))return;if(process.argv.includes('--focus-resize')&&!name.startsWith('Waterfall resize'))return;const entry={name,status:'running'};await showStep(page,'CRYChart 可见 Chrome 交互测试',name);try{entry.evidence=await run();entry.status='passed';}catch(error){entry.status='failed';entry.error=String(error.stack??error);report.errors.push(entry.error);}entry.snapshot=await snapshot();entry.screenshot=await capture(String(report.checks.length+1).padStart(2,'0'));report.checks.push(entry);await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({name,status:entry.status}));};
  await check('OpenTest default: real left drag pans X without changing Y',async()=>{
    await reset();const a=await point(30,50),b=await point(60,65);await drag(a,b);const state=await snapshot();near(state.x.start,-30,.25);near(state.x.end,70,.25);assert.deepEqual(state.y,{start:0,end:100});assert.ok(state.events.some(e=>e.type==='pointerdown'&&e.isTrusted));return {from:a,to:b};
  });
  await check('Disabled wheel and double click leave selected intervals intact',async()=>{
    await reset();await wheel(await point(50,50),120);const p=await point(50,50);await page.mouse.dblclick(p.x,p.y);await settle();const state=await snapshot();assert.deepEqual(state.x,{start:0,end:100});assert.deepEqual(state.y,{start:0,end:100});assert.ok(state.events.some(e=>e.type==='wheel'&&e.isTrusted&&e.constructor==='WheelEvent'));return {intervalsUnchanged:true};
  });
  await check('Real wheel uses configured X-only sensitivity and stops automatic scrolling',async()=>{
    await page.evaluate(async()=>{const s=window.state;await s.reset({...s.defaults,zoom:{wheel:{x:true,y:false,sensitivity:.5,stopScroll:true}}});});
    const event=await wheel(await point(25,50),100),state=await snapshot(),factor=wheelFactor(event,.5,state.plot.height);near(state.x.end-state.x.start,100*factor);near(state.x.start,25-25*factor,.02);assert.deepEqual(state.y,{start:0,end:100});assert.equal(state.stopped.x,true);return {requestedWheelDelta:100,actualDOMEvent:event,expectedFactor:factor};
  });
  await check('Axis-lane wheel policy stays separate from plot zoom',async()=>{
    await page.evaluate(async()=>{const s=window.state;await s.reset({...s.defaults,zoom:{wheel:{x:true,y:false,sensitivity:1}}});s.x.setUserInteractions({zoom:{wheel:false}});});
    const a=await point(25,0);await wheel({x:a.x,y:a.y+12},100);assert.deepEqual((await snapshot()).x,{start:0,end:100});
    await page.evaluate(()=>window.state.x.setUserInteractions({zoom:{wheel:{mode:'keep-end',sensitivity:1}}}));const event=await wheel({x:a.x,y:a.y+12},100),state=await snapshot(),factor=wheelFactor(event,1,state.plot.height);near(state.x.end,100);near(state.x.end-state.x.start,100*factor);return {axisLane:{x:a.x,y:a.y+12},requestedWheelDelta:100,actualDOMEvent:event,expectedFactor:factor};
  });
  await check('Rectangle selection scales both axes with native pointer capture',async()=>{
    await reset({pan:false,zoom:{wheel:false},rectangleZoom:{lmb:{x:true,y:true},rmb:false},restoreDefault:{doubleClick:false}});
    const a=await point(20,20),b=await point(80,80);await drag(a,b);const state=await snapshot();for(const interval of [state.x,state.y]){near(interval.start,20,.3);near(interval.end,80,.3);}return {from:a,to:b};
  });
  await check('Playback constant line drag emits value changes without panning the chart',async()=>{
    await reset();await page.evaluate(()=>{const s=window.state;s.line=s.x.addConstantLine(true).setValue(20).setDraggable(true);s.line.addEventListener('valuechange',e=>s.changes.push(e.value));});await settle();await drag(await point(20,50),await point(60,50));const state=await snapshot();near(state.line,60,.3);assert.ok(state.changes.length>0);assert.deepEqual(state.x,{start:0,end:100});return {changeCount:state.changes.length};
  });
  await check('Difference band moves both boundaries and listener removal takes effect',async()=>{
    await reset();await page.evaluate(()=>{const s=window.state;s.band=s.x.addBand({onTop:true}).setBounds({start:20,end:40}).setUserInteractions({move:{drag:true},scale:{drag:true}});s.listener=e=>s.changes.push({start:e.start,end:e.end});s.band.addEventListener('valuechange',s.listener);});await settle();await drag(await point(30,50),await point(50,50));const state=await snapshot();near(state.band.start,40,.3);near(state.band.end,60,.3);assert.ok(state.changes.length>0);assert.deepEqual(state.x,{start:0,end:100});
    await page.evaluate(()=>{const s=window.state;s.band.removeEventListener('valuechange',s.listener);s.band.setBounds({start:10,end:30});});assert.equal((await snapshot()).changes.length,state.changes.length);return {changeCount:state.changes.length};
  });
  await check('Public double-click cancellation prevents default fit',async()=>{
    await reset({});await page.evaluate(()=>{const s=window.state;s.x.setInterval({start:30,end:40});s.listener=e=>e.preventDefault();s.chart.addEventListener('dblclick',s.listener);});await settle();const p=await point(35,50);await page.mouse.dblclick(p.x,p.y);await settle();assert.deepEqual((await snapshot()).x,{start:30,end:40});
    await page.evaluate(()=>{const s=window.state;s.chart.removeEventListener('dblclick',s.listener);});await page.mouse.dblclick(p.x,p.y);await settle();assert.notDeepEqual((await snapshot()).x,{start:30,end:40});return {nativeDefaultPrevented:true};
  });
  await check('Waterfall resize observes actual container CSS size and unregisters the original callback',async()=>{
    await reset();await page.evaluate(()=>{const s=window.state;s.resizeEvents=[];s.resizeListener=e=>s.resizeEvents.push({...e});s.chart.addEventListener('resize',s.resizeListener);const host=document.getElementById('chart');host.style.width='900px';host.style.height='560px';});
    await page.waitForFunction(()=>window.state.resizeEvents.some(e=>Math.abs(e.width-900)<.05&&Math.abs(e.height-560)<.05));await settle();
    const observed=await page.evaluate(()=>{const s=window.state,b=s.chart.root.getBoundingClientRect();return{events:s.resizeEvents,size:s.chart.getSizePixels(),root:{width:b.width,height:b.height}};});near(observed.size.x,900,.05);near(observed.size.y,560,.05);assert.equal(observed.size.x,observed.root.width);assert.equal(observed.size.y,observed.root.height);assert.ok(observed.events.some(e=>e.width===observed.root.width&&e.height===observed.root.height&&e.engineWidth===e.width&&e.engineHeight===e.height));
    await page.evaluate(()=>{const s=window.state;s.chart.removeEventListener('resize',s.resizeListener);const host=document.getElementById('chart');host.style.width='1100px';host.style.height='620px';});await page.waitForFunction(()=>Math.abs(window.state.chart.getSizePixels().x-1100)<.05);await settle();assert.equal(await page.evaluate(()=>window.state.resizeEvents.length),observed.events.length);return observed;
  });
  report.graphics=await page.evaluate(()=>{const gl=window.state.chart.renderer.gl;return {webgl2:!!gl,error:gl?.getError(),contextLost:gl?.isContextLost()};});assert.equal(report.graphics.contextLost,false);assert.equal(report.graphics.error,0);
  await page.evaluate(()=>window.state.engine.dispose());
}catch(error){report.errors.push(String(error.stack??error));}
finally{
  report.summary={passed:report.checks.filter(c=>c.status==='passed').length,failed:report.checks.filter(c=>c.status==='failed').length};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');if(page)await page.goto('http://127.0.0.1:4178/examples/opentest-lab/index.html').catch(()=>{});if(browser)await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});
  console.log(JSON.stringify({report:resolve(output,'report.json'),summary:report.summary,errors:report.errors.length}));if(report.errors.length)process.exitCode=1;
}
