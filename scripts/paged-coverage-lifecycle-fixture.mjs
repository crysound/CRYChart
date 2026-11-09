// Independent original diagnostic. No vendor source, application execution,
// hidden renderer fallback, or complete-column materialization is used here.
const rate=48000,step=1000/rate,sampleCount=rate
const ensure=(condition,message)=>{if(!condition)throw new Error(message)}
const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))

function installResourceMeter(){
  const prototype=WebGL2RenderingContext.prototype,records=new WeakMap(),restores=[],events=[]
  let contextSequence=0
  const record=gl=>{let value=records.get(gl);if(!value){value={id:++contextSequence,buffers:new Map(),textures:new Map(),framebuffers:new Set(),arrays:new Set(),programs:new Set(),shaders:new Set(),created:{},deleted:{},unknownTextureFormats:[]};records.set(gl,value);for(const type of ['webglcontextlost','webglcontextrestored'])gl.canvas.addEventListener(type,()=>events.push({context:value.id,type,time:performance.now()}))}return value}
  const wrap=(name,handler)=>{const original=prototype[name];prototype[name]=function(...args){return handler.call(this,original,args)};restores.push(()=>{prototype[name]=original})}
  for(const [kind,create,remove]of [['buffers','createBuffer','deleteBuffer'],['textures','createTexture','deleteTexture'],['framebuffers','createFramebuffer','deleteFramebuffer'],['arrays','createVertexArray','deleteVertexArray'],['programs','createProgram','deleteProgram'],['shaders','createShader','deleteShader']]){
    wrap(create,function(original,args){const value=Reflect.apply(original,this,args);if(value){const entry=record(this);entry.created[kind]=(entry.created[kind]??0)+1;entry[kind] instanceof Map?entry[kind].set(value,0):entry[kind].add(value)}return value})
    wrap(remove,function(original,args){const result=Reflect.apply(original,this,args),entry=record(this);if(args[0]&&entry[kind].delete(args[0]))entry.deleted[kind]=(entry.deleted[kind]??0)+1;return result})
  }
  wrap('bufferData',function(original,args){const result=Reflect.apply(original,this,args),target=args[0],bindings=new Map([[this.ARRAY_BUFFER,this.ARRAY_BUFFER_BINDING],[this.ELEMENT_ARRAY_BUFFER,this.ELEMENT_ARRAY_BUFFER_BINDING],[this.COPY_READ_BUFFER,this.COPY_READ_BUFFER_BINDING],[this.COPY_WRITE_BUFFER,this.COPY_WRITE_BUFFER_BINDING],[this.PIXEL_PACK_BUFFER,this.PIXEL_PACK_BUFFER_BINDING],[this.PIXEL_UNPACK_BUFFER,this.PIXEL_UNPACK_BUFFER_BINDING],[this.TRANSFORM_FEEDBACK_BUFFER,this.TRANSFORM_FEEDBACK_BUFFER_BINDING],[this.UNIFORM_BUFFER,this.UNIFORM_BUFFER_BINDING]])
    const binding=bindings.get(target),buffer=binding===undefined?undefined:this.getParameter(binding);if(buffer)record(this).buffers.set(buffer,this.getBufferParameter(target,this.BUFFER_SIZE));return result})
  wrap('texStorage2D',function(original,args){const result=Reflect.apply(original,this,args),[target,levels,format,width,height]=args;if(target===this.TEXTURE_2D){const texture=this.getParameter(this.TEXTURE_BINDING_2D),entry=record(this),bytes=new Map([[this.R8,1],[this.RG8,2],[this.RGB8,3],[this.RGBA8,4],[this.R32F,4],[this.R32UI,4],[this.RG32F,8],[this.RGBA32F,16]]).get(format);if(bytes===undefined)entry.unknownTextureFormats.push(format);else if(texture){let amount=0;for(let level=0;level<levels;level++)amount+=Math.max(1,width>>level)*Math.max(1,height>>level)*bytes;entry.textures.set(texture,amount)}}return result})
  return{
    events,
    snapshot(gl){const entry=record(gl);return{context:entry.id,liveBuffers:entry.buffers.size,allocatedBufferBytes:[...entry.buffers.values()].reduce((n,v)=>n+v,0),liveTextures:entry.textures.size,allocatedTextureBytes:[...entry.textures.values()].reduce((n,v)=>n+v,0),liveFramebuffers:entry.framebuffers.size,liveVertexArrays:entry.arrays.size,livePrograms:entry.programs.size,liveShaders:entry.shaders.size,created:{...entry.created},deleted:{...entry.deleted},unknownTextureFormats:[...entry.unknownTextureFormats],contextLost:gl.isContextLost()}},
    uninstall(){for(const restore of restores.reverse())restore()},
  }
}

