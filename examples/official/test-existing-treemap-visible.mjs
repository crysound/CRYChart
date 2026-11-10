import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {connectVisibleChrome} from '../../scripts/visible-browser.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex'),args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return[x.slice(2,i<0?undefined:i),i<0?true:x.slice(i+1)];}));
const base=String(args['base-url']??process.env.CRYCHART_BASE_URL??'http://127.0.0.1:4180'),id='crychart-example-1506-TreeMapDynamic';
const directory=resolve(String(args.out??`codex_artifact/functional-existing-treemap/${new Date().toISOString().replace(/[:.]/g,'-')}`));await mkdir(directory,{recursive:true});
let bundlePath,sources={};
if(args.bundle){bundlePath=resolve(String(args.bundle));assert.ok(args['source-manifest'],'An existing bundle needs its frozen build-time source manifest');const m=JSON.parse(await readFile(String(args['source-manifest']),'utf8'));sources=m.sourceHashes??m.sources;assert.ok(sources&&!Array.isArray(sources));}
else{bundlePath=resolve(directory,'official.js');await build({entryPoints:['examples/official/main.ts'],outfile:bundlePath,bundle:true,format:'esm',target:'es2022',plugins:[{name:'record-executed-inputs',setup(builder){builder.onLoad({filter:/\.(ts|js|json)$/},async info=>{const bytes=await readFile(info.path);sources[info.path.replaceAll('\\','/').replace(resolve('.').replaceAll('\\','/')+'/','')]=hash(bytes);return{contents:bytes.toString(),loader:extname(info.path).slice(1)};});}}]});}
const bundle=await readFile(bundlePath),bundleSHA256=hash(bundle);if(args['expected-sha'])assert.equal(bundleSHA256,args['expected-sha']);
const report={sessionId:process.env.CRYCHART_FUNCTIONAL_SESSION_ID,startedAt:new Date().toISOString(),bundlePath,bundleSHA256,sourceHashes:sources,runnerSHA256:hash(await readFile(new URL(import.meta.url))),visibleChrome:true,headless:false,checks:[],errors:[],performanceTest:false,fullReferenceEquivalence:false,scope:'Actual 1506 consumer update, every original leaf, mathematical area invariants, real pointer/keyboard, pause and lifecycle; no claim of reference weights or interpolation equivalence.'};
await writeFile(resolve(directory,'build.json'),JSON.stringify({bundleSHA256,sources},null,2)+'\n');
if(args['build-only']){console.log(JSON.stringify({directory,bundleSHA256,sources:Object.keys(sources).length}));process.exit(0);}

// Independent declarative input specification: path, group base value and member index.
// The update expectation is evaluated in the browser, avoiding cross-engine Math.sin rounding.
const leafSpec=[];
const group=(prefix,names,value)=>names.forEach((name,member)=>leafSpec.push({path:prefix+'/'+name,base:value,member}));
group('Electronics/Mobile Phones/Smartphones/iOS',['Latest','Older Models'],32);
group('Electronics/Mobile Phones/Smartphones/Android',['Mid-Range','High-End','Budget'],31);
group('Electronics/Mobile Phones',['Feature Phones'],23);
group('Electronics/Television & Video',['LED TVs','Projectors','Streaming'],36);
group('Electronics/Laptops',['Ultrabooks','Gaming Laptops'],39);
group('Electronics/Cameras',['DSLR','Point-and-shoot','Mirrorless'],21);
group('Clothing/Women',['Dresses','Bottoms','Tops','Outerwear'],30);
group('Clothing/Men/Accessories',['Hats','Watches'],10);
group('Clothing/Men',['Pants'],24);group('Clothing/Men',['Shirts'],25);
group('Clothing/Children',['Baby','Girls','Boys'],20);
group('Home & Kitchen/Kitchen Supplies',['Appliances','Cookware','Utensils'],31);
group('Home & Kitchen/Furniture',['Chairs','Sofas','Tables'],27);
group('Home & Kitchen/Decor',['Ornaments','Wall Art','Vases'],13);
group('Sports & Outdoors/Outdoor Recreation',['Cycling','Camping & Hiking','Fishing'],23);
group('Sports & Outdoors/Exercise & Fitness',['Strength training','Cardio','Yoga'],24);
group('Sports & Outdoors/Team Sports',['Baseball','Basketball','Soccer'],11);
group('Health & Beauty/Personal Care',['Haircare','Skincare','Oral Care'],25);
group('Health & Beauty/Healthcare',['Supplements','Medicines','Equipment'],24);
group('Health & Beauty/Makeup',['Lips','Eyes','Face'],15);
group('Toys & Games/Games',['Video Games','Card Games','Puzzles','Board Games'],22);
group('Toys & Games/Toys',['Building','Action figures','Dolls','Educational'],17);
group('Books/Non-Fiction',['History','Self-help','Biography'],17);
group('Books/Fiction',['Mystery','Sci-Fi','Stories'],14);
group("Books/Children's Books",['Learning','Storybooks'],11);

