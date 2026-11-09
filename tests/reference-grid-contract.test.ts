// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {Axis,NumericTickStrategy,TickStyle,type AxisHost} from '../src/axis';
import {drawAxisCanvas} from '../src/axis-canvas';
import {numericTickPositions,logarithmicTickPositions} from '../src/grid-layout';
import {ChartXY,Polar} from '../src/chart';
import {SolidLine,SolidFill,ColorRGBA,emptyLine,emptyFill} from '../src/core/styles';

const major60=[0,10,20,30,40,50,60];
const minor60=Array.from({length:31},(_,i)=>i*2).filter(v=>v%10!==0);
test('publicly observed 0..60 has 10-unit major and 2-unit minor ticks at both actual plot sizes',()=>{
  for(const pixels of [495,527,642.857,682.906]){
    const result=numericTickPositions(0,60,pixels);
    assert.deepEqual(result.major,major60);assert.deepEqual(result.minor,minor60);
  }
});
test('decimal, negative, reversed and resized intervals remain finite and distinct',()=>{
  const small=numericTickPositions(.001,.007,495);
  assert.deepEqual(small.major,[.001,.002,.003,.004,.005,.006,.007]);
  assert.deepEqual(numericTickPositions(60,0,527),numericTickPositions(0,60,527));
  const negative=numericTickPositions(-23,37,527);
  assert.deepEqual(negative.major,[-20,-10,0,10,20,30]);
  for(const value of [...negative.major,...negative.minor])assert.ok(value>=-23&&value<=37);
  assert.ok(numericTickPositions(0,60,250).major.length<numericTickPositions(0,60,1000).major.length);
  assert.deepEqual(numericTickPositions(NaN,60,500).major,[]);
});

test('tiny and shifted finite intervals retain distinct IEEE tick values',()=>{
  const tiny=numericTickPositions(0,1e-16,527);
  assert.deepEqual(tiny.major,[0,1e-17,2e-17,3e-17,4e-17,5e-17,6e-17,7e-17,8e-17,9e-17,1e-16]);
  assert.equal(new Set(tiny.minor).size,tiny.minor.length);assert.ok(tiny.minor.every(v=>v>0&&v<1e-16));
  const subnormal=numericTickPositions(0,1e-200,527);assert.ok(subnormal.major.length>2);assert.ok(subnormal.major.some(v=>v>0));
  const shifted=numericTickPositions(1e-12,1.0001e-12,527);
  assert.ok(shifted.major.length>2);assert.equal(new Set(shifted.major).size,shifted.major.length);
  assert.ok(shifted.major.every(v=>v>=1e-12&&v<=1.0001e-12));
  const epoch=numericTickPositions(1.7e12,1.7e12+60,527);
  assert.deepEqual(epoch.major,[0,10,20,30,40,50,60].map(v=>1.7e12+v));
});
test('independent native line observations constrain the decimal hierarchy and minor visibility',()=>{
  const observations=[[6,1],[12,1],[20,5],[25,5],[40,5],[60,10],[100,10],[200,50],[600,100]];
  for(const[span,step]of observations)for(const pixels of[495,527,642.857,672])assert.equal(numericTickPositions(0,span,pixels).step,step);
  assert.equal(numericTickPositions(0,40,527).minor.length,0);
  assert.equal(numericTickPositions(0,40,672).minor.length,32);
  assert.equal(numericTickPositions(0,100,672).minor.length,0);
});
function host(width=640,height=495):AxisHost{return{plot:{width,height},invalidate(){},boundsFor(){return undefined;}};}
test('consumer relative-origin callbacks receive real screen extent and preserve epoch values',()=>{
  const h=host(),axis=new Axis(h,'x'),origin=1.7e12,calls:any[]=[];
  axis.setScreenRange({start:.25,end:.75});axis.setInterval({start:origin,end:origin+60});
  const placement={major:(info:any)=>{calls.push(info);const relativeStart=info.interval.start-origin;return[relativeStart,relativeStart+30,relativeStart+60].map(value=>({position:origin+value}));},minor:(info:any)=>{calls.push(info);return[{position:origin+15},{position:origin+45}];}};
  axis.tickStrategy.setCustomTickPlacement(placement);
  const actual=axis.tickLayout();
  assert.deepEqual(actual.major.map(v=>v.value),[origin,origin+30,origin+60]);
  assert.deepEqual(actual.minor.map(v=>v.value),[origin+15,origin+45]);
  assert.equal(calls.length,2);assert.equal(calls[0].axisSizePixels,320);
  assert.deepEqual(Object.keys(calls[0]).sort(),['axisSizePixels','interval']);
  assert.equal(axis.tickStrategy.getCustomTickPlacement(),placement);
  (h.plot as any).width=800;axis.tickLayout();assert.equal(calls.at(-1).axisSizePixels,400);
});
test('function placement suppresses the second level, undefined restores automatic levels',()=>{
  const axis=new Axis(host(),'x').setInterval({start:0,end:60}),strategy=axis.tickStrategy;
  const callback=()=>[{position:11},{position:29}];strategy.setCustomTickPlacement(callback);
  assert.equal(strategy.getCustomTickPlacement(),callback);
  assert.deepEqual(axis.tickLayout().major.map(v=>v.value),[11,29]);assert.deepEqual(axis.tickLayout().minor,[]);
  strategy.setCustomTickPlacement(undefined);assert.deepEqual(axis.tickLayout().minor.map(v=>v.value),minor60);
  strategy.setCustomTickPlacement({major:()=>[{position:NaN},{position:-1},{position:5},{position:61}],minor:()=>[]});
  assert.deepEqual(axis.tickLayout().major.map(v=>v.value),[5]);assert.deepEqual(axis.tickLayout().minor,[]);
});

