// Browser-side original capacity fixture. It uses public data/chart operations;
// internal resource counters are diagnostic, not a performance acceptance oracle.
export async function setupCapacity(options){
  const api=await import('/library.js'),Type=options.storage==='f32'?Float32Array:Float64Array;
  const step=1000/options.rate,capacity=options.rate*options.retainedSeconds;
  const engine=api.cryChart(),chart=engine.ChartXY({container:document.getElementById('chart'),legend:{visible:false},experimentalLineDisplayPixels:1});
  chart.setTitle(`${options.channels} channels · ${options.retainedSeconds}s history · ${options.storage} ${options.layout??'stacked'} paged`).setAnimationsEnabled(false).setAutoCursorMode(api.AutoCursorModes.disabled).setUserInteractions(false);
  const sharedAxis=options.layout==='shared'?chart.axisY:undefined;
  if(!sharedAxis)chart.axisY.dispose();chart.axisX.setTitle('Time').setUnits('ms').setInterval({start:0,end:options.visibleSeconds*1000});
  const channels=[],colors=[[65,220,180],[255,195,60],[150,135,255],[255,120,160]];
  for(let id=0;id<options.channels;id++){
    const data=new api.DataSetXY({schema:{x:{storage:Float64Array,auto:true,pattern:'progressive'},rawY:{storage:Type},renderY:{storage:Type}},includesNaN:true,columnStorage:{mode:'paged',pageSize:options.pageSize}}).setMaxSampleCount(capacity);
    const axis=(sharedAxis??chart.addAxisY({iStack:-id,iParallel:0})).setInterval({start:-1,end:1}).setTitle('').setTickStrategy(api.AxisTickStrategies.Empty);
    const series=chart.addLineSeries({dataSet:data,axisY:axis}).setDataMapping({x:'x',y:'renderY'}).setName(`Channel ${id+1}`).setStrokeStyle(new api.SolidLine({thickness:1.25,fillStyle:new api.SolidFill({color:api.ColorRGBA(...colors[id%colors.length])})}));
    if(!sharedAxis)series.setCurvePreprocessing({type:'spline',resolution:0});channels.push({id,data,axis,series});
  }
  let next=0,disposed=false;
  const value=(absolute,id)=>{
    const position=absolute+id*97;
    if(position%131071===1234)return Infinity;
    if(position%65537===2222)return -Infinity;
    if(position%32771===7777)return NaN;
    return Math.sin(position*.015)*.72;
  };
  const settle=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  function totals(){
    const result={ownedNumericBytes:0,pagedUniqueBytes:0,pagedPoolBytes:0,pagedLogicalBytes:0,pagedPageReferences:0,snapshotBytes:0,denseTypedArrayBytes:0,pagedColumnCount:0,affineColumnCount:0,displaySummaryBytes:0,displaySelectionBytes:0,displayProjectionBytes:0,displayCachedSelectionBytes:0,displayCachedProjectionBytes:0,displayCachedTopologyBytes:0,submittedDisplaySamples:0};
    for(const item of channels){const storage=item.data.getStorageStats(),display=item.series.getLineDisplayStats?.();
      for(const name of ['ownedNumericBytes','pagedUniqueBytes','pagedPoolBytes','pagedLogicalBytes','pagedPageReferences','snapshotBytes','denseTypedArrayBytes','pagedColumnCount','affineColumnCount'])result[name]+=storage[name]??0;
      for(const [target,source] of [['displaySummaryBytes','summaryBytes'],['displaySelectionBytes','selectionBytes'],['displayProjectionBytes','projectionBytes'],['displayCachedSelectionBytes','cachedSelectionBytes'],['displayCachedProjectionBytes','cachedProjectionBytes'],['displayCachedTopologyBytes','cachedTopologyBytes'],['submittedDisplaySamples','submittedDisplaySamples']])result[target]+=display?.[source]??0;
    }
    return result;
  }
  const snapshot=()=>({nextSampleIndex:next,elapsedDataSeconds:next/options.rate,channels:channels.length,retainedPerChannel:channels[0]?.data.getSampleCount()??0,totalRetainedSamples:channels.reduce((n,c)=>n+c.data.getSampleCount(),0),totals:totals(),chartStats:chart.getRenderStats(),disposed});
  async function append(count){
    if(disposed)throw new Error('Capacity fixture disposed');
    const raw=new Type(count),render=new Type(count);
    for(const item of channels){
      for(let i=0;i<count;i++){const v=value(next+i,item.id);raw[i]=v;render[i]=Number.isFinite(v)?v:NaN;}
      item.data.appendSamples({rawY:raw,renderY:render},{start:next*step,step});
    }
    next+=count;const end=next*step;chart.axisX.setInterval({start:Math.max(0,end-options.visibleSeconds*1000),end:Math.max(options.visibleSeconds*1000,end),stopAxisAfter:true});
    chart.renderNow();await settle();
    const state=snapshot();document.getElementById('status').textContent=`${state.elapsedDataSeconds.toFixed(1)} s data / ${state.totalRetainedSamples.toLocaleString()} retained points / ${(state.totals.ownedNumericBytes/1048576).toFixed(1)} MiB numeric storage`;
    if(state.totals.pagedColumnCount!==channels.length*2||state.totals.affineColumnCount!==channels.length||state.totals.snapshotBytes!==0||state.totals.denseTypedArrayBytes!==0)throw new Error('Capacity run unexpectedly materialized a dense column');
    if(channels.some(c=>!c.series.getLineDisplayStats?.()))throw new Error('Capacity run fell back to full-history projection');
    return state;
  }
  function validateChannel(index){
    const {id,data}=channels[index],first=next-data.getSampleCount(),raw=data.getColumnRuns('rawY'),render=data.getColumnRuns('renderY'),x=data.getColumnRuns('x');
    if(raw.kind!=='paged'||render.kind!=='paged'||x.kind!=='affine')throw new Error('Unexpected column backend');
    let checked=0,nan=0,positiveInfinity=0,negativeInfinity=0;
    const width=raw.pageSize,end=first+raw.count;
    for(let pageIndex=Math.floor(first/width);pageIndex<=Math.floor((end-1)/width);pageIndex++){
      const a=raw.getPage(pageIndex),b=render.getPage(pageIndex),base=pageIndex*width;
      for(let absolute=Math.max(first,base),last=Math.min(end,base+width);absolute<last;absolute++){
        const source=value(absolute,id),expected=Type===Float32Array?Math.fround(source):source,expectedRender=Number.isFinite(expected)?expected:NaN,offset=absolute-base;
        if(!Object.is(a[offset],expected)||!Object.is(b[offset],expectedRender))throw new Error(`Raw/render mismatch at channel ${id}, sample ${absolute}`);
        checked++;if(Number.isNaN(source))nan++;else if(source===Infinity)positiveInfinity++;else if(source===-Infinity)negativeInfinity++;
      }
    }
    let affineSamples=0;
    for(let i=x.runStart;i<x.runs.length;i++){const run=x.runs[i];if(run.start!==run.firstIndex*step||run.step!==step)throw new Error('Affine source arithmetic changed');affineSamples+=Math.max(0,Math.min(end,run.firstIndex+run.count)-Math.max(first,run.firstIndex));}
    if(affineSamples!==checked)throw new Error('Affine retained coverage mismatch');
    return {id,firstIndex:first,count:checked,rawAndRenderExact:true,affineSamples,nan,positiveInfinity,negativeInfinity,snapshotBytes:data.getStorageStats().snapshotBytes};
  }
  function health(){
    chart.renderNow();const gl=chart.renderer.gl;if(!gl)throw new Error('Capacity fixture requires WebGL2');
    const canvas=gl.canvas,bytes=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    const scaleX=canvas.width/chart.width,scaleY=canvas.height/chart.height,regions=new Map();
    const panes=channels.map(item=>{const r=chart.getSeriesScreenRect(item.series),key=JSON.stringify(r);let colored=regions.get(key);if(colored===undefined){colored=0;for(let y=Math.max(0,Math.ceil(r.top*scaleY));y<Math.min(canvas.height,Math.floor((r.top+r.height)*scaleY));y++)for(let x=Math.max(0,Math.ceil(r.left*scaleX));x<Math.min(canvas.width,Math.floor((r.left+r.width)*scaleX));x++){const offset=((canvas.height-1-y)*canvas.width+x)*4;if(bytes[offset+3]>25&&Math.max(bytes[offset],bytes[offset+1],bytes[offset+2])-Math.min(bytes[offset],bytes[offset+1],bytes[offset+2])>20)colored++;}regions.set(key,colored);}return{id:item.id,colored};});
    return {contextLost:gl.isContextLost(),error:gl.getError(),panes,distinctRegions:regions.size,limitation:sharedAxis?'Shared-region pixels cannot demonstrate separate visibility of mutually occluding series.':undefined};
  }
  async function dispose(){
    if(disposed)return;disposed=true;engine.dispose();for(const item of channels)item.data.dispose();channels.length=0;await settle();
  }
  await settle();return {append,snapshot,validateChannel,health,dispose};
}
