import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const directory='codex_artifact/html-axis-layout/'+new Date().toISOString().replaceAll(':','-');mkdirSync(directory,{recursive:true});
await build({stdin:{contents:"export {ChartXY,htmlTextRenderer} from './src/index.ts';export{makeCustomTheme}from './src/themes.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',outfile:directory+'/api.js'});
const bytes=readFileSync(directory+'/api.js'),server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/api.js'?'text/javascript':'text/html');res.end(req.url==='/api.js'?bytes:'<!doctype html><style>#chart{width:612px;height:536px;--size:12px}#chart .crychart-text{font-size:var(--size)!important;font-family:Arial!important}</style><div id="chart"></div><script type="module">window.api=await import("/api.js")</script>');});let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.api);
 const result=await page.evaluate(async()=>{
  const{ChartXY,htmlTextRenderer,makeCustomTheme}=api,container=document.querySelector('#chart'),chart=new ChartXY({container,textRenderer:htmlTextRenderer,legend:{visible:false},theme:makeCustomTheme({fontFamily:'Arial',fontSize:{axisTitle:14,other:14}})}).setTitle('').setPadding(7);
  try{
   chart.axisX.setInterval({start:0,end:.25});chart.axisY.setInterval({start:-.041,end:.041});chart.axisY.setTickStrategy('Numeric',s=>s.setFormattingFunction(v=>(v*1000).toFixed(0)+'m'));
   chart.addLineSeries().add([{x:0,y:0},{x:.25,y:.03}]);chart.renderNow();const small=await chart.getLayout();container.style.setProperty('--size','16px');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));chart.renderNow();const large=await chart.getLayout();return{small:small.margins,large:large.margins,padding:chart.getPadding(),raw:chart.getSeries()[0].getSampleCount()};
  }finally{chart.dispose();}
 });writeFileSync(directory+'/report.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({directory,...result}));assert.equal(result.small.right,7,'An absent right axis must reserve only chart padding');assert(result.small.left<60&&result.small.bottom<40,'HTML axes must use their actual text extents');assert(result.large.left>result.small.left||result.large.bottom>result.small.bottom);assert.equal(result.raw,2);
}finally{await browser?.close();await new Promise(r=>server.close(r));}
