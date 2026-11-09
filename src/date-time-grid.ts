/** Original calendar placement candidate. No reference implementation is used.
 * A calendar level and its display stride are separate decisions. The caller
 * supplies actual formatted label widths; no font or reference pixel scale is
 * inferred here. Calendar arithmetic never changes the source axis interval.
 */
export type CalendarUnit = 'millisecond'|'second'|'minute'|'hour'|'day'|'week'|'month'|'year'|'decade';
export type CalendarTickLevel = 'great'|'major'|'minor';
export type CalendarRange = Readonly<{start:number;end:number}>;
export interface CalendarTick {value:number;timestamp:number;label:string;level:CalendarTickLevel;anchor:number;}
export interface CalendarGridOptions {
  interval:CalendarRange;
  axisSizePixels:number;
  utc:boolean;
  origin?:number;
  format:(value:number,level:CalendarTickLevel,zoom:CalendarUnit)=>string;
  measure:(label:string,level:CalendarTickLevel)=>number;
  gapPixels?:number;
  /** Minimum clear space between adjacent minor labels, independently of the
   * clearance used when a minor label approaches a major label. */
  minorGapPixels?:number;
  maxTicks?:number;
  minorVisible?:boolean;
}
export interface CalendarGrid {
  zoom:CalendarUnit;
  major:CalendarTick[];
  minor:CalendarTick[];
  great:CalendarTick[];
  majorStep:number;
  minorStep:number|undefined;
  truncated:boolean;
}
const SECOND=1000,MINUTE=60*SECOND,HOUR=60*MINUTE,DAY=24*HOUR;
const units:readonly CalendarUnit[]=['millisecond','second','minute','hour','day','week','month','year','decade'];
const duration:Partial<Record<CalendarUnit,number>>={millisecond:1,second:SECOND,minute:MINUTE,hour:HOUR};
const steps:Record<CalendarUnit,readonly number[]>={
  millisecond:[1,2,5,10,20,50,100,200,500,1000],
  second:[1,2,3,5,10,15,20,30,60],minute:[1,2,3,5,10,15,20,30,60],
  hour:[1,2,3,6,12,24],day:[1,2,3,7,14,28],week:[1,2,3,4,8,13,26,52],
  month:[1,2,3,6,12],year:[1,2,5,10,20,50,100],decade:[1,2,5,10,20,50,100],
};
const validDate=(value:number)=>Number.isFinite(value)&&Number.isFinite(new Date(value).getTime());
const mod=(value:number,divisor:number)=>((value%divisor)+divisor)%divisor;
function part(date:Date,utc:boolean,name:'FullYear'|'Month'|'Date'|'Day'|'Hours'|'Minutes'|'Seconds'|'Milliseconds'):number {
  return (date as any)[`get${utc?'UTC':''}${name}`]();
}
function setPart(date:Date,utc:boolean,name:'FullYear'|'Month'|'Date'|'Hours',...values:number[]):number {
  return (date as any)[`set${utc?'UTC':''}${name}`](...values);
}

/** Calendar boundary at or before an absolute timestamp. Local days and weeks
 * use wall-calendar fields; a repeated DST hour retains its actual offset. */
export function floorCalendar(value:number,unit:CalendarUnit,utc:boolean):number {
  if(!validDate(value))return NaN;
  if(unit==='millisecond')return Math.floor(value);
  if(unit==='second')return Math.floor(value/SECOND)*SECOND;
  if(unit==='minute')return Math.floor(value/MINUTE)*MINUTE;
  const date=new Date(value);
  if(unit==='hour')return value-part(date,utc,'Minutes')*MINUTE-part(date,utc,'Seconds')*SECOND-part(date,utc,'Milliseconds');
  setPart(date,utc,'Hours',0,0,0,0);
  if(unit==='week')setPart(date,utc,'Date',part(date,utc,'Date')-mod(part(date,utc,'Day')-1,7));
  else if(unit==='month')setPart(date,utc,'Date',1);
  else if(unit==='year'||unit==='decade'){
    const year=part(date,utc,'FullYear');
    setPart(date,utc,'FullYear',unit==='decade'?Math.floor(year/10)*10:year,0,1);
  }
  return date.getTime();
}

/** Advance a known boundary. Months/years use calendar setters, not an average
 * millisecond duration; hours and smaller retain both occurrences at DST folds. */
