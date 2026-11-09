import {mkdir, writeFile, readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {connectVisibleChrome, ensureTestServer} from './visible-browser.mjs'

const geometryOnly = process.argv.includes('--geometry-only')
const coverageUnion = process.argv.includes('--line-coverage')
const directory = `codex_artifact/line-display-visible/${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}`
await mkdir(directory,{recursive:true})
const sourceFiles=['src/line-display-cache.ts','src/line-block-cache.ts','src/render-line-strip.ts','src/render-line-direction.ts','scripts/test-line-display-visible.mjs']
await build({stdin:{contents:"export {DataSetXY} from './src/core/data.ts'; export {getColumnOrder} from './src/data-order.ts'; export {LineDisplayCache} from './src/line-display-cache.ts'; export {LineBlockCache} from './src/line-block-cache.ts'; export {LineStripRenderer} from './src/render-line-strip.ts'; export {domainForStack} from './src/axis-layout.ts'",resolveDir:process.cwd()},bundle:true,format:'esm',outfile:directory+'/candidate.js'})
await writeFile(directory+'/fixture.html','<!doctype html><meta charset="utf-8"><title>Visible display-level extrema candidate</title><style>body{background:#101827;color:white;font:16px system-ui;margin:20px}canvas{display:block;background:black;width:1000px;height:600px}p{max-width:1000px}</style><h2 id="status">Original display-level candidate — raw data retained</h2><canvas id="chart" width="1000" height="600"></canvas><p>Experimental, disabled by default. Comparing raw vertices and extrema-preserving display geometry; pixel differences are recorded, never silently treated as identical.</p>')
const report={createdAt:new Date().toISOString(),visible:true,headless:false,status:'running',candidateDefaultEnabled:false,fullQualityEquivalence:false,performanceGoalPassed:false,checks:[],trials:[],errors:[],sources:Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')]))),bundleSha256:createHash('sha256').update(await readFile(directory+'/candidate.js')).digest('hex'),limits:['Independent original renderer fixture; not actual ChartXY or a CRYChart comparison.','All original source values remain in the DataSet; only display vertices can be omitted.','Horizontal centerline bounds do not promise identical opacity, line-join geometry or antialias coverage.','GPU query covers draw-command range; work includes projection/cache query, draw submission and synchronous 1-pixel readback. Neither measures display scanout.','Memory counts cover explicit source/summary/selection/projection/renderer arrays and buffers, not process or driver allocations.']}
let browser,page
const server=await ensureTestServer()
try{
  const connected=await connectVisibleChrome();browser=connected.browser;page=connected.page;report.browser=connected.metadata.Browser
  await page.setViewportSize({width:1100,height:780});page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto('http://127.0.0.1:4178/'+directory+'/fixture.html',{waitUntil:'load'})
  report.experimentalLineCoverage=coverageUnion
  report.environment=await page.evaluate(setup,{coverageUnion})
  for(const id of ['sparse','dense','dense-half-pixel','peaks','gaps','epoch','zoom','ring','stacked16','stacked128']){
    const check=await page.evaluate(quality,id);check.imagesSaved={}
    for(const [name,data]of Object.entries(check.images)){const path=`${directory}/${id}-${name}.png`;await writeFile(path,Buffer.from(data.split(',')[1],'base64'));check.imagesSaved[name]=path}
    delete check.images;report.checks.push(check)
    console.log(JSON.stringify({event:'display-quality',case:id,selected:check.selected,source:check.source,sourceUnchanged:check.sourceUnchanged,pixels:{...check.pixels,panes:undefined,maximumEnvelopeDifference:Math.max(...check.pixels.panes.map(p=>p.maximumEnvelopeDifference))},rawSourceOracle:check.rawSourceOracle?{...check.rawSourceOracle,checks:undefined}:undefined,gap:check.gap,glError:check.glError}))
  }
  if(!geometryOnly)for(const channels of [16,128])for(let repetition=0;repetition<3;repetition++){
    const trial=await page.evaluate(measure,{channels,repetition,frames:8});report.trials.push(trial)
    console.log(JSON.stringify({event:'display-performance',channels,repetition,valid:trial.valid,summaries:trial.summaries}))
  }
  report.disposal=await page.evaluate(()=>window.__display.dispose())
  report.status=report.errors.length||report.checks.some(x=>!x.sourceUnchanged||x.glError)||report.trials.some(x=>!x.valid)?'failed-candidate-disabled':'observed-review-required'
}catch(error){report.status='failed-candidate-disabled';report.errors.push(error.message);process.exitCode=1}
finally{
  report.completedAt=new Date().toISOString();await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n')
  if(page)await page.goto('http://127.0.0.1:4178/#demo=stream').catch(()=>{})
  if(browser)await browser.close();await server.close()
  console.log(JSON.stringify({status:report.status,report:directory+'/report.json'}))
}

async function setup({coverageUnion}){
  const api=await import('./candidate.js'),canvas=document.getElementById('chart'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,alpha:true,premultipliedAlpha:true})
  if(!gl)throw new Error('Visible WebGL2 unavailable')
  const rect={left:100,top:80,width:800,height:420},renderers={raw:new api.LineStripRenderer(gl,{coverageUnion}),display:new api.LineStripRenderer(gl,{coverageUnion}),relative:new api.LineStripRenderer(gl,{directionMode:'relative',coverageUnion})}
  const extension=gl.getExtension('EXT_disjoint_timer_query_webgl2'),info=gl.getExtension('WEBGL_debug_renderer_info'),pixel=new Uint8Array(4)
  const create=(channels,count,options={})=>Array.from({length:channels},(_,channel)=>{
    const data=new api.DataSetXY({schema:{x:{storage:Float64Array,auto:true,pattern:'progressive'},raw:{storage:Float64Array},y:{storage:Float64Array}}});data.setMaxSampleCount(count)
    const values=Float64Array.from({length:count},(_,i)=>options.value?options.value(i,channel):.8*Math.sin(i*.017+channel*.27)+.08*Math.cos(i*.113))
    data.appendSamples({raw:values,y:values},{start:options.start??0,step:options.step??1000/48000})
    return{data,raw:new api.LineBlockCache(),display:new api.LineDisplayCache(),relative:new api.LineDisplayCache(),channel}
  })
  const release=sources=>{for(const source of sources){source.raw.dispose();source.display.dispose();source.relative.dispose();source.data.dispose()}}
  const request=(source,channels,options={})=>{
    const data=source.data,next=data.getNextSampleIndex(),first=next-data.getSampleCount(),order=api.getColumnOrder(data,'x')
    const range={start:(channels-1-source.channel)/channels,end:(channels-source.channel)/channels}
    const domainX=options.domainX??{start:data.getValue('x',0),end:data.getValue('x',data.getSampleCount()-1)}
    const domainY=options.stacked?api.domainForStack({start:-1.3,end:1.3},range):{start:-1.3,end:1.3}
    return{source:{identity:data,contentEpoch:data.getContentEpoch(),revision:data.revision,firstSampleIndex:first,nextSampleIndex:next,x:data.getColumnRuns('x'),y:data.getColumnRuns('y')},projectionKey:'linear:x/y',coordinateMode:'linear',bindingRevision:0,styleRevision:0,visibleSegments:{first:options.first??first,end:options.last??next-1},domain:{x:domainX,y:domainY},clipRect:options.stacked?{left:rect.left,top:rect.top+(1-range.end)*rect.height,width:rect.width,height:(range.end-range.start)*rect.height}:rect,style:{color:[.12,.85,.65,1],thickness:2},monotonicX:order.finite&&order.strict?'verified-strict':'invalid',plotRect:rect,devicePixelRatio:1,maximumPixelSpan:options.span??1}
  }
  const packets=(sources,name,options={})=>{
    const stats=[],out=[]
    for(const source of sources){const req=request(source,sources.length,options),result=source[name].update(req);stats.push(result.stats);if(result.kind==='fallback')throw new Error(name+' fallback: '+result.reason);if(result.kind==='blocks')out.push(...result.packets);else if(result.packet)out.push(result.packet)}
    return{packets:out,stats}
  }
  const render=(name,packets)=>{gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);const renderer=renderers[name];renderer.beginFrame();if(coverageUnion){for(let first=0;first<packets.length;){let end=first+1;while(end<packets.length&&packets[end].strokeGroup===packets[first].strokeGroup)end++;if(!renderer.drawGroup(packets.slice(first,end),rect,1))throw new Error('Candidate group rejected');first=end}}else for(const packet of packets)if(!renderer.draw(packet,rect,1))throw new Error('Candidate packet rejected');renderer.endFrame()}
  const read=()=>{const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels}
  const compare=(a,b,channels)=>{
    let different=0,maxDifference=0,sumAbsoluteAlpha=0,rawAlpha=0,newAlpha=0,rawPixels=0,newPixels=0,lostOpaque=0,newOpaque=0,farMissing=0,farAdded=0
    const nearby=(pixels,x,y)=>{for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<canvas.width&&yy>=0&&yy<canvas.height&&pixels[(yy*canvas.width+xx)*4+3]>16)return true}return false}
    for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);if(delta)different++;maxDifference=Math.max(maxDifference,delta);if(i%4===3){const x=((i-3)/4)%canvas.width,y=Math.floor((i-3)/4/canvas.width);rawAlpha+=a[i];newAlpha+=b[i];sumAbsoluteAlpha+=delta;if(a[i])rawPixels++;if(b[i])newPixels++;if(a[i]>127&&!b[i]){lostOpaque++;if(!nearby(b,x,y))farMissing++}if(b[i]>127&&!a[i]){newOpaque++;if(!nearby(a,x,y))farAdded++}}}
    const panes=[]
    for(let pane=0;pane<channels;pane++){let columns=0,envelopeDelta=0,rawOccupied=0,newOccupied=0;const y0=Math.round(canvas.height-(rect.top+(pane+1)*rect.height/channels)),y1=Math.round(canvas.height-(rect.top+pane*rect.height/channels))
      for(let x=rect.left;x<rect.left+rect.width;x++){let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;for(let y=y0;y<y1;y++){const i=(y*canvas.width+x)*4+3;if(a[i]>16){amin=Math.min(amin,y);amax=Math.max(amax,y)}if(b[i]>16){bmin=Math.min(bmin,y);bmax=Math.max(bmax,y)}}if(Number.isFinite(amin))rawOccupied++;if(Number.isFinite(bmin))newOccupied++;if(Number.isFinite(amin)&&Number.isFinite(bmin)){columns++;envelopeDelta=Math.max(envelopeDelta,Math.abs(amin-bmin),Math.abs(amax-bmax))}}
      panes.push({pane,columns,rawOccupied,newOccupied,maximumEnvelopeDifference:envelopeDelta})}
    return{differingBytes:different,maxDifference,rawPixels,newPixels,rawAlpha,newAlpha,alphaRatio:newAlpha/(rawAlpha||1),meanAbsoluteAlphaDifference:sumAbsoluteAlpha/(rect.width*rect.height),lostOpaquePixels:lostOpaque,newOpaquePixels:newOpaque,missingFartherThan2Pixels:farMissing,addedFartherThan2Pixels:farAdded,panes}}
  const fingerprint=async sources=>{const hashes=[];for(const {data}of sources){const values=data.readBack().data;const bytes=new Uint8Array(values.y.buffer,values.y.byteOffset,values.y.byteLength);hashes.push({count:data.getSampleCount(),next:data.getNextSampleIndex(),hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')})}return hashes}
  const poll=query=>new Promise(resolve=>{const began=performance.now();const tick=()=>{if(gl.getParameter(extension.GPU_DISJOINT_EXT)){gl.deleteQuery(query);resolve({status:'disjoint'});return}if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){const milliseconds=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(query);resolve({status:'available',milliseconds});return}if(performance.now()-began>5000){gl.deleteQuery(query);resolve({status:'timeout'});return}requestAnimationFrame(tick)};requestAnimationFrame(tick)})
  window.__display={api,canvas,gl,rect,renderers,extension,pixel,create,release,request,packets,render,read,compare,fingerprint,poll,dispose(){for(const renderer of Object.values(renderers))renderer.dispose();return{glError:gl.getError(),contextLost:gl.isContextLost()}}}
  return{browserDpr:devicePixelRatio,rendererDpr:1,plot:rect,renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),context:gl.getContextAttributes(),gpuTimer:Boolean(extension)}
}
async function quality(id){
  const f=window.__display;document.getElementById('status').textContent='Visible display-quality comparison: '+id
  const channels=id==='stacked128'?128:id==='stacked16'?16:1,count=id==='sparse'?1001:48000
  const sourceOptions={}
  if(id==='peaks')sourceOptions.value=i=>i%997===0?1.2:i%991===0?-1.2:.7*Math.sin(i*.19)
  if(id==='gaps')sourceOptions.value=i=>i>=24000&&i<25000?NaN:i%4096===0?NaN:.8*Math.sin(i*.017)
  if(id==='epoch')sourceOptions.start=1700000000000
  const sources=f.create(channels,count,sourceOptions),options={stacked:channels>1,span:id==='dense-half-pixel'?.5:1},images={}
  if(id==='ring')for(const source of sources){f.packets([source],'display');source.data.appendSamples({raw:new Float64Array(960).fill(.2),y:new Float64Array(960).fill(.2)})}
  if(id==='zoom'){options.first=24000;options.last=24100;options.domainX={start:24000*1000/48000,end:24100*1000/48000}}
  const before=await f.fingerprint(sources),raw=f.packets(sources,'raw',options),display=f.packets(sources,'display',options)
  f.render('raw',raw.packets);const original=f.read();images.raw=f.canvas.toDataURL('image/png')
  f.render('display',display.packets);const actual=f.read();images.display=f.canvas.toDataURL('image/png')
  const pixels=f.compare(original,actual,channels),after=await f.fingerprint(sources),source=sources.reduce((sum,s)=>sum+s.data.getSampleCount(),0),selected=display.stats.reduce((sum,s)=>sum+s.submittedDisplaySamples,0)
  let rawSourceOracle,gap
  if(id==='peaks'){
    const data=sources[0].data,domain=f.request(sources[0],1,options).domain,checks=[]
    const project=i=>({x:f.rect.left+(data.getValue('x',i)-domain.x.start)/(domain.x.end-domain.x.start)*f.rect.width,y:f.canvas.height-f.rect.top-f.rect.height+(data.getValue('y',i)-domain.y.start)/(domain.y.end-domain.y.start)*f.rect.height})
    const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)}
    for(let i=2;i<count-2;i++)if(i%997===0||i%991===0){const point=project(i),column=Math.floor(point.x),row=Math.floor(point.y),center={x:column+.5,y:row+.5};if(column<=f.rect.left||column>=f.rect.left+f.rect.width-1)continue
      const alpha=Math.round(Math.max(0,Math.min(1,1.5-Math.min(distance(center,project(i-1),point),distance(center,point,project(i+1)))))*255),offset=(row*f.canvas.width+column)*4+3
      checks.push({index:i,x:point.x,y:point.y,expectedMinimumAlpha:alpha,rawAlpha:original[offset],displayAlpha:actual[offset],rawBelowExpected:original[offset]<alpha-2,displayBelowExpected:actual[offset]<alpha-2})}
    rawSourceOracle={definition:'Float64 projection of original extreme and its two adjacent real segments, evaluated at the nearest pixel center with a 2px round-cap distance field. This is an independent minimum stroke-coverage oracle; it does not assume old CRY raster is correct.',checked:checks.length,rawBelowExpected:checks.filter(c=>c.rawBelowExpected).length,displayBelowExpected:checks.filter(c=>c.displayBelowExpected).length,checks}
  }
  if(id==='gaps'){
    const domain=f.request(sources[0],1,options).domain,step=1000/48000,x0=Math.ceil(f.rect.left+(24000*step-domain.x.start)/(domain.x.end-domain.x.start)*f.rect.width)+2,x1=Math.floor(f.rect.left+(25000*step-domain.x.start)/(domain.x.end-domain.x.start)*f.rect.width)-2
    let rawColored=0,displayColored=0;for(let x=x0;x<x1;x++)for(let y=f.canvas.height-f.rect.top-f.rect.height;y<f.canvas.height-f.rect.top;y++){const offset=(y*f.canvas.width+x)*4+3;if(original[offset])rawColored++;if(actual[offset])displayColored++}
    gap={innerColumns:x1-x0,rawColored,displayColored}
  }
  const result={id,source,selected,sourceUnchanged:JSON.stringify(before)===JSON.stringify(after),fingerprints:{before,after},displayStats:display.stats,pixels,rawSourceOracle,gap,images,glError:f.gl.getError()};f.release(sources);return result
}
async function measure({channels,repetition,frames}){
  const f=window.__display,gl=f.gl,ext=f.extension;if(!ext)throw new Error('GPU timer unavailable')
  document.getElementById('status').textContent=`Visible display diagnostic: ${channels} stacked channels, repetition ${repetition+1}/3`
  const sources=f.create(channels,48000),values={raw:[],display:[],relative:[]},options={stacked:true,span:1},warmup={}
  const once=async name=>{await new Promise(requestAnimationFrame);const began=performance.now(),selected=f.packets(sources,name,options),prepared=performance.now()-began,query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);f.render(name,selected.packets);gl.endQuery(ext.TIME_ELAPSED_EXT);const callback=performance.now()-began;gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,f.pixel);const work=performance.now()-began;return{preparationMs:prepared,callbackMs:callback,workMs:work,gpu:await f.poll(query),glError:gl.getError(),source:sources.reduce((sum,s)=>sum+s.data.getSampleCount(),0),selected: selected.packets.reduce((sum,p)=>sum+(p.drawCount??p.count),0),renderer:{...f.renderers[name].stats},cache: selected.stats}}
  for(const name of Object.keys(values))warmup[name]=await once(name)
  for(let frame=0;frame<frames;frame++){
    for(const source of sources){const next=source.data.getNextSampleIndex(),y=Float64Array.from({length:960},(_,i)=>.8*Math.sin((next+i)*.017+source.channel*.27)+.08*Math.cos((next+i)*.113));source.data.appendSamples({raw:y,y})}
    for(const name of frame%2?['relative','display','raw']:['raw','display','relative'])values[name].push(await once(name))
  }
  const percentile=(values,fraction)=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);return a[Math.max(0,Math.ceil(a.length*fraction)-1)]}
  const summaries=Object.fromEntries(Object.entries(values).map(([name,rows])=>[name,{workMedianMs:percentile(rows.map(r=>r.workMs),.5),workP95Ms:percentile(rows.map(r=>r.workMs),.95),preparationMedianMs:percentile(rows.map(r=>r.preparationMs),.5),gpuMedianMs:percentile(rows.map(r=>r.gpu.milliseconds),.5),gpuP95Ms:percentile(rows.map(r=>r.gpu.milliseconds),.95),sourceSamples:rows.at(-1).source,selectedSamples:rows.at(-1).selected,summaryBytes:rows.at(-1).cache.reduce((s,c)=>s+(c.summaryBytes??0),0),projectionBytes:rows.at(-1).cache.reduce((s,c)=>s+(c.projectionBytes??c.residentProjectionBytes??0),0),cachedSelectionBytes:rows.at(-1).cache.reduce((s,c)=>s+(c.cachedSelectionBytes??0),0),cachedProjectionBytes:rows.at(-1).cache.reduce((s,c)=>s+(c.cachedProjectionBytes??0),0),reusedSelectionPages:rows.at(-1).cache.reduce((s,c)=>s+(c.reusedSelectionPages??0),0)}]))
  const valid=Object.values(values).flat().every(row=>row.glError===0&&row.gpu.status==='available'&&row.source===channels*48000)&&!gl.isContextLost();f.release(sources);return{channels,repetition,frames,valid,warmup,values,summaries}
}
