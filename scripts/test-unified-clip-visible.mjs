import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {connectVisibleChrome,ensureTestServer} from './visible-browser.mjs';
const directory=process.env.CRYCHART_CLIP_EVIDENCE??'codex_artifact/unified-clip-visible/'+new Date().toISOString().replaceAll(/[:.]/g,'-');
const port=Number(process.env.CRYCHART_PORT??4178),baseURL=`http://127.0.0.1:${port}`;
if(!Number.isInteger(port)||port<1||port>65535)throw new RangeError('Invalid CRYChart server port');
await mkdir(directory,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source='codex_artifact/unified-clip-candidate';
for(const name of ['baseline.js','candidate.js'])await copyFile(process.env[name==='baseline.js'?'CRYCHART_CLIP_BASELINE':'CRYCHART_CLIP_CANDIDATE']??source+'/'+name,directory+'/'+name);
await copyFile('scripts/unified-clip-fixture.mjs',directory+'/fixture.js');
await writeFile(directory+'/fixture.html','<!doctype html><meta charset="utf-8"><title>Explicit GPU clip correctness</title><style>body{margin:12px;background:#122033;color:white;font:15px system-ui}canvas{display:block;background:#000;width:1000px;height:600px}#chart{width:1000px;height:450px;position:relative}</style><p id="status">Original contained GPU clipping candidate</p><canvas id="plot" width="1000" height="600"></canvas><div id="chart"></div>');
const report={createdAt:new Date().toISOString(),visible:true,headless:false,defaultChanged:false,productionDistChanged:false,candidateSHA256:hash(await readFile(directory+'/candidate.js')),baselineSHA256:hash(await readFile(directory+'/baseline.js')),fixtureSHA256:hash(await readFile(directory+'/fixture.js')),checks:[],errors:[],fullEquivalence:false,performanceAcceptance:false};
const server=await ensureTestServer(port);let browser,page;
try{const connected=await connectVisibleChrome();browser=connected.browser;page=await browser.contexts()[0].newPage();report.browser=connected.metadata;report.baseURL=baseURL;report.workspace=process.cwd();report.console=[];
for(const name of ['baseline.js','candidate.js','fixture.js']){const response=await page.request.get(baseURL+'/'+directory+'/'+name);if(!response.ok()||hash(await response.body())!==hash(await readFile(directory+'/'+name)))throw new Error('Selected server does not serve the expected clip fixture: '+name);}
await page.setViewportSize({width:1100,height:820});await page.bringToFront();page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(report.console.length<30)report.console.push({type:message.type(),text:message.text()});});await page.goto(baseURL+'/'+directory+'/fixture.html');const result=await page.evaluate(async()=>{try{const fixture=await import('./fixture.js');return await fixture.run();}catch(error){return{...window.__clipCheckpoint,error:String(error.stack??error)};}});report.checks=result.checks??[];report.environment=result.environment;if(result.error)report.errors.push(result.error);for(const[name,data]of Object.entries(result.images??{}))await writeFile(directory+'/'+name+'.png',Buffer.from(data.split(',')[1],'base64'));report.completed=!result.error;report.passed=report.checks.length>0&&report.checks.every(check=>check.passed)&&!report.errors.length;}
catch(error){report.errors.push(String(error?.stack??error));report.completed=false;report.passed=false;}
finally{report.finishedAt=new Date().toISOString();await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');if(page)await page.close().catch(()=>{});if(browser)await browser.close();await server.close();console.log(JSON.stringify({directory,checks:report.checks,errors:report.errors,passed:report.passed}));}
if(!report.passed)process.exitCode=1;
