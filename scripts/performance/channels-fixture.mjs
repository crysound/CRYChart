// 当前 CRYChart 单库负载；所有计时使用浏览器实际执行结果。
const nativeRAF = window.requestAnimationFrame.bind(window);
const contexts = new Map();
let active;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const signal = (channel, index) => Math.sin(index * .002 + channel * .071) * .65 + Math.sin(index * .000037 + channel * .113) * .3 + (index % 8191 === 0 ? .15 : 0);

function instrument(gl) {
  if (contexts.has(gl)) return;
  const state = {buffers:new Map(),bindings:new Map(),allocated:0,peak:0,uploaded:0,draws:0,queries:[],liveQueries:new Set(),queryDeletes:0,timerErrors:[]};
  contexts.set(gl,state);
  const wrap = (name, before) => {
    const original=gl[name]; if(typeof original!=='function')return;
    gl[name]=function(...args){before(...args);return original.apply(this,args);};
  };
  wrap('bindBuffer',(target,buffer)=>state.bindings.set(target,buffer));
  wrap('bufferData',(target,value,_usage,_offset=0,length)=>{
    const buffer=state.bindings.get(target), bytes=typeof value==='number'?value:value?.byteLength===undefined?0:(length??(value.length-_offset))*value.BYTES_PER_ELEMENT;
    state.allocated+=bytes-(state.buffers.get(buffer)??0);state.buffers.set(buffer,bytes);state.peak=Math.max(state.peak,state.allocated);
    if(typeof value!=='number')state.uploaded+=bytes;
  });
  wrap('bufferSubData',(_target,_offset,value,start=0,length)=>{state.uploaded+=value?.BYTES_PER_ELEMENT===undefined?value?.byteLength??0:(length??(value.length-start))*value.BYTES_PER_ELEMENT;});
  wrap('deleteBuffer',buffer=>{state.allocated-=state.buffers.get(buffer)??0;state.buffers.delete(buffer);});
  for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(name,()=>{state.draws++;if(active)active.contexts.add(gl);});
  try {state.extension=gl.getExtension('EXT_disjoint_timer_query_webgl2');} catch(error) {state.timerErrors.push(String(error));}
}
const originalContext=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(kind,...args){const context=originalContext.call(this,kind,...args);if(kind==='webgl2'&&context)instrument(context);return context;};

function releaseTimerQuery(gl,state,query) {
  gl.deleteQuery(query);
  if(state.liveQueries.delete(query))state.queryDeletes++;
}
function cleanupTimerQueries() {
  const result={status:'passed',pendingBefore:0,deletedDuringCleanup:0,remaining:0,totalDeleted:0,errors:[]};
  for(const [gl,state]of contexts){
    result.pendingBefore+=state.liveQueries.size;
    for(const query of [...state.liveQueries])try{
      if(state.extension&&gl.getQuery(state.extension.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)===query)gl.endQuery(state.extension.TIME_ELAPSED_EXT);
      releaseTimerQuery(gl,state,query);result.deletedDuringCleanup++;
    }catch(error){result.errors.push(String(error));}
    for(const item of state.queries)if(!item.done){item.done=true;if(item.frame.gpuTimer.status==='pending')item.frame.gpuTimer={status:'unavailable',elapsedMs:null,reason:'测量提前结束，查询已在释放阶段处理'};}
    result.remaining+=state.liveQueries.size;result.totalDeleted+=state.queryDeletes;
  }
  if(result.remaining||result.errors.length)result.status='failed';
  return result;
}