export function advanceCalendar(value:number,unit:CalendarUnit,count:number,utc:boolean):number {
  if(!validDate(value)||!Number.isSafeInteger(count))return NaN;
  const elapsed=duration[unit];
  if(elapsed!==undefined){const next=value+count*elapsed;return validDate(next)?next:NaN;}
  const date=new Date(value);
  if(unit==='day'||unit==='week')setPart(date,utc,'Date',part(date,utc,'Date')+count*(unit==='week'?7:1));
  else if(unit==='month')setPart(date,utc,'Month',part(date,utc,'Month')+count);
  else setPart(date,utc,'FullYear',part(date,utc,'FullYear')+count*(unit==='decade'?10:1));
  return date.getTime();
}

/** Select the largest unit for which the range contains two whole unit lengths
 * from its first calendar boundary. This is a candidate policy, verified first
 * for the public week/month examples; it is not a claim of all-range parity. */
export function selectCalendarUnit(interval:CalendarRange,utc:boolean,origin=0):CalendarUnit {
  const low=Math.min(interval.start,interval.end)+origin,span=Math.abs(interval.end-interval.start);
  if(!validDate(low)||!Number.isFinite(span)||span<=0)return 'millisecond';
  for(let index=units.length-1;index>=1;index--){
    const unit=units[index]!,first=floorCalendar(low,unit,utc),second=advanceCalendar(first,unit,2,utc);
    if(Number.isFinite(second)&&second-first<=span)return unit;
  }
  return 'millisecond';
}

function calendarOrdinal(value:number,unit:CalendarUnit,utc:boolean):number {
  const date=new Date(value);
  if(unit==='month')return part(date,utc,'Month')+1;
  if(unit==='year')return part(date,utc,'FullYear');
  if(unit==='decade')return Math.floor(part(date,utc,'FullYear')/10);
  if(unit==='day')return part(date,utc,'Date')-1;
  if(unit==='hour')return part(date,utc,'Hours');
  if(unit==='minute')return part(date,utc,'Minutes');
  if(unit==='second')return part(date,utc,'Seconds');
  if(unit==='millisecond')return part(date,utc,'Milliseconds');
  // Only the civil date is used for this Monday index, so a DST offset cannot
  // move a whole week into a different stride bucket.
  const civil=new Date(0);civil.setUTCFullYear(part(date,utc,'FullYear'),part(date,utc,'Month'),part(date,utc,'Date'));civil.setUTCHours(0,0,0,0);
  return Math.floor((civil.getTime()-4*DAY)/(7*DAY));
}

export function calendarBoundaries(interval:CalendarRange,unit:CalendarUnit,utc:boolean,origin=0,limit=1000):{values:number[];truncated:boolean} {
  const low=Math.min(interval.start,interval.end)+origin,high=Math.max(interval.start,interval.end)+origin;
  if(!validDate(low)||!validDate(high)||!(high>=low)||!Number.isSafeInteger(limit)||limit<1)return{values:[],truncated:false};
  const values:number[]=[];let value=floorCalendar(low,unit,utc);
  if(value<low)value=advanceCalendar(value,unit,1,utc);
  for(;Number.isFinite(value)&&value<=high;){
    if(values.length>=limit)return{values,truncated:true};
    values.push(value-origin);
    const next=advanceCalendar(value,unit,1,utc);if(!(next>value))break;value=next;
  }
  return{values,truncated:false};
}

