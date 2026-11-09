export interface ImageDatum {id:number;x:number;y:number;kind:string;channel?:number;label?:string}
export interface ImageRect {left:number;top:number;width:number;height:number}
export interface ImageInterval {start:number;end:number}
export const reviewEpoch=Date.UTC(2026,0,5),reviewDay=86400000;

/** Original deterministic review data, independent of all chart rendering. */
export function reviewRecords(days=30,perDay=12):ImageDatum[]{
  if(!Number.isInteger(days)||days<1||!Number.isInteger(perDay)||perDay<1)throw new RangeError('Review dimensions must be positive integers');
  const result:ImageDatum[]=[];
  for(let day=0;day<days;day++)for(let sample=0;sample<perDay;sample++){
    const id=day*perDay+sample,kind=['unhappy','neutral','happy'][(day*5+sample*7)%3];
    result.push({id,x:6+((id*137+day*31)%1020)/60,y:reviewEpoch+(day+((sample*83+day*17)%1000)/1000)*reviewDay,kind,label:`Review ${id+1}`});
  }
  return result;
}

/** A bounded original signal: event icons mark actual sampled upward crossings. */
export function eventSignal(index:number):number{return 50+28*Math.sin(index*.026)+8*Math.sin(index*.109);}
export function eventCrossings(points:readonly{x:number;y:number}[],threshold=70):ImageDatum[]{
  const result:ImageDatum[]=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(Number.isFinite(a.y)&&Number.isFinite(b.x)&&Number.isFinite(b.y)&&a.y<threshold&&b.y>=threshold)result.push({id:i,x:b.x,y:b.y,kind:'event',label:`Threshold ${threshold}`});
  }
  return result;
}

/** Convert a drop through the current plot, never through cached CSS dimensions. */
export function dropCoordinate(point:{x:number;y:number},rect:ImageRect,x:ImageInterval,y:ImageInterval):{x:number;y:number}|undefined{
  if(![point.x,point.y,rect.left,rect.top,rect.width,rect.height,x.start,x.end,y.start,y.end].every(Number.isFinite)||rect.width<=0||rect.height<=0||x.start===x.end||y.start===y.end)return;
  if(point.x<rect.left||point.x>rect.left+rect.width||point.y<rect.top||point.y>rect.top+rect.height)return;
  return{x:x.start+(point.x-rect.left)/rect.width*(x.end-x.start),y:y.end-(point.y-rect.top)/rect.height*(y.end-y.start)};
}

/** Match only the clipped image rectangle; overlapping images use draw order. */
export function imageHit(point:{x:number;y:number},rectangles:readonly{datum:ImageDatum;bounds:ImageRect;clip:ImageRect}[]):ImageDatum|undefined{
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
  for(let i=rectangles.length-1;i>=0;i--){const{datum,bounds:b,clip:c}=rectangles[i];if(point.x>=Math.max(b.left,c.left)&&point.x<=Math.min(b.left+b.width,c.left+c.width)&&point.y>=Math.max(b.top,c.top)&&point.y<=Math.min(b.top+b.height,c.top+c.height))return datum;}
}

// Deliberately original office plan and signal; no reference artwork or code.
export const officeRooms=Object.freeze([
  {x:5,y:42,width:35,height:28,name:'Meeting room'},
  {x:40,y:5,width:50,height:65,name:'Open workspace'},
  {x:5,y:5,width:35,height:37,name:'Quiet rooms'}
]);
export function officeCategory(x:number,y:number):number{
  if(!Number.isFinite(x)||!Number.isFinite(y)||!officeRooms.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height))return 0;
  const distance=Math.hypot(x-61,y-14)+(x<40?12:0)+(y>42?6:0);
  return distance<22?3:distance<43?2:1;
}
export function officeGrid(columns=90,rows=70):Float32Array{
  if(!Number.isInteger(columns)||columns<1||!Number.isInteger(rows)||rows<1)throw new RangeError('Office grid dimensions must be positive integers');
  const values=new Float32Array(columns*rows);
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++)values[row*columns+column]=officeCategory((column+.5)*100/columns,(row+.5)*75/rows);
  return values;
}