function sourceValue(index,channel,seed){
  if(index===1234+channel)return Infinity
  if(index===5678+channel)return -Infinity
  if(index===9012+channel)return NaN
  if(index===12000+channel)return -0
  if(index===32000&&channel===0)return 5
  if(index===33000&&channel===0)return -5
  return .68*Math.sin(index*.017+channel*.23+seed*.31)+.17*Math.cos(index*.091+channel*.11)
}
function fingerprint(words,state={hash:2166136261,secondary:0,count:0}){
  for(let index=0;index<words.length;index++){const word=words[index];state.hash=Math.imul(state.hash^word,16777619)>>>0;state.secondary=(state.secondary+Math.imul(word^0x9e3779b9,++state.count))>>>0}
  return state
}
const fingerprintText=state=>`${state.count}:${state.hash.toString(16)}:${state.secondary.toString(16)}`
function inputFingerprints(raw,render){return{raw:fingerprintText(fingerprint(new Uint32Array(raw.buffer,raw.byteOffset,raw.byteLength/4))),render:fingerprintText(fingerprint(new Uint32Array(render.buffer,render.byteOffset,render.byteLength/4)))}}

export async function createLifecycleFixture(){
  const meter=installResourceMeter(),api=await import('/library.js'),host=document.getElementById('chart'),status=document.getElementById('status')
  let engine,chart,channels=[],sharedAxis,configuration,seed=0,lastDisposal,lastChartDisposal
  const counts={createdCharts:0,disposedCharts:0,createdDataSets:0,disposedDataSets:0,createdSeries:0,disposedSeries:0}
  const describe=text=>{status.textContent=text}
  const active=()=>channels.filter(item=>item.series)
  const storage=()=>{
    const totals={sampleCount:0,ownedNumericBytes:0,pagedUniqueBytes:0,pagedPoolBytes:0,pagedLogicalBytes:0,snapshotBytes:0,denseTypedArrayBytes:0,pagedColumnCount:0,affineColumnCount:0,pagedPromotionCount:0}
    for(const item of channels){const value=item.data.getStorageStats();for(const key of Object.keys(totals))totals[key]+=value[key]??0}
    return totals
  }
  const coverage=()=>chart?.renderer?.lineStrip?.getCoverageStats?.()
  const snapshot=()=>({configuration,seed,channels:channels.length,activeChannels:active().length,totalSamples:channels.reduce((n,item)=>n+item.data.getSampleCount(),0),engineCharts:engine?.getChartCount?.()??0,canvasCount:host.querySelectorAll('canvas').length,storage:storage(),coverage:coverage(),gpu:chart?.renderer?.gl?meter.snapshot(chart.renderer.gl):lastChartDisposal?.gpu,counts:{...counts},contextEvents:[...meter.events],lastChartDisposal,lastDisposal})
  function bind(item){
    const axis=sharedAxis??chart.addAxisY({iStack:-item.id,iParallel:0})
    axis.setInterval({start:-5.25,end:5.25,stopAxisAfter:true}).setTickStrategy(api.AxisTickStrategies.Empty).setTitle('')
    const phase=item.id*2.399963229728653,color=api.ColorRGBA(145+100*Math.sin(phase),145+100*Math.sin(phase+2.1),145+100*Math.sin(phase+4.2),210)
    item.axis=axis;item.series=chart.addLineSeries({dataSet:item.data,axisY:axis}).setDataMapping({x:'xValues',y:'renderYValues'}).setName(`Channel ${item.id+1}`).setStrokeStyle(new api.SolidLine({thickness:1.25,fillStyle:new api.SolidFill({color})}));counts.createdSeries++
  }
  function unbind(item){if(!item.series)return;item.series.dispose();counts.disposedSeries++;item.series=undefined;if(item.axis!==sharedAxis)item.axis.dispose();item.axis=undefined}
  function fill(item){
    const Type=configuration.storage==='f32'?Float32Array:Float64Array,raw=new Type(sampleCount),render=new Type(sampleCount)
    for(let index=0;index<sampleCount;index++){raw[index]=sourceValue(index,item.id,seed);render[index]=Number.isFinite(raw[index])?raw[index]:NaN}
    item.expected=inputFingerprints(raw,render);item.data.appendSamples({yValues:raw,renderYValues:render},{start:0,step})
  }
  function checkStorage(){const totals=storage();ensure(totals.pagedColumnCount===channels.length*2&&totals.affineColumnCount===channels.length,'Expected paged raw/render and affine X columns');ensure(totals.snapshotBytes===0&&totals.denseTypedArrayBytes===0&&totals.pagedPromotionCount===0,'Rendering must not materialize a dense column');return totals}
  async function create(config){
    ensure(!chart&&channels.length===0,'Dispose the previous cycle before rebuilding')
    ensure(['f32','f64'].includes(config.storage)&&['shared','stacked'].includes(config.layout),'Unknown lifecycle scenario')
    configuration={storage:config.storage,layout:config.layout,iteration:config.iteration,rate,historySeconds:1,pageSize:256};seed=config.iteration*17
    engine=api.cryChart();chart=engine.ChartXY({container:host,renderer:'webgl2',legend:{visible:false,addEntriesAutomatically:false},experimentalLineCoverage:true,experimentalLineDisplayPixels:1})
    counts.createdCharts++;chart.setTitle(`128 channels · ${config.storage} ${config.layout} · paged + coverage`).setAnimationsEnabled(false).setUserInteractions(false).setAutoCursorMode(api.AutoCursorModes.disabled)
    chart.axisX.setTitle('Time').setUnits('ms').setInterval({start:0,end:1000,stopAxisAfter:true});sharedAxis=config.layout==='shared'?chart.axisY:undefined;if(!sharedAxis)chart.axisY.dispose()
    const Type=config.storage==='f32'?Float32Array:Float64Array
    for(let id=0;id<128;id++){
      const data=new api.DataSetXY({schema:{xValues:{storage:Float64Array,pattern:'progressive',auto:true},yValues:{storage:Type},renderYValues:{storage:Type}},includesNaN:true,columnStorage:{mode:'paged',pageSize:256}}).setMaxSampleCount(sampleCount)
      counts.createdDataSets++;const item={id,data};channels.push(item);fill(item);bind(item)
    }
    chart.renderNow();await settle();checkStorage();ensure(coverage()?.compositePasses===128,'Frozen candidate did not use the requested coverage renderer for every channel')
    describe(`Iteration ${config.iteration}: 128 ${config.storage} ${config.layout} channels; 6,144,000 retained source points`)
    return snapshot()
  }
  function audit(){
    const results=[],Type=configuration.storage==='f32'?Float32Array:Float64Array
    for(const item of channels){
      ensure(!item.data.isDisposed(),'External DataSet was disposed by a series or chart')
      const raw=item.data.getColumnRuns('yValues'),render=item.data.getColumnRuns('renderYValues'),x=item.data.getColumnRuns('xValues')
      ensure(raw.kind==='paged'&&render.kind==='paged'&&x.kind==='affine','Unexpected storage representation')
      ensure(raw.count===sampleCount&&raw.firstIndex===0&&item.data.getNextSampleIndex()===sampleCount,'Wrong retained count or sequence')
      const rawHash={hash:2166136261,secondary:0,count:0},renderHash={hash:2166136261,secondary:0,count:0};let checked=0
      for(let pageIndex=0;pageIndex<=Math.floor((sampleCount-1)/raw.pageSize);pageIndex++){
        const a=raw.getPage(pageIndex),b=render.getPage(pageIndex),base=pageIndex*raw.pageSize,length=Math.min(raw.pageSize,sampleCount-base)
        ensure(a&&b,'Missing retained numeric page')
        for(let offset=0;offset<length;offset++){const source=sourceValue(base+offset,item.id,seed),expected=Type===Float32Array?Math.fround(source):source,expectedRender=Number.isFinite(expected)?expected:NaN;ensure(Object.is(a[offset],expected)&&Object.is(b[offset],expectedRender),`Original raw/render value changed: channel ${item.id}, sample ${base+offset}`);checked++}
        fingerprint(new Uint32Array(a.buffer,a.byteOffset,length*a.BYTES_PER_ELEMENT/4),rawHash);fingerprint(new Uint32Array(b.buffer,b.byteOffset,length*b.BYTES_PER_ELEMENT/4),renderHash)
      }
      ensure(fingerprintText(rawHash)===item.expected.raw&&fingerprintText(renderHash)===item.expected.render,'Stored typed bytes differ from original typed input')
      const runs=x.runs.slice(x.runStart);ensure(runs.length===1&&runs[0].firstIndex===0&&runs[0].count===sampleCount&&runs[0].start===0&&runs[0].step===step,'Affine auto-X source expression changed')
      ensure(item.data.getValue('xValues',0)===0&&item.data.getValue('xValues',sampleCount-1)===(sampleCount-1)*step,'Auto-X endpoint mismatch')
      results.push({id:item.id,checked,rawHash:fingerprintText(rawHash),renderHash:fingerprintText(renderHash),affineCount:sampleCount})
    }
    checkStorage();return{passed:true,checkedSamples:results.reduce((n,row)=>n+row.checked,0),channels:results}
  }
  async function switchChannels(count){
    ensure(count===16||count===128,'Only the requested 128↔16 lifecycle switch is supported')
    for(const item of channels)item.id<count?!item.series&&bind(item):unbind(item)
    chart.renderNow();await settle();ensure(active().length===count,'Wrong active channel count after switch');ensure(channels.every(item=>!item.data.isDisposed()&&item.data.getSampleCount()===sampleCount),'Channel removal released external data')
    checkStorage();describe(`${count} active channels; all 128 external DataSets retain their original samples`);return snapshot()
  }
  async function sharedOwnership(){
    const item=channels[0],data=item.data,oldSeries=item.series
    ensure(oldSeries,'Sharing probe requires active channel zero')
    const shadow=chart.addLineSeries({dataSet:data,axisY:item.axis}).setDataMapping({x:'xValues',y:'yValues'}).setVisible(false);counts.createdSeries++
    oldSeries.dispose();counts.disposedSeries++;item.series=undefined;ensure(!data.isDisposed()&&shadow.getDataSet()===data,'Removing first shared series disposed its DataSet')
    shadow.dispose();counts.disposedSeries++;ensure(!data.isDisposed()&&data.getSampleCount()===sampleCount,'Last series binding disposed an externally owned DataSet')
    if(item.axis!==sharedAxis)item.axis.dispose();item.axis=undefined;bind(item)
    const first=chart.addLineSeries({axisY:item.axis}).setVisible(false).add([{x:0,y:1},{x:1,y:2}]),internal=first.getDataSet(),second=chart.addLineSeries({dataSet:internal,axisY:item.axis}).setVisible(false);counts.createdSeries+=2
    first.dispose();counts.disposedSeries++;ensure(!internal.isDisposed(),'Internally owned DataSet was released while still shared');second.dispose();counts.disposedSeries++;ensure(internal.isDisposed()&&internal.getStorageStats().ownedNumericBytes===0,'Last internal binding did not release owned numeric storage')
    chart.renderNow();await settle();return{externalSharedIdentity:true,externalLastUnbindRetained:true,internalLastUnbindReleased:true,state:snapshot()}
  }
  async function clear(){
    for(const item of channels)item.data.clear()
    chart.renderNow();await settle();const state=snapshot();ensure(state.totalSamples===0&&state.storage.pagedUniqueBytes===0,'Clear left retained numeric pages');ensure(state.coverage.residentBufferBytes===0,'Clear left position buffers in the coverage renderer');ensure(state.gpu.liveBuffers===0,'Clear left allocated GL position buffers')
    describe('All DataSets cleared; schemas/capacity retained; bounded page pools and reusable scratch are measured separately')
    return state
  }
  async function refill(){seed++;for(const item of channels)fill(item);chart.renderNow();await settle();checkStorage();return snapshot()}
  function health(){
    const gl=chart.renderer.gl,canvas=chart.canvas,pixels=new Uint8Array(canvas.width*canvas.height*4),regions=new Map()
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
    const scaleX=canvas.width/chart.width,scaleY=canvas.height/chart.height,panes=active().map(item=>{
      const r=chart.getSeriesScreenRect(item.series),key=JSON.stringify(r);let colored=regions.get(key)
      if(colored===undefined){colored=0;for(let y=Math.max(0,Math.ceil(r.top*scaleY));y<Math.min(canvas.height,Math.floor((r.top+r.height)*scaleY));y++)for(let x=Math.max(0,Math.ceil(r.left*scaleX));x<Math.min(canvas.width,Math.floor((r.left+r.width)*scaleX));x++){const at=((canvas.height-1-y)*canvas.width+x)*4;if(pixels[at+3]>25&&Math.max(pixels[at],pixels[at+1],pixels[at+2])-Math.min(pixels[at],pixels[at+1],pixels[at+2])>20)colored++}regions.set(key,colored)}
      return{id:item.id,colored}
    })
    const gpu=meter.snapshot(gl),declared=coverage(),accounting={trackedPositionBytes:gpu.allocatedBufferBytes,rendererPositionBytes:declared.residentBufferBytes,trackedTextureBytes:gpu.allocatedTextureBytes,rendererScratchBytes:declared.scratchBytes,unknownTextureFormats:gpu.unknownTextureFormats}
    ensure(gpu.liveBuffers>=active().length&&gpu.liveTextures>=1&&gpu.liveFramebuffers>=1,'Resource instrumentation did not observe expected live GL objects; no leak conclusion can be drawn')
    ensure(accounting.trackedPositionBytes===accounting.rendererPositionBytes&&accounting.trackedTextureBytes===accounting.rendererScratchBytes&&accounting.unknownTextureFormats.length===0,'Resource instrumentation and renderer accounting disagree; no leak conclusion can be drawn')
    const result={glError:gl.getError(),contextLost:gl.isContextLost(),panes,distinctRegions:regions.size,resourceAccounting:accounting,limitation:configuration.layout==='shared'?'One shared region does not prove separate visibility of mutually occluding curves.':undefined}
    ensure(result.glError===0&&!result.contextLost&&panes.every(pane=>pane.colored>0),'Invalid GL state, context loss, or blank expected pane');return result
  }
  async function disposeChartKeepData(){
    ensure(chart,'No chart to dispose');const gl=chart.renderer.gl,renderer=chart.renderer.lineStrip,alive=active().length
    chart.dispose();counts.disposedCharts++;counts.disposedSeries+=alive
    for(const item of channels){item.series=undefined;item.axis=undefined;ensure(!item.data.isDisposed()&&item.data.getSampleCount()===sampleCount,'Chart disposal destroyed externally owned data')}
    lastChartDisposal={gpu:meter.snapshot(gl),coverage:renderer.getCoverageStats(),retainedExternalDataSets:channels.length,retainedExternalSamples:channels.reduce((n,item)=>n+item.data.getSampleCount(),0)}
    const gpu=lastChartDisposal.gpu
    ensure([gpu.liveBuffers,gpu.allocatedBufferBytes,gpu.liveTextures,gpu.allocatedTextureBytes,gpu.liveFramebuffers,gpu.liveVertexArrays,gpu.livePrograms,gpu.liveShaders].every(value=>value===0),'Chart disposal left tracked GL objects or allocations')
    ensure(lastChartDisposal.coverage.scratchBytes===0&&lastChartDisposal.coverage.residentBufferBytes===0,'Coverage disposal left declared scratch or buffers')
    chart=undefined;sharedAxis=undefined;await settle();ensure(engine.getChartCount()===0&&host.querySelectorAll('canvas').length===0,'Chart ownership or DOM was retained');return snapshot()
  }
  async function disposeDataOwner(){
    ensure(!chart,'Dispose chart bindings before external data owner cleanup')
    for(const item of channels){item.data.dispose();counts.disposedDataSets++;ensure(item.data.getStorageStats().ownedNumericBytes===0,'Data owner disposal left typed-array storage')}
    channels=[];engine?.dispose();engine=undefined;lastDisposal={allDataDisposed:true,gpu:lastChartDisposal?.gpu,coverage:lastChartDisposal?.coverage};await settle();ensure(counts.createdCharts===counts.disposedCharts&&counts.createdDataSets===counts.disposedDataSets&&counts.createdSeries===counts.disposedSeries,'Lifecycle counters do not balance');return snapshot()
  }
  async function cleanup(){if(chart){chart.dispose();chart=undefined}for(const item of channels)if(!item.data.isDisposed())item.data.dispose();channels=[];engine?.dispose();engine=undefined;await settle()}
  return{create,snapshot,audit,switchChannels,sharedOwnership,clear,refill,health,disposeChartKeepData,disposeDataOwner,cleanup}
}
