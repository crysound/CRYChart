import test from 'node:test';
import assert from 'node:assert/strict';
import {DataRenderer} from '../src/render';

test('explicit Canvas renderer creates no WebGL context, and explicit unavailable WebGL fails clearly',()=>{
  const requested:string[]=[],canvas={getContext(kind:string){requested.push(kind);return null;},addEventListener(){},removeEventListener(){}} as unknown as HTMLCanvasElement;
  const renderer=new DataRenderer(canvas,{renderer:'canvas2d'});assert.equal(renderer.backend,'canvas2d');assert.deepEqual(requested,['2d']);renderer.dispose();
  requested.length=0;assert.throws(()=>new DataRenderer(canvas,{renderer:'webgl2'}),/WebGL2 renderer is unavailable/);assert.deepEqual(requested,['webgl2']);
});
