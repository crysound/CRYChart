import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {chromium} from 'playwright';

const root=process.cwd(),sha=value=>createHash('sha256').update(value).digest('hex'),sourceHashes={};
const directory=resolve('codex_artifact/functional-existing-business-data',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(directory,{recursive:true});
await build({entryPoints:['examples/official/main.ts'],bundle:true,format:'esm',target:'es2022',outfile:directory+'/official.js',plugins:[{name:'record-inputs-and-expose-existing-clock',setup(b){b.onLoad({filter:/\.ts$/},async({path})=>{let contents=await readFile(path,'utf8');sourceHashes[relative(root,path).replaceAll('\\','/')]=sha(contents);if(path.replaceAll('\\','/').endsWith('/examples/official/main.ts')){const anchor='  (window as any).__CRY_OFFICIAL__ =';assert.equal(contents.split(anchor).length,2);contents=contents.replace(anchor,'  (window as any).__BUSINESS_DATA_TEST__ = { step: (time: number) => advance?.(time, 0) };\n'+anchor);}return{contents,loader:'ts',resolveDir:dirname(path)};});}}]});
const webPath='/'+relative(root,directory).replaceAll('\\','/'),bundleSHA256=sha(await readFile(directory+'/official.js'));
await writeFile(directory+'/index.html',(await readFile('examples/official/index.html','utf8')).replace('/dist/official.js',webPath+'/official.js'));
const racingBytes=await readFile('examples/data/covid-racing.json'),racing=JSON.parse(racingBytes),provenance=JSON.parse(await readFile('examples/data/covid-racing.provenance.json','utf8'));
assert.equal(sha(racingBytes),provenance.fileSHA256);sourceHashes['examples/data/covid-racing.json']=sha(racingBytes);
const report={startedAt:new Date().toISOString(),directory,bundleSHA256,sourceHashes,runnerSHA256:sha(await readFile(import.meta.filename)),visibleChrome:true,headless:false,checks:[],errors:[],instrumentation:'Exposes only the existing example update callback for exact time inputs while paused. Native data APIs and actual Canvas arc calls are read; no expected values or generated data are injected into production.'};
const selected=['0302-groupedBars','0303-spanChart','0304-mosaicChart','0305-racingBars','0306-stackedBars','0400-spiderStatic','0401-spiderAnimated','0451-donutChart','0452-pieLUT','1600-basicGauge','1602-gaugeDashboard','1712-sunBurstChart'].filter(id=>!process.argv.slice(2).length||process.argv.slice(2).some(prefix=>id.startsWith(prefix)));
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223'),page=await browser.contexts()[0].newPage();await page.setViewportSize({width:1360,height:1180});await page.bringToFront();report.browser=browser.version();let current;
page.on('pageerror',error=>report.errors.push({id:current,error:String(error)}));
const save=()=>writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n'),settle=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
async function check(name,action){try{report.checks.push({id:current,name,status:'passed',evidence:await action()});}catch(error){report.checks.push({id:current,name,status:'failed',error:String(error),stack:error.stack});}await save();}

async function audit(prefix,time,hidden=-1){return page.evaluate(({prefix,time,racing,hidden})=>{
 const api=window.__CRY_OFFICIAL__,charts=api.inspect().charts,chart=charts[0],notes=[];let comparisons=0;
 const eq=(actual,expected,label,tolerance=0)=>{comparisons++;if(Object.is(actual,expected))return;if(Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=tolerance)return;throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}, tolerance ${tolerance}`);};
 const record=(actual,expected,label)=>{for(const[k,v]of Object.entries(expected))eq(actual?.[k],v,label+'.'+k);};
 const list=(actual,expected,label)=>{eq(actual.length,expected.length,label+'.length');expected.forEach((row,i)=>record(actual[i],row,label+'['+i+']'));notes.push({label,rows:expected.length});};
 const actualArcs=()=>{const ctx=chart.canvas.getContext('2d'),original=ctx.arc,arcs=[];ctx.arc=function(...args){arcs.push(args);return original.apply(this,args);};try{chart.render();}finally{ctx.arc=original;}return arcs;};
 if(prefix==='0302'){
  const values=[[48,19,33],[27,40,33],[24,14,62]],countries=['Finland','Germany','UK'],roles=['Engineers','Sales','Marketing'],expected=[];
  values.forEach((row,group)=>row.forEach((value,role)=>{if(role!==hidden)expected.push({category:countries[group],name:roles[role],value,row:group+role/3,barSize:1/3});}));list(chart.getData(),expected,'all grouped bars');
  chart.render();const unit=chart.getBarScreenRect(0).height/expected[0].value;expected.forEach((bar,i)=>eq(chart.getBarScreenRect(i).height,bar.value*unit,'group height '+i,1e-9));
 }else if(prefix==='0303'){
  const rooms=['5 chair room','5 chair room','5 chair room','10 chair room','10 chair room','20 chair room','Conference Hall'];
  const source=[['Certificate exams',0,10,13],['Interview',0,16,18],['Trainee training program',1,8,17],['Department competition training sessions',2,12,20],['Internet security training',3,9,17],['Scrum meeting',4,10,12],['Development meeting',4,15,19],['First Aid training',5,11,16],['Conquering the silence - How to improve your marketing',6,9,18]],expected=source.map(([label,row,start,end])=>({label,row,start,value:end-start,category:rooms[row]}));
  list(chart.getData(),expected,'all reservation start duration and room');chart.render();const unit=chart.getBarScreenRect(0).width/3,origin=chart.getBarScreenRect(0).left-10*unit;
  expected.forEach((bar,i)=>{const box=chart.getBarScreenRect(i);eq(box.width,bar.value*unit,'reservation width',1e-9);eq(box.left,origin+bar.start*unit,'reservation start',1e-9);});eq(chart.numericFormatter(12),'12PM','noon label');
 }else if(prefix==='0304'){
  const groups=[[48,[25,35,40]],[32,[10,45,45]],[20,[20,50,30]]],expected=[];let x=0;for(const [width,parts]of groups){let y=0;for(const height of parts){expected.push({x1:x,y1:y,x2:x+width,y2:y+height});y+=height;}eq(y,100,'column total');x+=width;}
  const figures=chart.series[0].getFigures();list(figures.map(f=>f.getDimensionsTwoPoints()),expected,'all mosaic rectangle bounds');eq(figures.reduce((n,f)=>{const r=f.getDimensionsTwoPoints();return n+(r.x2-r.x1)*(r.y2-r.y1);},0),10000,'total mosaic area');
 }else if(prefix==='0305'){
  const at=(19+time*6)%(racing.days.length-1),day=Math.floor(at),fraction=at-day,a=racing.days[day].values,b=racing.days[day+1].values;
  const rank=values=>values.map((value,id)=>({value,id})).sort((a,b)=>b.value-a.value||a.id-b.id).map(row=>row.id),r1=rank(a),r2=rank(b),ease=3*fraction*fraction-2*fraction*fraction*fraction;
  const expected=a.map((value,i)=>({category:racing.countries[i].name,value:value+(b[i]-value)*fraction,row:r1.indexOf(i)+(r2.indexOf(i)-r1.indexOf(i))*ease})),actual=chart.getData();eq(actual.length,8,'ranking countries');expected.forEach((p,i)=>{eq(actual[i].category,p.category,'ranking name');eq(actual[i].value,p.value,'daily case interpolation');eq(actual[i].row,p.row,'independent smooth ranking',1e-13);});
  eq(chart.interval.start,0,'ranking axis start');eq(chart.interval.end,Math.max(100,...expected.map(p=>p.value*1.06)),'ranking maximum',1e-8);notes.push({time,day,fraction,date:racing.days[day].date,countries:8,datasetRows:racing.days.length});
 }else if(prefix==='0306'){
  const values=[[1,66,1,20,0,0,12],[51,18,7,13,0,0,11],[43,1,20,7,15,8,6],[.5,0,0,2,19,77,1.5],[0,0,0,0,14,82,4],[0,0,0,0,27,72,1]],years=['1999','2004','2009','2014','2019','2021'],expected=[];
  values.forEach((row,i)=>{let start=0;row.forEach((value,j)=>{if(!value||j===hidden)return;expected.push({category:years[i],row:i,start,value});start+=value;});eq(start,100-(hidden<0?0:row[hidden]),'visible stack total');});list(chart.getData(),expected,'all cumulative stack bounds');
 }else if(prefix==='0400'||prefix==='0401'){
  const animated=prefix==='0401',names=animated?['Category A','Category B','Category C','Category D','Category E']:['Pre-planning','Customer contacts','Meetings','Development time','Releases'];
  const expected=animated?[Array.from({length:5},(_,i)=>Math.max(2,Math.min(100,53+37*Math.sin(time*(.65+i*.13)+i*.8)+8*Math.sin(time*1.8+i))))]:[[6,21,60,76,100],[44,8,97,68,70],[94,63,4,67,70]];
  eq(chart.series.length,expected.length,'radar series');expected.forEach((values,i)=>list(chart.series[i].points,values.map((value,j)=>({name:names[j],value})),'all radar values '+i));
  names.forEach((name,i)=>record(chart.getAxisRange(name),{start:0,end:animated?expected[0][i]:[94,63,97,76,100][i]},'radar independent scale '+i));
 }else if(prefix==='0451'||prefix==='0452'){
  const donut=prefix==='0451',names=donut?['US','Canada','Greece','UK','Finland','Denmark']:Array.from({length:10},(_,i)=>'Slice #'+(i+1));
  const values=donut?[15000,20030,8237,16790,9842,4300]:[97,89,10,76,58,21,83,104,60,16].map((value,i)=>Math.floor(time/2.5)===0?value:Math.round(65+52*Math.sin(Math.floor(time/2.5)*.83+i*1.71)));
  list(chart.getSeries().map(s=>({name:s.name,value:s.getValue(),visible:s.getVisible()})),values.map((value,i)=>({name:names[i],value,visible:i!==hidden})),'all native pie values');
  const order=donut?[1,5,4,2,3,0]:values.map((_,i)=>i),shown=order.filter(i=>i!==hidden),total=shown.reduce((n,i)=>n+values[i],0),arcs=actualArcs();eq(arcs.length,shown.length*(donut?2:1),'drawn sector arcs');let angle=-Math.PI/2;
  shown.forEach((index,j)=>{const arc=arcs[j*(donut?2:1)],end=angle+2*Math.PI*values[index]/total;eq(arc[3],angle,'actual arc start',1e-12);eq(arc[4],end,'actual arc end',1e-12);if(donut){const inner=arcs[j*2+1];eq(inner[2],arc[2]*.6,'actual inner radius',1e-10);eq(inner[3],end,'inner start',1e-12);eq(inner[4],angle,'inner end',1e-12);eq(inner[5],true,'inner clockwise reversal');}angle=end;});eq(angle,Math.PI*1.5,'complete angle sum',1e-12);notes.push({total,actualCanvasArcs:arcs.length,hidden});
 }else if(prefix==='1600'){
  const expected=time<.3?0:Math.max(0,Math.min(120,71+29*Math.sin(time*.74)+13*Math.sin(time*1.8)));eq(chart.getValue(),expected,'speed gauge value');record(chart.interval,{start:0,end:120},'gauge interval');notes.push({time,value:expected});
 }else if(prefix==='1602'){
  const count=Math.floor(time*20),retained=Math.min(600,count),begin=Math.max(0,count-600),value=(channel,x)=>Math.max(0,Math.min(100,50+31*Math.sin(x*(.34+channel*.055)+channel*1.9)+14*Math.sin(x*1.47+channel)+4*Math.sin(x*23.1+channel*2.7)));
  eq(charts.length,8,'eight real charts');for(let channel=0;channel<4;channel++){const s=charts[4+channel].series[0];eq(s.getSampleCount(),retained,'retained history');for(let i=0;i<retained;i++){const x=(begin+i)/20;record(s.getSample(i),{x,y:value(channel,x)},'native channel '+channel+' point '+i);}eq(charts[channel].getValue(),value(channel,(count-1)/20),'gauge latest sample');record(charts[4+channel].axisX.getInterval(),{start:(count-1)/20-30,end:(count-1)/20},'synchronized time window');}notes.push({time,count,retained,begin,channels:4});
 }else if(prefix==='1712'){
  const flat={
   'Home & Kitchen/Decor/Wall Art':10,'Home & Kitchen/Decor/Lighting':18,'Home & Kitchen/Kitchen/Appliances':14,'Home & Kitchen/Kitchen/Utensils':10,'Home & Kitchen/Kitchen/Cookware':14,
   'Sports/Team sports':34,'Sports/Hiking':38,'Sports/Fitness':41,
   'Health & Beauty/Healthcare/Supplements':43,'Health & Beauty/Makeup/Lips':20,'Health & Beauty/Makeup/Eyes':25,'Health & Beauty/Makeup/Face':30,'Health & Beauty/Personal care/Oral Care':22,'Health & Beauty/Personal care/Bodycare':31,'Health & Beauty/Personal care/Haircare':42,'Health & Beauty/Personal care/Skincare':55,
   'Clothing/Children/Shoes':16,'Clothing/Children/Clothing':22,'Clothing/Children/Accessories':12,'Clothing/Men/Shoes':19,'Clothing/Men/Bottoms':29,'Clothing/Men/Tops':33,'Clothing/Men/Accessories':18,'Clothing/Women/Dresses':22,'Clothing/Women/Shoes':24,'Clothing/Women/Bottoms':28,'Clothing/Women/Tops':30,
   'Electronics/Laptops/Gaming laptops':31,'Electronics/Laptops/Ultrabooks':24,'Electronics/Laptops/Business laptops':27,'Electronics/Audio & Video/Smart TVs':26,'Electronics/Audio & Video/Speakers':28,'Electronics/Audio & Video/Headphones':44,'Electronics/Mobile devices/Accessories':40,'Electronics/Mobile devices/Smartphones/iOS':28,'Electronics/Mobile devices/Smartphones/Android':52
  },native=chart.getData(),nodes=[],leaves=[];const walk=(values,parent='')=>{for(const node of values){const path=parent?parent+'/'+node.name:node.name;nodes.push({path,depth:path.split('/').length-1});if(node.children?.length)walk(node.children,path);else{eq(node.value,flat[path],'native leaf '+path);leaves.push(path);}}};walk(native);eq(leaves.length,Object.keys(flat).length,'all source leaves');eq(new Set(leaves).size,leaves.length,'unique hierarchy leaf paths');
  const total=Object.values(flat).reduce((a,b)=>a+b,0),arcs=actualArcs();eq(arcs.length,1+nodes.length*2,'actual sunburst arc count');nodes.forEach((node,i)=>{const weight=Object.entries(flat).filter(([path])=>path===node.path||path.startsWith(node.path+'/')).reduce((n,[,value])=>n+value,0),outer=arcs[i*2+1],inner=arcs[i*2+2];eq(outer[4]-outer[3],2*Math.PI*weight/total,'sunburst subtree angular share',1e-12);eq(inner[3],outer[4],'sunburst inner end',1e-12);eq(inner[4],outer[3],'sunburst inner start',1e-12);if(!(outer[2]>inner[2]))throw new Error('Nonpositive ring width');});notes.push({leaves:leaves.length,nodes:nodes.length,total,actualCanvasArcs:arcs.length});
 }else throw new Error('Missing exact-case business oracle');
 return{comparisons,time,notes};
 },{prefix,time,racing:prefix==='0305'?racing:undefined,hidden});}

try{for(const id of selected){current='crychart-example-'+id;const prefix=id.slice(0,4);
 await page.goto('http://127.0.0.1:4180'+webPath+'/index.html#'+current,{waitUntil:'load'});await page.waitForFunction(id=>window.__CRY_OFFICIAL__?.snapshot().referenceId===id,current);if(prefix==='0305')await page.waitForFunction(()=>window.__CRY_OFFICIAL__.snapshot().moduleDetails.status==='ready');await settle();
 if(await page.locator('#official-pause').isEnabled())await page.locator('#official-pause').click();await settle();
 const times=['0305','0401','0452','1600','1602'].includes(prefix)?[.5,3.5,35]:[0];
 await check('complete-native-business-values-and-rendered-geometry',async()=>{const results=[];for(const time of times){await page.evaluate(time=>{for(let i=0;i<5;i++)window.__BUSINESS_DATA_TEST__.step(time);},time);await settle();results.push(await audit(prefix,time));}return results;});
 if(['0302','0306','0451'].includes(prefix))await check('legend-change-recomputes-all-native-values-and-geometry',async()=>{const buttons=prefix==='0451'?page.locator('[data-business-legend] button'):page.locator('.official-legend button');await buttons.first().click();await settle();const result=await audit(prefix,0,0);await buttons.first().click();await settle();await audit(prefix,0);return result;});
 await check('business-data-audit-disposal-and-remount',async()=>{const a=await page.evaluate(()=>window.__CRY_OFFICIAL__.dispose());assert.equal(a.ownedAfter,0);assert.equal(a.contextDisposed,true);await page.evaluate(id=>window.__CRY_OFFICIAL__.mount(id),current);await settle();const b=await page.evaluate(()=>window.__CRY_OFFICIAL__.dispose());assert.equal(b.ownedAfter,0);assert.equal(b.chartsDisposed,true);return{before:a,after:b};});
 console.log(JSON.stringify({id:current,checks:report.checks.filter(c=>c.id===current).map(c=>({name:c.name,status:c.status,error:c.error}))}));
}}catch(error){report.errors.push({id:current,error:String(error),stack:error.stack});}
finally{await page.close();await browser.close();report.finishedAt=new Date().toISOString();report.summary={checks:report.checks.length,passed:report.checks.filter(c=>c.status==='passed').length,failed:report.checks.filter(c=>c.status==='failed').length,errors:report.errors.length};await save();console.log(JSON.stringify({directory,bundleSHA256,summary:report.summary}));if(report.summary.failed||report.summary.errors)process.exitCode=1;}