function beginTimer(gl,state) {
  if(!state.extension)return undefined;
  try {
    const prior=gl.getError();if(prior!==0)active?.renderErrors.push(prior);
    if(gl.getQuery(state.extension.TIME_ELAPSED_EXT,gl.CURRENT_QUERY))return undefined;
    const query=gl.createQuery();if(!query)return undefined;state.liveQueries.add(query);
    gl.beginQuery(state.extension.TIME_ELAPSED_EXT,query);
    const error=gl.getError();if(error!==0){state.timerErrors.push('可选GPU查询启动失败：'+error);releaseTimerQuery(gl,state,query);return undefined;}return query;
  }catch(error){state.timerErrors.push(String(error));return undefined;}
}
window.requestAnimationFrame=callback=>nativeRAF(timestamp=>{
  const pending=active;
  if(!pending){callback(timestamp);return;}
  const timers=[];
  for(const [gl,state]of contexts){const query=beginTimer(gl,state);if(query)timers.push({gl,state,query});}
  const start=performance.now();let callbackError;
  try {callback(timestamp);}catch(error){callbackError=error;}
  const callbackEnd=performance.now();
  for(const timer of timers){try{
    const renderError=timer.gl.getError();if(renderError!==0)pending.renderErrors.push(renderError);
    timer.gl.endQuery(timer.state.extension.TIME_ELAPSED_EXT);
    const error=timer.gl.getError();if(error!==0)timer.state.timerErrors.push('可选GPU查询结束失败：'+error);
  }catch(error){timer.state.timerErrors.push(String(error));}}
  if(!pending.contexts.size){for(const t of timers)releaseTimerQuery(t.gl,t.state,t.query);if(callbackError){active=undefined;clearTimeout(pending.timeout);pending.reject(callbackError);}return;}
  const syncStart=performance.now(),barriers=[];
  try {
    for(const gl of pending.contexts){
      const previous=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pixel=new Uint8Array(4);
      try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);}
      finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous);}
      const error=gl.getError();barriers.push({pixel:Array.from(pixel),error,contextLost:gl.isContextLost()});
    }
    const completed=performance.now(),frame={mutationMs:pending.mutationMs,callbackCpuMs:callbackEnd-start,syncWaitMs:completed-syncStart,
      workMs:completed-start,requestLatencyMs:completed-pending.requestedAt,activeWorkMs:pending.mutationMs+completed-start,
      uploadedBytes:totals().uploaded-pending.before.uploaded,drawCalls:totals().draws-pending.before.draws,barriers,renderErrors:pending.renderErrors,
      gpuTimer:{status:timers.length?'pending':'unavailable',elapsedMs:null}};
    pending.observedFrame=frame;
    for(const timer of timers)timer.state.queries.push({...timer,frame});
    if(callbackError)throw callbackError;
    ensure(pending.renderErrors.length===0&&barriers.every(b=>b.error===0&&!b.contextLost),'实际绘制上下文丢失、绘制错误或单像素同步读回失败');
    active=undefined;clearTimeout(pending.timeout);pending.resolve(frame);
  }catch(error){active=undefined;clearTimeout(pending.timeout);error.observedFrame=pending.observedFrame;pending.reject(error);}
});

function totals(){return [...contexts.values()].reduce((sum,s)=>({allocated:sum.allocated+s.allocated,peak:sum.peak+s.peak,uploaded:sum.uploaded+s.uploaded,draws:sum.draws+s.draws}),{allocated:0,peak:0,uploaded:0,draws:0});}
function measure(mutate) {
  ensure(!active,'上一帧尚未完成');
  return new Promise((resolve,reject)=>{
    const pending={resolve,reject,contexts:new Set(),renderErrors:[],requestedAt:performance.now(),before:totals(),mutationMs:0};active=pending;
    pending.timeout=setTimeout(()=>{if(active===pending)active=undefined;reject(new Error('120秒内没有完成实际绘制回调'));},120000);
    try{const start=performance.now();mutate();pending.mutationMs=performance.now()-start;}catch(error){active=undefined;clearTimeout(pending.timeout);reject(error);}
  });
}
async function drainTimers(){
  const deadline=performance.now()+2000;
  while(performance.now()<deadline){
    let pending=0;
    for(const [gl,state]of contexts)for(const item of state.queries){
      if(item.done)continue;
      try{
        if(gl.getParameter(state.extension.GPU_DISJOINT_EXT)){item.frame.gpuTimer={status:'disjoint',elapsedMs:null};item.done=true;}
        else if(gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE)){item.frame.gpuTimer={status:'available',elapsedMs:gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6};item.done=true;}
        else pending++;
      }catch(error){item.frame.gpuTimer={status:'unavailable',elapsedMs:null,reason:String(error)};item.done=true;}
      if(item.done)releaseTimerQuery(gl,state,item.query);
    }
    if(!pending)break;await sleep(10);
  }
  for(const [gl,state]of contexts)for(const item of state.queries)if(!item.done){item.frame.gpuTimer={status:'unavailable',elapsedMs:null,reason:'异步查询在两秒内未就绪'};releaseTimerQuery(gl,state,item.query);item.done=true;}
}
const api=await import('/dist/crychart.js');
let current;
function memory(dataSets){const heap=performance.memory;return{sourceOwnedBytes:dataSets.reduce((n,d)=>n+d.getStorageStats().denseTypedArrayBytes,0),
  sourceSnapshotBytes:dataSets.reduce((n,d)=>n+d.getStorageStats().snapshotBytes,0),trackedGLBufferBytes:totals().allocated,trackedGLBufferPeakBytes:totals().peak,
  sampledJSHeap:heap?{used:heap.usedJSHeapSize,total:heap.totalJSHeapSize,limit:heap.jsHeapSizeLimit}:null};}
