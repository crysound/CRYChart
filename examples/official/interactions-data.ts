export interface XYPoint {x:number;y:number}

/** Closed boundaries count as selected. Invalid vertices never form an implicit edge. */
export function polygonContains(point:XYPoint,polygon:readonly XYPoint[]):boolean {
  if(polygon.length<3||![point.x,point.y,...polygon.flatMap(vertex=>[vertex.x,vertex.y])].every(Number.isFinite))return false;
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i],dx=b.x-a.x,dy=b.y-a.y,px=point.x-a.x,py=point.y-a.y;
    const tolerance=1e-10*Math.max(1,Math.abs(a.x),Math.abs(a.y),Math.abs(b.x),Math.abs(b.y));
    if(Math.abs(dx*py-dy*px)<=tolerance&&point.x>=Math.min(a.x,b.x)-tolerance&&point.x<=Math.max(a.x,b.x)+tolerance&&point.y>=Math.min(a.y,b.y)-tolerance&&point.y<=Math.max(a.y,b.y)+tolerance)return true;
    if((a.y>point.y)!==(b.y>point.y)&&point.x<a.x+(point.y-a.y)*dx/dy)inside=!inside;
  }
  return inside;
}

export function withTimeGaps(points:readonly XYPoint[],maximumInterval:number):XYPoint[]{
  if(!(maximumInterval>0&&Number.isFinite(maximumInterval)))throw new RangeError('The maximum sample interval must be finite and positive');
  const result:XYPoint[]=[];
  points.forEach((point,index)=>{const previous=points[index-1];if(previous&&point.x<previous.x)throw new RangeError('Time samples must be ordered');if(previous&&Number.isFinite(previous.y)&&Number.isFinite(point.y)&&point.x-previous.x>maximumInterval)result.push({x:previous.x+(point.x-previous.x)/2,y:NaN});result.push({...point});});
  return result;
}

/** Intersections of independently sampled values on the same monotonic X grid. */
export function alignedIntersections(first:readonly XYPoint[],second:readonly XYPoint[]):XYPoint[]{
  if(first.length!==second.length||first.some((point,index)=>point.x!==second[index].x))throw new RangeError('Both curves must share their X samples');
  const result:XYPoint[]=[];
  const append=(point:XYPoint)=>{const last=result.at(-1);if(!last||Math.abs(last.x-point.x)>1e-10||Math.abs(last.y-point.y)>1e-10)result.push(point);};
  for(let index=1;index<first.length;index++){
    const a=first[index-1],b=first[index],c=second[index-1],d=second[index];if(![a.x,a.y,b.x,b.y,c.y,d.y].every(Number.isFinite)||b.x<=a.x)continue;
    const left=a.y-c.y,right=b.y-d.y;if(left===0&&right===0)continue;if(left===0){append({x:a.x,y:a.y});continue;}if(right===0){append({x:b.x,y:b.y});continue;}if(Math.sign(left)===Math.sign(right))continue;
    const fraction=left/(left-right);append({x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction});
  }
  return result;
}
