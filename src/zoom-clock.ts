import {unit3,type Vec3} from './world-camera.js';

export const WORLD_ZOOM_NOMINAL_FRAME_MS=1000/60;
/** This cutoff is an original compatibility policy. Public observations bound
 * the transition between49.8 and50.1ms; they do not establish an exact private
 * implementation threshold. */
export function normalizeWorldZoomDelta(elapsedMS:number|undefined):number{
  return typeof elapsedMS==='number'&&Number.isFinite(elapsedMS)&&elapsedMS>0&&elapsedMS<=50?elapsedMS:WORLD_ZOOM_NOMINAL_FRAME_MS;
}

export interface WorldZoomStep {
  readonly position:Vec3;readonly pendingBefore:number;readonly pendingAfter:number;
  readonly elapsedMS:number|undefined;readonly appliedMS:number;readonly changed:boolean;
}

/** Original input integrator. Its chosen unit is one signed wheel event at
 * sensitivity1. No reference private variable or callback is read. */
export class WorldZoomInput {
  private pending=0;
  getPending(){return this.pending;}
  clear(){this.pending=0;}
  enqueue(deltaY:number,sensitivity=1):boolean{
    if(!Number.isFinite(deltaY)||!Number.isFinite(sensitivity))throw new RangeError('Wheel input must be finite');
    const input=Math.sign(deltaY)*sensitivity;if(input===0)return false;
    const next=this.pending===0||Math.sign(input)===Math.sign(this.pending)?this.pending+input:input;
    if(!Number.isFinite(next))throw new RangeError('Accumulated wheel input is out of range');
    this.pending=next;return true;
  }
  advance(position:Vec3,elapsedMS:number|undefined,instantFactor=1):WorldZoomStep{
    if(!Number.isFinite(instantFactor))throw new RangeError('Discrete zoom factor must be finite');
    const appliedMS=normalizeWorldZoomDelta(elapsedMS),pendingBefore=this.pending;
    if(pendingBefore===0&&instantFactor===1)return{position:{...position},pendingBefore:0,pendingAfter:0,elapsedMS,appliedMS,changed:false};
    const direction=unit3(position),radius=Math.hypot(position.x,position.y,position.z),factor=1+pendingBefore*appliedMS*.0003;
    if(!Number.isFinite(factor))throw new RangeError('Camera zoom action is out of range');
    const rawRadius=radius*instantFactor*factor;
    if(Number.isNaN(rawRadius))throw new RangeError('Combined zoom action is indeterminate');
    const target=Math.max(.8,Math.min(3,rawRadius));
    const next={x:direction.x*target,y:direction.y*target,z:direction.z*target};
    const remaining=Math.max(0,Math.abs(pendingBefore)-appliedMS*.02),pendingAfter=remaining===0?0:Math.sign(pendingBefore)*remaining;
    // Publish only after validation and position construction succeed.
    this.pending=pendingAfter;
    return{position:next,pendingBefore,pendingAfter,elapsedMS,appliedMS,changed:target!==radius};
  }
}

/** Constant-space staging for already classified discrete input. Public
 * observations require a product of input scales, applied to the latest pose
 * on the scheduled frame; clipping happens after the inertia action. */
export class WorldZoomInstantInput {
  private factor=1;
  private active=false;
  hasPending(){return this.active;}
  getStoredScalarCount(){return this.active?1:0;}
  getPendingFactor(){return this.active?this.factor:undefined;}
  clear(){this.factor=1;this.active=false;}
  enqueue(deltaY:number,sensitivity=1):boolean{
    if(!Number.isFinite(deltaY)||!Number.isFinite(sensitivity))throw new RangeError('Wheel input must be finite');
    if(deltaY===0||sensitivity===0)return false;
    const next=this.factor*(1+Math.sign(deltaY)*.05*sensitivity);
    if(!Number.isFinite(next))throw new RangeError('Accumulated discrete zoom factor is out of range');
    this.factor=next;this.active=true;return true;
  }
  takeFactor():number|undefined{const value=this.active?this.factor:undefined;this.clear();return value;}
}
