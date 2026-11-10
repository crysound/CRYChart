import * as api from '/dist/crychart.js';

const RATE = 48000, CAPACITY = RATE * 60, FRAME = 9600;
const clock = () => performance.timeOrigin + performance.now();
const nextFrame = () => new Promise(requestAnimationFrame);
const waveform = (index, channel) => index % 32749 === 129 ? NaN : index % 16381 === 17 ? (channel % 2 ? -.19 : .19) : (((index + channel * 97) % 4096) / 4095 - .5) * .02;
let engine, charts = [], histories = [], scope = [], sourceIndex = 0, seed = 0, worker, shared, producerURL;
let started = 0, stopped = 0, received = 0, ingested = 0, lastMain, lastScope, scopeFrame = 0, scopeReplacements = 0;
let metrics, queueSamples, longTasks, errors, observer, raf, queueTimer, stopResolve, stopReject, stopTimer, pointerHandler;
let pointer = [], restorers = [], config;
let diagnosticUnavailable = [], longTaskDiagnostic = {status:'not-started'};
function longTaskUnavailable(reason) {
  longTasks=null;longTaskDiagnostic={status:'unavailable',reason:String(reason)};
  if(!diagnosticUnavailable.some(item=>item.name==='longtask'))diagnosticUnavailable.push({name:'longtask',reason:String(reason)});
}
function disconnectLongTaskObserver(flush=false) {
  if(!observer)return;
  try{if(flush&&longTasks!==null)longTasks.push(...observer.takeRecords().map(t=>({atMs:t.startTime-started,durationMs:t.duration})));}
  catch(error){longTaskUnavailable(error);}
  finally{try{observer.disconnect();}catch(error){longTaskUnavailable(error);}observer=undefined;}
}

