import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Data-only companion to the existing interaction runners. Expected values do
// not import example generators, FFT, histogram, map or interpolation helpers.
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const ids=(args.get('--cases')??'0702,0800,0802,0803,0806,0807,1003,1100,1101,1102,1103,1111,1714,0600,0601,1402').split(',');
const base=args.get('--base')??(process.env.CRYCHART_BASE_URL ?? 'http://127.0.0.1:4180'),sha=b=>createHash('sha256').update(b).digest('hex');
const directory=(process.env.CRYCHART_SPECIALIZED_OUT ? resolve(process.env.CRYCHART_SPECIALIZED_OUT) : resolve(args.get('--prepared')??`codex_artifact/functional-priority/existing-heat-map-stat-data/${new Date().toISOString().replace(/[:.]/g,'-')}`));
await mkdir(directory,{recursive:true});
const assetFiles=['world-countries.json','world-bank-population.json','covid-history.json','nordic-bidding-zones.json','crychart-stereo.wav'];

// Independent decimation-in-frequency FFT. The production STFT uses a
// decimation-in-time transform. Verify this transform against a direct DFT
// before using it as a complete WAV -> matrix oracle.
function fftDIF(input){
 const n=input.length,re=Float64Array.from(input),im=new Float64Array(n);
 for(let size=n;size>=2;size/=2){const half=size/2;for(let start=0;start<n;start+=size)for(let j=0;j<half;j++){
  const a=start+j,b=a+half,dr=re[a]-re[b],di=im[a]-im[b],angle=-2*Math.PI*j/size,c=Math.cos(angle),s=Math.sin(angle);
  re[a]+=re[b];im[a]+=im[b];re[b]=dr*c-di*s;im[b]=dr*s+di*c;
 }}
 const real=new Float64Array(n),imag=new Float64Array(n),bits=Math.log2(n);for(let i=0;i<n;i++){let reversed=0,v=i;for(let b=0;b<bits;b++){reversed=reversed*2+(v&1);v>>=1;}real[i]=re[reversed];imag[i]=im[reversed];}return{real,imag};
}
function fftOracleSelfTest(){let maximumError=0,comparisons=0;for(const n of[8,16,32])for(const mode of[0,1,2]){
 const input=Float64Array.from({length:n},(_,i)=>mode===0?Number(i===2):mode===1?Math.sin(2*Math.PI*3*i/n):Math.cos(i*.73)+i/17),actual=fftDIF(input);
 for(let k=0;k<n;k++){let real=0,imag=0;for(let i=0;i<n;i++){real+=input[i]*Math.cos(-2*Math.PI*i*k/n);imag+=input[i]*Math.sin(-2*Math.PI*i*k/n);}maximumError=Math.max(maximumError,Math.abs(real-actual.real[k]),Math.abs(imag-actual.imag[k]));comparisons+=2;}
 }assert(maximumError<1e-11);return{comparisons,maximumError,limit:1e-11,method:'Direct O(N^2) complex DFT on impulse, sine and a nonperiodic mixed signal; no production helper.'};}
async function makeAudioOracle(){
 const bytes=await readFile('examples/data/crychart-stereo.wav');assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');let format,offset,length;
 for(let p=12;p+8<=bytes.length;){const type=bytes.toString('ascii',p,p+4),n=bytes.readUInt32LE(p+4);if(type==='fmt ')format={encoding:bytes.readUInt16LE(p+8),channels:bytes.readUInt16LE(p+10),sampleRate:bytes.readUInt32LE(p+12),blockAlign:bytes.readUInt16LE(p+20),bits:bytes.readUInt16LE(p+22)};if(type==='data'){offset=p+8;length=n;}p+=8+n+(n&1);}
 assert.deepEqual(format,{encoding:1,channels:2,sampleRate:24000,blockAlign:4,bits:16});assert.equal(length%4,0);const frames=length/4,N=1024,hop=256,columns=1+Math.floor((frames-N)/hop),rows=N/2+1,normalization=args.get('--audio-normalization')??'pcm-power-of-two';assert(['pcm-power-of-two','browser-signed-f32'].includes(normalization));
 const window=Float64Array.from({length:N},(_,i)=>(1-Math.cos(2*Math.PI*i/(N-1)))/2),gain=window.reduce((a,b)=>a+b,0)/N,files=[];
 for(let channel=0;channel<2;channel++){
  const values=new Float32Array(columns*rows),weighted=new Float64Array(N);
  for(let column=0;column<columns;column++){for(let i=0;i<N;i++){const pcm=bytes.readInt16LE(offset+((column*hop+i)*2+channel)*2),sample=normalization==='browser-signed-f32'?Math.fround(pcm*Math.fround(pcm<0?1/32768:1/32767)):pcm/32768;weighted[i]=sample*window[i];}const {real,imag}=fftDIF(weighted);
   for(let row=0;row<rows;row++){const amplitude=Math.hypot(real[row],imag[row])/N*(row===0||row===N/2?1:2);values[row*columns+column]=Math.max(-100,20*Math.log10(Math.max(Number.MIN_VALUE,amplitude/gain)));}
  }
  const file=`audio-channel-${channel}.f32`,data=Buffer.from(values.buffer);await writeFile(resolve(directory,file),data);files.push({file,sha256:sha(data),bytes:data.length});
 }
 return{source:'examples/data/crychart-stereo.wav',sourceSHA256:sha(bytes),format,dataOffset:offset,normalization,frames,N,hop,columns,rows,files,maximumAbsoluteDBError:1e-4,reason:'Fixed before browser execution. Independent DIF versus production DIT FFT accumulation may differ in double precision before Float32 dB storage; every cell must satisfy the absolute bound, not merely an aggregate.',normalizationEvidence:normalization==='browser-signed-f32'?'codex_artifact/functional-priority/existing-heat-map-stat-data/audio-decode-2026-11-03T11-32-11-229Z/normalization-review.json':undefined};
}

