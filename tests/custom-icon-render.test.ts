import test from 'node:test';
import assert from 'node:assert/strict';
import {DataRenderer} from '../src/render.js';
import {IconRegistry} from '../src/custom-icon.js';
import type {DrawPacket} from '../src/contracts.js';

const image=()=>({width:13,height:13,getContext:()=>null}) as unknown as HTMLCanvasElement;
const rect={left:0,top:0,width:100,height:100};
function packet(icon:ReturnType<IconRegistry['add']>):DrawPacket{return {id:1,revision:1,positions:new Float32Array([.5,.5]),count:1,dimensions:2,mode:'points',pointIcon:icon,pointSize:26,pointShape:0,color:[0,0,0,0],thickness:0,pointStrokeThickness:4,pointStrokeColor:[1,0,0,1],origin:{x:0,y:0,z:0},domain:{x:{start:0,end:1},y:{start:0,end:1}}};}

test('Canvas points use intrinsic icon pixels, exact requested size, and stop drawing disposed icons',()=>{
  const registry=new IconRegistry(),source=image(),icon=registry.add(source,{width:13,height:13});
  const images:unknown[][]=[];let saves=0,strokes=0;
  const ctx={save(){saves++;},restore(){saves--;},setTransform(){},clearRect(){},beginPath(){},rect(){},clip(){},setLineDash(){},translate(){},rotate(){},drawImage(...args:unknown[]){images.push(args);},stroke(){strokes++;},fill(){}};
  const canvas=Object.assign(new EventTarget(),{width:100,height:100,getContext:()=>ctx});
  const renderer=new DataRenderer(canvas as unknown as HTMLCanvasElement,{renderer:'canvas2d'});
  try{renderer.render([packet(icon)],rect,2);assert.deepEqual(images,[[source,-13,-13,26,26]]);assert.equal(strokes,0);assert.equal(saves,0);icon.dispose();renderer.render([packet(icon)],rect,2);assert.equal(images.length,1);assert.equal(saves,0);}
  finally{renderer.dispose();registry.dispose();}
});

/** Recording standard WebGL2 calls, without a fake image decoder or rendering oracle. */
class GL {
  VERTEX_SHADER=1;FRAGMENT_SHADER=2;COMPILE_STATUS=3;LINK_STATUS=4;ARRAY_BUFFER=5;DYNAMIC_DRAW=6;FLOAT=7;SCISSOR_TEST=8;BLEND=9;SRC_ALPHA=10;ONE_MINUS_SRC_ALPHA=11;ONE=12;COLOR_BUFFER_BIT=13;POINTS=14;TRIANGLE_STRIP=15;
  CURRENT_PROGRAM=16;VERTEX_ARRAY_BINDING=17;ARRAY_BUFFER_BINDING=18;ACTIVE_TEXTURE=19;TEXTURE0=20;TEXTURE_BINDING_2D=21;SAMPLER_BINDING=22;TEXTURE_2D=23;PIXEL_UNPACK_BUFFER=24;PIXEL_UNPACK_BUFFER_BINDING=25;
  UNPACK_FLIP_Y_WEBGL=26;UNPACK_PREMULTIPLY_ALPHA_WEBGL=27;UNPACK_ALIGNMENT=28;UNPACK_ROW_LENGTH=29;UNPACK_SKIP_ROWS=30;UNPACK_SKIP_PIXELS=31;UNPACK_IMAGE_HEIGHT=32;UNPACK_SKIP_IMAGES=33;
  TEXTURE_MIN_FILTER=34;TEXTURE_MAG_FILTER=35;LINEAR=36;TEXTURE_WRAP_S=37;TEXTURE_WRAP_T=38;CLAMP_TO_EDGE=39;RGBA=40;UNSIGNED_BYTE=41;
  id=0;params=new Map<number,unknown>();textures=new Map<number,unknown>();samplers=new Map<number,unknown>();attrs=new Map<string,number>();uniforms=new Map<string,unknown>();draws:unknown[]=[];uploads:unknown[]=[];createdTextures=0;deletedTextures=0;deletedVAOs=0;
  constructor(){this.params.set(this.ACTIVE_TEXTURE,this.TEXTURE0+3);this.textures.set(this.TEXTURE0,{externalTexture:true});this.samplers.set(0,{externalSampler:true});for(const p of [this.UNPACK_FLIP_Y_WEBGL,this.UNPACK_PREMULTIPLY_ALPHA_WEBGL,this.UNPACK_ALIGNMENT,this.UNPACK_ROW_LENGTH,this.UNPACK_SKIP_ROWS,this.UNPACK_SKIP_PIXELS,this.UNPACK_IMAGE_HEIGHT,this.UNPACK_SKIP_IMAGES])this.params.set(p,p);this.params.set(this.PIXEL_UNPACK_BUFFER_BINDING,{externalPBO:true});}
  createShader(){return{};}shaderSource(){}compileShader(){}getShaderParameter(){return true;}getShaderInfoLog(){return'';}deleteShader(){}createProgram(){return{id:++this.id};}attachShader(){}linkProgram(){}getProgramParameter(){return true;}getProgramInfoLog(){return'';}deleteProgram(){}getUniformLocation(_p:unknown,n:string){return n;}getAttribLocation(_p:unknown,n:string){if(!this.attrs.has(n))this.attrs.set(n,this.attrs.size);return this.attrs.get(n)!;}
  createBuffer(){return{id:++this.id};}deleteBuffer(){}bindBuffer(t:number,b:unknown){this.params.set(t===this.ARRAY_BUFFER?this.ARRAY_BUFFER_BINDING:this.PIXEL_UNPACK_BUFFER_BINDING,b);}bufferData(){}bufferSubData(){}enable(){}disable(){}blendFuncSeparate(){}clearColor(){}clear(){}viewport(){}scissor(){}useProgram(p:unknown){this.params.set(this.CURRENT_PROGRAM,p);}enableVertexAttribArray(){}disableVertexAttribArray(){}vertexAttribPointer(){}vertexAttribDivisor(){}vertexAttrib2f(){}
  createVertexArray(){return{id:++this.id};}deleteVertexArray(){this.deletedVAOs++;}bindVertexArray(v:unknown){this.params.set(this.VERTEX_ARRAY_BINDING,v);}
  uniform1f(k:string,v:number){this.uniforms.set(k,v);}uniform1i(k:string,v:number){this.uniforms.set(k,v);}uniform2f(k:string,...v:number[]){this.uniforms.set(k,v);}uniform4f(k:string,...v:number[]){this.uniforms.set(k,v);}uniform4fv(k:string,v:unknown){this.uniforms.set(k,v);}uniform1fv(){}drawArrays(mode:number,_first:number,count:number){this.draws.push({mode,count,size:this.uniforms.get('u_size')});}drawArraysInstanced(){}isContextLost(){return false;}
  getParameter(p:number){if(p===this.TEXTURE_BINDING_2D)return this.textures.get(this.params.get(this.ACTIVE_TEXTURE) as number)??null;if(p===this.SAMPLER_BINDING)return this.samplers.get((this.params.get(this.ACTIVE_TEXTURE) as number)-this.TEXTURE0)??null;return this.params.get(p)??null;}
  activeTexture(v:number){this.params.set(this.ACTIVE_TEXTURE,v);}bindTexture(_t:number,v:unknown){this.textures.set(this.params.get(this.ACTIVE_TEXTURE) as number,v);}bindSampler(unit:number,v:unknown){this.samplers.set(unit,v);}createTexture(){this.createdTextures++;return{id:++this.id};}deleteTexture(){this.deletedTextures++;}pixelStorei(k:number,v:unknown){this.params.set(k,v);}texParameteri(){}
  texImage2D(...args:unknown[]){assert.equal(this.getParameter(this.PIXEL_UNPACK_BUFFER_BINDING),null);assert.equal(this.getParameter(this.SAMPLER_BINDING),null);assert.equal(this.getParameter(this.UNPACK_ROW_LENGTH),0);assert.equal(this.getParameter(this.UNPACK_FLIP_Y_WEBGL),0);assert.equal(this.getParameter(this.UNPACK_PREMULTIPLY_ALPHA_WEBGL),0);this.uploads.push(args.at(-1));}
}

