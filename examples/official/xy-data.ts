import {random} from '../signals.js';

export interface PointColumns {x:Float64Array;y:Float64Array}
export function correlatedCloud(count:number,seed=20016):PointColumns {
  const rng=random(seed),x=new Float64Array(count),y=new Float64Array(count);
  for(let i=0;i<count;i++){
    const r=Math.sqrt(-2*Math.log(Math.max(1e-12,rng()))),angle=2*Math.PI*rng(),a=r*Math.cos(angle),b=r*Math.sin(angle);
    x[i]=a*.71;y[i]=(.68*a+Math.sqrt(1-.68**2)*b)*.45;
  }
  return{x,y};
}
/** Welford covariance; the ellipse is derived from every finite sample, not a fixed decoration. */
export function confidenceEllipse(data:PointColumns,probability=.95,segments=256){
  if(!(probability>0&&probability<1)||segments<8)throw new RangeError('Invalid confidence ellipse parameters');
  let count=0,mx=0,my=0,xx=0,yy=0,xy=0;
  for(let i=0;i<data.x.length;i++){const x=data.x[i],y=data.y[i];if(!Number.isFinite(x)||!Number.isFinite(y))continue;count++;const dx=x-mx,dy=y-my;mx+=dx/count;my+=dy/count;xx+=dx*(x-mx);yy+=dy*(y-my);xy+=dx*(y-my);}
  if(count<2)throw new RangeError('At least two finite samples are required');
  xx/=count-1;yy/=count-1;xy/=count-1;
  const discriminant=Math.hypot(xx-yy,2*xy),major=Math.max(0,(xx+yy+discriminant)/2),minor=Math.max(0,(xx+yy-discriminant)/2),angle=.5*Math.atan2(2*xy,xx-yy),threshold=-2*Math.log(1-probability),a=Math.sqrt(major*threshold),b=Math.sqrt(minor*threshold),c=Math.cos(angle),s=Math.sin(angle);
  const points=Array.from({length:segments+1},(_,i)=>{const t=i/segments*2*Math.PI,u=a*Math.cos(t),v=b*Math.sin(t);return{x:mx+c*u-s*v,y:my+s*u+c*v};});
  return{count,mean:{x:mx,y:my},covariance:{xx,xy,yy},probability,threshold,angle,axes:{major:a,minor:b},points};
}
/** Counting-sort spatial index; all original point indices remain present exactly once. */
export function spatialIndex(data:PointColumns,resolution=128){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let i=0;i<data.x.length;i++)if(Number.isFinite(data.x[i])&&Number.isFinite(data.y[i])){x0=Math.min(x0,data.x[i]);x1=Math.max(x1,data.x[i]);y0=Math.min(y0,data.y[i]);y1=Math.max(y1,data.y[i]);}
  if(!Number.isFinite(x0))return{size:0,nearest:()=>undefined as number|undefined};
  const dx=x1-x0||1,dy=y1-y0||1,cell=(value:number,origin:number,span:number)=>Math.max(0,Math.min(resolution-1,Math.floor((value-origin)/span*resolution))),counts=new Uint32Array(resolution*resolution),offsets=new Uint32Array(counts.length+1);
  for(let i=0;i<data.x.length;i++)if(Number.isFinite(data.x[i])&&Number.isFinite(data.y[i]))counts[cell(data.y[i],y0,dy)*resolution+cell(data.x[i],x0,dx)]++;
  for(let i=0;i<counts.length;i++)offsets[i+1]=offsets[i]+counts[i];
  const next=offsets.slice(),indices=new Uint32Array(offsets[offsets.length-1]);
  for(let i=0;i<data.x.length;i++)if(Number.isFinite(data.x[i])&&Number.isFinite(data.y[i])){const bin=cell(data.y[i],y0,dy)*resolution+cell(data.x[i],x0,dx);indices[next[bin]++]=i;}
  return{size:indices.length,nearest(x:number,y:number,radiusX:number,radiusY:number):number|undefined{
    if(!(radiusX>0&&radiusY>0)||x+radiusX<x0||x-radiusX>x1||y+radiusY<y0||y-radiusY>y1)return;
    const minX=cell(x-radiusX,x0,dx),maxX=cell(x+radiusX,x0,dx),minY=cell(y-radiusY,y0,dy),maxY=cell(y+radiusY,y0,dy);let best=1,result:number|undefined;
    for(let row=minY;row<=maxY;row++)for(let col=minX;col<=maxX;col++){const bin=row*resolution+col;for(let j=offsets[bin];j<offsets[bin+1];j++){const i=indices[j],distance=((data.x[i]-x)/radiusX)**2+((data.y[i]-y)/radiusY)**2;if(distance<best){best=distance;result=i;}}}
    return result;
  }};
}
export function lineWalk(count:number,seed:number){const rng=random(seed),x=new Float64Array(count),y=new Float64Array(count);let value=0;for(let i=0;i<count;i++){value+=(rng()-.5)*3;x[i]=i;y[i]=value;}return{x,y};}
export function cytometryCloud(count=100000,seed=20019){
  const rng=random(seed),x=new Float64Array(count),y=new Float64Array(count),size=128,counts=new Uint32Array(size*size),bins=new Uint32Array(count);
  const groups=[[.53,1.65e6,.27e6,.25e6,.08e6],[.33,2.65e6,.45e6,.37e6,.12e6],[.10,3.2e6,.95e6,.60e6,.26e6],[.04,6.2e6,.55e6,1.6e6,.32e6]];
  for(let i=0;i<count;i++){let q=rng(),group=groups[groups.length-1];for(const candidate of groups){q-=candidate[0];if(q<0){group=candidate;break;}}const r=Math.sqrt(-2*Math.log(Math.max(rng(),1e-12))),a=2*Math.PI*rng();x[i]=Math.max(.1e6,group[1]+r*Math.cos(a)*group[3]);y[i]=group[2]+r*Math.sin(a)*group[4];const col=Math.max(0,Math.min(size-1,Math.floor(x[i]/10e6*size))),row=Math.max(0,Math.min(size-1,Math.floor((y[i]+.2e6)/2e6*size)));bins[i]=row*size+col;counts[bins[i]]++;}
  const value=new Float32Array(count);let maximum=0;for(let i=0;i<count;i++){const col=bins[i]%size,row=Math.floor(bins[i]/size);let density=0;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const xx=col+ox,yy=row+oy;if(xx>=0&&xx<size&&yy>=0&&yy<size)density+=counts[yy*size+xx];}value[i]=density;maximum=Math.max(maximum,density);}
  return{x,y,value,maximum,count,densityMethod:'3 by 3 cells of a fixed 128 by 128 grid',cellSize:{x:10e6/size,y:2e6/size}};
}
export function syncAxes(axes:any[]){let changing=false;const tokens=axes.map(axis=>axis.onIntervalChange(()=>{if(changing)return;changing=true;try{const interval=axis.getInterval();for(const other of axes)if(other!==axis)other.setInterval({start:interval.start,end:interval.end});}finally{changing=false;}}));return()=>axes.forEach((axis,index)=>axis.offIntervalChange(tokens[index]));}
export interface TimeAnnotation{id:number;start:number;end:number;text:string;color:string;lane:number}
export function resizeAnnotation(value:TimeAnnotation,side:'start'|'end',position:number,minSpan=1){if(!Number.isFinite(position))return;value[side]=side==='start'?Math.min(position,value.end-minSpan):Math.max(position,value.start+minSpan);}