test('custom callbacks use the pre-label content extent while automatic ticks retain the plot extent',()=>{
  const chart=new ChartXY().setTitle('').setPadding(7),x=chart.getDefaultAxisX(),y=chart.getDefaultAxisY(),stacked=chart.addAxisY({iStack:1}),parallel=chart.addAxisY({iStack:0,iParallel:1}),calls=new Map<Axis,number[]>();
  try{
    for(const axis of[x,y,stacked,parallel]){
      calls.set(axis,[]);axis.setInterval({start:0,end:60});
      axis.tickStrategy.setCustomTickPlacement((info:any)=>{calls.get(axis)!.push(info.axisSizePixels);return[{position:0},{position:60}];});
    }
    chart.resize(700,600);chart.renderNow();
    assert.equal(calls.get(x)!.at(-1),686);assert.equal(calls.get(y)!.at(-1),293);assert.equal(calls.get(stacked)!.at(-1),293);assert.equal(calls.get(parallel)!.at(-1),586);
    const before=x.getPixelLength();y.tickStrategy.setFormattingFunction((value:number)=>'A long axis label '+value);chart.renderNow();
    assert.ok(x.getPixelLength()<before);assert.equal(calls.get(x)!.at(-1),686);
    stacked.setLength({pixels:100});chart.renderNow();assert.ok(Math.abs(calls.get(stacked)!.at(-1)!-100)<=Number.EPSILON*100);assert.equal(calls.get(y)!.at(-1),486);
    x.tickStrategy.setCustomTickPlacement(undefined);chart.renderNow();assert.deepEqual(x.tickLayout().major.map(t=>t.value),numericTickPositions(0,60,x.getPixelLength()).major);
  }finally{chart.dispose();}
});
test('logarithmic minor ticks stay within positive bounds and omit major duplicates',()=>{
  const result=logarithmicTickPositions(1,100);
  assert.deepEqual(result.major,[1,10,100]);assert.deepEqual(result.minor,[2,3,4,5,6,7,8,9,20,30,40,50,60,70,80,90]);
  assert.deepEqual(logarithmicTickPositions(0,100).major,[]);
});
class Canvas {
  font='12px sans-serif';fillStyle:any;strokeStyle:any;lineWidth=1;textAlign:any='left';textBaseline:any='alphabetic';lineDashOffset=0;
  path:number[][]=[];strokes:{color:any;width:number;path:number[][]}[]=[];texts:{value:string;color:any}[]=[];
  save(){}restore(){}translate(){}rotate(){}setLineDash(){}beginPath(){this.path=[];}moveTo(x:number,y:number){this.path.push([x,y]);}lineTo(x:number,y:number){this.path.push([x,y]);}
  arc(x:number,y:number,r:number){this.path.push([x,y,r]);}
  stroke(){this.strokes.push({color:this.strokeStyle,width:this.lineWidth,path:[...this.path]});}fillText(value:string){this.texts.push({value,color:this.fillStyle});}measureText(s:string){return{width:s.length*6,actualBoundingBoxLeft:s.length*3,actualBoundingBoxRight:s.length*3,actualBoundingBoxAscent:9,actualBoundingBoxDescent:3};}
}
const ink=(r:number,g:number,b:number)=>new SolidLine({thickness:1,fillStyle:new SolidFill({color:ColorRGBA(r,g,b)})});
test('Canvas paints both levels in bounded batched paths and respects independent stroke length',()=>{
  const axis=new Axis(host(),'y').setInterval({start:0,end:60});axis.setScreenRange({start:.5,end:1});
  axis.tickStrategy.setCustomTickPlacement({major:()=>[{position:10},{position:30}],minor:()=>[{position:20},{position:40}]})
    .setMajorTickStyle((s:TickStyle)=>s.setGridStrokeStyle(ink(255,0,0)).setGridStrokeLength(.5).setTickStyle(emptyLine))
    .setMinorTickStyle((s:TickStyle)=>s.setGridStrokeStyle(ink(0,255,0)).setGridStrokeLength(.25).setTickStyle(emptyLine));
  const ctx=new Canvas();drawAxisCanvas(ctx as any,{plot:{left:10,top:20,width:400,height:300},axesX:[],axesY:[axis]});
  assert.equal(ctx.strokes.length,2);const minor=ctx.strokes[0],major=ctx.strokes[1];
  assert.equal(minor.path.length,4);assert.equal(major.path.length,4);
  for(const point of [...minor.path,...major.path])assert.ok(point[1]>=20&&point[1]<=170);
  assert.equal(minor.path[1][0]-minor.path[0][0],100);assert.equal(major.path[1][0]-major.path[0][0],200);
  axis.tickStrategy.setTickStyle((s:TickStyle)=>s.setGridStrokeStyle(emptyLine));
  const empty=new Canvas();drawAxisCanvas(empty as any,{plot:{left:10,top:20,width:400,height:300},axesX:[],axesY:[axis]});assert.equal(empty.strokes.length,0);
});
test('default public grid styles distinguish minor opacity and leave configuration unset',()=>{
  const strategy=new NumericTickStrategy();
  for(const[level,alpha,length]of[['major',50,7],['minor',20,4]]as const){const t=strategy[level];assert.equal(t.getGridStrokeStyle().getThickness(),1);assert.equal(t.getGridStrokeStyle().getFillStyle().getColor().getA(),alpha);assert.equal(t.getGridStrokeLength(),1);assert.equal(t.getTickLength(),length);}
  assert.equal(strategy.getMinorTickStyle().getLabelFillStyle(),emptyFill);
  assert.equal(typeof (strategy.getMinorTickStyle().getLabelFillStyle() as any).getColor,'undefined');
  const axis=new Axis(host(),'x');assert.equal(axis.getIntervalRestrictions(),undefined);
  axis.setIntervalRestrictions({intervalMax:5});assert.deepEqual(axis.getIntervalRestrictions(),{intervalMax:5});
});