test('actual GPU path caches the source texture, restores upload/sampler state, and releases owned texture on disposal',()=>{
  const gl=new GL(),registry=new IconRegistry(),source=image(),icon=registry.add(source);
  const canvas=Object.assign(new EventTarget(),{width:100,height:100,getContext:(kind:string)=>kind==='webgl2'?gl:null});
  const renderer=new DataRenderer(canvas as unknown as HTMLCanvasElement,{renderer:'webgl2'});
  const before=new Map(gl.params),texture=gl.textures.get(gl.TEXTURE0),sampler=gl.samplers.get(0);
  try{
    renderer.render([packet(icon)],rect,2);renderer.render([packet(icon)],rect,2);
    assert.deepEqual(gl.uploads,[source]);assert.equal(gl.createdTextures,1);assert.equal(gl.draws.length,2);
    assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE),before.get(gl.ACTIVE_TEXTURE));assert.equal(gl.textures.get(gl.TEXTURE0),texture);assert.equal(gl.samplers.get(0),sampler);
    for(const p of [gl.PIXEL_UNPACK_BUFFER_BINDING,gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.UNPACK_ALIGNMENT,gl.UNPACK_ROW_LENGTH,gl.UNPACK_SKIP_ROWS,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_IMAGE_HEIGHT,gl.UNPACK_SKIP_IMAGES])assert.equal(gl.getParameter(p),before.get(p));
    icon.dispose();assert.equal(gl.deletedTextures,1);renderer.render([packet(icon)],rect,2);assert.equal(gl.draws.length,2);
    const next=registry.add(source);renderer.render([packet(next)],rect,2);assert.equal(gl.createdTextures,2);
    canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));renderer.render([packet(next)],rect,2);assert.equal(gl.draws.length,3);
    canvas.dispatchEvent(new Event('webglcontextrestored'));renderer.render([packet(next)],rect,2);assert.equal(gl.createdTextures,3);assert.equal(gl.draws.length,4);
  }finally{renderer.dispose();registry.dispose();}
  assert.equal(gl.deletedTextures,2);assert.equal(gl.deletedVAOs,1);
});
