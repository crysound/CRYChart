/** Original time formatting and placement helpers, specified by observable output. */
export const millisecondsPerDay = 86_400_000;
const pad = (value: number, length = 2) => String(value).padStart(length, '0');

export function elapsedLabel(milliseconds: number, digits = 0) {
  const factor = 10 ** digits, units = Math.round(Math.abs(milliseconds) * factor / 1000);
  const seconds = Math.floor(units / factor), fraction = units - seconds * factor;
  return `${milliseconds < 0 && units !== 0 ? '-' : ''}${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}${digits ? `.${pad(fraction, digits)}` : ''}`;
}

export function durationTicks(start: number, end: number, count = 8) {
  const steps = [0.000001,0.000002,0.000005,0.00001,0.00002,0.00005,0.0001,0.0002,0.0005,0.001,0.002,0.005,0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000,2000,5000,10000,15000,30000,60000,120000,300000,600000,900000,1800000,3600000,7200000,18000000,36000000,86400000];
  const span = Math.abs(end - start), low = Math.min(start,end), high = Math.max(start,end), step = steps.find(value => span / value <= count) ?? 86400000;
  const digits = step >= 1000 ? 0 : Math.max(3, Math.min(9, Math.ceil(-Math.log10(step / 1000))));
  const ticks = [];
  for(let index = Math.ceil(low / step - 1e-9), guard = 0; index * step <= high + step * 1e-8 && guard < count + 3; index++,guard++) {
    const position = Number((index * step).toPrecision(15));
    ticks.push({position,label:elapsedLabel(position,digits)});
  }
  return ticks;
}

export function calendarTicks(start: number, end: number, locale = 'zh-CN') {
  const span = end-start, result:Array<{position:number;label:string}>=[], first=new Date(start);
  if(span > millisecondsPerDay * 100) {
    const monthStep=span>millisecondsPerDay*365*6?12:span>millisecondsPerDay*365*2?3:span>millisecondsPerDay*365?2:1;
    let month=first.getUTCFullYear()*12+first.getUTCMonth();
    month=Math.ceil(month/monthStep)*monthStep;
    for(let guard=0;guard<30;guard++,month+=monthStep){const position=Date.UTC(Math.floor(month/12),month%12,1);if(position<start)continue;if(position>end)break;const date=new Date(position);result.push({position,label:new Intl.DateTimeFormat(locale,date.getUTCMonth()===0||monthStep===12?{year:'numeric',timeZone:'UTC'}:{month:'short',timeZone:'UTC'}).format(date)});}
  } else if(span > millisecondsPerDay*2) {
    const step=span>millisecondsPerDay*50?7*millisecondsPerDay:span>millisecondsPerDay*15?2*millisecondsPerDay:millisecondsPerDay;
    for(let position=Math.ceil(start/step)*step;position<=end&&result.length<30;position+=step){const date=new Date(position);result.push({position,label:new Intl.DateTimeFormat(locale,date.getUTCDate()===1?{month:'long',timeZone:'UTC'}:{month:'numeric',day:'numeric',timeZone:'UTC'}).format(date)});}
  } else {
    const midnight=Math.floor(start/millisecondsPerDay)*millisecondsPerDay;
    for(const tick of durationTicks(start-midnight,end-midnight))result.push({position:tick.position+midnight,label:tick.label});
  }
  return result;
}

export function visibleExtent(count: number, pointAt: (index:number)=>{x:number;y:number}, start:number,end:number, margin = .04) {
  let left=0,right=count;
  while(left<right){const middle=(left+right)>>>1;if(pointAt(middle).x<start)left=middle+1;else right=middle;}
  const first=left;let min=Infinity,max=-Infinity,samples=0;
  const include=(y:number)=>{if(Number.isFinite(y)){min=Math.min(min,y);max=Math.max(max,y);samples++;}};
  for(let index=first;index<count;index++){const point=pointAt(index);if(point.x>end)break;include(point.y);}
  // Boundary segments are visible even when neither endpoint falls inside the interval.
  for(const boundary of [start,end]){
    let lo=0,hi=count;while(lo<hi){const mid=(lo+hi)>>>1;if(pointAt(mid).x<boundary)lo=mid+1;else hi=mid;}
    if(lo>0&&lo<count){const a=pointAt(lo-1),b=pointAt(lo);if(b.x>a.x&&a.x<=boundary&&b.x>=boundary)include(a.y+(b.y-a.y)*(boundary-a.x)/(b.x-a.x));}
  }
  if(!samples)return undefined;
  const padding=Math.max((max-min)*margin,Math.abs(max)*1e-7,1e-7);
  return{start:min-padding,end:max+padding,dataMin:min,dataMax:max,samples};
}

export function formatNanosecondTimestamp(epoch: bigint) {
  const billion=1_000_000_000n,seconds=epoch/billion,fraction=epoch%billion;
  const date=new Date(Number(seconds*1000n));
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${String(fraction<0n?-fraction:fraction).padStart(9,'0')}`;
}