const connected=await connectVisibleChrome(),browser=connected.browser,page=await browser.contexts()[0].newPage();await page.bringToFront();await page.setViewportSize({width:1360,height:1180});page.setDefaultTimeout(15000);report.browser=connected.metadata;
const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.route('**/dist/official.js',r=>r.fulfill({contentType:'text/javascript',body:bundle}));
const frames=async(n=2)=>page.evaluate(n=>new Promise(done=>{const step=()=>--n<=0?done():requestAnimationFrame(step);requestAnimationFrame(step);}),n);
const snapshot=()=>page.evaluate(()=>window.__CRY_OFFICIAL__.snapshot());
async function pause(){if(!(await snapshot()).paused)await page.locator('#official-pause').click();await frames();}
async function resume(){if((await snapshot()).paused)await page.locator('#official-pause').click();}
async function check(name,dimension,work){try{const evidence=await work();assert.deepEqual(errors,[]);report.checks.push({id,name,dimension,status:'passed',evidence});console.log('PASS',name);}catch(e){report.checks.push({id,name,dimension,status:'failed',error:String(e.stack??e)});report.errors.push({name,error:String(e.message??e)});console.log('FAIL',name,String(e.message??e));}}
async function capture(name){const bounds=await page.locator('#official-stage').boundingBox();await page.screenshot({path:resolve(directory,name+'.png'),clip:bounds});return name+'.png';}

