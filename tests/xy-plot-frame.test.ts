import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {ColorHEX,SolidFill,SolidLine,emptyLine} from '../src/core/styles.js';

class FrameChart extends ChartXY {protected drawAxes(_ctx:CanvasRenderingContext2D) {}}
test('XY themed plot frame paints all four sides without depending on visible axes',()=>{
 const strokes:any[]=[];
 const ctx:any={beginPath(){},rect(){},clip(){},setTransform(){},clearRect(){},save(){},restore(){},setLineDash(){},strokeRect(...rect:number[]){strokes.push({rect,ink:this.strokeStyle,width:this.lineWidth});}};
 const stroke=new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorHEX('#123456')})});
 const chart=new FrameChart({legend:{visible:false},theme:{chartXYSeriesBackgroundStrokeStyle:stroke}});
 try{
  chart.axisX.setVisible(false);chart.axisY.setVisible(false);chart.resize(640,360);
  Object.assign(chart,{overlayContext:ctx});chart.renderNow();
  const r=chart.plot;assert.deepEqual(strokes,[{rect:[r.left,r.top,r.width,r.height],ink:ColorHEX('#123456').toCSS(),width:2}]);
  chart.theme.chartXYSeriesBackgroundStrokeStyle=emptyLine;strokes.length=0;chart.renderNow();assert.equal(strokes.length,0);
 }finally{chart.dispose();}
});
