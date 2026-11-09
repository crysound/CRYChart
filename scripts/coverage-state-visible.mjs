import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {connectVisibleChrome,ensureTestServer} from './visible-browser.mjs'

const directory=`codex_artifact/coverage-state-visible/${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}`
await mkdir(directory,{recursive:true})
await build({stdin:{contents:"export {LineCoverageRenderer} from './src/render-line-coverage.ts'; export {LineDisplayCache} from './src/line-display-cache.ts'; export {DataSetXY} from './src/core/data.ts';export {getColumnOrder} from './src/data-order.ts';export {domainForStack} from './src/axis-layout.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',outfile:directory+'/candidate.js'})
await writeFile(directory+'/fixture.html','<!doctype html><meta charset="utf-8"><title>Visible line coverage state A/B</title><style>body{background:#111827;color:white;font:16px system-ui}canvas{display:block;margin:20px;width:1000px;height:600px;background:black}</style><h2 id="status">Coverage state A/B — geometry unchanged</h2><canvas id="plot" width="1000" height="600"></canvas><p>Explicit exclusive-frame candidate. Raw samples and capsule geometry remain unchanged. This is an own-renderer diagnostic, not a CRYChart speed claim.</p>')
const report={createdAt:new Date().toISOString(),visible:true,headless:false,classification:'Own-renderer GL-state-scope A/B; no reference or application performance acceptance',defaultEnabled:false,geometryChanged:false,bundleSHA256:createHash('sha256').update(await readFile(directory+'/candidate.js')).digest('hex'),checks:[],trials:[],errors:[],performanceGoalPassed:false}
let browser,page
const server=await ensureTestServer()
try{
 const connected=await connectVisibleChrome();browser=connected.browser;page=connected.page
 await page.setViewportSize({width:1100,height:780});page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('http://127.0.0.1:4178/'+directory+'/fixture.html',{waitUntil:'load'})
 report.environment=await page.evaluate(setup)
 report.stateRestoration=await page.evaluate(stateRestoration)
  // The restoration probe uses a taller external target. Recreate both
  // renderers so its scratch allocation cannot bias the timed resource state.
  await page.evaluate(()=>{const f=window.__coverageState;f.renderers.draw.dispose();f.renderers.frame.dispose();f.renderers.draw=new f.api.LineCoverageRenderer(f.gl);f.renderers.frame=new f.api.LineCoverageRenderer(f.gl,{stateScope:'frame'})})
 for(const channels of [16,128]){
  const quality=await page.evaluate(qualityCheck,channels)
  await writeFile(directory+`/${channels}-frame.png`,Buffer.from(quality.image.split(',')[1],'base64'));delete quality.image
  report.checks.push(quality);console.log(JSON.stringify({event:'coverage-state-quality',...quality}))
  for(let repetition=0;repetition<3;repetition++){
   const trial=await page.evaluate(measure,{channels,repetition,frames:8});report.trials.push(trial)
   console.log(JSON.stringify({event:'coverage-state-trial',channels,repetition,summary:trial.summary,valid:trial.valid}))
  }
 }
 report.disposal=await page.evaluate(()=>window.__coverageState.dispose())
 report.status=report.errors.length||!report.stateRestoration.passed||report.checks.some(v=>!v.passed)||report.trials.some(v=>!v.valid)?'failed':'observed-state-candidate'
}catch(error){report.status='failed';report.errors.push(String(error?.stack??error));process.exitCode=1}
finally{
 report.finishedAt=new Date().toISOString();await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n')
 if(page)await page.goto('http://127.0.0.1:4178/#demo=stream').catch(()=>{})
 if(browser)await browser.close();await server.close()
 console.log(JSON.stringify({status:report.status,report:directory+'/report.json'}))
}

async function setup(){
 const api=await import('./candidate.js'),canvas=document.getElementById('plot'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true})
 if(!gl)throw Error('WebGL2 is unavailable')
 const rect={left:100,top:80,width:800,height:420},renderers={draw:new api.LineCoverageRenderer(gl),frame:new api.LineCoverageRenderer(gl,{stateScope:'frame'})},extension=gl.getExtension('EXT_disjoint_timer_query_webgl2'),pixel=new Uint8Array(4)
 const signal=(i,channel)=>i%4093===0?NaN:.82*Math.sin(2*Math.PI*(200+channel*25)*i/48000)+.13*Math.cos(2*Math.PI*1300*i/48000)
 const create=channels=>Array.from({length:channels},(_,channel)=>{const data=new api.DataSetXY({schema:{x:{storage:Float64Array,auto:true,pattern:'progressive'},raw:{storage:Float64Array},y:{storage:Float64Array}}}).setMaxSampleCount(48000),values=Float64Array.from({length:48000},(_,i)=>signal(i,channel));data.appendSamples({raw:values,y:values},{start:0,step:1000/48000});return{channel,data,cache:new api.LineDisplayCache()}})
 const prepare=sources=>sources.map(({channel,data,cache})=>{
  const next=data.getNextSampleIndex(),first=next-data.getSampleCount(),order=api.getColumnOrder(data,'x'),range={start:(sources.length-1-channel)/sources.length,end:(sources.length-channel)/sources.length}
  const result=cache.update({source:{identity:data,contentEpoch:data.getContentEpoch(),revision:data.revision,firstSampleIndex:first,nextSampleIndex:next,x:data.getColumnRuns('x'),y:data.getColumnRuns('y')},coordinateMode:'linear',bindingRevision:0,styleRevision:0,projectionKey:'linear',monotonicX:order.strict?'verified-strict':'invalid',visibleSegments:{first,end:next-1},domain:{x:{start:data.getValue('x',0),end:data.getValue('x',data.getSampleCount()-1)},y:api.domainForStack({start:-1.25,end:1.25},range)},plotRect:rect,clipRect:{left:rect.left,top:rect.top+(1-range.end)*rect.height,width:rect.width,height:(range.end-range.start)*rect.height},devicePixelRatio:1,maximumPixelSpan:1,style:{color:[1,.4,.1,.5],thickness:2},strokeGroup:channel+1})
  if(result.kind!=='display'||!result.packet)throw Error('Display cache did not return a packet');return result.packet
 })
 const advance=sources=>{for(const {channel,data}of sources){const start=data.getNextSampleIndex(),values=Float64Array.from({length:960},(_,i)=>signal(start+i,channel));data.appendSamples({raw:values,y:values})}}
 const release=sources=>sources.forEach(({data,cache})=>{cache.dispose();data.dispose()})
 const clear=()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT)}
 const render=(mode,packets)=>{const renderer=renderers[mode];renderer.beginFrame();try{for(const packet of packets)if(!renderer.drawGroup([packet],rect,1))throw Error('Packet rejected')}finally{renderer.endFrame()}}
 const read=()=>{const values=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,values);return values}
 const poll=query=>new Promise(resolve=>{const start=performance.now();const tick=()=>{if(gl.getParameter(extension.GPU_DISJOINT_EXT)){gl.deleteQuery(query);resolve({status:'disjoint'});return}if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){const milliseconds=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(query);resolve({status:'available',milliseconds});return}if(performance.now()-start>5000){gl.deleteQuery(query);resolve({status:'timeout'});return}requestAnimationFrame(tick)};requestAnimationFrame(tick)})
 window.__coverageState={api,canvas,gl,rect,renderers,extension,pixel,create,prepare,advance,release,clear,render,read,poll,dispose(){Object.values(renderers).forEach(r=>r.dispose());return{glError:gl.getError(),contextLost:gl.isContextLost(),stats:Object.fromEntries(Object.entries(renderers).map(([k,v])=>[k,{...v.stats}]))}}}
 return{browserDpr:devicePixelRatio,rendererDpr:1,plot:rect,renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),context:gl.getContextAttributes(),gpuTimer:Boolean(extension)}
}