function inputs(channels,first,count){return Array.from({length:channels},(_,channel)=>{const raw=Float64Array.from({length:count},(_,i)=>signal(channel,first+i));return{raw,render:raw.slice()};});}
function append(dataSets,batches,first,step){dataSets.forEach((data,i)=>data.appendSamples({raw:batches[i].raw,render:batches[i].render},{start:first*step,step}));}
function expectedX(index,batchSize,step){const batch=Math.floor(index/batchSize)*batchSize;return batch*step+(index-batch)*step;}
function sourceAudit(dataSets,next,capacity,batchSize,step){
  const first=next-capacity,details=[];
  for(let channel=0;channel<dataSets.length;channel++){
    const data=dataSets[channel],raw=data.getColumnRuns('raw'),render=data.getColumnRuns('render');
    ensure(raw.kind==='dense'&&render.kind==='dense','基准必须保留独立dense数值列');
    ensure(raw.slices.every(a=>render.slices.every(b=>a.buffer!==b.buffer)),'raw与render源存储必须是独立buffer');
    let compared=0;
    // 小块范围读回避免额外创建整份历史副本，并逐值核对全部保留列。
    for(let offset=0;offset<capacity;offset+=16384){
      const amount=Math.min(16384,capacity-offset),start=first+offset,end=start+amount-1;
      const back=data.readBack({onlyInRange:{key:'x',start:expectedX(start,batchSize,step),end:expectedX(end,batchSize,step)}});
      ensure(back.iSampleFirst===start&&back.data.raw.length===amount,'范围读回样本索引或数量不正确');
      ensure(back.data.raw.buffer!==back.data.render.buffer,'raw与render读回必须独立');
      for(let i=0;i<amount;i++){const index=start+i,value=signal(channel,index);ensure(Object.is(back.data.raw[i],value)&&Object.is(back.data.render[i],value),'原始数值列与独立确定性公式不符');ensure(Object.is(back.data.x[i],expectedX(index,batchSize,step)),'自动X批次浮点语义不符');}
      compared+=amount;
    }
    details.push({channel,comparedSamples:compared,count:data.getSampleCount(),next:data.getNextSampleIndex(),passed:true});
  }
  return details;
}

