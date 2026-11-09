import {ColorRGBA,type Color,type Theme} from './core/styles.js';

/** Original time-based pulse. Timing/phase is not a vendor animation contract. */
export class ComponentHighlightState {
  private configured=0;
  private animated=true;
  private active=0;
  private startedAt:number|undefined;
  private cancelled=false;
  set(value:boolean|number):number{
    const next=Math.max(0,Math.min(1,Number(value)));
    if(!Object.is(next,this.configured)||this.cancelled){
      this.configured=next;this.startedAt=undefined;this.cancelled=false;
      this.active=this.animated?0:this.finiteValue();
    }
    return next;
  }
  get(){return this.configured;}
  setAnimation(enabled:boolean){
    this.animated=!!enabled;this.startedAt=undefined;this.cancelled=false;
    this.active=this.animated?0:this.finiteValue();
  }
  getAnimation(){return this.animated;}
  private finiteValue(){return Number.isFinite(this.configured)?this.configured:0;}
  pending(visible=true){return visible&&!this.cancelled&&this.animated&&this.finiteValue()>0;}
  advance(timestamp:number,visible=true){
    if(!this.pending(visible)){this.startedAt=undefined;this.active=this.finiteValue();return;}
    if(!Number.isFinite(timestamp))return;
    this.startedAt??=timestamp;
    const elapsed=Math.max(0,timestamp-this.startedAt);
    this.active=this.finiteValue()*(1-Math.cos(elapsed*Math.PI*2/1200))/2;
  }
  strength(){return this.animated?this.active:this.finiteValue();}
  suspend(){this.startedAt=undefined;this.active=0;}
  cancel(){this.suspend();this.cancelled=true;}
}

/** The public theme offset is in byte channels; styles and source colors stay immutable. */
export function highlightColor(color:Color,strength:number,theme:Theme):Color{
  if(!(strength>0)||!Number.isFinite(strength)||color.a<=0)return color;
  const explicit=theme.highlightColorOffset;
  const background=theme.backgroundColor??theme.backgroundFillStyle?.getColor?.();
  const dark=typeof theme.isDark==='boolean'?theme.isDark:
    (background?.r??0)*.2126+(background?.g??0)*.7152+(background?.b??0)*.0722<.5;
  const fallback=dark?60:-60;
  const channel=(method:'getR'|'getG'|'getB'|'getA',defaultValue:number)=>{
    const value=typeof explicit?.[method]==='function'?explicit[method]():defaultValue;
    return Number.isFinite(value)?value:defaultValue;
  };
  return ColorRGBA(color.r*255+channel('getR',fallback)*strength,
    color.g*255+channel('getG',fallback)*strength,
    color.b*255+channel('getB',fallback)*strength,
    color.a*255+channel('getA',60)*strength);
}