function stateRestoration(){
 const f=window.__coverageState,gl=f.gl,renderer=f.renderers.frame,sources=f.create(2),packets=f.prepare(sources),framebuffer=gl.createFramebuffer(),texture=gl.createTexture(),sampler=gl.createSampler(),other=gl.createTexture(),vao=gl.createVertexArray(),buffer=gl.createBuffer()
 gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,1000,600);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0)
 if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('External FBO incomplete')
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,other);gl.bindSampler(0,sampler);gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,texture)
 gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,16,gl.STATIC_DRAW);gl.useProgram(null)
 gl.viewport(17,23,333,222);gl.scissor(31,37,200,100);gl.clearColor(.1,.2,.3,.4);gl.colorMask(false,true,false,true);gl.enable(gl.SCISSOR_TEST);gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.enable(gl.CULL_FACE);gl.disable(gl.DITHER)
 gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT,gl.FUNC_SUBTRACT);gl.blendFuncSeparate(gl.ONE,gl.ZERO,gl.ZERO,gl.ONE)
 const keys=[gl.DRAW_FRAMEBUFFER_BINDING,gl.READ_FRAMEBUFFER_BINDING,gl.VIEWPORT,gl.SCISSOR_BOX,gl.COLOR_CLEAR_VALUE,gl.COLOR_WRITEMASK,gl.CURRENT_PROGRAM,gl.VERTEX_ARRAY_BINDING,gl.ARRAY_BUFFER_BINDING,gl.ACTIVE_TEXTURE,gl.TEXTURE_BINDING_2D,gl.BLEND_SRC_RGB,gl.BLEND_DST_RGB,gl.BLEND_SRC_ALPHA,gl.BLEND_DST_ALPHA,gl.BLEND_EQUATION_RGB,gl.BLEND_EQUATION_ALPHA]
 const caps=[gl.SCISSOR_TEST,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.BLEND,gl.CULL_FACE,gl.RASTERIZER_DISCARD,gl.DITHER,gl.SAMPLE_ALPHA_TO_COVERAGE,gl.SAMPLE_COVERAGE]
 const snapshot=()=>{const result=keys.map(key=>gl.getParameter(key));result.push(...caps.map(key=>gl.isEnabled(key)));const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0);result.push(gl.getParameter(gl.TEXTURE_BINDING_2D),gl.getParameter(gl.SAMPLER_BINDING));gl.activeTexture(active);return result}
 const same=(a,b)=>a.every((v,i)=>ArrayBuffer.isView(v)||Array.isArray(v)?v.length===b[i].length&&[...v].every((x,j)=>Object.is(x,b[i][j])):Object.is(v,b[i]))
 const before=snapshot();renderer.beginFrame();renderer.drawGroup([packets[0]],f.rect,1);renderer.flushState();const flushPreserved=same(before,snapshot())
 // Interleave a different pipeline's state after the explicit boundary. A new
 // coverage batch must restore these new values, not the first batch's state.
 gl.viewport(41,43,400,300);gl.scissor(11,13,900,500);gl.colorMask(true,false,true,false);gl.enable(gl.BLEND);gl.disable(gl.DEPTH_TEST)
 const mixed=snapshot();renderer.drawGroup([packets[1]],f.rect,1);renderer.endFrame();const mixedPreserved=same(mixed,snapshot()),stats={...renderer.stats},error=gl.getError()
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindSampler(0,null);gl.colorMask(true,true,true,true);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.disable(gl.SCISSOR_TEST)
 gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteTexture(other);gl.deleteSampler(sampler);gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);f.release(sources)
 return{passed:flushPreserved&&mixedPreserved&&error===0&&stats.stateCaptures===2&&stats.stateRestores===2,flushPreserved,mixedPreserved,glError:error,stats}
}

