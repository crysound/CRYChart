import {build} from 'esbuild'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
const fullControl=process.argv.includes('--full-control'),timeAxis=process.argv.includes('--time-x')?'x':'z';
const directory='codex_artifact/constant-plane-pixels/'+new Date().toISOString().replaceAll(':','-').replaceAll('.','-');mkdirSync(directory,{recursive:true})
await build({stdin:{contents:"export {Chart3D, SolidLine, SolidFill, ColorRGBA, emptyFill, Themes} from './src/index.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',outfile:directory+'/candidate.js'})
const bundle=readFileSync(directory+'/candidate.js')
const server=createServer((req,res)=>{if(req.url==='/candidate.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle)}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>html,body{margin:0;background:#101823}.plot{width:640px;height:400px;display:inline-block}</style><div id="fast" class="plot"></div><div id="control" class="plot"></div><script type="module">import * as api from "/candidate.js";window.api=api</script>')}})
let browser
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']})
 const page=await browser.newPage({viewport:{width:1280,height:500},deviceScaleFactor:1.75}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.api)
 const result=await page.evaluate(async({fullControl,timeAxis})=>{
  const {Chart3D,SolidLine,SolidFill,ColorRGBA,emptyFill,Themes}=api,charts=[],checks=[]
  const make=(id,uncached)=>{
   const chart=new Chart3D({container:document.querySelector('#'+id),theme:Themes.dark,legend:{visible:false}}).setTitle('').setPadding(7)
   charts.push(chart);if(uncached)chart.getConstantCoordinates=()=>({})
   chart.setCameraAutomaticFittingEnabled(false).setCameraLocation({x:.8,y:.6,z:.9});chart.getDefaultAxisX().setInterval(timeAxis==='x'?{start:0,end:500}:{start:0,end:4096});chart.getDefaultAxisY().setInterval({start:-2,end:2});chart.getDefaultAxisZ().setInterval(timeAxis==='x'?{start:1,end:4097}:{start:0,end:500})
   const lines=[]
   for(let plane=0;plane<3;plane++){
    const line=chart.addPointLineAreaSeries({schema:{x:{storage:Float64Array},y:{storage:Float64Array},z:{storage:Float64Array}}}).setAreaFillStyle(emptyFill).setStrokeStyle(new SolidLine({thickness:plane+1,fillStyle:new SolidFill({color:ColorRGBA(30+plane*60,220-plane*40,100+plane*60,plane===1?130:255)})})).setPointSize(plane===1?4:0)
    const x=Float64Array.from({length:4097},(_,i)=>i),y=Float64Array.from(x,v=>Math.sin(v/50+plane));y[510+plane*200]=NaN
    line.appendSamples(timeAxis==='x'?{x:new Float64Array(x.length).fill(100*(plane+1)),y,z:Float64Array.from(x,v=>v+1)}:{x,y,z:new Float64Array(x.length).fill(100*(plane+1))});lines.push(line)
   }
   return{chart,lines}
  }
  const fast=make('fast',fullControl),control=make('control',true)
  for(const {chart}of[fast,control]){const render=chart.gpu3d.render.bind(chart.gpu3d);chart.gpu3d.render=(packets,rect,dpr,camera)=>{chart.lastPacketSnapshot={matrix:[...camera.worldFrame.matrix],packets:packets.map(p=>({positions:Float32Array.from(p.positions,(v,i)=>p.constantCoordinates?.[['x','y','z'][i%3]]??v),color:[...p.color],thickness:p.thickness,pointSize:p.pointSize,mode:p.mode}))};return render(packets,rect,dpr,camera)}}
  try{
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
   const pixels=chart=>{chart.renderNow();const gl=chart.canvas.getContext('webgl2'),data=new Uint8Array(chart.canvas.width*chart.canvas.height*4);gl.readPixels(0,0,chart.canvas.width,chart.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data}
   const compare=name=>{
    const a=pixels(fast.chart),beforeSnapshot=fast.chart.lastPacketSnapshot,owned=fast.chart.gpuPackets,proof=fast.chart.getConstantCoordinates;let b,afterSnapshot
    try{fast.chart.gpuPackets=new Map();fast.chart.getConstantCoordinates=()=>({});b=pixels(fast.chart);afterSnapshot=fast.chart.lastPacketSnapshot}finally{fast.chart.gpuPackets=owned;fast.chart.getConstantCoordinates=proof}
    let differences=0,coloured=0,maxChannelDifference=0,coordinateDifferences=0,matrixDifferences=0;const first=[]
    for(let i=0;i<a.length;i++){if(a[i]!==b[i]){differences++;maxChannelDifference=Math.max(maxChannelDifference,Math.abs(a[i]-b[i]));if(first.length<8)first.push({byte:i,fast:a[i],control:b[i]})}if(i%4===3&&a[i]>0)coloured++}
    const x=beforeSnapshot,y=afterSnapshot
    for(let i=0;i<x.matrix.length;i++)if(x.matrix[i]!==y.matrix[i])matrixDifferences++
    for(let n=0;n<x.packets.length;n++)for(let i=0;i<x.packets[n].positions.length;i++)if(!Object.is(x.packets[n].positions[i],y.packets[n].positions[i]))coordinateDifferences++
    if(!coloured)throw new Error(name+': no data pixels')
    checks.push({name,differentRgbaBytes:differences,maxChannelDifference,dataPixels:coloured,coordinateDifferences,matrixDifferences,first})
   }
   compare('initial planes, NaN gaps, translucent line and point markers')
   for(const interval of[{start:50,end:550},{start:-100,end:400},{start:0,end:1000}]){
    for(const item of[fast,control])(timeAxis==='x'?item.chart.getDefaultAxisX():item.chart.getDefaultAxisZ()).setInterval(interval)
    compare(timeAxis+' domain '+interval.start+'..'+interval.end)
   }
   for(const item of[fast,control]){const axis=timeAxis==='x'?item.chart.getDefaultAxisX():item.chart.getDefaultAxisZ();axis.type='logarithmic';axis.setInterval({start:1,end:1000});axis.setInverted(true)}
   compare('logarithmic and inverted '+timeAxis)
   for(const item of[fast,control])item.chart.getDefaultAxisY().setInterval({start:-1.5,end:1.5})
   compare('Y interval rebuild')
   for(const item of[fast,control])item.lines[0].appendSamples(timeAxis==='x'?{x:[100],y:[.5],z:[4098]}:{x:[4097],y:[.5],z:[100]})
   compare('new data revision rebuild')
   const gl=fast.chart.canvas.getContext('webgl2'),extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw new Error('Real WebGL context recovery extension unavailable')
   const event=name=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(name+' timeout')),5000);fast.chart.canvas.addEventListener(name,()=>{clearTimeout(timer);resolve()},{once:true})})
   const lost=event('webglcontextlost');extension.loseContext();await lost;await new Promise(r=>setTimeout(r,100));const restored=event('webglcontextrestored');extension.restoreContext();await restored;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));compare('context recovery retains constant coordinate uniforms')
   const debug=gl.getExtension('WEBGL_debug_renderer_info')
   return{scope:'Unpublished source cache vs forced full CPU normalization in the same WebGL context; owned Chrome, no Windows acceptance claim',fullControl,timeAxis,checks,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}
  }finally{for(const chart of charts)chart.dispose()}
 },{fullControl,timeAxis})
 result.pageErrors=errors;result.bundleSha256=createHash('sha256').update(bundle).digest('hex');result.status=errors.length||result.checks.some(c=>c.differentRgbaBytes||c.coordinateDifferences||c.matrixDifferences)?'failed':'passed';writeFileSync(directory+'/report.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({directory,...result},null,2));if(result.status!=='passed')process.exitCode=1
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
