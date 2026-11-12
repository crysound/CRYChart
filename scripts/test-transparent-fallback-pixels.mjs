import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const directory='codex_artifact/transparent-source-pixels/'+new Date().toISOString().replaceAll(':','-');mkdirSync(directory,{recursive:true});
await build({stdin:{contents:"export {ChartXY,SolidLine,SolidFill,ColorRGBA} from './src/index.ts';export {DataRenderer} from './src/render.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',outfile:directory+'/api.js'});
const bytes=readFileSync(directory+'/api.js'),server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/api.js'?'text/javascript':'text/html');res.end(req.url==='/api.js'?bytes:'<!doctype html><canvas id="probe" style="width:512px;height:320px"></canvas><script type="module">window.api=await import("/api.js")</script>');});let browser;
const report={scope:'Full retained source opacity fallback, one WebGL program and independent VBOs; not product performance acceptance',checks:[]};
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'chrome',headless:true});
 for(const dpr of[1,1.75]){
  const page=await browser.newPage({viewport:{width:700,height:500},deviceScaleFactor:dpr});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.api);
  const checks=await page.evaluate(({dpr})=>{
   const{ChartXY,DataRenderer,SolidLine,SolidFill,ColorRGBA}=api,chart=new ChartXY({renderer:'canvas2d',legend:{visible:false}}),canvas=document.querySelector('#probe');canvas.width=Math.round(512*dpr);canvas.height=Math.round(320*dpr);
   const renderer=new DataRenderer(canvas,{lineCoverageUnion:true,ownedCoverageFrame:true}),gl=renderer.gl,rect={left:20,top:20,width:472,height:280},checks=[];if(!gl)throw Error('WebGL2 required');
   try{
    chart.axisX.setInterval({start:0,end:48000});chart.axisY.setInterval({start:-1.5,end:1.5});
    const series=chart.addLineSeries({schema:{x:{auto:true,storage:Float64Array},y:{storage:Float64Array}}}).setMaxSampleCount(48000);
    series.appendSamples({y:Float64Array.from({length:48000},(_,i)=>i>19000&&i<22000?NaN:Math.sin(i*.017))},{start:0,step:1});
    for(const alpha of[64,128,192]){
     series.setStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(30,200,170,alpha)})}));
     const packets=series.drawLineDisplayPackets(rect,rect,dpr,1),ordinary=series.drawPacket('line');
     if(packets.length!==1||packets[0].count!==48000||series.getLineDisplayStats()||series.getLineBlockStats())throw Error('Transparency did not atomically restore full source');
     const actual=packets[0];if(actual.positions.length!==ordinary.positions.length||actual.positions.some((v,i)=>!Object.is(v,ordinary.positions[i])))throw Error('Source geometry changed');
     const pixels=()=>{const b=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;};
     renderer.render([{...ordinary,id:101}],rect,dpr);const expected=pixels();renderer.render([{...actual,id:102}],rect,dpr);const output=pixels();
     let differentRgbaBytes=0,dataPixels=0;for(let n=0;n<expected.length;n++){if(expected[n]!==output[n])differentRgbaBytes++;if(n%4===3&&output[n])dataPixels++;}
     checks.push({dpr,alpha,sourceSamples:series.getSampleCount(),differentRgbaBytes,dataPixels,glError:gl.getError()});
    }
   }finally{renderer.dispose();chart.dispose();}
   return checks;
  },{dpr});report.checks.push(...checks);await page.close();
 }
 writeFileSync(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,checks:report.checks.length,failures:report.checks.filter(c=>c.differentRgbaBytes||!c.dataPixels||c.glError)},null,2));assert(report.checks.every(c=>c.differentRgbaBytes===0&&c.dataPixels>0&&c.glError===0));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