export function calendarTickGrid(options:CalendarGridOptions):CalendarGrid {
  const {interval,utc,format,measure}=options,origin=options.origin??0;
  const low=Math.min(interval.start,interval.end),high=Math.max(interval.start,interval.end),span=high-low;
  const zoom=selectCalendarUnit(interval,utc,origin);
  const empty=():CalendarGrid=>({zoom,major:[],minor:[],great:[],majorStep:1,minorStep:undefined,truncated:false});
  if(!validDate(low+origin)||!validDate(high+origin)||!Number.isFinite(origin)||!(span>0)||!Number.isFinite(options.axisSizePixels)||!(options.axisSizePixels>0))return empty();
  const pixels=options.axisSizePixels,gap=Math.max(0,options.gapPixels??20),limit=Math.max(2,Math.min(4096,Math.floor(options.maxTicks??1000)));
  let source=calendarBoundaries(interval,zoom,utc,origin,limit),resolution=1;
  if(source.truncated&&duration[zoom]!==undefined){
    // Do not enumerate a millisecond for every possible timestamp. Pick a
    // bounded unit stride before producing values, including both endpoints of
    // the supported one-second range without returning a blank axis.
    const elapsed=duration[zoom]!;
    for(const step of steps[zoom])if(Math.ceil(span/(elapsed*step))+1<=limit){
      resolution=step;const values:number[]=[];const stepMS=elapsed*step;
      for(let at=Math.ceil((low+origin)/stepMS)*stepMS;at<=high+origin&&values.length<limit;at+=stepMS)values.push(at-origin);
      source={values,truncated:false};break;
    }
  }
  if(source.truncated)return{...empty(),truncated:true};
  const make=(value:number,level:CalendarTickLevel,anchor=value):CalendarTick=>({value,timestamp:value+origin,label:String(format(value,level,zoom)),level,anchor});
  const width=(tick:CalendarTick)=>{const size=measure(tick.label,tick.level);return Number.isFinite(size)&&size>=0?size:Infinity;};
  const location=(tick:CalendarTick)=>(tick.anchor-low)/span*pixels;
  const collides=(a:CalendarTick,b:CalendarTick,separation=gap)=>Math.abs(location(a)-location(b))<(width(a)+width(b))/2+separation;
  const all=source.values.map(value=>make(value,'major'));
  let major:CalendarTick[]=all,majorStep=1;
  for(const step of steps[zoom].filter(step=>step>=resolution)){
    const candidate=all.filter(tick=>mod(calendarOrdinal(tick.timestamp,zoom,utc),step)===0);
    if(candidate.length&&candidate.every((tick,index)=>index===0||!collides(candidate[index-1]!,tick))){major=candidate;majorStep=step;break;}
  }
  if(major.some((tick,index)=>index>0&&collides(major[index-1]!,tick))){
    // A very long user label remains unchanged. Keep one contextual tick rather
    // than hanging or silently shortening the label.
    major=major.length?[major[0]!]:[];
  }
  let minor:CalendarTick[]=[],minorStep:number|undefined;
  const index=units.indexOf(zoom),minorUnit=units[Math.max(0,index-1)]!;
  // Once major units have to be skipped, finer units cannot add a useful named
  // level. Keeping it empty also prevents a seconds loop on a year-scale axis.
  if(options.minorVisible!==false&&index>0&&majorStep===1){
    const parents:number[]=[];let parent=floorCalendar(low+origin,zoom,utc);
    while(Number.isFinite(parent)&&parent<=high+origin&&parents.length<limit){parents.push(parent);const next=advanceCalendar(parent,zoom,1,utc);if(!(next>parent))break;parent=next;}
    for(const step of steps[minorUnit]){
      const candidates:CalendarTick[]=[];let overflow=false;
      for(const from of parents){
        const to=advanceCalendar(from,zoom,1,utc);
        // A month boundary need not be a Monday. Start from the child's own
        // calendar boundary so month/week subdivisions remain actual Mondays.
        let at=advanceCalendar(floorCalendar(from,minorUnit,utc),minorUnit,step,utc);
        while(Number.isFinite(at)&&at<to){
          const value=at-origin;
          if(value>=low&&value<=high){
            candidates.push(make(value,'minor'));
          }
          if(candidates.length>=limit){overflow=true;break;}
          const next=advanceCalendar(at,minorUnit,step,utc);if(!(next>at))break;at=next;
        }
        if(overflow)break;
      }
      // Decide the finer level's spacing before major-label collisions remove
      // individual ticks. Otherwise a dense step can appear sparse by accident.
      if(!overflow&&candidates.length&&candidates.every((tick,i)=>i===0||!collides(candidates[i-1]!,tick,Math.max(gap,options.minorGapPixels??gap)))){minor=candidates.filter(tick=>!major.some(majorTick=>collides(majorTick,tick)));minorStep=step;break;}
    }
  }
  const greatUnit=units[Math.min(units.length-1,index+1)]!;
  const context=floorCalendar(low+origin,greatUnit,utc)-origin;
  const great=[make(context,'great',low)];
  return{zoom,major,minor,great,majorStep,minorStep,truncated:false};
}