function qualityCheck(channels){
 const f=window.__coverageState,sources=f.create(channels),packets=f.prepare(sources)
 f.clear();f.render('draw',packets);const before=f.read();f.clear();f.render('frame',packets);const after=f.read()
 let differingBytes=0,maximumDifference=0;for(let i=0;i<before.length;i++){if(before[i]!==after[i])differingBytes++;maximumDifference=Math.max(maximumDifference,Math.abs(before[i]-after[i]))}
 const stats={draw:{...f.renderers.draw.stats},frame:{...f.renderers.frame.stats}},image=f.canvas.toDataURL(),glError=f.gl.getError();f.release(sources)
 return{channels,passed:differingBytes===0&&glError===0,differingBytes,maximumDifference,stats,glError,image}
}

async function measure({channels,repetition,frames}){
 const f=window.__coverageState,gl=f.gl,ext=f.extension;if(!ext)throw Error('GPU timer unavailable')
 document.getElementById('status').textContent=`Coverage state: ${channels} channels, repetition ${repetition+1}/3`
 const sources=f.create(channels),values={draw:[],frame:[]}
 const once=async(mode,packets)=>{await new Promise(requestAnimationFrame);f.clear();const query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);const begin=performance.now();f.render(mode,packets);gl.endQuery(ext.TIME_ELAPSED_EXT);const callbackMs=performance.now()-begin;gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,f.pixel);const workMs=performance.now()-begin,gpu=await f.poll(query);return{callbackMs,workMs,gpu,glError:gl.getError(),stats:{...f.renderers[mode].stats}}}
 const initial=f.prepare(sources),warmup={draw:await once('draw',initial),frame:await once('frame',initial)}
 for(let frame=0;frame<frames;frame++){f.advance(sources);const packets=f.prepare(sources);for(const mode of frame%2?['frame','draw']:['draw','frame'])values[mode].push(await once(mode,packets))}
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
 const summary=Object.fromEntries(Object.entries(values).map(([mode,rows])=>[mode,{workMedianMs:median(rows.map(v=>v.workMs)),callbackMedianMs:median(rows.map(v=>v.callbackMs)),gpuRangeMedianMs:median(rows.map(v=>v.gpu.milliseconds)),stateCaptures:rows.at(-1).stats.stateCaptures,stateRestores:rows.at(-1).stats.stateRestores,uploadedBytesCumulative:rows.at(-1).stats.uploadedBytes,scratchBytes:rows.at(-1).stats.scratchBytes,residentBufferBytes:rows.at(-1).stats.residentBufferBytes}]))
 const valid=Object.values(values).flat().every(v=>v.glError===0&&v.gpu.status==='available')&&!gl.isContextLost();f.release(sources)
 return{channels,repetition,frames,valid,sourceSamples:channels*48000,preparationExcluded:true,warmup,values,summary}
}
