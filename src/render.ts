import {pointShapeVertices,pointStrokeJoin,pointStrokeMiterLimit,pointStrokeExtentGLSL} from './point-stroke-geometry.js';
import type { DrawPacket, Rect } from "./contracts.js";
import { dashDistances } from "./stroke-geometry.js";
import { visibleSampleRange } from './viewport.js';
import {LineStripRenderer} from './render-line-strip.js';
import {containedRasterClip, requireRasterTarget, type GpuClipPolicy, type RasterTarget} from './raster-clip.js';
import {Icon} from './custom-icon.js';

// A separate, lazily compiled program keeps bitmap samplers out of ordinary
// vector draws (which need no bound texture).
const iconVertex=`#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in float a_size;
layout(location=2) in float a_rotation;
uniform vec4 u_domain;uniform float u_size;uniform float u_rotation;uniform float u_dpr;
uniform bool u_hasSizes;uniform bool u_hasRotations;
out float v_valid;out float v_extent;out float v_rotation;
void main(){
  float size=u_hasSizes?a_size*u_dpr:u_size;
  v_rotation=u_hasRotations?a_rotation*0.0174532925199:u_rotation;
  v_valid=any(isnan(a_position))||any(isinf(a_position))||size<=0.?0.:1.;
  gl_Position=v_valid>.5?vec4((a_position-u_domain.xy)/u_domain.zw*2.-1.,0.,1.):vec4(2.,2.,2.,1.);
  gl_PointSize=size*(abs(cos(v_rotation))+abs(sin(v_rotation)))+2.;
  v_extent=gl_PointSize/max(size,.0001);
}`;
const iconFragment=`#version 300 es
precision highp float;
uniform sampler2D u_image;uniform vec2 u_ratio;
in float v_valid;in float v_extent;in float v_rotation;out vec4 color;
void main(){
  if(v_valid<.5)discard;
  vec2 p=vec2(gl_PointCoord.x*2.-1.,1.-gl_PointCoord.y*2.)*v_extent;
  float c=cos(v_rotation),s=sin(v_rotation);p=mat2(c,s,-s,c)*p;
  vec2 uv=vec2(p.x/u_ratio.x*.5+.5,.5-p.y/u_ratio.y*.5);
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))discard;
  color=texture(u_image,uv);if(color.a<=0.)discard;
}`;