let prepare;
if(args.has('--prepared'))prepare=JSON.parse(await readFile(resolve(directory,'prepare.json'),'utf8'));
else{
 const assets=Object.fromEntries(await Promise.all(assetFiles.map(async file=>{const bytes=await readFile(resolve('examples/data',file));return[file,{path:`examples/data/${file}`,sha256:sha(bytes),bytes:bytes.length}];})));
 const imports=[['interactionEntries','interactions'],['heatmapEntries','heatmaps'],['spectrogramEntries','spectrograms'],['interpolationEntries','interpolation'],['polarHeatmapEntries','polar-heatmaps'],['mapEntries','maps'],['statisticsEntries','statistics']];
 const fixture=`import {cryChart,Themes} from ${JSON.stringify(resolve('src/index.ts').replaceAll('\\','/'))};\n${imports.map(([name,file])=>`import {${name}} from ${JSON.stringify(resolve(`examples/official/${file}.ts`).replaceAll('\\','/'))};`).join('\n')}
 const entries=[${imports.map(([name])=>'...'+name).join(',')}],host=document.querySelector('#stage') as HTMLElement;let mounted:any,engine:any,time=0,decodedAudio:any;
 ${args.get('--audio-normalization')==='browser-signed-f32'?`const originalDecode=OfflineAudioContext.prototype.decodeAudioData;OfflineAudioContext.prototype.decodeAudioData=function(buffer:ArrayBuffer){return originalDecode.call(this,buffer).then(audio=>{decodedAudio={sampleRate:audio.sampleRate,length:audio.length,channels:Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i).slice())};return audio;});};`:''}
 const render=()=>mounted?.charts.forEach((chart:any)=>chart.renderNow?.());
 function dispose(){if(!mounted)return;mounted.dispose?.();engine.dispose();const result={engineCharts:engine.getChartCount(),canvases:host.querySelectorAll('canvas').length};mounted=undefined;host.replaceChildren();return result;}
 (window as any).__DATA={mount(id:string){dispose();time=0;decodedAudio=undefined;engine=cryChart();mounted=entries.find(e=>e.id.includes('-'+id+'-'))!.mount!({host,engine,theme:Themes.darkGold});render();},get charts(){return mounted?.charts??[];},get decodedAudio(){return decodedAudio;},snapshot(){return mounted?.snapshot?.();},advance(next:number,draw=true){const delta=next-time;time=next;mounted.update?.(next,delta);if(draw)render();},render,dispose};`;
 await writeFile(resolve(directory,'fixture.ts'),fixture);const inputs={};
 await build({entryPoints:[resolve(directory,'fixture.ts')],outfile:resolve(directory,'fixture.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[{name:'capture-actual-build-inputs',setup(builder){builder.onLoad({filter:/\.(ts|js|json)$/},async({path})=>{const bytes=await readFile(path);inputs[relative(process.cwd(),path).replaceAll('\\','/')]={sha256:sha(bytes),bytes:bytes.length};return{contents:bytes.toString('utf8'),loader:path.endsWith('.ts')?'ts':path.endsWith('.json')?'json':'js'};});}}]});
 await writeFile(resolve(directory,'build-inputs.json'),JSON.stringify({method:'SHA256 of exact esbuild onLoad contents, including actual core/example and raw JSON inputs',inputs},null,2)+'\n');
 const url='/'+relative(process.cwd(),directory).replaceAll('\\','/'),css=(await readFile('examples/official/index.html','utf8')).match(/<style>([\s\S]*?)<\/style>/)[1];
 await writeFile(resolve(directory,'index.html'),`<!doctype html><meta charset="utf-8"><title>Complete native data oracles</title><style>${css}body{padding:20px}#stage{position:relative;display:flex;flex-direction:column;width:1100px;height:800px;margin:auto;overflow:hidden;background:#101112}</style><h1>Native data verification</h1><div id="stage"></div><script type="module" src="${url}/fixture.js"></script>`);
 prepare={createdAt:new Date().toISOString(),cases:ids,url,bundleSHA256:sha(await readFile(resolve(directory,'fixture.js'))),runnerSHA256:sha(await readFile(new URL(import.meta.url))),buildInputsManifest:{path:'build-inputs.json',sha256:sha(await readFile(resolve(directory,'build-inputs.json'))),files:Object.keys(inputs).length},assets,fftSelfTest:fftOracleSelfTest(),audio:ids.includes('0802')?await makeAudioOracle():undefined};
 await writeFile(resolve(directory,'prepare.json'),JSON.stringify(prepare,null,2)+'\n');
}
if(args.get('--prepare-only')==='true'){console.log(JSON.stringify({directory,status:'prepared',bundleSHA256:prepare.bundleSHA256,fftSelfTest:prepare.fftSelfTest}));process.exit(0);}

// This function is sent verbatim into the visible browser. It reads native
// series, never the example's snapshot as expected numeric data.
async function auditNative({id,phase,audio,url}){
 const api=window.__DATA,charts=api.charts,all=charts.flatMap(c=>c.getSeries()),snapshot=api.snapshot();let comparisons=0,mismatches=0,maxDifference=0;const firstErrors=[],groups=[];
 const compare=(actual,expected,label,tolerance=0)=>{comparisons++;let same=Object.is(actual,expected)||actual===expected||(Number.isNaN(actual)&&Number.isNaN(expected));if(typeof actual==='number'&&typeof expected==='number'&&Number.isFinite(actual)&&Number.isFinite(expected)){const d=Math.abs(actual-expected);maxDifference=Math.max(maxDifference,d);same=d<=tolerance;}if(!same){mismatches++;if(firstErrors.length<8)firstErrors.push({label,actual,expected,tolerance});}};
 const group=(name,count)=>groups.push({name,count});
 const hash=async values=>{const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');};
 const cells=async(actual,expected,name,tolerance=0)=>{compare(actual.length,expected.length,`${name}.length`);for(let i=0;i<expected.length;i++)compare(actual[i],expected[i],`${name}[${i}]`,tolerance);group(name,expected.length);return{nativeSHA256:await hash(actual),expectedSHA256:await hash(expected)};};
 const lines=(series,expected,name,tolerance=0)=>{compare(series.getSampleCount(),expected.length,`${name}.count`);for(let i=0;i<expected.length;i++){const actual=series.getSample(i);for(const key of Object.keys(expected[i]))compare(actual?.[key],expected[i][key],`${name}[${i}].${key}`,tolerance);}group(name,expected.length);};
 const matrix=(series,expected,name,tolerance=0)=>{compare(series.getSampleCount(),expected.length,`${name}.count`);compare(series.rows.length,expected.length,`${name}.rows`);for(let i=0;i<expected.length;i++){compare(series.rows.flags[i],1,`${name}[${i}].active`);for(let k=0;k<expected[i].length;k++)compare(series.rows.values[i*series.rows.stride+k],expected[i][k],`${name}[${i},${k}]`,tolerance);}group(name,expected.length);};
 const lcg=seed=>{let state=seed>>>0;return()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};};
 let hashes=[];
 if(id==='0702'){
  const end=phase==='initial'?0:62000,first=Math.max(-1000,end-60000);compare(all.length,3,'channel count');
  for(let channel=0;channel<3;channel++){const expected=[];for(let sample=first;sample<end;sample++)expected.push({x:sample,y:2-channel+(.5+.28*Math.sin(sample*.008*(channel+1)+channel)+.12*Math.sin(sample*.019+channel*.7))});lines(all[channel],expected,`channel${channel}`);}
 }
 if(id==='0800'){
  const heat=all.find(s=>s.data instanceof Float32Array),expected=new Float32Array(1000000);for(let y=0;y<1000;y++)for(let x=0;x<1000;x++){const r=Math.hypot(x-500,y-500),a=Math.atan2(y-500,x-500);expected[y*1000+x]=Math.max(0,Math.min(100,48+29*Math.cos(r/57+.19*Math.sin(a*3))*Math.exp(-r/1600)+21*Math.exp(-((x-290)**2+(y-720)**2)/8500)-21*Math.exp(-((x-180)**2+(y-550)**2)/7000)));}
  hashes.push(await cells(heat.data,expected,'all temperature cells'));
  // Independent edge census: each cell contributes each crossed edge once.
  // Check the complete native endpoint multiset without importing the
  // production marching-squares topology routine or its lookup decisions.
  for(const level of[25,50,75]){const wanted=new Map(),key=(x,y)=>`${x.toFixed(8)},${y.toFixed(8)}`;let endpoints=0;
   for(let y=0;y<999;y+=4)for(let x=0;x<999;x+=4){const right=Math.min(x+4,999),top=Math.min(y+4,999),edges=[[x,y,right,y],[right,y,right,top],[right,top,x,top],[x,top,x,y]];
    for(const [ax,ay,bx,by]of edges){const a=expected[ay*1000+ax],b=expected[by*1000+bx];if((a<level)===(b<level))continue;const t=(level-a)/(b-a),k=key(ax+t*(bx-ax),ay+t*(by-ay));wanted.set(k,(wanted.get(k)??0)+1);endpoints++;}}
   const series=all.find(s=>s.getName?.()===`${level.toFixed(1)} °C contour`);compare(series?.getSampleCount(),endpoints/2*3,`contour${level}.count`);
   if(series)for(let i=0;i<series.getSampleCount();i++){const p=series.getSample(i);if(i%3===2){compare(Number.isNaN(p.x)&&Number.isNaN(p.y),true,`contour gap${i}`);continue;}const k=key(p.x,p.y),n=wanted.get(k)??0;compare(n>0,true,`contour endpoint${i}`);wanted.set(k,n-1);}for(const [k,n]of wanted)compare(n,0,`edge census${k}`);group(`contour${level} endpoints`,endpoints);
  }
 }
 if(id==='0802'){
  compare(snapshot.status,'ready','audio decoded');compare(snapshot.decodedChannels,2,'decoded channels');compare(snapshot.decodedSamples,audio.frames,'decoded sample frames');
  if(audio.normalization==='browser-signed-f32'){
   const decoded=api.decodedAudio,pcm=new DataView(await fetch('/'+audio.source).then(r=>r.arrayBuffer()));compare(decoded?.sampleRate,24000,'actual example decoder sample rate');compare(decoded?.length,audio.frames,'actual example decoder frame count');compare(decoded?.channels.length,2,'actual example decoder channels');
   for(let channel=0;channel<2;channel++){const expected=new Float32Array(audio.frames);for(let i=0;i<audio.frames;i++){const v=pcm.getInt16(audio.dataOffset+(i*2+channel)*2,true);expected[i]=Math.fround(v*Math.fround(v<0?1/32768:1/32767));}hashes.push(await cells(decoded.channels[channel],expected,`actual AudioBuffer channel${channel} vs signed PCM normalization`));}
  }
  for(let channel=0;channel<2;channel++){const h=charts[channel].getSeries()[0],bytes=await fetch(`${url}/${audio.files[channel].file}`).then(r=>r.arrayBuffer()),expected=new Float32Array(bytes);compare(h.columns,audio.columns,'audio columns');compare(h.rows,audio.rows,'audio rows');hashes.push(await cells(h.data,expected,`PCM channel${channel} full STFT`,audio.maximumAbsoluteDBError));}
 }
 if(id==='0803'||id==='0806'){
  const rows=id==='0803'?500:1000,columns=id==='0803'?300:250,vectors=phase==='initial'?(id==='0803'?30:25):(id==='0803'?390:325),expected=new Float32Array(rows*columns),random=lcg(id==='0803'?20803:20806);
  // A scrolling series has no observations in unused slots. Unlike 0806,
  // which explicitly supplies an initial zero matrix, these are missing NaN.
  if(id==='0803')expected.fill(NaN);
  for(let vector=0;vector<vectors;vector++)for(let row=0;row<rows;row++){const f=row/rows,t=vector/30,noise=.35+.65*random(),low=Math.exp(-(((f-.17-.03*Math.sin(t*.7))/.18)**2)),high=Math.exp(-(((f-.64-.045*Math.sin(t*.23))/.09)**2));expected[row*columns+vector%columns]=Math.max(0,Math.min(75,75*(.02+.88*low*noise+.65*high*noise)));}
  const h=all.find(s=>s.data instanceof Float32Array);compare(snapshot.vectors,vectors,'written vectors');hashes.push(await cells(h.data,expected,`${id} all physical cells including zero/unmodified slots`));
 }
 if(id==='0807'){
  const expected=new Float32Array(800);for(let y=0;y<40;y++)for(let x=0;x<20;x++){const r=Math.hypot(x-10,y-20);expected[y*20+x]=Math.max(0,Math.min(100,30+24*Math.cos(r*.7)*Math.exp(-r/20)+46*Math.exp(-r*r/2.2)));}
  for(let panel=0;panel<2;panel++)hashes.push(await cells(charts[panel].getSeries()[0].data,expected,`panel${panel} complete shared matrix`));
 }
 if(id==='1003'){
  const expected=new Float32Array(18000);for(let row=0;row<100;row++)for(let col=0;col<180;col++){const a=(col+.5)/180*(Math.PI*2),r=(row+.5)/100;expected[row*180+col]=Math.max(0,Math.min(60,37+16*Math.sin(r*16-1.2*Math.cos(a*3))+7*Math.cos(a*2+r*5)));}
  hashes.push(await cells(all[0].data,expected,'all polar cells'));for(let row=0;row<100;row++)for(let col=0;col<180;col++)compare(all[0].getIntensityAt((col+.5)*2,row+.5),expected[row*180+col],`public center${row},${col}`,1e-12);group('public cell-center reads',18000);
 }
 if(['1100','1101','1102','1103','1111','1714'].includes(id)){
  const raw=window.__RAW;const geometry=(chart,expected,name)=>{const actual=chart.getGeoJSON();compare(JSON.stringify(actual),JSON.stringify(expected),`${name} complete GeoJSON geometry and properties`);let coordinates=0,rings=0;for(const feature of expected.features){const polygons=feature.geometry?.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry?.coordinates??[];for(const polygon of polygons)for(const ring of polygon){rings++;coordinates+=ring.length;}}group(name,coordinates);return{features:expected.features.length,rings,coordinates};};
  const metric=(code,index,column,maxAge=column===0?45:7)=>{const records=raw.covid.countries[code]?.rows??[];for(let i=records.length-1;i>=0;i--){const row=records[i];if(row[0]>index)continue;if(index-row[0]>maxAge)break;const v=row[column+1];if(v!==null&&Number.isFinite(v))return v;}return undefined;};
  const regionValues=(chart,values)=>{const actual=chart.getRegions();compare(actual.length,chart.getGeoJSON().features.length,'all region count');for(const region of actual)compare(region.value,values[region.key],`region${region.key}`);group('all native region values',actual.length);};
  const histories=(chart,code,metricIndex,start,end,actual,name,index=0)=>{const population=raw.covid.countries[code]?.population,scale=actual&&population?population/(metricIndex===0?100:1e6):1;const expected=[];for(let day=start;day<=end;day++){const value=metric(code,day,metricIndex,metricIndex===0?45:0);expected.push({x:day,y:value===undefined?NaN:value*scale});}lines(chart.getSeries()[index],expected,name);};
  if(id==='1100'||id==='1101'||id==='1103'||id==='1111')geometry(charts[0],raw.world,'full world geometry');
  if(id==='1101'){const values={};for(const f of raw.world.features)if(f.properties?.continent==='Europe'&&f.id!=='RUS'&&Number.isFinite(raw.population.population2018[f.id]))values[f.id]=raw.population.population2018[f.id];regionValues(charts[0],values);}
  if(id==='1102'){const continents=['North America','South America','Europe'],year=phase==='initial'?1965:Number(phase);compare(snapshot.year,year,'selected year');for(let i=0;i<3;i++){const geo={type:'FeatureCollection',features:raw.world.features.filter(f=>f.properties?.continent===continents[i])},values={};geometry(charts[i],geo,continents[i]);for(const f of geo.features){const value=raw.population.growth1961to2019[f.id]?.[year];if(Number.isFinite(value))values[f.id]=value;}regionValues(charts[i],values);}}
  if(id==='1103'||id==='1111'){
   const index=id==='1103'?(phase==='initial'?raw.covid.dates.indexOf('2021-01-27'):Number(phase)):raw.covid.dates.length-1;compare(snapshot.dateIndex,index,'selected date');const expected=[];
   for(const f of raw.world.features){const code=String(f.id),v=metric(code,index,id==='1103'?0:1),position=f.properties?.label;if(!position||v===undefined||(id==='1111'&&v<=0))continue;expected.push({longitude:position[0],latitude:position[1],name:String(f.properties.name),code,value:id==='1103'?`${v.toFixed(2)}% vaccinated`:`${v.toFixed(1)} new cases / million (7-day avg)`,...(id==='1103'?{percentage:v}:{}),size:id==='1103'?5+Math.sqrt(Math.max(0,v))*2.6:Math.min(35,2+Math.sqrt(v)*.48)});}
   const actual=charts[0].getSeries()[0].getPoints();compare(actual.length,expected.length,'native map point count');for(let i=0;i<expected.length;i++){for(const key of Object.keys(expected[i]))compare(actual[i]?.[key],expected[i][key],`mapPoint${i}.${key}`);if(id==='1103'){const value=Math.max(0,Math.min(100,expected[i].percentage)),colors=[[238,53,40],[240,213,42],[24,242,56]],low=value<50?0:1,t=(value-low*50)/50;for(let channel=0;channel<3;channel++){const a=colors[low][channel]/255,b=colors[low+1][channel]/255;compare(actual[i]?.color?.[['r','g','b'][channel]],a+(b-a)*t,`mapPoint${i}.color${channel}`,1e-15);}compare(actual[i]?.color?.a,1,`mapPoint${i}.alpha`);}}group('all native map point fields',expected.length);
   if(id==='1103')compare(snapshot.worldVaccinated,metric('OWID_WRL',index,0),'world vaccinated');
   else{const values={};for(const f of raw.world.features){const v=metric(String(f.id),index,0);if(v!==undefined)values[f.id]=v;}regionValues(charts[0],values);histories(charts[1],'OWID_WRL',1,0,index,true,'world daily cases',0);histories(charts[1],'OWID_WRL',0,0,index,false,'world vaccinated',1);
    if(phase==='detail'||phase==='actual'){compare(snapshot.level,'country','country drilldown');compare(snapshot.country,'DEU','clicked independent country');compare(snapshot.actual,phase==='actual','unit mode');for(let column=0;column<4;column++){histories(charts[2+column],'DEU',column,0,index,phase==='actual',`Germany metric${column}`,0);histories(charts[2+column],'OWID_WRL',column,0,index,phase==='actual',`world metric${column}`,1);}}
    if(phase==='popup'){compare(snapshot.hoverCode,'DEU','hovered country');compare(snapshot.popupVisible,true,'popup visible');for(let column=0;column<4;column++)histories(charts[6],'DEU',column,index-27,index,false,`popup metric${column}`,column);}
   }
  }
  if(id==='1714'){
   geometry(charts[0],raw.zones,'all bidding-zone polygons');
   const facts=[['FI',309,52,128],['SE3',252,25,122],['NO2',221,100,91],['SE2',185,98,109],['NO5',133,100,95],['DK1',106,84,90],['NO4',104,97,34],['SE1',101,100,100],['NO3',100,100,116],['NO1',58,99,125],['DK2',31,77,114],['LV',26,21,233],['LT',24,22,233],['SE4',23,68,134],['EE',19,19,223]],zoneIndex=facts.findIndex(f=>f[0]===phase),[code,volume,share,averagePrice]=facts[zoneIndex],renewable=[true,false,false,true,true,false,false,true,true,false,true,true,false];compare(snapshot.selectedZone,code,'selected zone');
   const weights=renewable.map((r,i)=>r?(code.startsWith('NO')?(i===3?3:i===4?7:.03):code.startsWith('DK')?(i===11?6:i===10?3:.15):(i===3||i===11?2:i===4?3:.3)):(code.startsWith('SE')||code==='FI'?(i===5?7:.2):(i===12?7:.2))),sums=[0,0];weights.forEach((w,i)=>sums[Number(renewable[i])]+=w);const bottom=new Float64Array(24),native=charts[1].getSeries();let total=0;
   for(let source=0;source<13;source++){const shape=Array.from({length:24},(_,h)=>source===8?Math.max(.01,Math.sin((h-7)/12*Math.PI)):1+.13*Math.sin(h/24*2*Math.PI+zoneIndex*.37)+.06*Math.cos(h/4+source)),sum=shape.reduce((a,b)=>a+b,0),energy=volume*1000*(renewable[source]?share/100:1-share/100)*weights[source]/sums[Number(renewable[source])],figures=native[source].getFigures();compare(figures.length,24,`source${source}.count`);
    for(let h=0;h<24;h++){const v=shape[h]/sum*energy,d=figures[h]?.getDimensionsTwoPoints();for(const[k,e]of Object.entries({x1:h,x2:h+.98,y1:bottom[h],y2:bottom[h]+v}))compare(d?.[k],e,`source${source}[${h}].${k}`,1e-9);bottom[h]+=v;total+=v;}group(`zone${code} source${source}`,24);}
   compare(total,volume*1000,'daily energy conservation',1e-7);const shape=Array.from({length:24},(_,h)=>.75+.76*Math.exp(-(((h-11-zoneIndex%4)/4)**2))+.15*Math.exp(-(((h-18)/2.6)**2))),mean=shape.reduce((a,b)=>a+b,0)/24;lines(native[13],shape.map((v,h)=>({x:h+.5,y:averagePrice*v/mean})),'all hourly prices',1e-12);
  }
 }
 if(id==='0600'){
  const fields=[[17.5,19.5,21.2,28.5,48],[14,19.5,20.1,26.8,41.5],[15.2,18.5,22.7,34,41]];matrix(all[0],fields.map((values,i)=>[i+1-.35,i+1+.35,...values]),'all box fields');lines(all[1],[{x:1,y:50}],'developer outlier');lines(all[2],[{x:2,y:52},{x:2,y:60}],'cashier outliers');
 }
 if(id==='0601'){
  const pdf=Float64Array.from({length:801},(_,i)=>Math.exp(-((-4+i*.01)**2)/2)/Math.sqrt(2*Math.PI)),cdf=new Float64Array(801);for(let i=1;i<801;i++)cdf[i]=cdf[i-1]+(pdf[i-1]+pdf[i])*.01/2;const integral=cdf[800];for(let i=0;i<801;i++)cdf[i]/=integral;const n=phase==='initial'?1:801;lines(all[0],Array.from(cdf.subarray(0,n),(v,i)=>({x:-4+i*.01,y:v})),'all cumulative points');lines(all[1],Array.from(pdf.subarray(0,n),(v,i)=>({x:-4+i*.01,y:v})),'all density points');matrix(all[2],Array.from(pdf.subarray(0,n),(v,i)=>[-4+i*.01,1-v*.5,1+v*.5]),'all violin bounds');
  if(n===801){const quantile=p=>{let lo=0,hi=800;while(hi-lo>1){const mid=(lo+hi)>>1;if(cdf[mid]<p)lo=mid;else hi=mid;}return -4+(lo+(p-cdf[lo])/(cdf[hi]-cdf[lo]))*.01;},q1=quantile(.25),q2=quantile(.5),q3=quantile(.75),iqr=q3-q1;matrix(all[3],[[.9,1.1,q1-1.5*iqr,q1,q2,q3,q3+1.5*iqr]],'native final horizontal box');}
 }
 if(id==='1402'){
  const random=lcg(21402),counts=new Uint32Array(20);let excluded=0;for(let pair=0;pair<25000;pair++){const r=Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,random()))),angle=Math.PI*2*random();for(const sample of[r*Math.cos(angle),r*Math.sin(angle)]){if(sample< -4||sample>4){excluded++;continue;}const index=sample===4?19:Math.floor((sample+4)/8*20);counts[index]++;}}
  const figures=all[0].getFigures();compare(figures.length,20,'all histogram bins');for(let i=0;i<20;i++){const d=figures[i]?.getDimensionsTwoPoints();for(const[k,e]of Object.entries({x1:-4+i*.4,x2:-4+(i+1)*.4,y1:0,y2:counts[i]}))compare(d?.[k],e,`bin${i}.${k}`);}compare(snapshot.counted+excluded,50000,'all generated samples accounted');compare(snapshot.excluded,excluded,'excluded count');group('native histogram bin geometry and counts',20);
 }
 return{id,phase,comparisons,mismatches,maxDifference,firstErrors,groups,hashes};
}

