import {numericTickPositions,steppedTickPositions,type TickPositions} from './grid-layout.js';
const SECOND=1000,MINUTE=60*SECOND,HOUR=60*MINUTE,DAY=24*HOUR;

/** 候选第一阶段：只修正已观察的秒/分钟主格线分派。
 * 15s下界和1day上界是本库保守实现范围；不声明完整时间转换阈值。
 * 89,999/90,000ms及599,999/600,000ms的边界均有真实公开观察。
 * 返回的绘制坐标仍裁剪到原区间；formatter区间外候选不视为已绘制。
 */
export function timeTickPositions(start:number,end:number,axisSizePixels:number,intervalCount?:number,minorDensity?:Pick<TimeMinorProposalInput,'majorLabelWidth'|'minorLabelWidth'>):TickPositions {
  const previous=numericTickPositions(start,end,axisSizePixels,intervalCount),span=Math.abs(end-start);
  const step=span>=HOUR&&span<DAY?HOUR:span>=10*MINUTE&&span<HOUR?15*MINUTE:span>=90*SECOND&&span<10*MINUTE?MINUTE:span>=15*SECOND&&span<90*SECOND?15*SECOND:undefined;
  if(step===undefined)return previous;
  const major=steppedTickPositions(Math.min(start,end),Math.max(start,end),step),majorValues=new Set(major);
  const boundedMinor=minorDensity?timeMinorTickPositions({start,end,axisSizePixels,...minorDensity}):undefined;
  return{major,minor:boundedMinor?.minor??previous.minor.filter(value=>!majorValues.has(value)),step};
}

export interface TimeMinorProposalInput {start:number;end:number;axisSizePixels:number;majorLabelWidth:number;minorLabelWidth:number;}
export interface TimeMinorProposal {scope:'bounded-time';majorStep:number;minorStep:number|undefined;minor:number[];minimumCenterDistance:number;}
/** 有限范围的时间次格线：以时钟整数子格为候选，根据主/次文本实际宽度及15CSS间隔选择。
 * 15CSS是字号、宽度与未着色PNG布局条件共同约束下的本库间隔参数。62行仅名义格线吻合，不计运行验收。
 * 仅15s≤span<1h有支持；2h的15min/20min反例禁止向hour域泛化。
 */
export function timeMinorTickPositions(input:TimeMinorProposalInput):TimeMinorProposal|undefined {
  const {start,end,axisSizePixels,majorLabelWidth,minorLabelWidth}=input,span=Math.abs(end-start);
  if(!(span>=15*SECOND&&span<HOUR)||!(axisSizePixels>0)||![start,end,axisSizePixels,majorLabelWidth,minorLabelWidth].every(Number.isFinite)||majorLabelWidth<0||minorLabelWidth<0)return undefined;
  const majorStep=span<90*SECOND?15*SECOND:span<10*MINUTE?MINUTE:15*MINUTE;
  const base=majorStep===15*SECOND?SECOND:majorStep===MINUTE?5*SECOND:MINUTE;
  const minimumCenterDistance=(majorLabelWidth+minorLabelWidth)/2+15;
  let minorStep:number|undefined;
  for(let multiplier=1;multiplier<majorStep/base;multiplier++){
    const step=base*multiplier;
    if(majorStep%step!==0)continue;
    if(axisSizePixels*step/span>=minimumCenterDistance){minorStep=step;break;}
  }
  const major=new Set(steppedTickPositions(Math.min(start,end),Math.max(start,end),majorStep));
  const minor=minorStep===undefined?[]:steppedTickPositions(Math.min(start,end),Math.max(start,end),minorStep).filter(value=>!major.has(value));
  return{scope:'bounded-time',majorStep,minorStep,minor,minimumCenterDistance};
}