try{
  await page.goto(base+'/examples/official/index.html#'+id,{waitUntil:'networkidle'});await page.waitForFunction(id=>window.__CRY_OFFICIAL__?.snapshot().referenceId===id,id);await pause();
  await page.evaluate(spec=>{
    const api=window.__CRY_OFFICIAL__,chart=api.inspect().charts[0],proto=chart.constructor.prototype,originalSet=proto.setData,originalRender=proto.render,originalHit=proto.hitRect;
    const probe=window.__treeFunctional={updates:[],layouts:[],spec};
    proto.setData=function(...args){const initial=this.getData().length===0,time=initial?0:api.snapshot().elapsed;const result=originalSet.apply(this,args);probe.updates.push({time,initial,data:this.getData()});if(probe.updates.length>12)probe.updates.shift();return result;};
    proto.render=function(...args){probe.layouts=[];return originalRender.apply(this,args);};
    proto.hitRect=function(rect,data,label,...rest){if(data&&typeof data.name==='string')probe.layouts.push({rect:{...rect},data,label});return originalHit.call(this,rect,data,label,...rest);};
    probe.audit=()=>{
      let compared=0,mismatches=0,firstMismatch,maxTotalError=0;const updateSummaries=[];
      for(const update of probe.updates){const expected=new Map(spec.map((s,i)=>[s.path,s.base*(1-s.member*.12)*(update.time===0?1:.80+.43*Math.sin(update.time*(.35+i%5*.11)+i*1.4))]));const seen=new Set();let total=0,branches=0;
        const visit=(nodes,prefix='')=>{let previous=Infinity;return nodes.reduce((sum,node)=>{const path=prefix?prefix+'/'+node.name:node.name;let nodeWeight;if(node.children?.length){branches++;nodeWeight=visit(node.children,path);}else{const value=expected.get(path);seen.add(path);compared++;if(!Object.is(node.value,value)){mismatches++;firstMismatch??={path,actual:node.value,expected:value,time:update.time};}total+=node.value;nodeWeight=node.value;}if(update.time>0&&nodeWeight>previous){mismatches++;firstMismatch??={reason:'descending-sibling-order',path,time:update.time};}previous=nodeWeight;return sum+nodeWeight;},0);};
        const rootTotal=visit(update.data),expectedTotal=[...expected.values()].reduce((sum,v)=>sum+v,0);maxTotalError=Math.max(maxTotalError,Math.abs(rootTotal-expectedTotal));if(seen.size!==expected.size){mismatches++;firstMismatch??={reason:'leaf-set',actual:seen.size,expected:expected.size};}updateSummaries.push({time:update.time,initial:update.initial,leaves:seen.size,branches,total,roots:update.data.map(x=>x.name)});
      }
      return{compared,mismatches,firstMismatch,maxTotalError,updates:updateSummaries};
    };
    probe.area=()=>{
      const c=api.inspect().charts[0],roots=c.data,focus=c.getPath(),weights=new Map(),parents=new Map(),byNode=new Map(probe.layouts.map(x=>[x.data,x]));
      const visit=(nodes,parent)=>{let sum=0;for(const n of nodes){parents.set(n,parent);const w=n.children?.length?visit(n.children,n):n.value;weights.set(n,w);sum+=w;}return sum;};visit(roots,null);
      let groups=0,tiles=0,maxRatioError=0,maxOverlap=0,missing=[];const check=(nodes,label)=>{const list=nodes.map(n=>byNode.get(n));if(list.some(x=>!x)){missing.push(label);return;}const boxes=list.map(x=>({left:x.rect.left-.8,top:x.rect.top-.8,width:x.rect.width+1.6,height:x.rect.height+1.6})),areas=boxes.map(b=>b.width*b.height),total=areas.reduce((a,b)=>a+b,0),weight=nodes.reduce((s,n)=>s+weights.get(n),0);groups++;tiles+=boxes.length;for(let i=0;i<boxes.length;i++){maxRatioError=Math.max(maxRatioError,Math.abs(areas[i]/total-weights.get(nodes[i])/weight));for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j],overlap=Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));maxOverlap=Math.max(maxOverlap,overlap);}}};
      if(!focus.length)check(roots,'roots');for(const [node]of weights)if(node.children?.length&&byNode.has(node))check(node.children,node.name);
      const top=roots.map(x=>byNode.get(x)).filter(Boolean),bounds=c.plotRect(),topArea=top.reduce((s,x)=>s+(x.rect.width+1.6)*(x.rect.height+1.6),0),areaError=focus.length?null:Math.abs(topArea-bounds.width*bounds.height);
      return{groups,tiles,maxRatioError,maxOverlap,missingTinyGroups:missing,rootAreaError:areaError,rootCount:top.length,path:focus,plot:bounds};
    };
    api.mount('crychart-example-1506-TreeMapDynamic');
  },leafSpec);await pause();
  await check('every initial and timed leaf equals the independent marketplace specification','data',async()=>{await resume();const before=(await snapshot()).moduleDetails.updateRevision;await page.waitForFunction(n=>window.__CRY_OFFICIAL__.snapshot().moduleDetails.updateRevision>=n+3,before);await pause();const a=await page.evaluate(()=>window.__treeFunctional.audit());assert.equal(a.mismatches,0);assert.ok(a.compared>=leafSpec.length*4);assert.ok(a.maxTotalError<1e-10);assert.equal(a.updates[0].initial,true);return a;});
  await check('all visible sibling tile areas match weights without overlap','data',async()=>{const a=await page.evaluate(()=>window.__treeFunctional.area());assert.equal(a.rootCount,7);assert.ok(a.groups>=15);assert.ok(a.maxRatioError<1e-12);assert.ok(a.maxOverlap<1e-7);assert.ok(a.rootAreaError<1e-6);return a;});
  await check('pause retains every leaf, order, layout and elapsed time; resume changes weights','interaction',async()=>{const before=await page.evaluate(()=>({s:window.__CRY_OFFICIAL__.snapshot(),data:window.__CRY_OFFICIAL__.inspect().charts[0].getData(),a:window.__treeFunctional.area()}));await page.waitForTimeout(650);await frames(3);const held=await page.evaluate(()=>({s:window.__CRY_OFFICIAL__.snapshot(),data:window.__CRY_OFFICIAL__.inspect().charts[0].getData(),a:window.__treeFunctional.area()}));assert.deepEqual(held,before);await resume();await page.waitForFunction(n=>window.__CRY_OFFICIAL__.snapshot().moduleDetails.updateRevision>n,before.s.moduleDetails.updateRevision);await pause();const after=await page.evaluate(()=>({data:window.__CRY_OFFICIAL__.inspect().charts[0].getData(),audit:window.__treeFunctional.audit()}));assert.notDeepEqual(after.data,before.data);assert.equal(after.audit.mismatches,0);return{heldRevision:before.s.moduleDetails.updateRevision,heldElapsed:before.s.elapsed,heldLeaves:leafSpec.length,resumedAudit:after.audit};});
  await check('real heading drilldown persists during updates and keyboard returns to root','interaction',async()=>{const target=await page.evaluate(()=>{const c=window.__CRY_OFFICIAL__.inspect().charts[0],tile=window.__treeFunctional.layouts.find(x=>x.data===c.data[0]),b=c.canvas.getBoundingClientRect();return{name:tile.data.name,x:b.left+tile.rect.left+7,y:b.top+tile.rect.top+5};});await page.mouse.click(target.x,target.y);await frames();const drilled=(await snapshot()).moduleDetails;assert.equal(drilled.path[0],target.name);await resume();await page.waitForFunction(n=>window.__CRY_OFFICIAL__.snapshot().moduleDetails.updateRevision>n,drilled.updateRevision);await pause();assert.deepEqual((await snapshot()).moduleDetails.path,drilled.path);await capture('drilled');await page.locator('#official-stage canvas').press('Escape');await frames();assert.deepEqual((await snapshot()).moduleDetails.path,[]);return{target:target.name,drilledPath:drilled.path,preservedAcrossUpdate:true,returnedByRealKeyboard:true};});
  await check('resize preserves numerical area proportions and native PNG contains tree geometry','display',async()=>{await page.mouse.move(5,5);await page.setViewportSize({width:1210,height:1040});await frames(5);const data=await page.evaluate(async()=>{const c=window.__CRY_OFFICIAL__.inspect().charts[0],p=c.canvas.getContext('2d').getImageData(0,0,c.canvas.width,c.canvas.height).data;let colored=0;for(let i=0;i<p.length;i+=4)if(p[i+3]>100&&Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])>45)colored++;return{area:window.__treeFunctional.area(),colored,pngBytes:(await c.engine.captureFrame()).size,canvas:{width:c.canvas.width,height:c.canvas.height}};});assert.ok(data.area.maxRatioError<1e-12);assert.ok(data.area.rootAreaError<1e-6);assert.ok(data.colored>10000);assert.ok(data.pngBytes>10000);return{...data,screenshot:await capture('resized')};});
  await check('dispose twice and remount leave no canvas or owned update frame','lifecycle',async()=>{const result=await page.evaluate(()=>{const a=window.__CRY_OFFICIAL__,c=a.inspect().charts[0];a.dispose();const once=a.lifecycle();a.dispose();return{once,twice:a.lifecycle(),disposed:c.isDisposed(),canvases:document.querySelectorAll('#official-stage canvas').length};});assert.equal(result.disposed,true);assert.equal(result.canvases,0);assert.equal(result.once.pendingOwnRAF,false);assert.equal(result.once.lastDisposal.ownedAfter,0);assert.deepEqual(result.once.lastDisposal.errors,[]);assert.equal(result.once.disposals,result.twice.disposals);await page.evaluate(id=>window.__CRY_OFFICIAL__.mount(id),id);await pause();const remounted=await snapshot();assert.equal(remounted.referenceId,id);assert.equal(remounted.charts.length,1);assert.equal(remounted.charts[0].disposed,false);await page.evaluate(()=>window.__CRY_OFFICIAL__.dispose());await frames();const last=await page.evaluate(()=>window.__CRY_OFFICIAL__.lifecycle());assert.equal(last.pendingOwnRAF,false);assert.equal(last.chartCount,0);return{...result,remounted:true,last};});
}catch(error){report.errors.push({name:'runner',error:String(error.stack??error)});}
finally{await page.evaluate(()=>window.__CRY_OFFICIAL__?.dispose()).catch(()=>{});report.finishedAt=new Date().toISOString();report.summary={checks:report.checks.length,passed:report.checks.filter(x=>x.status==='passed').length,failed:report.checks.filter(x=>x.status==='failed').length};await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await page.close();await browser.close();console.log(JSON.stringify({directory,summary:report.summary,errors:report.errors.length}));if(report.errors.length)process.exitCode=1;}
