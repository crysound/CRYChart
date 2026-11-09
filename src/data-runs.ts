import type {DataColumnRuns} from './core/data.js';
import type {Interval} from './contracts.js';
import {PagedColumnCursor, readPagedValue} from './core/paged-columns.js';

function firstAffineRun(view:Extract<DataColumnRuns,{kind:'affine'}>,absolute:number){let lo=view.runStart,hi=view.runs.length;while(lo<hi){const middle=lo+Math.floor((hi-lo)/2),run=view.runs[middle];if(run.firstIndex+run.count<=absolute)lo=middle+1;else hi=middle;}return lo;}

/** Scan dense values or exact per-append affine endpoints without allocating a time column. */
export function boundsFromRuns(view:DataColumnRuns,from=0):Interval|undefined{
 let min=Infinity,max=-Infinity;
 const include=(value:number)=>{if(Number.isFinite(value)){min=Math.min(min,value);max=Math.max(max,value);}};
 if(view.kind==='dense'){
  let offset=0;for(const values of view.slices){for(let i=Math.max(0,from-offset);i<values.length;i++)include(values[i]);offset+=values.length;}
 }else if(view.kind==='paged'){
  const cursor=new PagedColumnCursor(view,view.firstIndex+Math.max(0,from));
  while(cursor.values){const values=cursor.values;for(let i=cursor.offset,end=i+cursor.length;i<end;i++)include(values[i]);cursor.next();}
 }else{
  const first=view.firstIndex+from,end=view.firstIndex+view.count;
  for(let i=firstAffineRun(view,first);i<view.runs.length;i++){const run=view.runs[i],lo=Math.max(first,run.firstIndex),hi=Math.min(end,run.firstIndex+run.count)-1;if(hi<lo)continue;const value=(index:number)=>run.start+(index-run.firstIndex)*run.step,a=value(lo),b=value(hi);include(a);include(b);
   if(Number.isFinite(a)&&!Number.isFinite(b)){let left=lo,right=hi;while(left<right){const middle=left+Math.ceil((right-left)/2);if(Number.isFinite(value(middle)))left=middle;else right=middle-1;}include(value(left));}
  }
 }
 return min===Infinity?undefined:{start:min,end:max};
}
export function firstRunValue(view:DataColumnRuns|undefined){
 if(!view||!view.count)return NaN;
 if(view.kind==='dense')return view.slices[0]?.[0]??NaN;
 if(view.kind==='paged')return readPagedValue(view,view.firstIndex)??NaN;
 const run=view.runs[view.runStart];return run?run.start+(view.firstIndex-run.firstIndex)*run.step:NaN;
}
/** Write one interleaved coordinate directly. Affine batch origins must not be reassociated. */
export function projectRuns(view:DataColumnRuns,positions:Float32Array,dimension:0|1,from:number,origin:number,logarithmic:boolean){
 if(view.kind==='dense'){
  let offset=0;for(const values of view.slices){for(let i=Math.max(0,from-offset);i<values.length;i++){const value=values[i];positions[(offset+i)*2+dimension]=(logarithmic?Math.log10(value):value)-origin;}offset+=values.length;}
 }else if(view.kind==='paged'){
  const cursor=new PagedColumnCursor(view,view.firstIndex+Math.max(0,from));
  while(cursor.values){const values=cursor.values,base=cursor.absoluteIndex-view.firstIndex-cursor.offset;for(let i=cursor.offset,end=i+cursor.length;i<end;i++){const value=values[i];positions[(base+i)*2+dimension]=(logarithmic?Math.log10(value):value)-origin;}cursor.next();}
 }else{
  const first=view.firstIndex+from,end=view.firstIndex+view.count;
  for(let i=firstAffineRun(view,first);i<view.runs.length;i++){const run=view.runs[i],lo=Math.max(first,run.firstIndex),hi=Math.min(end,run.firstIndex+run.count);for(let absolute=lo;absolute<hi;absolute++){const value=run.start+(absolute-run.firstIndex)*run.step;positions[(absolute-view.firstIndex)*2+dimension]=(logarithmic?Math.log10(value):value)-origin;}}
 }
}

/** Preserve the single dense pass used by ordinary explicit XY inputs. */
export function projectXYRuns(x:DataColumnRuns,y:DataColumnRuns,positions:Float32Array,from:number,origin:{x:number;y:number},logX:boolean,logY:boolean){
 let monotonic=true,strict=true;
 if(x.kind==='dense'&&y.kind==='dense'&&x.slices.length===y.slices.length&&x.slices.every((slice,i)=>slice.length===y.slices[i].length)){
  let offset=0;for(let part=0;part<x.slices.length;part++){const xs=x.slices[part],ys=y.slices[part];for(let i=Math.max(0,from-offset);i<xs.length;i++){const j=(offset+i)*2;positions[j]=(logX?Math.log10(xs[i]):xs[i])-origin.x;positions[j+1]=(logY?Math.log10(ys[i]):ys[i])-origin.y;if(!Number.isFinite(positions[j])||(j>0&&positions[j]<positions[j-2]))monotonic=false;if(!Number.isFinite(positions[j])||(j>0&&positions[j]<=positions[j-2]))strict=false;}offset+=xs.length;}
 }else{
  projectRuns(x,positions,0,from,origin.x,logX);projectRuns(y,positions,1,from,origin.y,logY);
  for(let i=from;i<x.count;i++){const j=i*2;if(!Number.isFinite(positions[j])||(j>0&&positions[j]<positions[j-2]))monotonic=false;if(!Number.isFinite(positions[j])||(j>0&&positions[j]<=positions[j-2]))strict=false;}
 }
 return{monotonic,strict};
}