test('Polar radial public style getter/setter controls the actual spokes and labels',()=>{
  const chart=new Polar(),axis=chart.getRadialAxis(),grid=ink(255,20,40),label=new SolidFill({color:ColorRGBA(20,220,70)});
  try{
    const original=axis.getTickStyle();assert.equal(original,axis.tickStrategy.getMajorTickStyle());
    assert.equal(axis.setTickStyle(style=>style.setGridStrokeStyle(grid).setLabelFillStyle(label)),axis);
    const before=new Canvas();chart.drawPolarAxes(before as any);assert.ok(before.strokes.filter(s=>s.color===grid.getFillStyle().getColor().toCSS()).length>=12);
    assert.ok(before.texts.some(t=>t.color===label.getColor().toCSS()&&t.value.includes('°')));
    const hidden=new TickStyle().setGridStrokeStyle(emptyLine).setLabelFillStyle(emptyFill);
    assert.equal(axis.setTickStyle(hidden),axis);assert.equal(axis.getTickStyle(),hidden);
    const after=new Canvas();chart.drawPolarAxes(after as any);
    assert.equal(after.strokes.filter(s=>s.color===grid.getFillStyle().getColor().toCSS()).length,0);
    assert.equal(after.texts.filter(t=>t.color===label.getColor().toCSS()).length,0);
  }finally{chart.dispose();}
});
