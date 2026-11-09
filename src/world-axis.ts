import type {Interval} from './contracts.js';

export interface WorldAxisConversion {
  readonly requested:Readonly<Interval>;
  /** The conversion operates in linear/log10 coordinates; the public domain is unchanged. */
  readonly transformed:Readonly<Interval>;
  readonly logarithmic:boolean;
  readonly worldSpan:number;
  readonly geometryMargin:Readonly<{start:number;end:number}>;
}

/** Public style-size/world-coordinate calibration, independently measured using
 * 0/1/2/4/8 thickness and a unit box. This is a geometry unit, not camera padding. */
export const WORLD_STYLE_UNIT3D=1/1000;

export function createWorldAxisConversion(requested:Interval,logarithmic:boolean,worldSpan:number,geometryMargin:{start:number;end:number}):WorldAxisConversion{
  const {start,end}=requested;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start===end)throw new RangeError('World axis requires distinct finite endpoints');
  if(logarithmic&&(start<=0||end<=0))throw new RangeError('Logarithmic world axis endpoints must be positive');
  if(!Number.isFinite(worldSpan)||worldSpan<=0||![geometryMargin.start,geometryMargin.end].every(value=>Number.isFinite(value)&&value>=0))throw new RangeError('World axis geometry must be finite and nonnegative');
  const from=logarithmic?Math.log10(start):start,to=logarithmic?Math.log10(end):end;
  const span=to-from,marginUnit=span/worldSpan*WORLD_STYLE_UNIT3D;
  const effectiveStart=from-marginUnit*geometryMargin.start,effectiveEnd=to+marginUnit*geometryMargin.end;
  if(!Number.isFinite(effectiveStart)||!Number.isFinite(effectiveEnd)||effectiveStart===effectiveEnd)throw new RangeError('World axis effective interval exceeds finite precision');
  return Object.freeze({requested:Object.freeze({...requested}),transformed:Object.freeze({start:effectiveStart,end:effectiveEnd}),logarithmic,worldSpan,geometryMargin:Object.freeze({...geometryMargin})});
}

export function worldAxisValueToFraction(value:number,conversion:WorldAxisConversion,inverted=false):number{
  const coordinate=conversion.logarithmic?Math.log10(value):value,{start,end}=conversion.transformed;
  const fraction=(coordinate-start)/(end-start);return inverted?1-fraction:fraction;
}
export function worldAxisFractionToValue(fraction:number,conversion:WorldAxisConversion,inverted=false):number{
  if(inverted)fraction=1-fraction;
  const {start,end}=conversion.transformed,value=start+fraction*(end-start);
  return conversion.logarithmic?10**value:value;
}
