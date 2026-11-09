// Original graphics-API observer. It never reads shader text, vertex data,
// chart internals or vendor implementation. Captures are not timings.
export function installLineGraphicsTrace(){
  const contexts=new WeakMap(),restores=[];let sequence=0,capture,raf;
  const clone=value=>Array.isArray(value)||ArrayBuffer.isView(value)?Array.from(value):value;
  const identity=(map,value)=>{if(value===null)return 0;if(!value)return null;let id=map.get(value);if(id===undefined){id=map.sequence=(map.sequence??0)+1;map.set(value,id);}return id;};
  const current=gl=>{
    let ctx=contexts.get(gl);if(ctx)return ctx;
    const has2=typeof gl.drawArraysInstanced==='function',get=key=>clone(gl.getParameter(key));
    ctx={id:++sequence,glVersion:has2?'webgl2':'webgl',attributes:gl.getContextAttributes(),defaultSamples:get(gl.SAMPLES),framebuffers:new WeakMap(),renderbuffers:new WeakMap(),textures:new WeakMap(),framebufferInfo:new Map(),renderbufferInfo:new Map(),textureInfo:new Map(),sampleCache:new Map(),boundRenderbuffer:0,
      state:{viewport:get(gl.VIEWPORT),scissor:get(gl.SCISSOR_BOX),scissorEnabled:gl.isEnabled(gl.SCISSOR_TEST),blendEnabled:gl.isEnabled(gl.BLEND),depthEnabled:gl.isEnabled(gl.DEPTH_TEST),sampleCoverageEnabled:gl.isEnabled(gl.SAMPLE_COVERAGE),sampleAlphaToCoverageEnabled:gl.isEnabled(gl.SAMPLE_ALPHA_TO_COVERAGE),sampleCoverageValue:get(gl.SAMPLE_COVERAGE_VALUE),sampleCoverageInvert:get(gl.SAMPLE_COVERAGE_INVERT),colorMask:get(gl.COLOR_WRITEMASK),blend:[get(gl.BLEND_SRC_RGB),get(gl.BLEND_DST_RGB),get(gl.BLEND_SRC_ALPHA),get(gl.BLEND_DST_ALPHA)],blendEquation:[get(gl.BLEND_EQUATION_RGB),get(gl.BLEND_EQUATION_ALPHA)],drawFramebuffer:0,readFramebuffer:0},
    };
    contexts.set(gl,ctx);return ctx;
  };
  const register=(gl,ctx)=>{
    if(!capture)return;
    if(!capture.contexts.has(ctx.id)){
      const element=gl.canvas,box=element.getBoundingClientRect?.()??{width:element.width,height:element.height,left:0,top:0};
      capture.contexts.set(ctx.id,{id:ctx.id,glVersion:ctx.glVersion,attributes:ctx.attributes,defaultSamples:ctx.defaultSamples,canvas:{width:element.width,height:element.height,drawingBufferWidth:gl.drawingBufferWidth,drawingBufferHeight:gl.drawingBufferHeight,cssWidth:box.width,cssHeight:box.height,left:box.left,top:box.top},framebuffers:[],renderbuffers:[],textures:[]});
    }
  };
  const event=(gl,ctx,type,extra={})=>{
    if(!capture)return;register(gl,ctx);
    if(capture.events.length>=100000){capture.truncated=true;return;}
    const s=ctx.state;
    capture.events.push({context:ctx.id,frame:capture.frame,type,...extra,viewport:[...s.viewport],scissor:[...s.scissor],scissorEnabled:s.scissorEnabled,blendEnabled:s.blendEnabled,blend:[...s.blend],blendEquation:[...s.blendEquation],colorMask:[...s.colorMask],depthEnabled:s.depthEnabled,sampleCoverageEnabled:s.sampleCoverageEnabled,sampleAlphaToCoverageEnabled:s.sampleAlphaToCoverageEnabled,sampleCoverageValue:s.sampleCoverageValue,sampleCoverageInvert:s.sampleCoverageInvert,framebuffer:s.drawFramebuffer,defaultFramebuffer:s.drawFramebuffer===0});
  };
  const wrap=(prototype,name,handler)=>{const original=prototype[name];if(typeof original!=='function')return;prototype[name]=function(...args){return handler.call(this,original,args);};restores.push(()=>prototype[name]=original);};
  const contextMethod=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,...args){const gl=Reflect.apply(contextMethod,this,[kind,...args]);if(gl&&['webgl','experimental-webgl','webgl2'].includes(kind)){const ctx=current(gl);register(gl,ctx);}return gl;};
  restores.push(()=>HTMLCanvasElement.prototype.getContext=contextMethod);
  for(const prototype of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
    for(const name of ['viewport','scissor','colorMask','blendFunc','blendFuncSeparate','blendEquation','blendEquationSeparate','sampleCoverage'])wrap(prototype,name,function(original,args){const result=Reflect.apply(original,this,args),ctx=current(this),s=ctx.state;
      // Actual GL integers include WebIDL conversion and implementation limits.
      // Query on state changes only; this instrumentation is never timed.
      if(name==='viewport'||name==='scissor')s[name]=clone(this.getParameter(name==='viewport'?this.VIEWPORT:this.SCISSOR_BOX));
      else if(name==='colorMask')s[name]=args.slice();
      else if(name==='blendFunc')s.blend=[args[0],args[1],args[0],args[1]];
      else if(name==='blendFuncSeparate')s.blend=args.slice();
      else if(name==='blendEquation')s.blendEquation=[args[0],args[0]];
      else if(name==='blendEquationSeparate')s.blendEquation=args.slice();
      else if(name==='sampleCoverage'){s.sampleCoverageValue=args[0];s.sampleCoverageInvert=args[1];}
      return result;});
    for(const name of ['enable','disable'])wrap(prototype,name,function(original,args){const result=Reflect.apply(original,this,args),s=current(this).state,key=args[0]===this.SCISSOR_TEST?'scissorEnabled':args[0]===this.BLEND?'blendEnabled':args[0]===this.DEPTH_TEST?'depthEnabled':args[0]===this.SAMPLE_COVERAGE?'sampleCoverageEnabled':args[0]===this.SAMPLE_ALPHA_TO_COVERAGE?'sampleAlphaToCoverageEnabled':undefined;if(key)s[key]=name==='enable';return result;});
    wrap(prototype,'bindFramebuffer',function(original,args){const result=Reflect.apply(original,this,args),ctx=current(this),id=identity(ctx.framebuffers,args[1]);
      if(args[0]===this.FRAMEBUFFER||args[0]===this.DRAW_FRAMEBUFFER)ctx.state.drawFramebuffer=id;
      if(args[0]===this.FRAMEBUFFER||args[0]===this.READ_FRAMEBUFFER)ctx.state.readFramebuffer=id;
      return result;});
    wrap(prototype,'bindRenderbuffer',function(original,args){const result=Reflect.apply(original,this,args),ctx=current(this);ctx.boundRenderbuffer=identity(ctx.renderbuffers,args[1]);return result;});
    for(const name of ['renderbufferStorage','renderbufferStorageMultisample'])wrap(prototype,name,function(original,args){const result=Reflect.apply(original,this,args),ctx=current(this),multi=name.endsWith('Multisample');ctx.renderbufferInfo.set(ctx.boundRenderbuffer,{id:ctx.boundRenderbuffer,format:args[multi?2:1],width:args[multi?3:2],height:args[multi?4:3],requestedSamples:multi?args[1]:0,actualSamples:multi?this.getRenderbufferParameter(this.RENDERBUFFER,this.RENDERBUFFER_SAMPLES):0});ctx.sampleCache.clear();return result;});
    wrap(prototype,'framebufferRenderbuffer',function(original,args){const result=Reflect.apply(original,this,args),ctx=current(this),id=args[0]===this.READ_FRAMEBUFFER?ctx.state.readFramebuffer:ctx.state.drawFramebuffer,info=ctx.framebufferInfo.get(id)??{id,attachments:{}};info.attachments[args[1]]={kind:'renderbuffer',id:identity(ctx.renderbuffers,args[3])};ctx.framebufferInfo.set(id,info);ctx.sampleCache.delete(id);return result;});
    wrap(prototype,'framebufferTexture2D',function(original,args){const result=Reflect.apply(original,this,args),ctx=current(this),id=args[0]===this.READ_FRAMEBUFFER?ctx.state.readFramebuffer:ctx.state.drawFramebuffer,info=ctx.framebufferInfo.get(id)??{id,attachments:{}};info.attachments[args[1]]={kind:'texture',id:identity(ctx.textures,args[3]),level:args[4]};ctx.framebufferInfo.set(id,info);ctx.sampleCache.delete(id);return result;});
    // One standard query for each framebuffer attachment configuration, not
    // per vertex, buffer contents, shader text, or private implementation state.
    const samples=(gl,ctx)=>{const id=ctx.state.drawFramebuffer;if(!ctx.sampleCache.has(id))ctx.sampleCache.set(id,gl.getParameter(gl.SAMPLES));return ctx.sampleCache.get(id);};
    for(const name of ['drawArrays','drawElements','drawRangeElements','drawArraysInstanced','drawElementsInstanced'])wrap(prototype,name,function(original,args){const ctx=current(this);if(capture)event(this,ctx,'draw',{method:name,args:args.slice(),samples:samples(this,ctx)});return Reflect.apply(original,this,args);});
    wrap(prototype,'blitFramebuffer',function(original,args){const ctx=current(this);event(this,ctx,'blit',{args:args.slice(),sourceFramebuffer:ctx.state.readFramebuffer});return Reflect.apply(original,this,args);});
    wrap(prototype,'clear',function(original,args){const ctx=current(this);event(this,ctx,'clear',{mask:args[0]});return Reflect.apply(original,this,args);});
  }
  return{
    begin(label){if(capture)throw new Error('End the prior graphics trace first');capture={label,frame:0,events:[],contexts:new Map(),truncated:false};const tick=()=>{if(!capture)return;capture.frame++;raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);},
    end(){if(!capture)return undefined;cancelAnimationFrame(raf);const result=capture;capture=undefined;
      // Context records contain only public graphics metadata; no live GL/chart
      // handles, sources or caller data are serialized into evidence.
      const glCanvases=[...document.querySelectorAll('canvas')];
      for(const canvas of glCanvases){const gl=Reflect.apply(contextMethod,canvas,['webgl2'])??Reflect.apply(contextMethod,canvas,['webgl']);if(!gl)continue;const ctx=contexts.get(gl),info=ctx&&result.contexts.get(ctx.id);if(!info)continue;info.framebuffers=[...ctx.framebufferInfo.values()];info.renderbuffers=[...ctx.renderbufferInfo.values()];info.observedFramebufferSamples=[...ctx.sampleCache].map(([framebuffer,samples])=>({framebuffer,samples}));const box=canvas.getBoundingClientRect();info.finalCanvas={width:canvas.width,height:canvas.height,drawingBufferWidth:gl.drawingBufferWidth,drawingBufferHeight:gl.drawingBufferHeight,cssWidth:box.width,cssHeight:box.height,left:box.left,top:box.top};info.finalState={viewport:clone(gl.getParameter(gl.VIEWPORT)),scissor:clone(gl.getParameter(gl.SCISSOR_BOX)),scissorEnabled:gl.isEnabled(gl.SCISSOR_TEST),framebufferIsDefault:gl.getParameter(gl.FRAMEBUFFER_BINDING)===null,contextLost:gl.isContextLost()};}
      const events=result.events,frames=[...new Set(events.map(item=>item.frame))],lastDrawFrame=Math.max(-1,...events.filter(item=>item.type==='draw'||item.type==='blit').map(item=>item.frame));
      return{label:result.label,scope:'Standard WebGL graphics API trace; distinct from public chart API observations; no shader text, vertex data or private chart state inspected.',contexts:[...result.contexts.values()],truncated:result.truncated,observedFrames:frames,lastDrawFrame,eventCount:events.length,frames:frames.map(frame=>({frame,draws:events.filter(item=>item.frame===frame&&item.type==='draw').length,blits:events.filter(item=>item.frame===frame&&item.type==='blit').length,defaultDraws:events.filter(item=>item.frame===frame&&item.type==='draw'&&item.defaultFramebuffer).length})),events};
    },
    uninstall(){if(capture)this.end();for(const restore of restores.reverse())restore();}
  };
}
