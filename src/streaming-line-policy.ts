/** CPU admission only. Source data retention and public readback are unchanged. */
export function isDenseStreamingLineWindow(sampleCount:number,maxSampleCount:number|undefined,cssWidth:number,dpr:number):boolean{
  return sampleCount>=262144&&maxSampleCount!==undefined&&Number.isFinite(cssWidth)&&cssWidth>0&&Number.isFinite(dpr)&&dpr>0;
}

/** Use physical pixels, so a narrow high-DPR view is not treated as a CSS-pixel view. */
export function isDenseStreamingLineViewport(visibleSampleCount:number,cssWidth:number,dpr:number):boolean{
  const physicalWidth=cssWidth*dpr;
  return Number.isFinite(physicalWidth)&&physicalWidth>0&&visibleSampleCount/physicalWidth>=256;
}

/** These two axis types use the same affine value transform, not the same precision policy. */
export function isAffineLineAxis(type:string):boolean{return type==='linear'||type==='linear-highPrecision';}

/** Conservative bound for the Float32 vertex/uniform/subtract/divide/clip pipeline.
 * Never add the relative coordinate back to a large epoch to estimate error:
 * that addition can round away the error being measured. Near an epoch,
 * Sterbenz's lemma makes the original Float64 subtraction exact. */
export function relativeProjectionPixelError(origin:number,start:number,end:number,maximumRelativeMagnitude:number,pixelLength:number):number{
  // GLSL ES 3.00 section 4.5.1 allows subnormal flush-to-zero and division
  // error of 2.5 ULP only for normal denominators in [2^-126,2^126]. Use a
  // full-ULP relative bound plus a normal-minimum absolute FTZ allowance.
  const u=2**-23,tiny=2**-126,span=end-start,offset=start-origin;
  const fSpan=Math.fround(span),fOffset=Math.fround(offset),m=maximumRelativeMagnitude/(1-u)+tiny;
  if(![origin,start,end,m,pixelLength,fSpan,fOffset].every(Number.isFinite)||!(pixelLength>0)||Math.abs(fSpan)<tiny||Math.abs(fSpan)>2**126||m<0)return Infinity;
  const subtract64=(a:number,b:number)=>a===0||b===0||(Math.sign(a)===Math.sign(b)&&Math.abs(a)/2<=Math.abs(b)&&Math.abs(b)<=Math.abs(a)*2)?0:(Math.abs(a)+Math.abs(b))*Number.EPSILON;
  const subtraction64=origin===0||m<=Math.abs(origin)/2?0:(2*Math.abs(origin)+m)*Number.EPSILON;
  const inputError=m*u+tiny+subtraction64;
  const subtractError=(m+Math.abs(fOffset))*u+tiny;
  const numeratorError=inputError+Math.abs(offset-fOffset)+tiny+subtract64(start,origin)+subtractError;
  const numeratorMagnitude=m+Math.abs(offset);
  const quotientError=numeratorError/Math.abs(fSpan)+numeratorMagnitude*(Math.abs(span-fSpan)+subtract64(end,start))/(Math.abs(span)*Math.abs(fSpan));
  const quotientMagnitude=(m+Math.abs(fOffset)+subtractError)/Math.abs(fSpan);
  if(!Number.isFinite(quotientMagnitude)||quotientMagnitude>2**126)return Infinity;
  // 2.5 ULP division, unspecified rounding, then *2/-1 and viewport mapping.
  // ceil also covers the renderer's rounded physical viewport size.
  return (quotientError+(quotientMagnitude*16+8)*u+tiny)*Math.ceil(pixelLength);
}
