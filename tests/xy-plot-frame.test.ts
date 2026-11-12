import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {ColorHEX,SolidFill,SolidLine,emptyLine} from '../src/core/styles.js';

test('XY themed plot frame paints all four sides without depending on visible axes',()=>{
 const strokes:any[]=[];
 const ctx:any={beginPath(){},rect(){},clip(){},setTransform(){},clearRect(){},save(){},restore(){},setLineDash(){},fillText(){},strokeRect(...rect:number[]){strokes.push({rect,ink:this.strokeStyle,width:this.lineWidth});}};
 const stroke=new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorHEX('#123456')})});
 const chart=new ChartXY({legend:{visible:false},theme:{chartXYSeriesBackgroundStrokeStyle:stroke}});
 try{
  chart.axisX.setVisible(false);chart.axisY.setVisible(false);chart.resize(640,360);
  Object.assign(chart,{overlayContext:ctx});chart.renderNow();
  const r=chart.plot;assert.deepEqual(strokes,[{rect:[r.left,r.top,r.width,r.height],ink:ColorHEX('#123456').toCSS(),width:2}]);
  chart.theme.chartXYSeriesBackgroundStrokeStyle=emptyLine;strokes.length=0;chart.renderNow();assert.equal(strokes.length,0);
 }finally{chart.dispose();}
});

test('endpoint grids cannot wash out the frame and an explicitly styled axis still owns its baseline',()=>{
 const frame=ColorHEX('#64748b'),grid=ColorHEX('#cbd5e1'),axis=ColorHEX('#e62828');
 const line=(color:ReturnType<typeof ColorHEX>)=>new SolidLine({thickness:1,fillStyle:new SolidFill({color})});
 const paints:string[]=[];
 const ctx:any={beginPath(){},moveTo(){},lineTo(){},rect(){},clip(){},setTransform(){},clearRect(){},save(){},restore(){},setLineDash(){},fillText(){},measureText(){return{width:8,actualBoundingBoxAscent:9,actualBoundingBoxDescent:3};},stroke(){paints.push(this.strokeStyle);},strokeRect(){paints.push(this.strokeStyle);}};
 const chart=new ChartXY({legend:{visible:false},theme:{chartXYSeriesBackgroundStrokeStyle:line(frame)}});
 try{
  chart.resize(640,360);
  chart.axisY.setInterval({start:0,end:10}).setStrokeStyle(line(axis));
  chart.axisY.tickStrategy.setCustomTickPlacement({major:()=>[0,5,10]}).setMajorTickStyle(s=>s.setGridStrokeStyle(line(grid)));
  Object.assign(chart,{overlayContext:ctx});chart.renderNow();
  const frameIndex=paints.indexOf(frame.toCSS());
  assert(paints.includes(grid.toCSS())&&frameIndex>paints.lastIndexOf(grid.toCSS()),'The grid must be below the visible frame');
  assert(paints.indexOf(axis.toCSS())>frameIndex,'An explicitly styled axis must remain above the frame');
 }finally{chart.dispose();}
});
