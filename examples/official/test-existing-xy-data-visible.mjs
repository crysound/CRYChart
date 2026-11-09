import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {chromium} from 'playwright';

const root=process.cwd(), sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const directory=resolve('codex_artifact/functional-existing-xy-data',new Date().toISOString().replace(/[:.]/g,'-'));
const sourceHashes={}; await mkdir(directory,{recursive:true});
await build({entryPoints:['examples/official/main.ts'],bundle:true,format:'esm',target:'es2022',outfile:directory+'/official.js',plugins:[{name:'record-build-inputs',setup(b){b.onLoad({filter:/\.ts$/},async({path})=>{const contents=await readFile(path,'utf8');sourceHashes[relative(root,path).replaceAll('\\','/')]=sha(contents);return {contents,loader:'ts',resolveDir:dirname(path)};});}}]});
const webPath='/'+relative(root,directory).replaceAll('\\','/'),bundleSHA256=sha(await readFile(directory+'/official.js'));
await writeFile(directory+'/index.html',(await readFile('examples/official/index.html','utf8')).replace('/dist/official.js',webPath+'/official.js'));
assert.equal(sha(Buffer.from(await fetch('http://127.0.0.1:4180'+webPath+'/official.js').then(r=>r.arrayBuffer()))),bundleSHA256);
const report={startedAt:new Date().toISOString(),directory,bundleSHA256,sourceHashes,runnerSHA256:sha(await readFile(import.meta.filename)),visibleChrome:true,headless:false,checks:[],errors:[],scope:'Supplementary data and derived geometry oracles. Existing visible interaction checks remain separate. Expected values are calculated in this browser independently of the production signal helpers.'};
const selected=['0006-pointClusters','0010-multiChannelLineProgressive','0015-confidenceEllipseXY','0018-refreshingLineSpectrum','0020-dateTimeAxis','0034-dashedProjection','0035-dashedSupplementaryTrends','0051-linePaletteY','0053-dataGaps','0550-zoomBandChart','0706-onScreenMenu'].filter(id=>!process.argv.slice(2).length||process.argv.slice(2).some(prefix=>id.startsWith(prefix)));
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223'),page=await browser.contexts()[0].newPage();
await page.setViewportSize({width:1360,height:1180});await page.bringToFront();report.browser=browser.version();let current;
page.on('pageerror',error=>report.errors.push({id:current,error:String(error)}));
const save=()=>writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');
const settle=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
async function check(name,fn){try{report.checks.push({id:current,name,status:'passed',evidence:await fn()});}catch(error){report.checks.push({id:current,name,status:'failed',error:String(error),stack:error.stack});}await save();}

