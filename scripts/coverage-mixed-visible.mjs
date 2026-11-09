import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {connectVisibleChrome,ensureTestServer} from './visible-browser.mjs'
const directory=`codex_artifact/coverage-mixed-visible/${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}`
await mkdir(directory,{recursive:true})
await build({stdin:{contents:"export {DataRenderer} from './src/render.ts';export {domainForStack} from './src/axis-layout.ts';export {cryChart,ColorHEX,SolidLine,SolidFill,Themes} from './src/index.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',outfile:directory+'/candidate.js'})
await writeFile(directory+'/fixture.html','<!doctype html><meta charset="utf-8"><title>Visible mixed coverage pipelines</title><style>body{background:#101827;color:white;font:16px system-ui}canvas{width:1000px;height:600px;background:black}</style><h2 id="status">Coverage frame integration — real WebGL state and pixels</h2><canvas id="plot" width="1000" height="600"></canvas><div id="chart" style="width:1000px;height:600px"></div>')
const report={createdAt:new Date().toISOString(),visible:true,headless:false,bundleSHA256:createHash('sha256').update(await readFile(directory+'/candidate.js')).digest('hex'),defaultEnabled:false,checks:[],errors:[],performanceGoalPassed:false,fullQualityEquivalence:false}
let browser,page;const server=await ensureTestServer()
try{
 const connected=await connectVisibleChrome();browser=connected.browser;page=connected.page
 await page.setViewportSize({width:1100,height:780});page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('http://127.0.0.1:4178/'+directory+'/fixture.html',{waitUntil:'load'})
 const result=await page.evaluate(run);report.checks=result.checks;report.environment=result.environment
 for(const [name,data]of Object.entries(result.images))await writeFile(directory+'/'+name+'.png',Buffer.from(data.split(',')[1],'base64'))
 report.status=report.errors.length||report.checks.some(c=>!c.passed)?'failed':'passed-explicit-frame-integration'
}catch(error){report.status='failed';report.errors.push(String(error?.stack??error));process.exitCode=1}
finally{report.finishedAt=new Date().toISOString();await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');if(page)await page.goto('http://127.0.0.1:4178/#demo=stream').catch(()=>{});if(browser)await browser.close();await server.close();console.log(JSON.stringify({status:report.status,report:directory+'/report.json',checks:report.checks,errors:report.errors}))}

async function run(){
 const api=await import('./candidate.js'),canvas=document.getElementById('plot'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true}),rect={left:100,top:80,width:800,height:420},checks=[],images={}
 if(!gl)throw Error('WebGL2 unavailable')
 const renderers={draw:new api.DataRenderer(canvas,{lineCoverageUnion:true,lineCoverageStateScope:'draw'}),frame:new api.DataRenderer(canvas,{lineCoverageUnion:true,lineCoverageStateScope:'frame'})}
 let id=1
 const line=(options={})=>{const count=options.count??201,positions=Float32Array.from({length:count*2},(_,i)=>i%2?.7*Math.sin(Math.floor(i/2)*.12):100*Math.floor(i/2)/(count-1));const key=id++;return{id:key,strokeGroup:key,revision:1,dimensions:2,count,positions,mode:'line',pointSize:0,thickness:3,color:[1,.2,.1,.5],origin:{x:0,y:0,z:0},domain:{x:{start:0,end:100},y:{start:-1,end:1}},monotonicX:true,strictlyMonotonicX:true,...options}}
 const points=options=>line({count:3,positions:new Float32Array([20,.9,50,0,80,-.9]),mode:'points',pointSize:11,thickness:0,color:[.1,1,.2,1],strictlyMonotonicX:false,...options})
 const dash=options=>line({color:[.2,.3,1,1],dashPattern:[9,7],...options})
 const read=()=>{const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels}
 const draw=(renderer,packets,target=null)=>{gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.bindVertexArray(null);renderer.render(packets,rect,1);return read()}
 const compare=(name,packets,target=null)=>{document.getElementById('status').textContent=name;const a=draw(renderers.draw,packets,target),b=draw(renderers.frame,packets,target);let differing=0,colored=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])differing++;if(i%4===3&&b[i])colored++}const stats={draw:renderers.draw.lineStrip?.getCoverageStats(),frame:renderers.frame.lineStrip?.getCoverageStats()},error=gl.getError();checks.push({id:name,passed:differing===0&&colored>0&&error===0,differingBytes:differing,coloredPixels:colored,stats,glError:error});if(!target)images[name]=canvas.toDataURL();return b}
 const top={left:100,top:80,width:800,height:210},bottom={left:100,top:290,width:800,height:210},topY=api.domainForStack({start:-1,end:1},{start:.5,end:1}),bottomY=api.domainForStack({start:-1,end:1},{start:0,end:.5})
 compare('coverage-point-coverage',[line(),points(),line({color:[0,.4,1,.3]})])
 compare('two-pane-same-clip-dash-boundary',[line({clipRect:top,domain:{x:{start:0,end:100},y:topY}}),line({clipRect:bottom,domain:{x:{start:0,end:100},y:bottomY}}),dash({clipRect:bottom,domain:{x:{start:0,end:100},y:bottomY}}),points({clipRect:top,domain:{x:{start:0,end:100},y:topY}})])
 compare('point-dash-coverage-point',[points(),dash(),line(),points({pointShape:4,color:[1,1,0,1]})])
 const original=line(),a={...original,id:id++,count:101,positions:original.positions.subarray(0,202)},b={...original,id:id++,count:101,positions:original.positions.subarray(200)}
 compare('same-stroke-blocks-and-general',[a,b,dash(),points()])
 const palette=line({colors:Float32Array.from({length:804},(_,i)=>i%4===3?1:i%4===0?1:.3)})
 compare('coverage-palette-fallback-coverage',[line(),palette,line({color:[.1,1,.4,.3]})])
 const stacked=Array.from({length:16},(_,channel)=>{const range={start:(15-channel)/16,end:(16-channel)/16};return line({clipRect:{left:100,top:80+channel*420/16,width:800,height:420/16},domain:{x:{start:0,end:100},y:api.domainForStack({start:-1,end:1},range)}})})
 const data=compare('sixteen-pane-continuous-batch',stacked);checks.push({id:'one-capture-for-sixteen-strokes',passed:renderers.frame.lineStrip.getCoverageStats().stateCaptures===1&&renderers.frame.lineStrip.getCoverageStats().stateRestores===1,stats:renderers.frame.lineStrip.getCoverageStats()})
 let outside=0;for(let y=0;y<600;y++)for(let x=0;x<1000;x++)if(x<100||x>=900||y<100||y>=520)outside+=data[(y*1000+x)*4+3]>0?1:0
 checks.push({id:'stacked-pixels-stay-inside-plot',passed:outside===0,outsidePixels:outside})
 const target=gl.createFramebuffer(),texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,1000,600);gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0)
 if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Custom FBO incomplete')
 compare('custom-fbo-mixed-pipelines',[line(),points(),dash(),line()],target)
 const preserved=()=>gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)===target&&gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)===target&&gl.getParameter(gl.VERTEX_ARRAY_BINDING)===null&&!gl.isEnabled(gl.SCISSOR_TEST)&&[...gl.getParameter(gl.VIEWPORT)].join(',')==='100,100,800,420'
 const badRange={...dash(),drawFirst:-1,drawCount:3};let rangeError=''
 try{gl.bindFramebuffer(gl.FRAMEBUFFER,target);renderers.frame.render([line(),badRange],rect,1)}catch(error){rangeError=error.message}
 checks.push({id:'range-exception-restores-target-and-baseline',passed:Boolean(rangeError)&&preserved()&&gl.getError()===0,error:rangeError})
 const first=line(),badGroup=line({strokeGroup:first.strokeGroup,color:[0,1,0,1]});let groupError=''
 try{gl.bindFramebuffer(gl.FRAMEBUFFER,target);renderers.frame.render([line(),first,badGroup],rect,1)}catch(error){groupError=error.message}
 checks.push({id:'group-preflight-exception-restores-target',passed:Boolean(groupError)&&preserved()&&gl.getError()===0,error:groupError})
 compare('valid-render-after-exceptions',[line(),points(),dash()],target)
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(target);gl.deleteTexture(texture);Object.values(renderers).forEach(r=>r.dispose())
 const context=api.cryChart(),chart=context.ChartXY({container:document.getElementById('chart'),theme:api.Themes.darkGold,experimentalLineCoverage:true});chart.setAutoCursorMode(0);chart.getDefaultAxisX().setInterval({start:0,end:100});chart.getDefaultAxisY().setInterval({start:-1,end:1})
 chart.addLineSeries().setStrokeStyle(new api.SolidLine({thickness:3,fillStyle:new api.SolidFill({color:api.ColorHEX('#ff7033')})})).addArraysXY(Float64Array.from({length:201},(_,i)=>i/2),Float32Array.from({length:201},(_,i)=>Math.sin(i*.12)*.8))
 chart.addPointSeries().setPointSize(12).add([{x:30,y:.8},{x:60,y:-.8}]);chart.addLineSeries().setStrokeStyle(new api.SolidLine({thickness:2,dashPattern:[9,7],fillStyle:new api.SolidFill({color:api.ColorHEX('#52eedd')})})).add([{x:0,y:-.5},{x:100,y:.5}])
 await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)
 const chartGL=chart.renderer.gl,stats=chart.renderer.lineStrip?.getCoverageStats(),pixels=new Uint8Array(chartGL.drawingBufferWidth*chartGL.drawingBufferHeight*4);chartGL.readPixels(0,0,chartGL.drawingBufferWidth,chartGL.drawingBufferHeight,chartGL.RGBA,chartGL.UNSIGNED_BYTE,pixels)
 checks.push({id:'actual-chartxy-mixed-opt-in',passed:Boolean(stats?.maskPasses)&&stats.stateCaptures===stats.stateRestores&&pixels.some((v,i)=>i%4===3&&v>0)&&chartGL.getError()===0,stats})
 images['actual-chartxy-mixed']=chartGL.canvas.toDataURL();context.dispose()
 return{checks,images,environment:{renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),browserDpr:devicePixelRatio}}
}
