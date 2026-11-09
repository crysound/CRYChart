import type {Axis} from './axis.js';
import type {Interval} from './contracts.js';

/** Each parallel axis column partitions its own stacks on one plotting surface. */
export function layoutAxisStacks(axes:readonly Axis[],length:number){
 const parallels=new Map<string,Axis[]>();
 for(const axis of axes){const key=`${axis.opposite}:${axis.iParallel}`,group=parallels.get(key)??[];group.push(axis);parallels.set(key,group);}
 const result=new Map<Axis,{range:Interval;lane:number}>();
 for(const opposite of [false,true]){
  const groups=[...parallels.values()].filter(group=>group[0].opposite===opposite).sort((a,b)=>a[0].iParallel-b[0].iParallel);let lane=0;
  for(const group of groups){for(const [axis,range]of stackRanges(group,length))result.set(axis,{range,lane});if(group.some(axis=>axis.visible))lane++;}
 }
 return result;
}
function stackRanges(axes:readonly Axis[],length:number){
 const ordered=[...axes].sort((a,b)=>a.iStack-b.iStack);
 const requirements=ordered.map(axis=>{const value=axis.getLength(),pixels=typeof value==='object'&&'pixels'in value?value.pixels:0,relative=pixels?0:typeof value==='number'?value:'relative'in value?value.relative:1;return{pixels,relative};});
 const fixed=requirements.reduce((sum,value)=>sum+value.pixels,0),weight=requirements.reduce((sum,value)=>sum+value.relative,0),budget=Math.max(1,length),fixedScale=fixed>=budget?budget/(fixed+weight):1,remaining=Math.max(0,budget-fixed*fixedScale);
 const result=new Map<Axis,Interval>();let offset=0;
 ordered.forEach((axis,index)=>{const requirement=requirements[index],size=requirement.pixels?requirement.pixels*fixedScale:remaining*requirement.relative/(weight||1),start=offset/budget,end=index===ordered.length-1&&(weight>0||fixed>=budget)?1:(offset+size)/budget;offset+=size;
  result.set(axis,{start,end});
 });
 return result;
}
export function parallelAxisCount(axes:readonly Axis[],opposite:boolean){return new Set(axes.filter(axis=>axis.visible&&axis.opposite===opposite).map(axis=>axis.iParallel)).size;}

/** Expand a data domain so a shared GPU viewport maps it into one axis stack. */
export function domainForStack(domain:Interval,range:Interval):Interval{
 if(range.start===0&&range.end===1)return domain;
 const span=(domain.end-domain.start)/(range.end-range.start),start=domain.start-range.start*span;
 return{start,end:start+span};
}