try{for(const id of selected){
 current='crychart-example-'+id;
 await page.goto('http://127.0.0.1:4180'+webPath+'/index.html#'+current,{waitUntil:'load'});
 await page.waitForFunction(id=>window.__CRY_OFFICIAL__?.snapshot().referenceId===id,current);await settle();
 if(await page.locator('#official-pause').isEnabled())await page.locator('#official-pause').click();await settle();
 await check('full-native-source-and-derived-geometry-audit',async()=>page.evaluate(prefix=>{
  const api=window.__CRY_OFFICIAL__,state=api.snapshot(),{charts,traces}=api.inspect();
  let comparisons=0;const sections=[];
  const eq=(actual,expected,label,tolerance=0)=>{comparisons++;if(Object.is(actual,expected))return;if(Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=tolerance)return;throw new Error(`${label}: actual ${actual}, expected ${expected}, tolerance ${tolerance}`);};
  const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const audit=(series,points,label)=>{eq(series.getSampleCount(),points.length,label+'.count');for(let i=0;i<points.length;i++){const actual=series.getSample(i);for(const key of Object.keys(points[i]))eq(actual?.[key],points[i][key],`${label}[${i}].${key}`);}sections.push({label,points:points.length});};
  const day=86400000;
  if(prefix==='0006'){
   const random=rng(10006),specs=[[220,24,0,2600,5900],[230,23,6,2150,3900]];
   specs.forEach(([count,width,offset,low,high],group)=>{
    const expected=Array.from({length:count},()=>{const d=Math.floor(random()*(width+1)),range=(high-low)*Math.min(1,d/7+.45);return{x:Date.UTC(2022,2,1)+(offset+d)*day,y:low+random()*range};}).sort((a,b)=>a.x-b.x);
    const series=charts[0].series[group*2];eq(series.getSampleCount(),count,'cluster count');
    for(let i=0;i<count;i++){const actual=series.getSample(i);eq(actual.x,expected[i].x,'cluster x');eq(actual.y,expected[i].y,'cluster y');}
    const rectangle=charts[0].series[group*2+1].getFigures();eq(rectangle.length,1,'cluster rectangle count');const d=rectangle[0].getDimensionsTwoPoints();
    eq(d.x1,Math.min(...expected.map(p=>p.x)),'rectangle min x');eq(d.x2,Math.max(...expected.map(p=>p.x)),'rectangle max x');
    eq(d.y1,Math.min(...expected.map(p=>p.y)),'rectangle min y',2e-12);eq(d.y2,Math.max(...expected.map(p=>p.y)),'rectangle max y',2e-12);
    sections.push({label:'cluster '+group,points:count,bounds:d});
   });
  }else if(prefix==='0010'){
   const frequencies=[2.8,3.7,5.2,1.9,.11,.16,.7,1.2,2.1,2.6],count=state.moduleDetails.sampleIndex;
   if(count<1)throw new Error('No streaming samples produced');eq(traces.length,10,'channel count');
   traces.forEach((trace,channel)=>audit(trace.series,Array.from({length:count},(_,x)=>{const t=x/1000;return{x,y:10-channel+.38*Math.sin(2*Math.PI*frequencies[channel]*t+channel*.4)+.05*Math.sin(2*Math.PI*frequencies[channel]*2.8*t)};}),'channel '+channel));
  }else if(prefix==='0015'){
   const random=rng(10015),expected=Array.from({length:10000},()=>{const radius=Math.sqrt(-2*Math.log(Math.max(1e-12,random()))),theta=2*Math.PI*random(),a=radius*Math.cos(theta),b=radius*Math.sin(theta);return{x:.83*a+.22*b,y:.36*a+.40*b};});
   audit(charts[0].series[1],expected,'Gaussian samples');
   const mean=expected.reduce((s,p)=>({x:s.x+p.x/10000,y:s.y+p.y/10000}),{x:0,y:0});
   let xx=0,yy=0,xy=0;for(const p of expected){const x=p.x-mean.x,y=p.y-mean.y;xx+=x*x/9999;yy+=y*y/9999;xy+=x*y/9999;}
   const shape=charts[0].series[0].figures[0].getDimensions(),det=xx*yy-xy*xy,target=-2*Math.log(.05);eq(shape.length,193,'ellipse vertices');let maxResidual=0;
   for(const p of shape){const x=p.x-mean.x,y=p.y-mean.y,q=(yy*x*x-2*xy*x*y+xx*y*y)/det;eq(q,target,'Mahalanobis radius',1e-10);maxResidual=Math.max(maxResidual,Math.abs(q-target));}
   eq(shape[0].x,shape.at(-1).x,'closed ellipse x',1e-12);eq(shape[0].y,shape.at(-1).y,'closed ellipse y',1e-12);
   sections.push({label:'independent covariance quadratic form',vertices:shape.length,maxResidual,probability:.95});
  }else if(prefix==='0018'){
   const random=rng(10018),updates=state.moduleDetails.updates,time=state.elapsed;for(let i=0;i<(updates-1)*1024;i++)random();
   const centers=[160+Math.sin(time*.4)*9,650+Math.sin(time*.55)*12],lobe=(x,c,w)=>Math.abs((x-c)/w)<=1?Math.cos((x-c)/w*Math.PI/2):0;
   audit(charts[0].series[0],Array.from({length:1024},(_,x)=>({x,y:.1+Math.max(.65*lobe(x,centers[0],240),.49*lobe(x,centers[1],135))*(.9+random()*.2)})),'full replaced spectrum');
   sections.push({updates,time});
  }else if(prefix==='0020'){
   const random=rng(2000),expected=Array.from({length:121},(_,i)=>({x:Date.UTC(2008,i,1),y:i<12?i*70/12:62+4*Math.sin(i/4.5)+2*Math.cos(i/2)+(random()-.5)*3}));
   for(const [i,series]of charts[0].series.entries())audit(series,expected,i?'monthly markers':'monthly line');eq(charts[0].series.length,2,'two actual series');
  }else if(prefix==='0034'){
   const random=rng(3400),anchors=[[0,600000],[270,485000],[430,620000],[520,630000],[669,730000],[770,770000],[860,715000],[1009,845000]],all=[];let noise=0;
   for(let i=0;i<1010;i++){let interval=0;while(interval<anchors.length-2&&i>anchors[interval+1][0])interval++;const [xa,ya]=anchors[interval],[xb,yb]=anchors[interval+1];noise=noise*.82+(random()-.5)*18000;all.push({x:Date.UTC(2020,11,1)+i*day,y:ya+(yb-ya)*Math.max(0,Math.min(1,(i-xa)/(xb-xa)))+noise+Math.sin(i*.13)*18000*.55});}
   audit(charts[0].series[1],all.slice(0,670),'complete history');audit(charts[0].series[2],all.slice(669),'complete forecast');
   const range=charts[0].series[0];eq(range.rows.length,341,'range count');for(let i=0;i<341;i++){const p=all[669+i],width=i?4000+i/340*102000:0;for(const [key,value]of [p.x,p.y-width,p.y+width].entries())eq(range.rows.values[i*3+key],value,`range ${i}/${key}`);}sections.push({label:'all forecast lower/upper bounds',rows:341});
  }else if(prefix==='0035'){
   const lists=[[80,102,96,99,69.5,73,94,72.5,88.5],[36.5,40.3,44.7,41.3,50.2,51.8,55,56.3,63]];
   lists.forEach((values,k)=>{const expected=values.map((v,i)=>({x:Date.UTC(2022,5+i,1),y:v*1000})),spline=charts[0].series[k*2];audit(spline,expected,'spline original '+k);audit(charts[0].series[k*2+1],expected,'monthly markers '+k);
    const packet=spline.drawPacket(),nodes=spline.drawPacket('points').positions;eq(packet.count,129,'spline path vertices');
    for(let segment=0;segment<8;segment++)for(let j=0;j<=16;j++)for(let d=0;d<2;d++){
     const a=nodes[segment*2+d],b=nodes[(segment+1)*2+d],left=segment?nodes[(segment-1)*2+d]:2*a-b,right=segment===7?2*b-a:nodes[(segment+2)*2+d],t=j/16;
     const c0=a,c1=(b-left)/2,c2=left-2.5*a+2*b-.5*right,c3=(right-left)/2+1.5*(a-b),value=Math.fround(((c3*t+c2)*t+c1)*t+c0),actual=packet.positions[(segment*16+j)*2+d];
     eq(actual,value,'independent cubic path',Math.max(Math.abs(value)*2**-22,1e-4));
    }sections.push({label:'cubic path '+k,vertices:packet.count,tolerance:'two Float32 ULP for algebraic regrouping'});
   });
  }else if(prefix==='0051'){
   const random=rng(5100);let noise=0;const expected=Array.from({length:10001},(_,x)=>{noise=noise*.92+(random()-.5)*1900;return{x,y:-15000+27000*Math.cos(x/1250)-11500*Math.exp(-(((x-3500)/1050)**2))+6500*Math.sin(x/220)+noise};});
   audit(charts[0].series[0],expected,'all palette input samples');
  }else if(prefix==='0053'){
   const random=rng(5300),prices=[],volumes=[];let value=174;
   for(let d=0;d<41;d++){const date=Date.UTC(2018,9,18)+d*day;if([0,6].includes(new Date(date).getUTCDay()))continue;for(let h=0;h<17;h++){value+=(random()-.5)*.7+(174-value)*.012;const x=date+9*3600000+h*1800000;prices.push({x,y:value});volumes.push({x,y:300000+Math.pow(random(),4)*8500000});}}
   const gaps=input=>{const result=[];for(let i=0;i<input.length;i++){if(i&&input[i].x-input[i-1].x>3600000)result.push({x:(input[i-1].x+input[i].x)/2,y:NaN});result.push(input[i]);}return result;};
   const p=gaps(prices),v=gaps(volumes),low=Math.min(...prices.map(p=>p.y)),high=Math.max(...prices.map(p=>p.y));
   audit(charts[0].series[0],p,'price with NaN gaps');audit(charts[1].series[0],v,'volume with NaN gaps');
   audit(charts[2].series[0],p.map(p=>({x:p.x,y:(p.y-low)/(high-low)})),'normalized overview price');audit(charts[2].series[1],v.map(p=>({x:p.x,y:p.y/10000000})),'normalized overview volume');
   sections.push({records:prices.length,NaNGaps:p.filter(p=>Number.isNaN(p.y)).length});
  }else if(prefix==='0550'){
   const random=rng(5550),rows=[7,1,-8].map(offset=>{let value=offset;return Array.from({length:1000},(_,i)=>{value+=(random()-.5)*1.3+(offset-value)*.008;return{x:Date.UTC(2001,0,1)+i*day,y:value};});});
   rows.push(Array.from({length:1000},(_,i)=>({x:Date.UTC(2001,0,1)+i*day,y:7+4*Math.sin(i/25)+(random()-.5)*9})));
   charts.forEach((chart,c)=>{eq(chart.series.length,4,'series per panel');rows.forEach((points,s)=>audit(chart.series[s],points,`panel ${c} series ${s}`));});
   const interval=charts[0].axisX.getInterval(),visible=rows.flat().filter(p=>p.x>=interval.start&&p.x<=interval.end).map(p=>p.y),actual=charts[0].axisY.getInterval();eq(actual.start,Math.min(...visible)-1,'visible Y min');eq(actual.end,Math.max(...visible)+1,'visible Y max');
  }else if(prefix==='0706'){
   const random=rng(7600),a=[],b=[];let value=20;for(let x=0;x<=250;x++){value+=(random()-.45)*2.2;a.push({x,y:value});b.push({x,y:22+Math.sin(x*.29)*8+(random()-.5)*5});}
   const count=state.moduleDetails.secondarySamples,crossings=[];
   for(let i=1;i<count;i++){const left=a[i-1].y-b[i-1].y,right=a[i].y-b[i].y;if(Math.sign(left)!==Math.sign(right)){const weight=left/(left-right);crossings.push({x:i-1+weight,y:a[i-1].y+(a[i].y-a[i-1].y)*weight});}}
   charts.forEach((chart,p)=>{audit(chart.series[0],a,'primary '+p);audit(chart.series[1],b.slice(0,count),'submitted secondary '+p);audit(chart.series[2],crossings,'intersection markers '+p);});
   const generic=api.auditData({traceIndex:1});eq(generic.expectedCount,count,'generic submitted count');eq(generic.actualCount,count,'generic actual count');eq(generic.mismatchCount,0,'generic prefix mismatches');eq(generic.countMatches,true,'generic prefix lengths');if(!(count<251))throw new Error('Prefix scenario reached full array unexpectedly');sections.push({sourceArrayLength:251,submitted:count,generic});
  }else throw new Error('Missing exact-case data oracle');
  return {comparisons,sections,allNativeValuesChecked:true,independentHelperImports:false};
 },id.slice(0,4)));
 if(['0006','0015','0034','0051'].includes(id.slice(0,4)))await check('real-pointer-values-wheel-and-reset',async()=>{
  const target=await page.evaluate(()=>{const {charts,traces}=window.__CRY_OFFICIAL__.inspect(),c=charts[0],p=c.plot,b=c.overlay.getBoundingClientRect();
   c.overlay.addEventListener('pointermove',e=>window.__xyActualPointer={x:e.clientX-b.left,y:e.clientY-b.top},{capture:true});
   const source=traces[0].points.find(v=>{const x=c.axisX.valueToFraction(v.x),y=c.axisY.valueToFraction(v.y);return x>.2&&x<.8&&y>.2&&y<.8;});if(!source)throw new Error('No visible interior source point');
   return {x:b.left+p.left+c.axisX.valueToFraction(source.x)*p.width,y:b.top+p.top+(1-c.axisY.valueToFraction(source.y))*p.height,initial:c.axisX.getInterval(),samples:traces.map(t=>t.series.getSampleCount())};
  });
  await page.mouse.move(target.x,target.y);await settle();
  const hover=await page.evaluate(prefix=>{const {charts,traces}=window.__CRY_OFFICIAL__.inspect(),c=charts[0],p=c.plot,pointer=window.__xyActualPointer,rows=[...c.root.querySelectorAll('.shared-cursor-table:not([hidden]) .cursor-row')].map(row=>({name:row.querySelector('span').textContent,value:row.querySelector('strong').textContent}));let expected=[];
   if(['0006','0015'].includes(prefix)){let closest,distance=Infinity;for(const trace of traces)for(const point of trace.points){const x=p.left+trace.series.getAxisX().valueToFraction(point.x)*p.width,y=p.top+(1-trace.series.getAxisY().valueToFraction(point.y))*p.height,d=Math.hypot(pointer.x-x,pointer.y-y);if(d<distance){distance=d;closest={trace,point};}}if(distance>22)throw new Error('Pointer missed all samples');expected=[{name:closest.trace.name,value:closest.point.y.toFixed(2)+(closest.trace.unit?' '+closest.trace.unit:'')}];
   }else{const x=c.axisX.fractionToValue((pointer.x-p.left)/p.width);for(const trace of traces){if(x<trace.points[0].x||x>trace.points.at(-1).x)continue;let closest=trace.points[0];for(const point of trace.points)if(Math.abs(point.x-x)<Math.abs(closest.x-x))closest=point;expected.push({name:trace.name,value:closest.y.toFixed(trace.unit?2:1)+(trace.unit?' '+trace.unit:'')});}}
   return{pointer,actual:rows,expected};
  },id.slice(0,4));assert(hover.expected.length>0);assert.deepEqual(hover.actual,hover.expected);
  await page.mouse.wheel(0,-240);await settle();const zoomed=await page.evaluate(()=>window.__CRY_OFFICIAL__.inspect().charts[0].axisX.getInterval());assert(zoomed.end-zoomed.start<(target.initial.end-target.initial.start)*.9);
  await page.mouse.move(2,2);await settle();assert.equal(await page.locator('#official-stage .shared-cursor-table:not([hidden])').count(),0);
  await page.locator('#official-reset').click();await settle();const reset=await page.evaluate(()=>{const {charts,traces}=window.__CRY_OFFICIAL__.inspect();return{x:charts[0].axisX.getInterval(),samples:traces.map(t=>t.series.getSampleCount())};});assert.deepEqual(reset.x,target.initial);assert.deepEqual(reset.samples,target.samples);
  return {hover,initial:target.initial,zoomed,reset,leaveHidden:true};
 });
 await check('dispose-and-rebuild-after-native-data-audit',async()=>{const before=await page.evaluate(()=>window.__CRY_OFFICIAL__.dispose());assert.equal(before.ownedAfter,0);assert.equal(before.chartsDisposed,true);await page.evaluate(id=>window.__CRY_OFFICIAL__.mount(id),current);await settle();const after=await page.evaluate(()=>window.__CRY_OFFICIAL__.dispose());assert.equal(after.ownedAfter,0);assert.equal(after.contextDisposed,true);return {before,after};});
 console.log(JSON.stringify({id:current,checks:report.checks.filter(c=>c.id===current).map(c=>({name:c.name,status:c.status,error:c.error}))}));
}}catch(error){report.errors.push({id:current,error:String(error),stack:error.stack});}
finally{await page.close();await browser.close();report.finishedAt=new Date().toISOString();report.summary={checks:report.checks.length,passed:report.checks.filter(c=>c.status==='passed').length,failed:report.checks.filter(c=>c.status==='failed').length,errors:report.errors.length};await save();console.log(JSON.stringify({directory,bundleSHA256,summary:report.summary}));if(report.summary.failed||report.summary.errors)process.exitCode=1;}