function recordError(error) { errors.push(String(error?.stack ?? error)); }
function schema() { return {xValues:{storage:Float64Array, pattern:'progressive', auto:true}, yValues:{storage:Float32Array}, renderYValues:{storage:Float32Array}}; }
function line(chart, channel, hidden = false, bounded = false) {
  const result = chart.addLineSeries({includesNaN:true,schema:schema()}).setDataMapping({x:'xValues',y:'renderYValues'})
    .setStrokeStyle(new api.SolidLine({thickness:config.strokeWidth,fillStyle:new api.SolidFill({color:api.ColorHEX(['#216bf3','#fc8021'][channel % 2])})})).setPointSize(0);
  if (bounded) result.setMaxSampleCount(CAPACITY);
  if (hidden) result.setVisible(false);
  return result;
}
function append(amount) {
  for (let channel=0;channel<2;channel++) {
    const raw = Float32Array.from({length:amount}, (_,i)=>waveform(sourceIndex+i,channel)), render = raw.slice();
    if (raw.buffer === render.buffer) throw Error('原始列与显示列必须独立');
    for (const lines of histories) lines[channel].appendSamples({yValues:raw,renderYValues:render},{start:sourceIndex*1000/RATE,step:1000/RATE});
  }
  sourceIndex += amount;
}
function replaceScope(first) {
  for (let channel=0;channel<2;channel++) {
    const raw = Float32Array.from({length:FRAME},(_,i)=>waveform(first+i,channel)), render=raw.slice();
    scope[channel].clear().appendSamples({yValues:raw,renderYValues:render},{start:0,step:1000/RATE});
  }
  scopeReplacements++;
}
function queueObservation() {
  if (!shared) return;
  // The seqlock keeps producer batch/sample counters from different updates out of one snapshot.
  let a,b,producedBatches,producedSamples;
  do { a=Atomics.load(shared,4); if(a % 2) continue; producedBatches=Atomics.load(shared,0);producedSamples=Atomics.load(shared,1);b=Atomics.load(shared,4); } while(a!==b || a%2);
  const value={atMs:performance.now()-started,batches:producedBatches-received,samples:producedSamples-ingested,producedBatches,producedSamples,receivedBatches:received,ingestedSamples:ingested};
  queueSamples.push(value); return value;
}
function watchRender(index) {
  const chart=charts[index],original=chart.renderNow;let renderedSequence=0;
  chart.renderNow=function(...args) {
    const result=original.apply(this,args),batch=index===2?lastScope:lastMain;
    if(batch && batch.sequence!==renderedSequence) {
      renderedSequence=batch.sequence;
      metrics[index===2?'scopeSubmitMs':'historySubmitMs'].push({atMs:performance.now()-started,value:clock()-batch.sourceDueAt,chartIndex:index,sequence:batch.sequence});
    }
    return result;
  };
  restorers.push(()=>{chart.renderNow=original;});
}
function observe() {
  metrics={rafMs:[],receiveMs:[],ingestMs:[],scopeSubmitMs:[],historySubmitMs:[]};queueSamples=[];longTasks=[];errors=[];
  diagnosticUnavailable=[];longTaskDiagnostic={status:'not-started'};
  if(typeof PerformanceObserver==='undefined'||!PerformanceObserver.supportedEntryTypes?.includes('longtask')){
    longTaskUnavailable('浏览器未声明支持PerformanceObserver longtask');
  }else{
    try{
      observer=new PerformanceObserver(list=>{
        if(longTasks===null)return;
        try{longTasks.push(...list.getEntries().map(t=>({atMs:t.startTime-started,durationMs:t.duration})));}
        catch(error){longTaskUnavailable(error);disconnectLongTaskObserver();}
      });
      observer.observe({type:'longtask',buffered:false});longTaskDiagnostic={status:'available'};
    }catch(error){longTaskUnavailable(error);disconnectLongTaskObserver();}
  }
  let previous;
  const tick=at=>{if(previous!==undefined)metrics.rafMs.push({atMs:at-started,value:at-previous});previous=at;raf=requestAnimationFrame(tick);};
  raf=requestAnimationFrame(tick);queueTimer=setInterval(queueObservation,200);
}
async function setup(options) {
  await cleanup();config=options;sourceIndex=0;seed=options.seedSamples;received=0;ingested=0;scopeFrame=0;scopeReplacements=0;stopped=0;lastMain=lastScope=undefined;
  if(!['linear','linear-highPrecision'].includes(options.axisType)||![1,1.5].includes(options.strokeWidth)||!Number.isInteger(seed)||seed<0||seed>CAPACITY)throw Error('无效监视配置');
  const grid=document.querySelector('#grid')??document.body.appendChild(document.createElement('div'));grid.id='grid';grid.replaceChildren();
  grid.style.cssText='display:grid;grid-template-columns:463px 463px;gap:6px';
  engine=api.cryChart();charts=[];histories=[];scope=[];
  for(let index=0;index<9;index++) {
    const host=grid.appendChild(document.createElement('div'));host.style.cssText='width:463px;height:119.5535736084px';
    const type=index===2?'linear':options.axisType;
    const chart=engine.ChartXY({container:host,defaultAxisX:{type},theme:api.Themes.light,legend:{visible:false},animationsEnabled:false}).setTitle('');chart.setAnimationsEnabled(false);charts.push(chart);
    if(chart.getDefaultAxisX().type!==type)throw Error('实际轴类型与请求不一致');
    chart.getDefaultAxisX().setScrollMargins(false).setInterval({start:0,end:index===2?(FRAME-1)*1000/RATE:60000,stopAxisAfter:true});
    chart.getDefaultAxisY().setScrollMargins(false);
    if(index===0)chart.getDefaultAxisY().fit(false,false);else chart.getDefaultAxisY().setInterval({start:-.2,end:.2,stopAxisAfter:true});
    if(index<2){histories.push([line(chart,0,false,true),line(chart,1,false,true)]);line(chart,0,true);line(chart,1,true);}
    else if(index===2){scope=[line(chart,0),line(chart,1)];line(chart,0,true);line(chart,1,true);}
    else for(let channel=0;channel<2;channel++) {const small=line(chart,channel),count=index===6?0:557;small.setMaxSampleCount(90000);if(count){const raw=Float32Array.from({length:count},(_,i)=>waveform(i,channel));small.appendSamples({yValues:raw,renderYValues:raw.slice()},{start:0,step:200});}}
  }
  while(sourceIndex<seed)append(Math.min(RATE,seed-sourceIndex));replaceScope(Math.max(0,seed-FRAME));
  for(let round=0;round<3;round++){await nextFrame();for(let i=0;i<charts.length;i++){const c=charts[i],p=c.getPadding();c.setPadding({...p,right:p.right+c.plot.width-(i===1?347:352),bottom:p.bottom+c.plot.height-52.5535736084});}}
  await nextFrame();await nextFrame();return snapshot(false);
}
function start() {
  if(worker)throw Error('生产者已经启动');started=performance.now();observe();[0,1,2].forEach(watchRender);
  shared=new Int32Array(new SharedArrayBuffer(20));Atomics.store(shared,3,1);
  const code=`let shared,timer,start,frame=0,sequence=0;const now=()=>performance.timeOrigin+performance.now();onmessage=e=>{shared=new Int32Array(e.data.shared);start=now();timer=setInterval(()=>{if(!Atomics.load(shared,3)){clearInterval(timer);postMessage({done:true,sequence,amount:frame*960});return}const next=Math.floor((now()-start)/20);if(next<=frame)return;const amount=(next-frame)*960;frame=next;sequence++;Atomics.add(shared,4,1);Atomics.store(shared,0,sequence);Atomics.add(shared,1,amount);Atomics.add(shared,4,1);postMessage({sequence,amount,sourceDueAt:start+frame*20,sentAt:now()})},20)}`;
  producerURL=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));worker=new Worker(producerURL);URL.revokeObjectURL(producerURL);producerURL=undefined;
  worker.onerror=e=>{recordError(e.message);stopReject?.(Error(e.message));};
  worker.onmessage=event=>{
    const batch=event.data;
    if(batch.done){if(batch.sequence!==received||batch.amount!==ingested){const error=Error('停止时生产、接收与完整写入计数不一致');recordError(error);stopReject?.(error);}else stopResolve?.();return;}
    const at=clock(),before=performance.now();
    try {
      queueObservation();if(batch.sequence!==received+1)throw Error('输入批次序号不连续');
      append(batch.amount);received=batch.sequence;ingested+=batch.amount;lastMain=batch;
      const nextScope=Math.floor((sourceIndex-seed)/FRAME);
      if(nextScope>scopeFrame){replaceScope(Math.max(0,sourceIndex-FRAME));scopeFrame=nextScope;lastScope=batch;}
      const end=sourceIndex/48;for(const chart of charts.slice(0,2))chart.getDefaultAxisX().setInterval({start:Math.max(0,end-60000),end:Math.max(60000,end),stopAxisAfter:true});
      for(const chart of charts.slice(3))chart.invalidate();
      metrics.receiveMs.push({atMs:before-started,value:at-batch.sentAt,sequence:batch.sequence});metrics.ingestMs.push({atMs:performance.now()-started,value:performance.now()-before,sequence:batch.sequence});queueObservation();
    }catch(error){recordError(error);Atomics.store(shared,3,0);stopReject?.(error);}
  };
  worker.postMessage({shared:shared.buffer});return{startedAtMs:started,protocol:'独立 Worker 每20ms发送进度元数据；主线程生成并完整写入样本，非实际设备或波形传输延迟'};
}
function snapshot(withQueue=true) {
  return{elapsedMs:started?(stopped||performance.now())-started:0,focused:document.hasFocus(),visibility:document.visibilityState,dpr:devicePixelRatio,sourceIndex,seedSamples:seed,receivedBatches:received,ingestedSamplesPerChannel:ingested,ingestedSamplesAcrossHistory:ingested*4,scopeReplacements,
    longTaskDiagnostic:{...longTaskDiagnostic},diagnosticUnavailable:diagnosticUnavailable.map(item=>({...item})),
    queue:withQueue&&shared?queueObservation():undefined,charts:charts.map(c=>({axisType:c.getDefaultAxisX().type,container:{width:c.width,height:c.height},plot:{...c.plot},stats:c.getRenderStats()})),
    history:histories.map(lines=>lines.map(s=>{const data=s.getDataSet(),raw=data.getColumnSlices('yValues'),render=data.getColumnSlices('renderYValues');return{count:s.getSampleCount(),next:s.getNextSampleIndex(),capacity:s.getMaxSampleCount(),mapping:s.getDataMapping(),rawRenderBuffersIndependent:raw.every(a=>render.every(b=>a.buffer!==b.buffer)),storage:{x:data.schema.xValues.storage.name,raw:data.schema.yValues.storage.name,render:data.schema.renderYValues.storage.name}};})),scope:scope.map(s=>({count:s.getSampleCount()})),errors:[...(errors??[])]};
}
function armPointer(){pointer=[];pointerHandler=e=>{const item={atMs:performance.now()-started,eventToHandlerMs:performance.now()-e.timeStamp,handlerToRafMs:null};pointer.push(item);const at=performance.now();requestAnimationFrame(()=>item.handlerToRafMs=performance.now()-at);};document.addEventListener('pointermove',pointerHandler,{capture:true});}
function finishPointer(){document.removeEventListener('pointermove',pointerHandler,true);pointerHandler=undefined;return pointer;}
function collect(fromMs=0){return{snapshot:snapshot(),metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,v.filter(x=>x.atMs>=fromMs)])),queue:queueSamples.filter(x=>x.atMs>=fromMs),longTasks:longTasks===null?null:longTasks.filter(x=>x.atMs>=fromMs),longTaskDiagnostic:{...longTaskDiagnostic},diagnosticUnavailable:diagnosticUnavailable.map(item=>({...item})),longTaskScope:'完整生产运行期；未截尾，检查点窗口另按起始时间筛选'};}
async function stop(){
  if(!worker)return snapshot();
  const drained=new Promise((resolve,reject)=>{stopResolve=resolve;stopReject=reject;stopTimer=setTimeout(()=>reject(Error('生产者停止并排空超时')),30000);});
  Atomics.store(shared,3,0);
  try{await drained;await nextFrame();await nextFrame();stopped=performance.now();return snapshot();}
  finally{clearTimeout(stopTimer);stopResolve=stopReject=undefined;worker.terminate();worker=undefined;clearInterval(queueTimer);cancelAnimationFrame(raf);disconnectLongTaskObserver(true);restorers.splice(0).forEach(fn=>fn());}
}
async function cleanup(){
  if(worker)await stop();if(pointerHandler)finishPointer();clearInterval(queueTimer);cancelAnimationFrame(raf);disconnectLongTaskObserver();restorers.splice(0).forEach(fn=>fn());engine?.dispose();engine=undefined;charts=[];histories=[];scope=[];shared=undefined;started=0;
}
window.__CRY_MONITOR__={ready:true,setup,start,snapshot,collect,stop,cleanup,armPointer,finishPointer};