export async function runRound(config){
  const {channels,sampleRate,batchSize,historySeconds,warmupFrames,measureFrames}=config,capacity=sampleRate*historySeconds,step=1000/sampleRate;
  ensure(Number.isInteger(capacity)&&capacity%batchSize===0,'保留容量必须为整批');
  const dataSets=[],result={config,status:'running',firstFrame:null,warmup:[],frames:[],memory:[],errors:[],correctness:{}};
  current={dataSets};
  try{
    for(let i=0;i<channels;i++)dataSets.push(new api.DataSetXY({schema:{x:{storage:Float64Array,auto:true,pattern:'progressive'},raw:{storage:Float64Array},render:{storage:Float64Array}}}).setMaxSampleCount(capacity));
    const prefillStart=performance.now();
    for(let first=0;first<capacity;first+=batchSize){append(dataSets,inputs(channels,first,batchSize),first,step);if((first/batchSize)%16===15)await sleep(0);}
    result.prefill={elapsedMs:performance.now()-prefillStart,retainedSamples:channels*capacity,timingExcluded:true};
    const host=document.createElement('div');host.id='channels-chart';host.style.cssText='width:1000px;height:600px;background:#000';document.body.replaceChildren(host);
    const engine=api.cryChart();current.engine=engine;current.host=host;
    const chart=engine.ChartXY({container:host,renderer:'webgl2',legend:{visible:false}});current.chart=chart;
    chart.setTitle('').setPadding({left:100,right:100,top:90,bottom:90}).setAnimationsEnabled(false).setCursorMode(undefined).setMouseInteractionsEnabled(false);
    chart.getDefaultAxisY().dispose();const axisX=chart.getDefaultAxisX();
    axisX.setTickStrategy('Empty').setTitle('').setThickness(0).setStrokeStyle(api.emptyLine).setInterval({start:0,end:historySeconds*1000,stopAxisAfter:true});
    const axes=Array.from({length:channels},(_,i)=>chart.addAxisY({iStack:-i,iParallel:0}).setTickStrategy('Empty').setTitle('').setThickness(0).setStrokeStyle(api.emptyLine).setInterval({start:-1.25,end:1.25,stopAxisAfter:true}));
    const series=dataSets.map((data,i)=>chart.addLineSeries({axisY:axes[i],dataSet:data}).setDataMapping({x:'x',y:'render'}).setStrokeStyle(new api.SolidLine({thickness:2,fillStyle:new api.SolidFill({color:api.ColorRGBA(30+(i%4)*45,220-(i%3)*30,180)})})).setCursorEnabled(false));
    result.firstFrame=await measure(()=>chart.invalidate());
    result.firstFrameQualification='协作式历史预填后的首次图表绘制，不是冷启动采集首帧';
    const gl=[...contexts.keys()].find(value=>value.canvas===chart.canvas)??[...contexts.keys()][0];ensure(gl,'本负载需要实际WebGL2绘制');current.gl=gl;
    const extension=gl.getExtension('WEBGL_debug_renderer_info');
    result.environment={devicePixelRatio,plot:{...chart.plot},container:{width:host.clientWidth,height:host.clientHeight},physicalCanvas:{width:gl.canvas.width,height:gl.canvas.height},gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION)};
    const panes=series.map(s=>chart.getSeriesScreenRect(s));
    ensure(panes.length===channels&&panes.every(p=>Math.abs(p.height-chart.plot.height/channels)<.01),'独立Y分区高度不符');
    const sorted=panes.slice().sort((a,b)=>a.top-b.top);ensure(sorted.every((p,i)=>i===0||p.top>=sorted[i-1].top+sorted[i-1].height-.01),'Y分区发生重叠');
    result.panes=panes.map(({left,top,width,height})=>({left,top,width,height}));
    result.memory.push({phase:'filled',...memory(dataSets)});let next=capacity;
    for(let frame=0;frame<warmupFrames+measureFrames;frame++){
      const batches=inputs(channels,next,batchSize),first=next;next+=batchSize;
      const row=await measure(()=>{append(dataSets,batches,first,step);const end=expectedX(next-1,batchSize,step);axisX.setInterval({start:end-historySeconds*1000,end,stopAxisAfter:true});});
      row.index=frame-warmupFrames;row.retainedSamples=dataSets.reduce((n,d)=>n+d.getSampleCount(),0);row.nextSampleIndex=next;
      ensure(dataSets.every(d=>d.getSampleCount()===capacity&&d.getNextSampleIndex()===next),'追加或回绕丢失了原始样本');
      row.memory=memory(dataSets);(frame<warmupFrames?result.warmup:result.frames).push(row);
    }
    await drainTimers();
    const auditStart=performance.now();result.correctness.source=sourceAudit(dataSets,next,capacity,batchSize,step);result.correctness.auditMs=performance.now()-auditStart;
    result.correctness.auditTimingExcluded=true;
    const pixels=new Uint8Array(gl.canvas.width*gl.canvas.height*4),previous=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,gl.canvas.width,gl.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous);}
    let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>30)colored++;
    ensure(colored>100,'最终实际数据画布没有可见彩色曲线');result.correctness.coloredPixels=colored;
    result.correctness.rawAndRenderOwnedBytes=channels*capacity*16;
    ensure(memory(dataSets).sourceOwnedBytes===channels*capacity*16,'自有dense双F64源字节数不符');
    result.status='passed';
  }catch(error){result.status='failed';result.errors.push({message:error.message,stack:error.stack});if(error.observedFrame)result.failedFrame=error.observedFrame;}
  finally{
    if(active){clearTimeout(active.timeout);active=undefined;}
    result.timerCleanup=cleanupTimerQueries();
    try{current.engine?.dispose();}catch(error){result.status='failed';result.errors.push({message:'图表释放失败：'+error.message});}
    for(const data of dataSets)try{data.dispose();}catch(error){result.status='failed';result.errors.push({message:'数据释放失败：'+error.message});}
    result.disposed=memory(dataSets);result.timerDiagnostics=[...contexts.values()].flatMap(s=>s.timerErrors);
    if(result.disposed.sourceOwnedBytes!==0||result.disposed.trackedGLBufferBytes!==0){result.status='failed';result.errors.push({message:'销毁后仍有跟踪的源数组或GL buffer'});}
    current=undefined;
  }
  return result;
}
window.__CRY_CHANNEL_PERF__={runRound};
