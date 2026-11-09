import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {connectVisibleChrome,ensureTestServer} from './visible-browser.mjs'

const directory=`codex_artifact/line-coverage-visible/${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}`
await mkdir(directory,{recursive:true})
await build({stdin:{contents:"export {LineStripRenderer} from './src/render-line-strip.ts';export {ChartXY} from './src/chart.ts';export {SolidLine,SolidFill,ColorRGBA} from './src/core/styles.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',outfile:directory+'/candidate.js'})
await writeFile(directory+'/fixture.html','<!doctype html><meta charset="utf-8"><title>Visible conservative line coverage</title><style>body{margin:12px;background:#122033;color:white;font:15px system-ui}canvas{display:block;background:#07111d;width:1000px;height:600px}#host{width:1000px;height:450px;position:relative}</style><h2 id="status">Original line coverage candidate: raw source retained</h2><canvas id="canvas" width="1000" height="600"></canvas><div id="host"></div>')
const files=['src/render-line-strip.ts','src/render-line-direction.ts','src/render-line-coverage.ts','src/line-coverage-geometry.ts','src/render.ts','src/contracts.ts','src/chart.ts']
const report={createdAt:new Date().toISOString(),visible:true,headless:false,candidateDefaultEnabled:false,checks:[],errors:[],fullQualityEquivalence:false,performanceGoalPassed:false,sources:Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),limits:['Independent source-coordinate and coverage checks, not CRYChart equivalence or a performance benchmark.','The main/default renderer remains on the baseline unless explicitly enabled.']}
const server=await ensureTestServer();let browser,page
try{
  const connected=await connectVisibleChrome();browser=connected.browser;page=connected.page;report.browser=connected.metadata.Browser
  await page.setViewportSize({width:1100,height:850});page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto('http://127.0.0.1:4178/'+directory+'/fixture.html',{waitUntil:'load'})
  const result=await page.evaluate(run)
  for(const [name,url] of Object.entries(result.images)){await writeFile(directory+'/'+name+'.png',Buffer.from(url.split(',')[1],'base64'))}
  delete result.images;Object.assign(report,result)
  report.status=report.errors.length||report.checks.some(check=>!check.pass)?'failed':'passed-explicit-candidate'
}catch(error){report.status='failed';report.errors.push(error.stack??error.message);process.exitCode=1}
finally{
  report.completedAt=new Date().toISOString();await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n')
  if(browser)await browser.close();await server.close()
  console.log(JSON.stringify({directory,status:report.status,checks:report.checks.map(c=>({id:c.id,pass:c.pass,details:c.details})),errors:report.errors}))
  if(report.status==='failed')process.exitCode=1
}

async function run(){
  const api=await import('./candidate.js'),canvas=document.querySelector('#canvas'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,alpha:true,premultipliedAlpha:true})
  if(!gl)throw Error('Visible WebGL2 unavailable')
  const baseline=new api.LineStripRenderer(gl),candidate=new api.LineStripRenderer(gl,{coverageUnion:true}),checks=[],images={}
  const rect={left:100,top:80,width:800,height:420},domain={x:{start:0,end:47999},y:{start:-1.3,end:1.3}}
  const signal=i=>i%997===0?1.2:i%991===0?-1.2:.7*Math.sin(i*.19)
  const positions=new Float32Array(48000*2);for(let i=0;i<48000;i++){positions[i*2]=i;positions[i*2+1]=signal(i)}
  const input={id:1,revision:1,strokeGroup:1,positions,count:48000,dimensions:2,mode:'line',color:[.12,.85,.65,1],thickness:2,pointSize:0,origin:{x:0,y:0,z:0},domain,monotonicX:true,strictlyMonotonicX:true}
  const check=(id,pass,details)=>checks.push({id,pass,details})
  const clear=()=>{gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT)}
  const read=()=>{const data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data}
  const pixel=(data,x,y)=>[...data.subarray((Math.floor(y)*canvas.width+Math.floor(x))*4,(Math.floor(y)*canvas.width+Math.floor(x))*4+4)]
  const render=(renderer,packets,dpr=1)=>{clear();renderer.beginFrame();renderer.drawGroup(packets,rect,dpr);renderer.endFrame();return read()}
  const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,sq=dx*dx+dy*dy,t=sq?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/sq)):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t)}
  const quality=(pixels,dpr)=>{
    const project=i=>({x:(rect.left+i/47999*rect.width)*dpr,y:canvas.height-(rect.top+rect.height)*dpr+(signal(i)+1.3)/2.6*rect.height*dpr}),rows=[]
    for(let i=2;i<47998;i++)if(i%997===0||i%991===0){const p=project(i),center={x:Math.floor(p.x)+.5,y:Math.floor(p.y)+.5},minimum=Math.round(Math.max(0,Math.min(1,dpr+.5-Math.min(distance(center,project(i-1),p),distance(center,p,project(i+1)))))*255),alpha=pixel(pixels,center.x,center.y)[3];rows.push({index:i,minimum,alpha,pass:alpha>=minimum-2})}
    return{checked:rows.length,belowMinimum:rows.filter(row=>!row.pass).length,rows}
  }
  document.querySelector('#status').textContent='96 original spike probes: conservative coverage'
  const old=render(baseline,[input]),oldQuality=quality(old,1);images['peaks-baseline']=canvas.toDataURL()
  let current=render(candidate,[input]),newQuality=quality(current,1);images['peaks-coverage']=canvas.toDataURL()
  check('float64-source-spike-minimum',newQuality.belowMinimum===0,{old:oldQuality,new:newQuality})
  const uploaded=candidate.stats.uploadedBytes;render(candidate,[{...input,domain:{x:{start:-1,end:47998},y:domain.y}}]);check('pan-does-not-reupload',candidate.stats.uploadedBytes===uploaded,{before:uploaded,after:candidate.stats.uploadedBytes})

  const simple={...input,id:2,strokeGroup:2,positions:new Float32Array([0,0,100,0,200,0,300,0,400,0]),count:5,domain:{x:{start:0,end:400},y:{start:-1,end:1}},color:[1,0,0,.5]}
  const whole=render(candidate,[simple]),left={...simple,id:3,positions:simple.positions.subarray(0,8),count:4,drawFirst:0,drawCount:3},right={...simple,id:4,positions:simple.positions.subarray(2),count:4,drawFirst:1,drawCount:3}
  const split=render(candidate,[left,right]);let differing=0;for(let i=0;i<whole.length;i++)if(whole[i]!==split[i])differing++
  const center=pixel(split,500,310);check('blocks-union-halo-and-alpha',differing===0&&Math.abs(center[3]-128)<=1&&candidate.getCoverageStats().compositePasses===1,{differingBytes:differing,joinPixel:center,stats:candidate.getCoverageStats()});images['alpha-blocks']=canvas.toDataURL()
  const dense={...input,id:5,strokeGroup:5,color:[1,0,0,.25]};current=render(candidate,[dense]);let maximumAlpha=0;for(let i=3;i<current.length;i+=4)maximumAlpha=Math.max(maximumAlpha,current[i]);check('dense-translucent-union',maximumAlpha>=63&&maximumAlpha<=64,{maximumAlpha})

  const gap={...simple,id:6,strokeGroup:6,positions:new Float32Array([0,0,100,0,150,NaN,250,Infinity,300,0,400,0]),count:6}
  current=render(candidate,[gap]);let gapPixels=0;for(let x=310;x<690;x++)for(let y=305;y<316;y++)if(pixel(current,x,y)[3])gapPixels++
  check('nan-infinity-gap',gapPixels===0&&pixel(current,200,310)[3]>0&&pixel(current,800,310)[3]>0,{gapPixels});images['finite-gaps']=canvas.toDataURL()

  clear();candidate.beginFrame();candidate.draw(simple,rect,1);candidate.draw({...simple,id:7,strokeGroup:7,color:[0,0,1,.5]},rect,1);candidate.endFrame();current=read();const layered=pixel(current,500,310)
  check('different-series-alpha-order',Math.abs(layered[0]-64)<=2&&layered[1]===0&&Math.abs(layered[2]-128)<=1&&Math.abs(layered[3]-192)<=1,{layeredPixel:layered})

  const pane={...simple,id:8,strokeGroup:8,clipRect:{left:100,top:200,width:800,height:8},positions:new Float32Array([0,296,400,296]),count:2,domain:{x:{start:0,end:400},y:{start:0,end:420}}}
  current=render(candidate,[pane]);let outside=0,inside=0;for(let y=0;y<600;y++)for(let x=100;x<900;x++)if(current[(y*1000+x)*4+3]){if(y>=392&&y<400)inside++;else outside++}
  check('stacked-scratch-roi-no-stale-pixels',outside===0&&inside>0,{outside,inside,stats:candidate.getCoverageStats()});images['stacked-roi']=canvas.toDataURL()

  canvas.width=2000;canvas.height=1200;current=render(candidate,[input],2);const highDpr=quality(current,2)
  check('dpr2-spike-coverage',highDpr.belowMinimum===0,highDpr);images['peaks-dpr2']=canvas.toDataURL()
  const errored=gl.getError();check('real-glsl-and-context',errored===0&&!gl.isContextLost(),{glError:errored,contextLost:gl.isContextLost(),scratchBytes:candidate.getCoverageStats().scratchBytes})
  baseline.dispose();candidate.dispose();check('renderer-dispose-numeric-backing',candidate.getCoverageStats().scratchBytes===0&&candidate.getCoverageStats().residentBufferBytes===0,candidate.getCoverageStats())

  canvas.style.display='none';document.querySelector('#status').textContent='Actual ChartXY: explicit coverage + block pipeline'
  const chart=new api.ChartXY({container:document.querySelector('#host'),renderer:'webgl2',experimentalLineBlocks:true,experimentalLineCoverage:true,legend:{addEntriesAutomatically:false}})
  chart.getDefaultAxisX().setInterval({start:0,end:47999,stopAxisAfter:true});chart.getDefaultAxisY().setInterval({start:-1.3,end:1.3,stopAxisAfter:true})
  const series=chart.addLineSeries().setStrokeStyle(new api.SolidLine({thickness:2,fillStyle:new api.SolidFill({color:api.ColorRGBA(255,80,120,128)})}))
  series.add(Array.from({length:48000},(_,i)=>({x:i,y:signal(i)})));chart.renderNow()
  const plot=chart.plot,dpr=chart.dpr,chartGL=chart.renderer.gl,pixels=new Uint8Array(chart.canvas.width*chart.canvas.height*4)
  chartGL.readPixels(0,0,chart.canvas.width,chart.canvas.height,chartGL.RGBA,chartGL.UNSIGNED_BYTE,pixels)
  let chartProbes=0,chartBelow=0
  for(let i=2;i<47998;i++)if(i%997===0||i%991===0){const point=chart.translatePoint({x:i,y:signal(i)},chart.coordsAxis,chart.coordsPixel),column=Math.floor(point.x*dpr),row=Math.floor(chart.canvas.height-point.y*dpr),alpha=pixels[(row*chart.canvas.width+column)*4+3];chartProbes++;if(alpha<99)chartBelow++}
  const actualStats=chart.renderer.lineStrip.getCoverageStats();check('actual-chartxy-opt-in-blocks',chartProbes===96&&chartBelow===0&&actualStats.compositePasses===1&&chartGL.getError()===0,{chartProbes,chartBelow,plot,dpr,stats:actualStats})
  images['chartxy-blocks']=chart.canvas.toDataURL();chart.dispose()
  return{checks,images,environment:{renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),antialias:false,browserDpr:devicePixelRatio}}
}