const resultDirectory=args.has('--prepared')?resolve(directory,`visible-${new Date().toISOString().replace(/[:.]/g,'-')}`):directory;
await mkdir(resultDirectory,{recursive:true});
await writeFile(resolve(resultDirectory,'runner-used.mjs'),await readFile(new URL(import.meta.url)));
const inputManifest=JSON.parse(await readFile(resolve(directory,'build-inputs.json'),'utf8'));
const changedInputs=[];for(const[path,record]of Object.entries(inputManifest.inputs))if(sha(await readFile(resolve(path)))!==record.sha256)changedInputs.push(path);
assert.deepEqual(changedInputs,[],'Prepared bundle inputs changed; rebuild rather than claiming current-source coverage');
const report={sessionId:process.env.CRYCHART_FUNCTIONAL_SESSION_ID,...prepare,createdAt:new Date().toISOString(),buildDirectory:relative(process.cwd(),directory).replaceAll('\\','/'),executedRunnerSHA256:sha(await readFile(new URL(import.meta.url))),cases:ids,browserVisible:true,performanceRun:false,sharedDistModified:false,numericalPolicy:{default:'Every native numeric field exact, including NaN topology; full matrices have independent SHA256.',audioAbsoluteDB:1e-4,contourEndpointKeyDecimalPlaces:8,polarPublicCellCenterAbsolute:1e-12,mapNormalizedColorAbsolute:1e-15,energyRectangleAbsolute:1e-9,energyPriceAbsolute:1e-12,energyConservationAbsolute:1e-7,fixedBeforeBrowserExecution:true},checks:[],errors:[],screenshots:[],scope:'Complete actual native data for original local examples. Independent formulas or untransformed public asset files supply expected data. This is not equality to upstream random samples, complete visual parity, or a performance result.'};
const save=()=>writeFile(resolve(resultDirectory,'report.json'),JSON.stringify(report,null,2)+'\n');
assert.equal(sha(Buffer.from(await fetch(base+prepare.url+'/fixture.js').then(r=>r.arrayBuffer()))),prepare.bundleSHA256);
const browser=await chromium.connectOverCDP(process.env.CRYCHART_CDP ?? 'http://127.0.0.1:9223'),page=await browser.contexts()[0].newPage();await page.setViewportSize({width:1360,height:1080});await page.bringToFront();page.on('pageerror',e=>report.errors.push(String(e)));let id='';
const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function check(name,run){try{report.checks.push({id,name,passed:true,evidence:await run()});}catch(e){report.checks.push({id,name,passed:false,error:e.stack??String(e)});}await save();console.log(JSON.stringify({id,name,passed:report.checks.at(-1).passed}));}
async function audit(phase){const result=await page.evaluate(auditNative,{id,phase,audio:prepare.audio,url:prepare.url});assert.equal(result.mismatches,0,JSON.stringify(result));assert(result.comparisons>0);return result;}
async function slider(control,value){await page.locator(`[data-control="${control}"]`).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);await settle();}
async function germany(){return page.evaluate(()=>{const c=window.__DATA.charts[0],f=window.__RAW.world.features.find(f=>f.id==='DEU'),p=c.positionToScreen(f.properties.label),b=c.canvas.getBoundingClientRect();return{x:p.x+b.left,y:p.y+b.top,picked:c.getRegionAt(p)?.key};});}
try{
 await page.goto(base+prepare.url+'/index.html');await page.waitForFunction(()=>!!window.__DATA);
 await page.evaluate(async()=>{const names={world:'world-countries',population:'world-bank-population',covid:'covid-history',zones:'nordic-bidding-zones'};window.__RAW={};for(const[key,file]of Object.entries(names))window.__RAW[key]=await fetch(`/examples/data/${file}.json`).then(r=>r.json());});
 for(id of ids){await page.mouse.move(1,1);await page.evaluate(id=>window.__DATA.mount(id),id);await settle();
  if(id==='0802')await page.waitForFunction(()=>window.__DATA.snapshot().status!=='loading',null,{timeout:45000});
  await check('complete initial native source data',()=>audit(id==='1714'?'NO1':'initial'));
  if(id==='0702')await check('all 180000 retained channel samples after prefix eviction and ring wrap',async()=>{await page.evaluate(()=>{for(let i=1;i<=124;i++)window.__DATA.advance(i*.5,false);window.__DATA.render();});return audit('wrapped');});
  if(id==='0803'||id==='0806')await check('complete physical grid after new vectors cross the circular capacity',async()=>{await page.evaluate(time=>window.__DATA.advance(time),id==='0803'?12:10);return audit('wrapped');});
  if(id==='0601')await check('all final density, cumulative, violin and quartile values',async()=>{await page.evaluate(()=>window.__DATA.advance(8));return audit('complete');});
  if(id==='1102')for(const year of[1961,2019])await check(`all region values after year ${year}`,async()=>{await slider('population-year',year);return audit(String(year));});
  if(id==='1103')await check('all latest vaccination point positions, magnitudes and labels',async()=>{const last=await page.evaluate(()=>window.__RAW.covid.dates.length-1);await slider('vaccination-date',last);return audit(String(last));});
  if(id==='1111'){
   await check('all four hover history series preserve missing observations',async()=>{const p=await germany();assert.equal(p.picked,'DEU');await page.mouse.move(p.x,p.y);await settle();return audit('popup');});
   await check('country drilldown retains every day in all eight relative series',async()=>{for(let i=0;i<2;i++){const p=await germany();assert.equal(p.picked,'DEU');await page.mouse.click(p.x,p.y);await page.waitForTimeout(300);await settle();}return audit('detail');});
   await check('absolute mode applies the correct population scale to every metric and missing day',async()=>{await page.locator('[data-control="covid-actual"]').click();await settle();return audit('actual');});
  }
  if(id==='1714')for(const zone of['FI','SE3','NO2','SE2','NO5','DK1','NO4','SE1','NO3','DK2','LV','LT','SE4','EE'])await check(`all hourly generation rectangles and prices in ${zone}`,async()=>{await page.locator(`[data-control="zone-${zone}"]`).click();await settle();return audit(zone);});
  const file=`${id}-native-data.png`;await page.screenshot({path:resolve(resultDirectory,file)});report.screenshots.push({id,file,sha256:sha(await readFile(resolve(resultDirectory,file)))});
  await check('native charts and canvases released after data validation',async()=>{const result=await page.evaluate(()=>window.__DATA.dispose());assert.equal(result.engineCharts,0);assert.equal(result.canvases,0);return result;});
 }
 await page.evaluate(id=>window.__DATA.mount(id),ids.at(-1));await settle();report.visibleRemountExcludedFromChecks=true;
}catch(e){report.errors.push(e.stack??String(e));}
finally{report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(c=>c.passed).length;report.failed=report.checks.filter(c=>!c.passed).length;await save();await browser.close();console.log(JSON.stringify({directory:resultDirectory,passed:report.passed,failed:report.failed,errors:report.errors}));if(report.failed||report.errors.length)process.exitCode=1;}
