import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {connectVisibleChrome,ensureTestServer,showStep} from './visible-browser.mjs';
const directory='codex_artifact/line-topology-visible';mkdirSync(directory,{recursive:true});
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const report={visible:true,createdAt:new Date().toISOString(),beforeSHA256:hash(`${directory}/before.js`),afterSHA256:hash('dist/crychart.js'),errors:[]};
const server=await ensureTestServer();let browser;
try{
  const connection=await connectVisibleChrome();browser=connection.browser;const page=connection.page;report.browser=connection.metadata.Browser;
  await page.setViewportSize({width:1100,height:760});page.on('pageerror',error=>report.errors.push(error.message));await page.goto(`http://127.0.0.1:4178/tests/browser.html?topology=${report.afterSHA256}`);
  await showStep(page,'CRYChart：线段顶点优化核验','旧版6顶点与新版4顶点逐像素对比：粗线、接缝、NaN、虚线、渐变与颜色阈值');
  report.cases=await page.evaluate(async({beforeSHA256,afterSHA256})=>{
    const before=await import(`/codex_artifact/line-topology-visible/before.js?v=${beforeSHA256}`),after=await import(`/dist/crychart.js?v=${afterSHA256}`),results=[];
    function draw(l,kind){
      const c=l.cryChart().ChartXY({container:'chart'}).setAutoCursorMode(l.AutoCursorModes.disabled).setTitle(`Original line topology / ${kind}`);c.getDefaultAxisX().setInterval({start:0,end:10});c.getDefaultAxisY().setInterval({start:0,end:10});
      const lut=new l.LUT({steps:[{value:0,color:l.ColorRGBA(0,255,0)},{value:4,color:l.ColorRGBA(255,0,0)},{value:7,color:l.ColorRGBA(0,128,255)},{value:10,color:l.ColorRGBA(255,255,0)}],interpolate:kind!=='discrete'});
      const monotonic=['monotonic','gapped','dense'].includes(kind),style=kind==='dash'?new l.DashedLine({thickness:6,pattern:[12,8],fillStyle:new l.SolidFill({color:l.ColorRGBA(0,255,255,170)})}):new l.SolidLine({thickness:6,fillStyle:kind==='solid'||monotonic?new l.SolidFill({color:l.ColorRGBA(0,255,255,170)}):new l.PalettedFill({lut,lookUpProperty:'value'})});
      const n=kind==='dense'?100000:1001,points=monotonic?Array.from({length:n},(_,i)=>({x:i/(n-1)*10,y:kind==='gapped'&&i>399&&i<420?NaN:5+3*Math.sin(i*(kind==='dense'?.01:.1))})): [{x:-1,y:2,value:0},{x:2,y:8,value:2},{x:3,y:1,value:4},{x:3.1,y:8,value:5},{x:4,y:5,value:7},{x:5,y:5,value:10},{x:6,y:NaN},{x:7,y:2,value:1},{x:9,y:7,value:9},{x:8,y:2,value:3},{x:10,y:4,value:10}];
      c.addLineSeries().setStrokeStyle(style).add(points);
      c.renderNow();const gl=c.renderer.gl,pixels=new Uint8Array(c.canvas.width*c.canvas.height*4);gl.readPixels(0,0,c.canvas.width,c.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return{c,pixels,vertices:c.getRenderStats().vertices,error:gl.getError()};
    }
    for(const kind of ['solid','dash','continuous','discrete','monotonic','gapped','dense']){
      const old=draw(before,kind);old.c.dispose();const current=draw(after,kind);let differentBytes=0,maxDelta=0;for(let i=0;i<old.pixels.length;i++){const delta=Math.abs(old.pixels[i]-current.pixels[i]);if(delta){differentBytes++;maxDelta=Math.max(maxDelta,delta);}}
      results.push({kind,differentBytes,maxDelta,beforeVertices:old.vertices,afterVertices:current.vertices,errors:[old.error,current.error]});if(kind!=='dense')current.c.dispose();
    }return results;
  },report);
  for(const result of report.cases){assert.equal(result.differentBytes,0,JSON.stringify(result));assert.ok(result.afterVertices<result.beforeVertices);assert.deepEqual(result.errors,[0,0]);}
  assert.deepEqual(report.errors,[]);const cdp=await page.context().newCDPSession(page),capture=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${directory}/chart.png`,Buffer.from(capture.data,'base64'));await cdp.detach();report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack??String(error);process.exitCode=1;}finally{writeFileSync(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();await server.close();}
