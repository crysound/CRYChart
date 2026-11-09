import {pointStrokeRadius} from './point-stroke-geometry.js';
import type {DrawPacket} from './contracts.js';
import type {DataSetXY} from './core/data.js';
import {getColumnOrder} from './data-order.js';

/** Source-precision segment range for a linear X axis. Ordering must hold over
 * the entire retained column. The result uses absolute sample indices and does
 * not create snapshots of implicit time columns or discard retained history.
 */
export function visibleSourceSegments(data:DataSetXY,column:string,interval:{start:number;end:number},plotWidth:number,thickness:number):{first:number;end:number}|undefined{
  if(!Number.isFinite(interval.start)||!Number.isFinite(interval.end)||!(plotWidth>0)||!Number.isFinite(plotWidth)||!Number.isFinite(thickness)||thickness<0)return undefined;
  const order=getColumnOrder(data,column),n=order.sampleCount,offset=order.firstIndex;
  if(!order.strict)return undefined;
  if(n<2)return {first:offset,end:offset};
  const padding=Math.abs(interval.end-interval.start)*(thickness*2+2)/plotWidth;
  const minimum=Math.min(interval.start,interval.end)-padding,maximum=Math.max(interval.start,interval.end)+padding;
  if(!Number.isFinite(minimum)||!Number.isFinite(maximum))return undefined;
  const search=(value:number,inclusive:boolean)=>{let low=0,high=n;while(low<high){const middle=low+Math.floor((high-low)/2),x=data.getValue(column,middle)!;if(x<value||(inclusive&&x===value))low=middle+1;else high=middle;}return low;};
  // The existing whole-column strict certificate and finite padded bounds
  // have already been checked. A covered retained endpoint proves that side
  // of the original binary search without changing any source expression.
  const firstX=data.getValue(column,0)!,lastX=data.getValue(column,n-1)!;
  const first=minimum<=firstX?0:Math.max(0,search(minimum,false)-1),end=maximum>=lastX?n-1:Math.min(n-1,search(maximum,true));
  return {first:offset+Math.min(first,end),end:offset+end};
}

/** Select all potentially visible samples without resampling or copying geometry. */
export function visibleSampleRange(packet:DrawPacket,plotWidth:number){
  const n=packet.count;
  const ownedFirst=packet.drawFirst??0,ownedCount=packet.drawCount??n,ownedEnd=ownedFirst+ownedCount;
  if(!Number.isSafeInteger(ownedFirst)||!Number.isSafeInteger(ownedCount)||ownedFirst<0||ownedCount<0||ownedEnd>n)throw new RangeError('Draw range exceeds stored samples');
  const intersect=(first:number,end:number)=>{const clippedFirst=Math.max(ownedFirst,first),clippedEnd=Math.min(ownedEnd,end);return{first:Math.min(clippedFirst,ownedEnd),count:Math.max(0,clippedEnd-clippedFirst)};};
  if(!packet.monotonicX||packet.pointSizes||n===0)return {first:ownedFirst,count:ownedCount};
  const a=packet.domain.x.start-packet.origin.x,b=packet.domain.x.end-packet.origin.x;
  const radius=packet.mode==='points'?pointStrokeRadius(packet.pointSize,packet.pointStrokeThickness??0,packet.pointShape??1):packet.thickness*2+2;
  const pad=Math.abs(b-a)*radius/Math.max(1,plotWidth),min=Math.min(a,b)-pad,max=Math.max(a,b)+pad;
  if(!Number.isFinite(min)||!Number.isFinite(max))return {first:ownedFirst,count:ownedCount};
  const search=(value:number,inclusive:boolean)=>{let low=0,high=n;while(low<high){const mid=(low+high)>>>1,x=packet.positions[mid*2]!;if(x<value||(inclusive&&x===value))low=mid+1;else high=mid;}return low;};
  const lower=search(min,false),upper=search(max,true);
  // Keep the crossing segment and its real GPU neighbor attributes at each edge.
  const first=packet.mode==='line'?Math.max(0,lower-1):lower;
  const end=packet.mode==='line'?Math.min(n,upper+1):upper;
  return intersect(first,end);
}
