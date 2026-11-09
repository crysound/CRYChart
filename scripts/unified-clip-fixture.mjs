// Original GPU clipping oracle. It inspects only our renderer and standard GL.
export async function run() {
  const [api,base]=await Promise.all([import('./candidate.js'),import('./baseline.js')]);
  const canvas=document.getElementById('plot'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,premultipliedAlpha:true});
  if(!gl)throw Error('WebGL2 unavailable');
  const checks=[],images={},rect={left:100,top:80,width:800,height:420},objects=[];
  window.__clipCheckpoint={checks,images};
  for(const type of ['Buffer','Texture','Framebuffer','Renderbuffer','Program','Shader','VertexArray']) {
    const original=gl['create'+type].bind(gl);gl['create'+type]=(...args)=>{const object=original(...args);if(object)objects.push({type,object});return object;};
  }
  const own=new api.DataRenderer(canvas,{lineCoverageUnion:true,gpuClipPolicy:'contained'}),old=new base.DataRenderer(canvas,{lineCoverageUnion:true});
  const legacy=new api.DataRenderer(canvas,{lineCoverageUnion:true}),strip=new api.DataRenderer(canvas,{gpuClipPolicy:'contained'});
  const heat=new api.DataRendererHeatmap(gl,canvas,{clipPolicy:'contained'}),oldHeat=new base.DataRendererHeatmap(gl,canvas),legacyHeat=new api.DataRendererHeatmap(gl,canvas);
  const target=(r=rect,w=canvas.width,h=canvas.height,framebuffer=null,dpr=1)=>api.rasterTargetForRect(framebuffer,w,h,r,dpr);
  const read=(w=canvas.width,h=canvas.height)=>{const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
  const same=(a,b)=>a.reduce((count,value,index)=>count+(value!==b[index]),0);
  const add=(id,passed,detail={})=>{checks.push({id,passed,...detail});document.getElementById('status').textContent=id;};
  let next=1;
  const line=(options={})=>{const id=next++;return{id,strokeGroup:id,revision:1,count:2,positions:new Float32Array([0,.5,1,.5]),dimensions:2,mode:'line',color:[1,1,1,1],thickness:64,pointSize:0,origin:{x:0,y:0,z:0},domain:{x:{start:0,end:1},y:{start:0,end:1}},monotonicX:true,strictlyMonotonicX:true,...options};};
  const grid=(options={})=>({id:next++,revision:1,values:new Float32Array([0]),columns:1,rows:1,extent:[0,1,0,1],intensityRange:{start:0,end:1},palette:new Uint8Array([255,255,255,255,255,255,255,255]),...options});
  const clip={left:110.2,top:100.3,width:200.6,height:22.4};
  const throughClip=(r=rect,c=clip)=>line({clipRect:c,positions:new Float32Array([-1,1-(c.top+c.height/2-r.top)/r.height,2,1-(c.top+c.height/2-r.top)/r.height])});
  const pointFill=(r=rect,c=clip)=>{const values=[];for(let y=c.top-8;y<=c.top+c.height+8;y+=4)for(let x=c.left-8;x<=c.left+c.width+8;x+=4)values.push((x-r.left)/r.width,1-(y-r.top)/r.height);return line({mode:'points',positions:new Float32Array(values),count:values.length/2,pointSize:12,pointShape:1,thickness:0,strictlyMonotonicX:false,monotonicX:false,clipRect:c});};
  const render=(renderer,packets,grids=[],frame=target(),heatmap=heat)=>{gl.bindFramebuffer(gl.FRAMEBUFFER,frame.framebuffer);gl.bindVertexArray(null);if(grids.length)heatmap.render(grids,rect,1,{rasterTarget:frame});renderer.render(packets,rect,1,{clear:!grids.length,rasterTarget:frame});return read(frame.width,frame.height);};
  const wholeClip=(data,frame,r,c)=>{const expected=api.containedRasterClip(r,c,frame);let outside=0,missing=0,colored=0;for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){const inside=expected&&x>=expected.x&&x<expected.x+expected.width&&y>=expected.y&&y<expected.y+expected.height,a=data[(y*frame.width+x)*4+3];if(a)colored++;if(inside&&a!==255)missing++;if(!inside&&a)outside++;}return{outside,missing,colored,expected};};
  const checkFill=(name,packets,grids=[],renderer=own)=>{const frame=target(),data=render(renderer,packets,grids,frame),detail=wholeClip(data,frame,rect,clip);add(name,detail.outside===0&&detail.missing===0&&detail.colored>0&&gl.getError()===0,detail);};
  checkFill('coverage-clip-pixels',[throughClip()]);
  checkFill('strip-clip-pixels',[throughClip()],[],strip);
  checkFill('general-point-clip-pixels',[pointFill()]);
  checkFill('general-dash-clip-pixels',[{...throughClip(),dashPattern:[10000,1]}]);
  checkFill('general-palette-clip-pixels',[{...throughClip(),colors:new Float32Array([1,1,1,1,1,1,1,1])}]);
  checkFill('heatmap-clip-pixels',[],[grid({clipRect:clip})]);
  images['same-physical-clip']=canvas.toDataURL();

  const curved=line({count:201,positions:Float32Array.from({length:402},(_,i)=>i%2?.5+.4*Math.sin(Math.floor(i/2)*.12):Math.floor(i/2)/200),thickness:3,color:[1,.2,.1,.5]});
  const mixed=[curved,line({mode:'points',strictlyMonotonicX:false,pointSize:17,positions:new Float32Array([.2,.3,.6,.7]),color:[.1,1,.3,.7]}),{...curved,id:next++,strokeGroup:next++,dashPattern:[9,5],color:[.2,.2,1,.7]},line({positions:new Float32Array([0,.8,1,.2]),thickness:4,colors:new Float32Array([1,0,0,1,0,0,1,1])})];
  const mixedGrid=grid({values:new Float32Array([0,NaN,.5,1]),columns:2,rows:2,intensityInterpolation:'bilinear',palette:new Uint8Array([0,0,255,80,255,0,0,80])});
  const baselinePixels=render(old,mixed,[mixedGrid],target(),oldHeat),legacyPixels=render(legacy,mixed,[mixedGrid],target(),legacyHeat);
  add('undefined-policy-preserves-legacy-full-rgba',same(baselinePixels,legacyPixels)===0&&gl.getError()===0,{differingBytes:same(baselinePixels,legacyPixels)});
  const sharedClip={left:100.2,top:80.3,width:799.4,height:419.3},mixedFrame=target();
  const candidatePixels=render(own,mixed.map(p=>({...p,clipRect:sharedClip})),[{...mixedGrid,clipRect:sharedClip}],mixedFrame),allowed=api.containedRasterClip(rect,sharedClip,mixedFrame);
  let outside=0,interiorDifference=0;for(let y=0;y<600;y++)for(let x=0;x<1000;x++){const inside=x>=allowed.x&&x<allowed.x+allowed.width&&y>=allowed.y&&y<allowed.y+allowed.height;for(let c=0;c<4;c++){const index=(y*1000+x)*4+c;if(inside)interiorDifference+=candidatePixels[index]!==baselinePixels[index];else outside+=candidatePixels[index]!==0;}}
  add('mixed-pipelines-preserve-interior-rgba-and-empty-exterior',outside===0&&interiorDifference===0&&gl.getError()===0,{outsideBytes:outside,interiorDifferingBytes:interiorDifference});images['mixed']=canvas.toDataURL();

  // Actual attachment dimensions differ from the canvas by hundreds of pixels.
  const framebuffer=gl.createFramebuffer(),texture=gl.createTexture(),small={left:-20,top:-10,width:400,height:300},smallClip={left:4.2,top:6.3,width:180.7,height:36.1};
  gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,320,240);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Custom FBO is incomplete');
  const custom=target(small,320,240,framebuffer);
  heat.render([grid({clipRect:smallClip})],small,1,{rasterTarget:custom});own.render([throughClip(small,smallClip),pointFill(small,smallClip)],small,1,{rasterTarget:custom,clear:false});
  const smallPixels=read(320,240),smallDetail=wholeClip(smallPixels,custom,small,smallClip);
  add('custom-fbo-size-and-mixed-state',smallDetail.outside===0&&smallDetail.missing===0&&gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)===framebuffer&&gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)===framebuffer&&gl.getError()===0,smallDetail);
  let mismatch='',before=read(320,240);try{own.render([throughClip(small,smallClip)],small,1,{rasterTarget:{...custom,framebuffer:null}});}catch(error){mismatch=error.message;}
  add('target-mismatch-fails-before-clear',!!mismatch&&same(before,read(320,240))===0&&gl.getError()===0,{error:mismatch});
  const bad=line({drawFirst:-1,drawCount:3,dashPattern:[2,2]});let thrown='';try{own.render([throughClip(small,smallClip),bad],small,1,{rasterTarget:custom});}catch(error){thrown=error.message;}
  add('exception-restores-custom-framebuffer',!!thrown&&gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)===framebuffer&&!gl.isEnabled(gl.SCISSOR_TEST)&&gl.getError()===0,{error:thrown});
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);

  // Retained float64 source coordinates define this oracle independently of the shader.
  const value=i=>i%997===0?1.2:i%991===0?-1.2:.7*Math.sin(i*.19),count=48000;
  const raw=Float64Array.from({length:count},(_,i)=>value(i)),positions=Float32Array.from({length:count*2},(_,i)=>i%2?raw[Math.floor(i/2)]:Math.floor(i/2));
  const spike=line({count,positions,domain:{x:{start:0,end:count-1},y:{start:-1.3,end:1.3}},thickness:2});
  const spikePixels=render(own,[spike]);let probes=0,missing=0,minAlpha=255;
  for(let i=2;i<count-2;i++)if(i%997===0||i%991===0){const x=Math.floor(100+i/(count-1)*800),y=Math.floor(100+(raw[i]+1.3)/2.6*420),alpha=spikePixels[(y*1000+x)*4+3];probes++;minAlpha=Math.min(minAlpha,alpha);if(alpha<253)missing++;}
  add('96-original-float64-spikes-covered',probes===96&&missing===0&&gl.getError()===0,{probes,missing,minAlpha,sourceUnchanged:raw.every((v,i)=>v===value(i))});images['96-spikes']=canvas.toDataURL();
  const gap=line({count:5,positions:new Float32Array([0,.5,.2,.5,.5,NaN,.8,.5,1,.5]),thickness:2});
  const gapPixels=render(own,[gap]);add('nan-gap-stays-empty',gapPixels[(310*1000+500)*4+3]===0&&gapPixels[(310*1000+180)*4+3]>250&&gl.getError()===0);images['nan-gap']=canvas.toDataURL();
  const translucent=line({thickness:16,color:[1,0,0,.5]}),overlap=render(own,[translucent,{...translucent,id:next++}]),center=(310*1000+500)*4;
  const shared=[...overlap.slice(center,center+4)];add('one-stroke-block-union-applies-alpha-once',shared.every((v,i)=>Math.abs(v-[128,0,0,128][i])<=1),{rgba:shared});
  const separate=render(own,[translucent,line({thickness:16,color:[0,1,0,.5]})]),rgba=[...separate.slice(center,center+4)];add('separate-strokes-compose-in-order',rgba.every((v,i)=>Math.abs(v-[64,128,0,192][i])<=1),{rgba});

  const dpr=1.0000000447034836,denseFrame=target(rect,1000,600,null,dpr),dense=[];let allowedRows=new Set();
  for(let i=0;i<128;i++){const pane={left:100,top:80+i*420/128,width:800,height:420/128};dense.push(throughClip(rect,pane));const c=api.containedRasterClip(rect,pane,denseFrame);if(c)for(let y=c.y;y<c.y+c.height;y++)allowedRows.add(y);}
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);own.render(dense,rect,dpr,{rasterTarget:denseFrame});const densePixels=read();let denseOutside=0,denseMissing=0;
  for(let y=0;y<600;y++)for(let x=0;x<1000;x++){const expected=allowedRows.has(y)&&x>=101&&x<900,alpha=densePixels[(y*1000+x)*4+3];if(expected&&alpha!==255)denseMissing++;if(!expected&&alpha)denseOutside++;}
  add('128-pane-contained-area-without-border-adjustment',allowedRows.size===292&&denseOutside===0&&denseMissing===0&&gl.getError()===0,{rows:allowedRows.size,outside:denseOutside,missing:denseMissing,knownReferenceDifferentChannels:[0,31,32,63,64,95,96,127]});images['128-panes']=canvas.toDataURL();
  const empty={left:100.1,top:80.1,width:.2,height:.2};heat.render([grid({clipRect:empty})],rect,1,{rasterTarget:target()});own.render([line({clipRect:empty}),pointFill(rect,empty)],rect,1,{clear:false,rasterTarget:target()});
  const emptyPixels=read();add('empty-resize-clears-old-pixels-and-does-not-expand',emptyPixels.every(v=>v===0)&&gl.getError()===0,{nonzeroBytes:emptyPixels.reduce((sum,v)=>sum+(v!==0),0)});

  const lose=gl.getExtension('WEBGL_lose_context');
  if(lose){
    const beforeRestore=render(own,[curved],[mixedGrid]);
    const event=type=>new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),4000);canvas.addEventListener(type,()=>{clearTimeout(timer);resolve(true);},{once:true});});
    const lost=event('webglcontextlost');lose.loseContext();if(!await lost)throw Error('Context loss event timed out');
    // Chrome may not allow restoration until the loss task has completed.
    await new Promise(resolve=>setTimeout(resolve,250));
    const restored=event('webglcontextrestored');lose.restoreContext();
    if(await restored){const afterRestore=render(own,[curved],[mixedGrid]);add('context-restoration-rebuilds-clipped-resources',same(beforeRestore,afterRestore)===0&&gl.getError()===0,{differingBytes:same(beforeRestore,afterRestore)});}
    else add('context-restoration-rebuilds-clipped-resources',false,{reason:'Real context restoration timed out after 4 seconds',lost:gl.isContextLost()});
  }else add('context-restoration-rebuilds-clipped-resources',false,{reason:'WEBGL_lose_context unavailable'});
  for(const renderer of [own,old,legacy,strip,heat,oldHeat,legacyHeat])renderer.dispose();
  const live=objects.filter(({type,object})=>gl['is'+type](object)),glError=gl.getError();
  add('gpu-objects-are-not-live-after-dispose',live.length===0&&glError===0,{liveTypes:live.map(x=>x.type),trackedObjects:objects.length,glError,limit:'Context-lost objects are verified with standard is*; this does not confuse automatic context release with missing delete calls.'});
  // Real public ChartXY bridge: heatmap and line receive the same stacked-axis clip.
  const context=api.cryChart(),chart=context.ChartXY({container:document.getElementById('chart'),experimentalLineCoverage:true,experimentalGpuClipPolicy:'contained',legend:{addEntriesAutomatically:false}});
  chart.getDefaultAxisY().dispose();const y0=chart.addAxisY({iStack:0}),y1=chart.addAxisY({iStack:1});
  for(const axis of [chart.getDefaultAxisX(),y0,y1])axis.setInterval({start:0,end:1});
  chart.addLineSeries({axisY:y0}).setStrokeStyle(new api.SolidLine({thickness:3,fillStyle:new api.SolidFill({color:api.ColorRGBA(255,40,40)})})).add([{x:0,y:0},{x:1,y:1}]);
  chart.addHeatmapGridSeries({axisY:y1,columns:2,rows:2}).setStart({x:-1,y:-1}).setStep({x:1.5,y:1.5}).invalidateIntensityValues([[0,1],[NaN,.5]]);
  chart.renderNow();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  const chartGL=chart.renderer.gl,chartPixels=new Uint8Array(chartGL.drawingBufferWidth*chartGL.drawingBufferHeight*4);chartGL.readPixels(0,0,chartGL.drawingBufferWidth,chartGL.drawingBufferHeight,chartGL.RGBA,chartGL.UNSIGNED_BYTE,chartPixels);
  const upper=chart.translateCoordinate({x:.5,y:.5},{x:chart.getDefaultAxisX(),y:y0},chart.coordsPixel),lower=chart.translateCoordinate({x:.5,y:.5},{x:chart.getDefaultAxisX(),y:y1},chart.coordsPixel);
  const nativeAlpha=axis=>{const point=chart.translateCoordinate({x:.8,y:.2},{x:chart.getDefaultAxisX(),y:axis},chart.coordsPixel),x=Math.floor(point.x*devicePixelRatio),y=chartGL.drawingBufferHeight-1-Math.floor(point.y*devicePixelRatio);return chartPixels[(y*chartGL.drawingBufferWidth+x)*4+3];};
  const linePaneAlpha=nativeAlpha(y0),heatPaneAlpha=nativeAlpha(y1);
  add('actual-chartxy-heatmap-stack-bridge',chartPixels.some((v,i)=>i%4===3&&v>0)&&upper.y!==lower.y&&linePaneAlpha===0&&heatPaneAlpha>250&&chartGL.getError()===0,{upper,lower,linePaneAlpha,heatPaneAlpha,canvasSize:[chartGL.drawingBufferWidth,chartGL.drawingBufferHeight],scope:'The grid extends outside its axis interval: a finite cell renders in its own pane and does not leak into the adjacent line pane. Not whole-image reference equivalence.'});images['actual-chartxy']=chartGL.canvas.toDataURL();context.dispose();
  return{checks,images,environment:{dpr:devicePixelRatio,attributes:gl.getContextAttributes()},scope:'Original GPU clipping correctness. No vendor implementation or performance claim.'};
}
