import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {connectVisibleChrome,ensureTestServer,showStep} from './visible-browser.mjs';
const directory='codex_artifact/polar-heatmap-visible';mkdirSync(directory,{recursive:true});const server=await ensureTestServer(),report={visible:true,createdAt:new Date().toISOString(),bundleSHA256:createHash('sha256').update(readFileSync('dist/crychart.js')).digest('hex'),errors:[]};let browser;
try{
 const connection=await connectVisibleChrome();browser=connection.browser;const page=connection.page;report.browser=connection.metadata.Browser;page.on('pageerror',error=>report.errors.push(error.message));await page.setViewportSize({width:1100,height:760});await page.goto(`http://127.0.0.1:4178/tests/browser.html?polar=${report.bundleSHA256}`);await showStep(page,'CRYChart：极坐标热力图实测','扇区/圆环定位、角度方向、周期插值、局部GPU上传与真实鼠标取值');
 report.result=await page.evaluate(async()=>{
  const l=await import('/dist/crychart.js'),c=l.cryChart().Polar({container:'chart'}).setTitle('Polar texture / annuli / periodic interpolation');c.getAmplitudeAxis().setInterval({start:0,end:2});c.getAngularAxis().setInterval({start:0,end:360});
  const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0],[0,255,255],[255,0,255],[255,255,255],[255,128,0]];
  const h=c.addHeatmapSeries({sectors:4,annuli:2,amplitudeEnd:2}).setFillStyle(new l.PalettedFill({lut:new l.LUT({steps:colors.map((v,i)=>({value:i,color:l.ColorRGBA(...v)})),interpolate:false})})).invalidateIntensityValues([[0,1,2,3],[4,5,6,7]]);
  c.renderNow();const gl=c.renderer.gl,pixel=(angle,amplitude)=>{const point=c.projectPolarPoint({angle,amplitude}),rgba=new Uint8Array(4);gl.readPixels(Math.round(point.x*c.dpr),Math.round(c.canvas.height-point.y*c.dpr),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return[...rgba];};
  const cardinal=[45,135,225,315].map(angle=>pixel(angle,.5)),outer=pixel(45,1.5),outside=pixel(45,2.1),before=c.getRenderStats().heatmapStats.uploadedBytes;
  h.invalidateIntensityValues({iSector:0,iAnnulus:0,values:[[7]]});c.renderNow();const changed=pixel(45,.5),unchanged=pixel(225,.5),partialBytes=c.getRenderStats().heatmapStats.uploadedBytes-before;
  const uploads=c.getRenderStats().heatmapStats.uploads;c.setAngleOrigin(90).setClockwise(true);c.renderNow();const oriented=pixel(135,.5),after=c.getRenderStats().heatmapStats.uploads;
  const projected=c.projectPolarPoint({angle:45,amplitude:.5}),rect=c.overlay.getBoundingClientRect(),hit=h.solveNearestFromScreen({clientX:rect.left+projected.x,clientY:rect.top+projected.y});
  window.polarChart=c;return{cardinal,outer,outside,changed,unchanged,partialBytes,uploads,after,oriented,hit:hit?{angle:hit.angleDeg,amplitude:hit.amplitude,intensity:hit.intensity}:null,error:gl.getError()};
 });const r=report.result;assert.deepEqual(r.cardinal,[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]]);assert.deepEqual(r.outer,[0,255,255,255]);assert.equal(r.outside[3],0);assert.deepEqual(r.changed,[255,128,0,255]);assert.deepEqual(r.unchanged,[0,0,255,255]);assert.equal(r.partialBytes,4);assert.equal(r.uploads,r.after);assert.deepEqual(r.oriented,[0,255,0,255]);assert.ok(Math.abs(r.hit.angle-45)<1e-9);assert.equal(r.hit.intensity,7);assert.equal(r.error,0);
 const cdp=await page.context().newCDPSession(page),capture=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${directory}/chart.png`,Buffer.from(capture.data,'base64'));await cdp.detach();assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack??String(error);process.exitCode=1;}finally{writeFileSync(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();await server.close();}
