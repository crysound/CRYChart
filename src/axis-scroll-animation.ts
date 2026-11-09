export interface ScrollInterval {start:number;end:number;}

/** A bounded, time-based approach to an automatic viewport target. The target
 * is independent of the displayed interval, so retargeting a live stream does
 * not mutate samples or restart the response from an obsolete viewport. */
export class AxisScrollAnimation {
  private target:ScrollInterval|undefined;
  private previousTime:number|undefined;
  private stableFrames=0;
  request(target:ScrollInterval){
    if(!Number.isFinite(target.start)||!Number.isFinite(target.end)||target.start===target.end)
      throw new RangeError('Scroll target requires distinct finite endpoints');
    if(this.target?.start===target.start&&this.target.end===target.end)return;
    if(!this.target)this.previousTime=undefined;
    this.target={...target};this.stableFrames=0;
  }
  pending(){return this.target!==undefined;}
  cancel(){this.target=undefined;this.previousTime=undefined;this.stableFrames=0;}
  advance(current:ScrollInterval,timestamp:number,pixelLength:number,logarithmic=false):ScrollInterval|undefined{
    const target=this.target;if(!target||!Number.isFinite(timestamp))return;
    const elapsed=this.previousTime===undefined?1000/60:Math.max(0,Math.min(1000,timestamp-this.previousTime));
    this.previousTime=Math.max(this.previousTime??timestamp,timestamp);
    if(elapsed===0)return;
    const convert=(value:number)=>logarithmic?Math.log(value):value;
    const a=convert(current.start),b=convert(current.end),ta=convert(target.start),tb=convert(target.end);
    if(![a,b,ta,tb].every(Number.isFinite)){this.cancel();return;}
    const blend=-Math.expm1(-elapsed/125);
    const nextA=a+(ta-a)*blend,nextB=b+(tb-b)*blend;
    const tolerance=Math.max(Math.abs(tb-ta),Math.abs(b-a))/Math.max(1,pixelLength);
    this.stableFrames++;
    if(Math.max(Math.abs(ta-nextA),Math.abs(tb-nextB))<=tolerance||this.stableFrames>=90||
      nextA===a&&nextB===b){this.cancel();return{...target};}
    const next={start:logarithmic?Math.exp(nextA):nextA,end:logarithmic?Math.exp(nextB):nextB};
    if(next.start===next.end||!Number.isFinite(next.start)||!Number.isFinite(next.end)){this.cancel();return{...target};}
    return next;
  }
}
