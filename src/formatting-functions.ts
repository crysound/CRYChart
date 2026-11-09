export interface FormattingRange { start:number; end:number; }
export type FormattingFunction=(value:number,range:FormattingRange,locale?:string,shiftInfo?:{valueShifted:number;shiftOrigin:number})=>string;

/** Decimal display resolution follows the range, never a rounded source copy. */
export function formatNumeric(value:number,range:FormattingRange):string {
  const span=Math.abs(range.end-range.start);
  const decimals=Number.isFinite(span)&&span>0?Math.max(0,Math.min(100,2-Math.floor(Math.log10(span)))):0;
  return value.toFixed(decimals);
}
/** Nonzero scientific values retain three significant digits. */
export function formatScientific(value:number,range:FormattingRange):string {
  if(value!==0)return value.toExponential(2);
  const maximum=Math.max(Math.abs(range.start),Math.abs(range.end));
  const exponent=maximum>0&&Number.isFinite(maximum)?Math.floor(Math.log10(maximum)):0;
  return `0.00e${exponent<0?'':'+'}${exponent}`;
}
export const FormattingFunctions=Object.freeze({Numeric:formatNumeric,Scientific:formatScientific});
