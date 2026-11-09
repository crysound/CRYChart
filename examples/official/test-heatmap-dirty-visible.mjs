import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {connectVisibleChrome,ensureTestServer,showStep} from '../../scripts/visible-browser.mjs';

const output=resolve('codex_artifact/heatmap-dirty-visible');await mkdir(output,{recursive:true});
const prior=await readFile(resolve(output,'report.json'),'utf8').catch(()=>undefined);if(prior)await writeFile(resolve(output,`report-history-${Date.now()}.json`),prior);
const seriesPath=resolve('src/series.ts'),source=await readFile(seriesPath,'utf8'),start=source.indexOf('export class HeatmapSeries'),prefix=source.slice(0,start);let before=source.slice(start);
assert.ok(start>0&&before.includes('acknowledgeDataRevision'));
before=before.replace('  private pendingFullDataUpdate = false;','');
const changeStart=before.indexOf('  private changed('),changeEnd=before.indexOf('  invalidateIntensityValues(');
before=before.slice(0,changeStart)+`  private changed(dataChanged = false) {
    this.revision++;
    if (dataChanged) {this.dataRevision++;this.dataUpdate=undefined;}
    this.chart.invalidate();
    return this;
  }
`+before.slice(changeEnd);
before=before.replace('return this.changed(true,update);','this.changed(true);this.dataUpdate=update;return this;');
before=before.replace('    return this.changed(true,update);','    this.changed(true);this.dataUpdate=update;return this;');
assert.ok(!before.includes('acknowledgeDataRevision')&&!before.includes('pendingFullDataUpdate')&&!before.includes('changed(true,update)'));
const previousSource=prefix+before,hash=text=>createHash('sha256').update(text).digest('hex');
await writeFile(resolve(output,'before-series.ts'),previousSource);await writeFile(resolve(output,'after-series.ts'),source);
await build({entryPoints:['examples/official/heatmap-dirty-probe.ts'],bundle:true,format:'esm',outfile:resolve(output,'probe.js'),plugins:[{name:'frozen-series-before-after',setup(builder){builder.onResolve({filter:/^virtual:before-heatmap$/},()=>({path:seriesPath,namespace:'before-heatmap'}));builder.onLoad({filter:/.*/,namespace:'before-heatmap'},()=>({contents:previousSource,loader:'ts',resolveDir:dirname(seriesPath)}));builder.onLoad({filter:/[/\\]src[/\\]series\.ts$/},args=>args.path===seriesPath?{contents:source,loader:'ts',resolveDir:dirname(seriesPath)}:undefined);}}]});
await writeFile(resolve(output,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Heatmap dirty region comparison</title><style>body{margin:12px;background:#13191f;color:#e9ecca;font:15px system-ui}.pair{display:flex;gap:16px}canvas{width:590px;height:550px;border:1px solid #54645c}h1{font-size:19px}h2{font-size:15px}#integration{height:500px;width:1180px}</style><h1>Heatmap upload comparison · visible Chrome</h1><div class="pair"><section><h2>Before: final patch only</h2><canvas id="before" width="590" height="550"></canvas></section><section><h2>After: all pending patches</h2><canvas id="after" width="590" height="550"></canvas></section></div><div id="integration" hidden></div><script type="module" src="probe.js"></script>');
const server=await ensureTestServer(),{browser,page,metadata}=await connectVisibleChrome(),report={browserVisible:true,browser:metadata,observedAt:new Date().toISOString(),comparison:'Only HeatmapSeries dirty-region tracking is reverted for the baseline; both sides use the same current GPU shader and dependencies.',beforeSeriesSHA256:hash(previousSource),afterSeriesSHA256:hash(source),checks:[],errors:[]};
page.on('pageerror',error=>report.errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
try{await page.setViewportSize({width:1360,height:900});await page.goto(`http://127.0.0.1:4178/codex_artifact/heatmap-dirty-visible/index.html?run=${Date.now()}`,{waitUntil:'networkidle'});await page.waitForFunction(()=>Boolean(window.__heatmapDirtyProbe));
  for(const name of ['initial','two-columns','disjoint-patches','full-then-patch','stale-ack','hide-show','clear-then-patch','scroll-initialize','scroll-wrap','scroll-two-vectors','context-restore','chart-integration']){await showStep(page,'热图脏区域合并 · 可见像素验证',name);const result=await page.evaluate(name=>window.__heatmapDirtyProbe.run(name),name);report.checks.push(result);console.log(`PASS ${name}: ${JSON.stringify(result)}`);}
  const session=await page.context().newCDPSession(page),shot=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await writeFile(resolve(output,'comparison.png'),Buffer.from(shot.data,'base64'));assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.errors.push(String(error));report.passed=false;}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await page.evaluate(()=>window.__heatmapDirtyProbe?.dispose()).catch(()=>{});await browser.close();await server.close();}
console.log(JSON.stringify({checks:report.checks.length,passed:report.passed,errors:report.errors}));if(!report.passed)process.exitCode=1;