const vertex = `#version 300 es
precision highp float;
precision highp int;
${pointStrokeExtentGLSL}
in vec2 a_start; in vec2 a_end;in vec2 a_dash;in vec2 a_previous;in vec2 a_next;
in vec4 a_colorStart;in vec4 a_colorEnd;in float a_pointSize;in float a_pointRotation;
uniform vec4 u_domain; uniform vec2 u_size; uniform float u_width; uniform float u_pointSize; uniform float u_pointStrokeWidth; uniform float u_pointStrokeEnabled;
uniform int u_points;uniform int u_shape;uniform bool u_hasColors;uniform bool u_hasSizes;uniform bool u_hasRotations;uniform float u_dpr;uniform float u_rotation;uniform vec4 u_color;out vec4 v_color;out float v_rotation;out float v_valid;out float v_distance;out float v_pointSize;out float v_pointExtent;flat out float v_pointStrokeEnabled;
flat out vec2 v_lineStart;flat out vec2 v_lineEnd;flat out vec2 v_dashPhase;flat out vec4 v_lineColorStart;flat out vec4 v_lineColorEnd;
vec2 project(vec2 p){return (p-u_domain.xy)/u_domain.zw*2.0-1.0;}
void main(){
  v_valid=any(isnan(a_start))||any(isinf(a_start))?0.0:1.0;
  vec2 p=project(a_start);
  v_distance=0.0;
  v_color=u_hasColors?a_colorStart:u_color;v_rotation=u_hasRotations?a_pointRotation*0.0174532925199:u_rotation;
  v_lineStart=vec2(0.);v_lineEnd=vec2(0.);v_dashPhase=a_dash;v_lineColorStart=v_color;v_lineColorEnd=u_hasColors?a_colorEnd:u_color;
  if(u_points==0){
    if(any(isnan(a_end))||any(isinf(a_end))) v_valid=0.0;
    vec2 q=project(a_end);vec2 delta=(q-p)*u_size;float len=length(delta);
    if(len<=0.00001)v_valid=0.0;
    vec2 normal=len>0.00001?vec2(-delta.y,delta.x)/len:vec2(0.0,1.0);
    vec2 tangent=len>0.00001?delta/len:vec2(1.,0.);
    int i=gl_VertexID;float side=i<2?-1.0:1.0;bool ending=i%2==1;
    vec2 neighbor=ending?a_next:a_previous;
    vec2 adjacent=(ending?project(neighbor)-q:p-project(neighbor))*u_size;
    bool hasNeighbor=!any(isnan(neighbor))&&!any(isinf(neighbor))&&length(adjacent)>0.00001;
    vec2 adjacentNormal=hasNeighbor?vec2(-adjacent.y,adjacent.x)/length(adjacent):normal;
    vec2 sum=normal+adjacentNormal;
    vec2 miter=length(sum)>.00001?normalize(sum):normal;
    miter/=max(.25,dot(miter,normal));
    v_lineStart=(p+1.)*.5*u_size;v_lineEnd=(q+1.)*.5*u_size;
    v_distance=ending?a_dash.y:a_dash.x;
    if(u_hasColors)v_color=ending?a_colorEnd:a_colorStart;
    vec2 edge=miter*side;
    if(!hasNeighbor)edge+=tangent*(ending?1.:-1.);
    p=(ending?q:p)+edge*(u_width+2.)/u_size;
  }
  gl_Position=v_valid>0.5?vec4(p,0.0,1.0):vec4(2.0,2.0,2.0,1.0);
  if(u_points==1){
    v_pointSize=u_hasSizes?max(0.0,a_pointSize*u_dpr):u_pointSize;
    v_pointStrokeEnabled=u_hasSizes?(a_pointSize>1.0?1.0:0.0):u_pointStrokeEnabled;
    float pointCos=abs(cos(v_rotation)),pointSin=abs(sin(v_rotation));
    float pointExtent=pointCos+pointSin;
    if(u_shape==2){
      // Equilateral triangle: altitude = point size, centroid at the source.
      // The furthest rotated vertex determines the centered sprite bounds.
      float base=2.0/sqrt(3.0),oneThird=2.0/3.0;
      pointExtent=max((4.0/3.0)*max(pointCos,pointSin),max(base*pointCos+oneThird*pointSin,base*pointSin+oneThird*pointCos));
    }
    gl_PointSize=v_pointSize*pointExtent+2.0*ceil(pointStrokeExtent(u_shape)*(v_pointStrokeEnabled>.5?max(0.0,u_pointStrokeWidth):0.0))+2.0;
    v_pointExtent=gl_PointSize/max(v_pointSize,0.0001);
    if(v_pointSize<=0.0)v_valid=0.0;
  }else{gl_PointSize=1.;v_pointSize=0.;v_pointExtent=1.;v_pointStrokeEnabled=0.;}
}`;
const fragment = `#version 300 es
precision highp float;precision highp int;uniform int u_points;uniform int u_shape;uniform int u_pointPass;uniform int u_dashCount;uniform float u_dash[16];uniform float u_dashPeriod;uniform vec4 u_pointStrokeColor;uniform float u_pointStrokeWidth;in float v_valid;in float v_distance;in vec4 v_color;in float v_rotation;in float v_pointSize;in float v_pointExtent;flat in float v_pointStrokeEnabled;out vec4 color;
uniform vec2 u_plotOrigin;uniform float u_width;flat in vec2 v_lineStart;flat in vec2 v_lineEnd;flat in vec2 v_dashPhase;flat in vec4 v_lineColorStart;flat in vec4 v_lineColorEnd;
float shapeDistance(vec2 p){
 vec2 a=abs(p);float box=max(a.x,a.y)-1.;
 if(u_shape==0)return box;
 if(u_shape==1)return length(p)-1.;
 if(u_shape==2)return max(p.y-2.0/3.0,(sqrt(3.0)*a.x-p.y-4.0/3.0)*.5);
 if(u_shape==3)return max(box,(abs(a.x-a.y)-.28)/sqrt(2.));
 if(u_shape==4)return (a.x+a.y-1.)/sqrt(2.);
 if(u_shape==5)return max(box,min(a.x,a.y)-.24);
 if(u_shape==6)return max(a.x-1.,a.y-.22);
 if(u_shape==7)return min(max(-p.y,(a.x+p.y-1.)/sqrt(2.)),max(max(a.x-.24,-1.-p.y),p.y-.1));
 bool inside=false;vec2 previous=vec2(0.0,1.0);float distanceSquared=1e10;
 for(int i=1;i<=10;i++){float angle=1.57079632679+float(i)*0.628318530718;float radius=i%2==0?1.0:.42;vec2 next=radius*vec2(cos(angle),sin(angle));vec2 edge=next-previous;vec2 nearest=p-previous-edge*clamp(dot(p-previous,edge)/dot(edge,edge),0.,1.);distanceSquared=min(distanceSquared,dot(nearest,nearest));if((previous.y>p.y)!=(next.y>p.y)){float crossing=edge.x*(p.y-previous.y)/edge.y+previous.x;if(p.x<crossing)inside=!inside;}previous=next;}
 return sqrt(distanceSquared)*(inside?-1.:1.);
}
float shapeCoverage(vec2 p,float diameter){
 return clamp(.5-shapeDistance(p)*diameter*.5,0.,1.);
}
void main(){
 if(v_valid<0.5)discard;color=v_color;
 if(u_points==1){
  vec2 p=vec2(gl_PointCoord.x*2.0-1.0,1.0-gl_PointCoord.y*2.0)*v_pointExtent;float c=cos(v_rotation),s=sin(v_rotation);p=mat2(c,s,-s,c)*p;
  float strokeWidth=v_pointStrokeEnabled>.5?max(0.0,u_pointStrokeWidth):0.0;
  float inside=shapeCoverage(p,v_pointSize);
  float coverage=clamp(.5-shapeDistance(p)*v_pointSize*.5+strokeWidth,0.,1.);
  if(u_shape==7){
    // The stem top overlaps the arrow head; it is not an outside edge.
    // Expand the actual head/stem boundary, not that internal seam.
    float radius=v_pointSize*.5;
    float head=clamp(.5-max(-p.y,(abs(p.x)+p.y-1.)/sqrt(2.))*radius+strokeWidth,0.,1.);
    float stem=clamp(.5-max(abs(p.x)-.24,-1.-p.y)*radius+strokeWidth,0.,1.);
    float overlap=clamp(.5-(p.y-.1)*radius,0.,1.);
    coverage=max(head,min(stem,overlap));
  }
  if(coverage<=0.)discard;
  if(u_pointPass==1){
    // All strokes are below all fills in this series. Preserve the single
    // point's coverage when its own fill is composited in the later pass.
    float fillAlpha=color.a*inside,strokeAlpha=u_pointStrokeColor.a*(coverage-inside);
    float layerAlpha=fillAlpha<1.?clamp(strokeAlpha/(1.-fillAlpha),0.,1.):0.;
    if(layerAlpha<=0.)discard;color=vec4(u_pointStrokeColor.rgb,layerAlpha);
  }else{if(inside<=0.)discard;color.a*=inside;}
 }else{
  vec2 pixel=gl_FragCoord.xy-u_plotOrigin,delta=v_lineEnd-v_lineStart;float squared=dot(delta,delta);
  float rawT=squared>0.000001?dot(pixel-v_lineStart,delta)/squared:0.,t=clamp(rawT,0.,1.);
  float distance=length(pixel-mix(v_lineStart,v_lineEnd,t)),coverage=clamp(u_width*.5+.5-distance,0.,1.);
  if(coverage<=0.)discard;
  color=mix(v_lineColorStart,v_lineColorEnd,t);color.a*=coverage;
  if(u_dashCount>0){float phase=mod(mix(v_dashPhase.x,v_dashPhase.y,rawT),u_dashPeriod);for(int i=0;i<16;i++){if(i>=u_dashCount)break;if(phase<u_dash[i]){if(i%2==1)discard;break;}phase-=u_dash[i];}}
 }
}`;
type BufferEntry = {
  buffer: WebGLBuffer;
  revision: number;
  bytes: number;
  dashBuffer?: WebGLBuffer;
  dashKey?: string;
};
export class DataRenderer {
  readonly backend: "webgl2" | "canvas2d";
  readonly gl: WebGL2RenderingContext | null;
  private ctx: CanvasRenderingContext2D | null = null;
  private program?: WebGLProgram;
  private lineStrip?:LineStripRenderer;
  private readonly lineCoverageUnion:boolean;
  private readonly lineCoverageStateScope:'draw'|'frame';
  private readonly ownedCoverageFrame:boolean;
  readonly ownedFrameAdmission={enabled:false,reason:'disabled'};
  private readonly gpuClipPolicy:GpuClipPolicy;
  private buffers = new Map<number, BufferEntry>();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private attrStart = 0;
  private attrEnd = 1;
  private attrDash = 2;
  private attrPrevious=7;private attrNext=8;
  private attrColorStart = 3;
  private attrColorEnd = 4;
  private attrSize = 5;
  private attrRotation = 6;
  private attributeBuffers = new Map<
    string,
    { buffer: WebGLBuffer; source: Float32Array; revision: number }
  >();
  private lost = false;
  private iconPipeline?:{program:WebGLProgram;vao:WebGLVertexArrayObject;uniforms:Record<string,WebGLUniformLocation|null>};
  private readonly iconTextures=new Map<Icon,{texture:WebGLTexture;unsubscribe:()=>void}>();
  readonly stats = {
    frames: 0,
    uploads: 0,
    uploadedBytes: 0,
    drawCalls: 0,
    vertices: 0,
    submittedSamples: 0,
    renderTimeMs: 0,
  };
  constructor(readonly canvas: HTMLCanvasElement, options: { antialias?: boolean;renderer?:'auto'|'webgl2'|'canvas2d';lineCoverageUnion?:boolean;lineCoverageStateScope?:'draw'|'frame';ownedCoverageFrame?:boolean;gpuClipPolicy?:GpuClipPolicy } = {}) {
    this.lineCoverageUnion=options.lineCoverageUnion===true;
    this.lineCoverageStateScope=options.lineCoverageStateScope??'frame';
    this.ownedCoverageFrame=options.ownedCoverageFrame===true;
    this.gpuClipPolicy=options.gpuClipPolicy??'legacy';
    let gl: WebGL2RenderingContext | null = null;
    try {
      if(options.renderer!=='canvas2d')gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: options.antialias ?? false,
        preserveDrawingBuffer: true,
        premultipliedAlpha: true,
      });
    } catch {}
    if(options.renderer==='webgl2'&&!gl)throw new Error('CRYChart WebGL2 renderer is unavailable');
    this.gl = gl;
    this.backend = gl ? "webgl2" : "canvas2d";
    if (gl) {
      this.init(gl);
      canvas.addEventListener("webglcontextlost", this.onLost);
      canvas.addEventListener("webglcontextrestored", this.onRestore);
    } else
      try {
        this.ctx = canvas.getContext("2d");
      } catch {}
  }
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.clearIcons(false);
  };
  private clearIcons(remove:boolean):void {
    const gl=this.gl;
    for(const entry of this.iconTextures.values()){entry.unsubscribe();if(remove&&gl)gl.deleteTexture(entry.texture);}
    this.iconTextures.clear();
    if(remove&&gl&&this.iconPipeline){gl.deleteVertexArray(this.iconPipeline.vao);gl.deleteProgram(this.iconPipeline.program);}
    this.iconPipeline=undefined;
  }
  private getIconPipeline(gl:WebGL2RenderingContext){
    if(this.iconPipeline)return this.iconPipeline;
    const shaders:WebGLShader[]=[];let program:WebGLProgram|undefined,vao:WebGLVertexArrayObject|undefined;
    try{
      program=gl.createProgram()??undefined;if(!program)throw new Error('Cannot allocate icon program');
      for(const [type,source] of [[gl.VERTEX_SHADER,iconVertex],[gl.FRAGMENT_SHADER,iconFragment]] as const){
        const shader=gl.createShader(type);if(!shader)throw new Error('Cannot allocate icon shader');shaders.push(shader);
        gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)??'Icon shader compilation failed');gl.attachShader(program,shader);
      }
      gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)??'Icon link failed');
      vao=gl.createVertexArray()??undefined;if(!vao)throw new Error('Cannot allocate icon vertex array');
      const uniforms:Record<string,WebGLUniformLocation|null>={};for(const name of ['domain','size','rotation','dpr','hasSizes','hasRotations','image','ratio'])uniforms[name]=gl.getUniformLocation(program,`u_${name}`);
      return this.iconPipeline={program,vao,uniforms};
    }catch(error){if(vao)gl.deleteVertexArray(vao);if(program)gl.deleteProgram(program);throw error;}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  private drawIconGPU(p:DrawPacket,buffer:WebGLBuffer,first:number,count:number,dpr:number,liveAttributes:Set<string>):void {
    const gl=this.gl!,icon=p.pointIcon!,source=icon.getSource();if(!source)return;
    const pipeline=this.getIconPipeline(gl),size=icon.getRasterSize(),max=Math.max(size.width,size.height);
    const oldProgram=gl.getParameter(gl.CURRENT_PROGRAM),oldVAO=gl.getParameter(gl.VERTEX_ARRAY_BINDING),oldBuffer=gl.getParameter(gl.ARRAY_BUFFER_BINDING),oldActive=gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);const oldTexture=gl.getParameter(gl.TEXTURE_BINDING_2D),oldSampler=gl.getParameter(gl.SAMPLER_BINDING);
    gl.bindSampler(0,null);
    try{
      let entry=this.iconTextures.get(icon);
      if(!entry){
        const texture=gl.createTexture();if(!texture)throw new Error('Cannot allocate custom icon texture');
        const flip=gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),premultiply=gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),alignment=gl.getParameter(gl.UNPACK_ALIGNMENT),unpackBuffer=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
        const unpackParameters=[gl.UNPACK_ROW_LENGTH,gl.UNPACK_SKIP_ROWS,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_IMAGE_HEIGHT,gl.UNPACK_SKIP_IMAGES];
        const unpackValues=unpackParameters.map(key=>gl.getParameter(key));
        try{
          gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);for(const key of unpackParameters)gl.pixelStorei(key,0);
          gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
        }catch(error){gl.deleteTexture(texture);throw error;}
        finally{gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flip);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);gl.pixelStorei(gl.UNPACK_ALIGNMENT,alignment);unpackParameters.forEach((key,index)=>gl.pixelStorei(key,unpackValues[index]));gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpackBuffer);}
        const unsubscribe=icon.onDispose(()=>{gl.deleteTexture(texture);this.iconTextures.delete(icon);});entry={texture,unsubscribe};this.iconTextures.set(icon,entry);
        this.stats.uploads++;const sourceDimensions=source as {width?:number;height?:number};this.stats.uploadedBytes+=(sourceDimensions.width??size.width)*(sourceDimensions.height??size.height)*4;
      }
      gl.bindTexture(gl.TEXTURE_2D,entry.texture);gl.useProgram(pipeline.program);gl.bindVertexArray(pipeline.vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,8+first*8);
      const u=pipeline.uniforms;
      const attribute=(name:string,location:number,values:Float32Array|undefined)=>{
        gl.uniform1i(u[name]!,values?1:0);
        if(!values){gl.disableVertexAttribArray(location);return;}
        const key=`${p.id}:icon-${name}`;liveAttributes.add(key);let item=this.attributeBuffers.get(key);
        if(!item){const target=gl.createBuffer();if(!target)throw new Error('Cannot allocate icon attributes');item={buffer:target,source:values,revision:-1};this.attributeBuffers.set(key,item);}
        gl.bindBuffer(gl.ARRAY_BUFFER,item.buffer);if(item.revision!==p.revision||item.source!==values){gl.bufferData(gl.ARRAY_BUFFER,values,gl.DYNAMIC_DRAW);item.revision=p.revision;item.source=values;this.stats.uploads++;this.stats.uploadedBytes+=values.byteLength;}
        gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,1,gl.FLOAT,false,4,first*4);
      };
      attribute('hasSizes',1,p.pointSizes);attribute('hasRotations',2,p.pointRotations);
      gl.uniform4f(u.domain!,p.domain.x.start-p.origin.x,p.domain.y.start-p.origin.y,p.domain.x.end-p.domain.x.start,p.domain.y.end-p.domain.y.start);
      gl.uniform1f(u.size!,p.pointSize*dpr);gl.uniform1f(u.rotation!,(p.pointRotation??0)*Math.PI/180);gl.uniform1f(u.dpr!,dpr);gl.uniform2f(u.ratio!,size.width/max,size.height/max);gl.uniform1i(u.image!,0);
      gl.drawArrays(gl.POINTS,0,count);this.stats.drawCalls++;this.stats.vertices+=count;this.stats.submittedSamples+=count;
    }finally{gl.bindVertexArray(oldVAO);gl.bindBuffer(gl.ARRAY_BUFFER,oldBuffer);gl.useProgram(oldProgram);gl.bindTexture(gl.TEXTURE_2D,oldTexture);gl.bindSampler(0,oldSampler);gl.activeTexture(oldActive);}
  }
  private onRestore = () => {
    if (this.gl) {
      this.buffers.clear();
      this.attributeBuffers.clear();
      this.init(this.gl);
      this.lineStrip?.restoreContext();
      this.lost = false;
      this.canvas.dispatchEvent(new Event("crychartcontextrestored"));
    }
  };
  private init(gl: WebGL2RenderingContext) {
    const allocated: WebGLShader[] = [];
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      allocated.push(s);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? "Shader compilation failed");
      return s;
    };
    const p = gl.createProgram()!;
    try {
      const v = shader(gl.VERTEX_SHADER, vertex),
        f = shader(gl.FRAGMENT_SHADER, fragment);
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p) ?? "Shader link failed");
      this.program = p;
      this.attrStart = gl.getAttribLocation(p, "a_start");
      this.attrEnd = gl.getAttribLocation(p, "a_end");
      this.attrDash = gl.getAttribLocation(p, "a_dash");
    this.attrPrevious=gl.getAttribLocation(p,'a_previous');this.attrNext=gl.getAttribLocation(p,'a_next');
      this.attrColorStart = gl.getAttribLocation(p, "a_colorStart");
      this.attrColorEnd = gl.getAttribLocation(p, "a_colorEnd");
      this.attrSize = gl.getAttribLocation(p, "a_pointSize");
      this.attrRotation = gl.getAttribLocation(p, "a_pointRotation");
      for (const name of [
        "domain",
        "size",
        "width",
        "pointSize",
        "pointStrokeEnabled",
        "pointPass",
        "points",
        "color",
        "shape",
        "rotation",
        "dashCount",
        "dashPeriod",
        "dash",
        "hasColors",
        "hasSizes",
        "hasRotations",
        "dpr",
        "pointStrokeColor",
        "pointStrokeWidth",
        "plotOrigin",
      ])
        this.uniforms[name] = gl.getUniformLocation(p, `u_${name}`);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
    } catch (error) {
      gl.deleteProgram(p);
      throw error;
    } finally {
      for (const shader of allocated) gl.deleteShader(shader);
    }
  }
  render(
    packets: DrawPacket[],
    rect: Rect,
    dpr: number,
    options: { clear?: boolean; rasterTarget?: RasterTarget; experimentalHiddenLineOwners?:ReadonlySet<number> } = {},
  ) {
    const started = performance.now();
    this.lineStrip?.setExperimentalAliveOwners(options.experimentalHiddenLineOwners??new Set<number>());
    this.stats.frames++;
    this.stats.drawCalls = 0;
    this.stats.vertices = 0;
    this.stats.submittedSamples = 0;
    if (this.gl && !this.lost)
      this.drawGPU(packets, rect, dpr, options.clear !== false, options.rasterTarget);
    else if (this.ctx) this.drawCPU(packets, rect, dpr);
    this.stats.renderTimeMs = performance.now() - started;
  }
  private canUseKnownOwnedFrame(packets:readonly DrawPacket[],clear:boolean,nonDefaultTarget=false):boolean {
    const reject=(reason:string)=>{this.ownedFrameAdmission.enabled=false;this.ownedFrameAdmission.reason=reason;return false;};
    if(!this.ownedCoverageFrame)return reject('disabled');
    if(nonDefaultTarget)return reject('non-default-raster-target');
    if(!this.lineCoverageUnion||this.lineCoverageStateScope!=='frame'||!clear||!packets.length)return reject('not-exclusive-coverage-frame');
    // Prepared packet metadata only: no new raw-data/order/readback scan.
    if(!packets.every(p=>p.strictlyMonotonicX===true&&p.mode==='line'&&p.dimensions===2&&Number.isSafeInteger(p.count)&&p.count>=2&&p.positions.length>=p.count*2&&Number.isFinite(p.thickness)&&p.thickness>0&&!p.colors&&!p.dashPattern?.length&&!p.pointSizes&&!p.pointRotations))return reject('mixed-or-incompatible-packets');
    this.ownedFrameAdmission.enabled=true;this.ownedFrameAdmission.reason='owned-default-target';return true;
  }

  private establishKnownPrivateBaseline(gl:WebGL2RenderingContext):void {
    // This explicit mode owns the Chart private context. It does not promise to
    // preserve external GL/FBO mutations; standalone/custom-target paths never
    // call this function. Every state later restored by coverage is established.
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);
    gl.drawBuffers([gl.BACK]);gl.readBuffer(gl.BACK);
    gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindSampler(0,null);
    gl.colorMask(true,true,true,true);gl.clearColor(0,0,0,0);
    for(const capability of [gl.DEPTH_TEST,gl.STENCIL_TEST,gl.CULL_FACE,gl.RASTERIZER_DISCARD,gl.SAMPLE_ALPHA_TO_COVERAGE,gl.SAMPLE_COVERAGE])gl.disable(capability);
    gl.enable(gl.BLEND);gl.enable(gl.DITHER);
    gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    // Existing drawGPU immediately establishes viewport/scissor/program/uniforms
    // before the known baseline record is adopted and before any stroke is drawn.
  }

  private drawGPU(
    packets: DrawPacket[],
    rect: Rect,
    dpr: number,
    clear = true,
    rasterTarget?: RasterTarget,
  ) {
    const gl = this.gl!;
    // Close an abandoned exclusive batch before establishing this frame's
    // baseline. Every exit below also closes it, including range/validation
    // failures that occur before the coverage renderer's own draw try block.
    const owned=this.canUseKnownOwnedFrame(packets,clear,this.gpuClipPolicy==='contained'&&rasterTarget?.framebuffer!==null);
    if(owned&&!this.lineStrip)this.lineStrip=new LineStripRenderer(gl,{coverageUnion:true,coverageStateScope:'frame',clipPolicy:this.gpuClipPolicy});
    // A synchronous invocation containing only compatible coverage lines can
    // share one real incoming-state capture, including ordinary non-block
    // packets. Do not infer a private-context baseline or retain state between
    // invocations. Mixed/standalone/custom-FBO paths keep their safe fallback.
    const coverageBatch=!owned&&!rasterTarget&&packets.length>0&&packets.every(p=>
      p.strictlyMonotonicX===true&&
      p.mode==='line'&&p.dimensions===2&&Number.isSafeInteger(p.count)&&p.count>=2&&
      p.positions.length>=p.count*2&&Number.isFinite(p.thickness)&&p.thickness>0&&
      !p.colors&&!p.dashPattern?.length&&!p.pointSizes&&!p.pointRotations)&&
      gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)===null;
    if(coverageBatch&&!this.lineStrip)this.lineStrip=new LineStripRenderer(gl,{coverageUnion:this.lineCoverageUnion,coverageStateScope:this.lineCoverageStateScope,clipPolicy:this.gpuClipPolicy});
    const stripBefore={uploads:this.lineStrip?.stats.uploads??0,bytes:this.lineStrip?.stats.uploadedBytes??0};
    this.lineStrip?.beginFrame();
    let frameEnded=false;
    let capturedCoverageBatch=false;
    try {
    if(coverageBatch){this.lineStrip!.beginCapturedCoverageFrame();capturedCoverageBatch=true;}
    const target=this.gpuClipPolicy==='contained'?requireRasterTarget(rasterTarget):undefined;
    const containedClips=target?packets.map(packet=>containedRasterClip(rect,packet.clipRect,target)):undefined;
    if(target&&gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)!==target.framebuffer)throw new Error('Raster target does not match the destination framebuffer');
    if(owned)this.establishKnownPrivateBaseline(gl);
    gl.disable(gl.SCISSOR_TEST);
    if (clear) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.enable(gl.SCISSOR_TEST);
    const x = target?.viewport.x ?? Math.round(rect.left * dpr),
      y = target?.viewport.y ?? Math.round(this.canvas.height - (rect.top + rect.height) * dpr),
      w = target?.viewport.width ?? Math.max(1, Math.round(rect.width * dpr)),
      h = target?.viewport.height ?? Math.max(1, Math.round(rect.height * dpr));
    gl.viewport(x, y, w, h);
    gl.scissor(x, y, w, h);
    gl.useProgram(this.program!);
    gl.uniform2f(this.uniforms.size!, w, h);
    gl.uniform2f(this.uniforms.plotOrigin!, x, y);
    gl.uniform1f(this.uniforms.dpr!, dpr);
    if(owned)this.lineStrip!.beginKnownOwnedFrame(this.program!,[x,y,w,h]);
    let clipX=x,clipY=y,clipW=w,clipH=h;
    const live = new Set<number>();
    const liveAttributes = new Set<string>();
    for (let packetIndex=0;packetIndex<packets.length;packetIndex++) {
      const p=packets[packetIndex]!;
      live.add(p.id);
      if (
        !p.count ||
        (p.color[3] === 0 && !p.pointIcon &&
          !p.colors &&
          !(p.mode === "points" && (p.pointStrokeThickness ?? 0) > 0)) ||
        (p.mode === "line" && (p.count < 2 || p.thickness <= 0))
      )
        continue;
      const clip=p.clipRect??rect,contained=containedClips?.[packetIndex];
      const cx=target?(contained?.x??0):Math.round(clip.left*dpr),cy=target?(contained?.y??0):Math.round(this.canvas.height-(clip.top+clip.height)*dpr),cw=target?(contained?.width??0):Math.max(0,Math.round((clip.left+clip.width)*dpr)-cx),ch=target?(contained?.height??0):Math.max(0,Math.round(this.canvas.height-clip.top*dpr)-cy);
      if(!target&&(cw===0||ch===0))continue;
      if(cw>0&&ch>0&&(cx!==clipX||cy!==clipY||cw!==clipW||ch!==clipH)){gl.scissor(cx,cy,cw,ch);clipX=cx;clipY=cy;clipW=cw;clipH=ch;}
      const range=visibleSampleRange(p,rect.width),first=range.first,drawCount=range.count;
      if(drawCount<(p.mode==='line'?2:1))continue;
      if(p.strictlyMonotonicX&&p.mode==='line'&&!p.colors&&!p.dashPattern?.length){
        if(!this.lineStrip){this.lineStrip=new LineStripRenderer(gl,{coverageUnion:this.lineCoverageUnion,coverageStateScope:this.lineCoverageStateScope,clipPolicy:this.gpuClipPolicy});this.lineStrip.beginFrame();}
        let groupEnd=packetIndex+1;
        if(p.strokeGroup!==undefined)while(groupEnd<packets.length&&packets[groupEnd]!.strokeGroup===p.strokeGroup&&this.lineStrip.canDraw(packets[groupEnd]!))groupEnd++;
        const drawn=groupEnd>packetIndex+1?this.lineStrip.drawGroup(packets.slice(packetIndex,groupEnd),rect,dpr,target):this.lineStrip.draw(p,rect,dpr,range,target);
        if(drawn){for(let i=packetIndex+1;i<groupEnd;i++)live.add(packets[i]!.id);packetIndex=groupEnd-1;if(!this.lineCoverageUnion&&!capturedCoverageBatch)gl.useProgram(this.program!);continue;}
      }
      if(cw===0||ch===0)continue;
      // Coverage's frame mode leaves its composite VAO and ROI viewport active.
      // Restore before a point, dash, palette or other general-pipeline draw.
      // The saved scissor may describe the FIRST coverage pane, so do not trust
      // the loop's LAST-pane cache after this restoration boundary.
      if(this.lineStrip?.flushCoverageState()){
        gl.bindVertexArray(null);gl.useProgram(this.program!);gl.viewport(x,y,w,h);
        gl.enable(gl.SCISSOR_TEST);gl.scissor(cx,cy,cw,ch);
        clipX=cx;clipY=cy;clipW=cw;clipH=ch;
      }
      let entry = this.buffers.get(p.id);
      if (!entry) {
        entry = { buffer: gl.createBuffer()!, revision: -1, bytes: 0 };
        this.buffers.set(p.id, entry);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
      if (entry.revision !== p.revision) {
        const required = p.positions.byteLength+16,
          grow = entry.bytes < required;
        if (grow) {
          entry.bytes = Math.max(
            2048,
            2 ** Math.ceil(Math.log2(Math.max(1, required))),
          );
          gl.bufferData(gl.ARRAY_BUFFER, entry.bytes, gl.DYNAMIC_DRAW);
        }
        const from =
          !grow &&
          p.updateFrom !== undefined &&
          p.previousRevision === entry.revision
            ? p.updateFrom * 2
            : 0;
        const values = from ? p.positions.subarray(from) : p.positions;
        if(from===0)gl.bufferSubData(gl.ARRAY_BUFFER,0,p.positions.subarray(0,2));
        gl.bufferSubData(gl.ARRAY_BUFFER,8+from*4,values);
        gl.bufferSubData(gl.ARRAY_BUFFER,8+p.positions.byteLength,p.positions.subarray(p.positions.length-2));
        entry.revision = p.revision;
        this.stats.uploads++;
        this.stats.uploadedBytes += values.byteLength+(from===0?16:8);
      }
      if(p.mode==='points'&&p.pointIcon){this.drawIconGPU(p,entry.buffer,first,drawCount,dpr,liveAttributes);continue;}
      gl.uniform4f(
        this.uniforms.domain!,
        p.domain.x.start - p.origin.x,
        p.domain.y.start - p.origin.y,
        p.domain.x.end - p.domain.x.start,
        p.domain.y.end - p.domain.y.start,
      );
      gl.uniform4fv(this.uniforms.color!, p.color);
      gl.uniform1f(this.uniforms.width!, p.thickness * dpr);
      gl.uniform1f(this.uniforms.pointSize!, Math.max(1, p.pointSize * dpr));
      gl.uniform1f(this.uniforms.pointStrokeEnabled!, p.pointSize > 1 ? 1 : 0);
      gl.uniform4fv(
        this.uniforms.pointStrokeColor!,
        p.pointStrokeColor ?? [0, 0, 0, 0],
      );
      gl.uniform1f(
        this.uniforms.pointStrokeWidth!,
        (p.pointStrokeThickness ?? 0) * dpr,
      );
      gl.uniform1i(this.uniforms.shape!, p.pointShape ?? 1);
      gl.uniform1f(
        this.uniforms.rotation!,
        ((p.pointRotation ?? 0) * Math.PI) / 180,
      );
      gl.enableVertexAttribArray(this.attrStart);
      gl.vertexAttribPointer(this.attrStart, 2, gl.FLOAT, false, 8, 8+first*8);
      const bindAttribute = (
        name: string,
        data: Float32Array | undefined,
        location: number,
        components: number,
        offset = 0,
      ) => {
        if (!data) {
          gl.disableVertexAttribArray(location);
          gl.vertexAttribDivisor(location, 0);
          return;
        }
        const key = `${p.id}:${p.mode}:${name}`;
        liveAttributes.add(key);
        let attribute = this.attributeBuffers.get(key);
        if (!attribute) {
          attribute = {
            buffer: gl.createBuffer()!,
            source: data,
            revision: -1,
          };
          this.attributeBuffers.set(key, attribute);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, attribute.buffer);
        if (attribute.source !== data || attribute.revision !== p.revision) {
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
          attribute.source = data;
          attribute.revision = p.revision;
          this.stats.uploads++;
          this.stats.uploadedBytes += data.byteLength;
        }
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(
          location,
          components,
          gl.FLOAT,
          false,
          components * 4,
          offset+first*components*4,
        );
        gl.vertexAttribDivisor(location, p.mode === "line" ? 1 : 0);
      };
      bindAttribute("color", p.colors, this.attrColorStart, 4);
      bindAttribute(
        "color",
        p.mode === "line" ? p.colors : undefined,
        this.attrColorEnd,
        4,
        16,
      );
      bindAttribute(
        "size",
        p.mode === "points" ? p.pointSizes : undefined,
        this.attrSize,
        1,
      );
      bindAttribute(
        "rotation",
        p.mode === "points" ? p.pointRotations : undefined,
        this.attrRotation,
        1,
      );
      gl.uniform1i(this.uniforms.hasColors!, p.colors ? 1 : 0);
      gl.uniform1i(
        this.uniforms.hasSizes!,
        p.mode === "points" && p.pointSizes ? 1 : 0,
      );
      gl.uniform1i(
        this.uniforms.hasRotations!,
        p.mode === "points" && p.pointRotations ? 1 : 0,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
      if (p.mode === "line" && p.dashPattern?.length) {
        const pattern = p.dashPattern.map((v) => v * dpr),
          period = pattern.reduce((a, b) => a + b, 0),
          scaleX = w / (p.domain.x.end - p.domain.x.start),
          scaleY = h / (p.domain.y.end - p.domain.y.start);
        const key = [p.revision, scaleX, scaleY, period].join(":");
        if (!entry.dashBuffer) entry.dashBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.dashBuffer);
        if (entry.dashKey !== key) {
          const values = dashDistances(p.positions, scaleX, scaleY, period);
          gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
          entry.dashKey = key;
          this.stats.uploads++;
          this.stats.uploadedBytes += values.byteLength;
        }
        gl.enableVertexAttribArray(this.attrDash);
        gl.vertexAttribPointer(this.attrDash, 2, gl.FLOAT, false, 8, first*8);
        gl.vertexAttribDivisor(this.attrDash, 1);
        gl.uniform1i(this.uniforms.dashCount!, pattern.length);
        gl.uniform1f(this.uniforms.dashPeriod!, period);
        gl.uniform1fv(
          this.uniforms.dash!,
          new Float32Array([...pattern, ...Array(16 - pattern.length).fill(0)]),
        );
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
      } else {
        gl.disableVertexAttribArray(this.attrDash);
        gl.vertexAttribDivisor(this.attrDash, 0);
        gl.vertexAttrib2f(this.attrDash, 0, 0);
        gl.uniform1i(this.uniforms.dashCount!, 0);
      }
      let draws=1;
      if (p.mode === "points") {
        gl.uniform1i(this.uniforms.points!, 1);
        gl.vertexAttribDivisor(this.attrStart, 0);
        gl.disableVertexAttribArray(this.attrEnd);
        gl.vertexAttribDivisor(this.attrEnd, 0);
        gl.disableVertexAttribArray(this.attrPrevious);gl.vertexAttribDivisor(this.attrPrevious,0);gl.disableVertexAttribArray(this.attrNext);gl.vertexAttribDivisor(this.attrNext,0);
        const outlined=(p.pointStrokeThickness??0)>0&&(p.pointStrokeColor?.[3]??0)>0&&(p.pointSizes!==undefined||p.pointSize>1);
        if(outlined){gl.uniform1i(this.uniforms.pointPass!,1);gl.drawArrays(gl.POINTS,0,drawCount);draws++;}
        gl.uniform1i(this.uniforms.pointPass!,2);gl.drawArrays(gl.POINTS,0,drawCount);
      } else {
        gl.uniform1i(this.uniforms.points!, 0);
        gl.enableVertexAttribArray(this.attrEnd);
        gl.vertexAttribPointer(this.attrEnd, 2, gl.FLOAT, false, 8, 16+first*8);
        gl.enableVertexAttribArray(this.attrPrevious);gl.vertexAttribPointer(this.attrPrevious,2,gl.FLOAT,false,8,first*8);gl.vertexAttribDivisor(this.attrPrevious,1);
        gl.enableVertexAttribArray(this.attrNext);gl.vertexAttribPointer(this.attrNext,2,gl.FLOAT,false,8,24+first*8);gl.vertexAttribDivisor(this.attrNext,1);
        gl.vertexAttribDivisor(this.attrStart, 1);
        gl.vertexAttribDivisor(this.attrEnd, 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawCount - 1);
      }
      this.stats.drawCalls+=draws;
      this.stats.vertices += p.mode==='points'?drawCount*draws:4*(drawCount-1);
      this.stats.submittedSamples += drawCount*draws;
    }
    // Restore borrowed bindings before evicting general-pipeline buffers: the
    // saved ARRAY_BUFFER may still be an otherwise-unused previous-frame one.
    this.lineStrip?.endFrame();frameEnded=true;
    for (const [id, entry] of this.buffers)
      if (!live.has(id)) {
        gl.deleteBuffer(entry.buffer);
        if (entry.dashBuffer) gl.deleteBuffer(entry.dashBuffer);
        this.buffers.delete(id);
      }
    for (const [key, entry] of this.attributeBuffers)
      if (!liveAttributes.has(key)) {
        gl.deleteBuffer(entry.buffer);
        this.attributeBuffers.delete(key);
      }
    } finally {
      if(this.lineStrip){if(!frameEnded)this.lineStrip.endFrame();this.stats.uploads+=this.lineStrip.stats.uploads-stripBefore.uploads;this.stats.uploadedBytes+=this.lineStrip.stats.uploadedBytes-stripBefore.bytes;this.stats.drawCalls+=this.lineStrip.stats.drawCalls;this.stats.vertices+=this.lineStrip.stats.vertices;this.stats.submittedSamples+=this.lineStrip.stats.submittedSamples;}
      if(!capturedCoverageBatch)gl.disable(gl.SCISSOR_TEST);
    }
  }
  private drawCPU(packets: DrawPacket[], rect: Rect, dpr: number) {
    const ctx = this.ctx!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
    for (const p of packets) {
      if (
        p.color[3] === 0 && !p.pointIcon &&
        !p.colors &&
        !(p.mode === "points" && (p.pointStrokeThickness ?? 0) > 0)
      )
        continue;
      const pointOutline=p.mode === "points" && !p.pointIcon && (p.pointStrokeThickness??0)>0 && (p.pointStrokeColor?.[3]??0)>0;
      const clipping=!!p.clipRect;
      if(clipping){const clip=p.clipRect!;ctx.save();ctx.beginPath();ctx.rect(clip.left,clip.top,clip.width,clip.height);ctx.clip();}
      const [r, g, b, a] = p.color;
      ctx.strokeStyle =
        ctx.fillStyle = `rgba(${r * 255},${g * 255},${b * 255},${a})`;
      ctx.lineWidth = p.thickness;
      ctx.setLineDash(p.mode === "line" ? [...(p.dashPattern ?? [])] : []);
      // Keep the original fill batching; only move the outside stroke pass below all fills.
      const first=p.drawFirst??0,end=first+(p.drawCount??p.count);
          if(pointOutline)for(let i=first;i<end;i++){
            const x=rect.left+((p.positions[2*i]!+p.origin.x-p.domain.x.start)/(p.domain.x.end-p.domain.x.start))*rect.width;
            const y=rect.top+rect.height-((p.positions[2*i+1]!+p.origin.y-p.domain.y.start)/(p.domain.y.end-p.domain.y.start))*rect.height;
            const size=p.pointSizes?.[i]??p.pointSize,shape=p.pointShape??1,rotation=p.pointRotations?.[i]??p.pointRotation??0;
            if(!Number.isFinite(x)||!Number.isFinite(y)||!(size>1))continue;
            const stroke=p.pointStrokeColor??[0,0,0,0];ctx.save();
            ctx.beginPath();ctx.rect(rect.left,rect.top,rect.width,rect.height);appendPointPath(ctx,x,y,size,shape,rotation);ctx.clip('evenodd');
            ctx.beginPath();appendPointPath(ctx,x,y,size,shape,rotation);ctx.strokeStyle=`rgba(${stroke[0]*255},${stroke[1]*255},${stroke[2]*255},${stroke[3]})`;
            ctx.lineJoin=pointStrokeJoin(shape);ctx.miterLimit=pointStrokeMiterLimit;ctx.lineWidth=2*p.pointStrokeThickness!;ctx.stroke();ctx.restore();
          }
      ctx.beginPath();
      let pen = false;
      let previousX = 0,
        previousY = 0,
        arcLength = 0;

      for (let i = first; i < end; i++) {
        const x =
            rect.left +
            ((p.positions[2 * i]! + p.origin.x - p.domain.x.start) /
              (p.domain.x.end - p.domain.x.start)) *
              rect.width,
          y =
            rect.top +
            rect.height -
            ((p.positions[2 * i + 1]! + p.origin.y - p.domain.y.start) /
              (p.domain.y.end - p.domain.y.start)) *
              rect.height;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          pen = false;
          arcLength = 0;
          continue;
        }
        if (p.mode === "points") {
          if(p.pointIcon){
            const image=p.pointIcon.getCanvasSource();if(image){const dimensions=p.pointIcon.getRasterSize(),scale=(p.pointSizes?.[i]??p.pointSize)/Math.max(dimensions.width,dimensions.height);ctx.save();try{ctx.translate(x,y);ctx.rotate((p.pointRotations?.[i]??p.pointRotation??0)*Math.PI/180);ctx.drawImage(image,-dimensions.width*scale/2,-dimensions.height*scale/2,dimensions.width*scale,dimensions.height*scale);}finally{ctx.restore();}}continue;
          }
          if(p.colors){const o=i*4;ctx.beginPath();ctx.fillStyle=`rgba(${p.colors[o]! *255},${p.colors[o+1]! *255},${p.colors[o+2]! *255},${p.colors[o+3]})`;}
          appendPointPath(ctx,x,y,p.pointSizes?.[i]??p.pointSize,p.pointShape??1,p.pointRotations?.[i]??p.pointRotation??0);
          if(p.colors)ctx.fill();
        } else if (p.colors) {
          if (pen && Math.hypot(x - previousX, y - previousY) > 0) {
            const gradient = ctx.createLinearGradient(
                previousX,
                previousY,
                x,
                y,
              ),
              o = (i - 1) * 4,
              n = i * 4;
            gradient.addColorStop(
              0,
              `rgba(${p.colors[o]! * 255},${p.colors[o + 1]! * 255},${p.colors[o + 2]! * 255},${p.colors[o + 3]})`,
            );
            gradient.addColorStop(
              1,
              `rgba(${p.colors[n]! * 255},${p.colors[n + 1]! * 255},${p.colors[n + 2]! * 255},${p.colors[n + 3]})`,
            );
            ctx.strokeStyle = gradient;
            ctx.lineDashOffset = -arcLength;
            ctx.beginPath();
            ctx.moveTo(previousX, previousY);
            ctx.lineTo(x, y);
            ctx.stroke();
            arcLength += Math.hypot(x - previousX, y - previousY);
          }
          previousX = x;
          previousY = y;
          pen = true;
        } else if (pen) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          pen = true;
        }
      }
      if(!p.colors){if(p.mode === "points")ctx.fill();else ctx.stroke();}
      ctx.lineDashOffset = 0;
      this.stats.drawCalls++;
      this.stats.vertices += end-first;
      if(clipping)ctx.restore();
    }
    ctx.restore();
  }
  dispose() {
    this.clearIcons(true);
    this.lineStrip?.dispose();
    if (this.gl) {
      for (const entry of this.buffers.values()) {
        this.gl.deleteBuffer(entry.buffer);
        if (entry.dashBuffer) this.gl.deleteBuffer(entry.dashBuffer);
      }
      this.buffers.clear();
      for (const entry of this.attributeBuffers.values())
        this.gl.deleteBuffer(entry.buffer);
      this.attributeBuffers.clear();
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestore);
  }
}

function appendPointPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: number,
  rotation: number,
) {
  const r = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  if (shape === 1) {
    ctx.moveTo(r, 0);
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  } else if (shape === 0) ctx.rect(-r, -r, size, size);
  else if (shape === 6) ctx.rect(-r, -r * 0.22, size, r * 0.44);
  else {
    const points=pointShapeVertices(shape);
    if(shape===3)ctx.rotate(Math.PI/4);
    points.forEach((p, i) =>
      i ? ctx.lineTo(p[0]! * r, p[1]! * r) : ctx.moveTo(p[0]! * r, p[1]! * r),
    );
    ctx.closePath();
  }
  ctx.restore();
}
