import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart.js';
import * as Styles from '../src/core/styles.js';
import {UIElement} from '../src/ui.js';
import type {UITextBox} from '../src/compatibility-types.js';
import type {DrawPacket3D} from '../src/render3d.js';

class Probe extends Chart3D{
 capturePackets(){let packets:DrawPacket3D[]=[];(this as any).gpu3d={render:(value:DrawPacket3D[])=>{packets=value;},dispose(){}};this.renderData([]);return packets;}
 paintFrame(ctx:CanvasRenderingContext2D){this.drawSpecial(ctx);}
}
function canvas(){
 const strokes:Array<{color:unknown;width:unknown}>=[],target:Record<string,unknown>={measureText:(value:string)=>({width:value.length*6}),stroke(){strokes.push({color:target.strokeStyle,width:target.lineWidth});}};
 return{strokes,ctx:new Proxy(target,{get:(value,key)=>key in value?value[key as string]:()=>{}}) as unknown as CanvasRenderingContext2D};
}

test('Simple shading reaches real 3D line, point and auxiliary marker packets without changing old defaults',()=>{
 const chart=new Probe({experimental3DCameraModel:'legacy'});try{
  const line=chart.addLineSeries().add([{x:0,y:1,z:2},{x:1,y:2,z:3}]).setPointSize(4).setPointFillStyle(new Styles.SolidFill({color:Styles.ColorHEX('#ff0000')})),point=chart.addPointSeries().add({x:1,y:1,z:1});
  const before=chart.capturePackets();assert.ok(before.every(packet=>packet.unshaded!==true));
  const simple=new Styles.ColorShadingStyles.Simple();
  assert.equal(line.setHighlightOnHover(false).setColorShadingStyle(simple).setStrokeStyle(new Styles.SolidLine({thickness:2})),line);point.setColorShadingStyle(simple);
  assert.equal(line.getHighlightOnHover(),false);assert.throws(()=>line.setHighlightOnHover(true),/not implemented|not supported/i);
  assert.equal(line.getColorShadingStyle(),simple);
  const packets=chart.capturePackets();for(const id of [line.id,-line.id,point.id])assert.equal(packets.find(packet=>packet.id===id)!.unshaded,true);
  assert.throws(()=>line.setColorShadingStyle({type:'phong'} as any));assert.equal(line.getColorShadingStyle(),simple);
 }finally{chart.dispose();}
});

test('real 3D camera projections expose whole-chart bottom-left relative pixels without changing client or pixel results',()=>{
 for(const model of ['world','legacy'] as const){
  const chart=new Chart3D({width:800,height:600,experimental3DCameraModel:model});try{
   chart.axisX.setInterval({start:0,end:10});chart.axisY.setInterval({start:0,end:20});chart.axisZ.setInterval({start:0,end:30});
   chart.setBoundingBox({x:2,y:3,z:4});chart.setCameraLocation({x:5,y:4,z:7});
   (chart as any).overlay={getBoundingClientRect:()=>({left:31,top:47})};chart.renderNow();
   const point={x:3,y:8,z:12},scale={x:chart.axisX,y:chart.axisY,z:chart.axisZ};
   const check=()=>{
    const pixel=chart.translateCoordinate(point,scale,chart.coordsPixel),relative=chart.translateCoordinate(point,scale,chart.coordsRelative),client=chart.translateCoordinate(point,scale,chart.coordsClient);
    assert.ok(Number.isFinite(pixel.x+pixel.y));assert.deepEqual(relative,{x:pixel.x,y:chart.getSizePixels().y-pixel.y});
    assert.deepEqual(client,{clientX:pixel.x+31,clientY:pixel.y+47});
    assert.deepEqual(chart.translateCoordinate(point,chart.coordsRelative),relative);
    const restored=chart.translateCoordinate(relative,chart.coordsRelative,chart.coordsPixel);
    // Two Y-origin flips perform height-(height-y), which can round by one
    // floating-point unit even though the visible coordinate is unchanged.
    assert.ok(Math.abs(restored.x-pixel.x)<1e-10&&Math.abs(restored.y-pixel.y)<1e-10);
   };
   check();chart.resize(1000,700);check();
  }finally{chart.dispose();}
 }
});

test('point-map engine facade supplies real background save/restore and delegates the public Blob capture',()=>{
 const chart=new Chart3D();try{
  const engine=chart.engine,original=engine.getBackgroundFillStyle(),fill=new Styles.SolidFill({color:Styles.ColorHEX('#112233')}),blob=new Blob(['frame'],{type:'image/png'});
  chart.captureFrame=type=>{assert.equal(type,'image/png');assert.equal(chart.getBackgroundFillStyle(),fill);return blob;};
  try{assert.equal(engine.setBackgroundFillStyle(fill),engine);assert.equal(engine.captureFrame('image/png'),blob);}
  finally{engine.setBackgroundFillStyle(original);}
  assert.equal(chart.getBackgroundFillStyle(),original);
 }finally{chart.dispose();}
});

test('bounding box stroke affects the actual twelve frame edges while emptyLine suppresses them',()=>{
 const chart=new Probe({experimental3DCameraModel:'legacy'});try{
  chart.setTitle('');for(const axis of chart.getAxes())axis.setVisible(false);
  const first=canvas();chart.paintFrame(first.ctx);assert.equal(first.strokes.length,12);
  chart.setBoundingBoxStrokeStyle(Styles.emptyLine);const hidden=canvas();chart.paintFrame(hidden.ctx);assert.equal(hidden.strokes.length,0);
  const stroke=new Styles.SolidLine({thickness:3,fillStyle:new Styles.SolidFill({color:Styles.ColorHEX('#aabbcc')})});
  chart.setBoundingBoxStrokeStyle(stroke);assert.equal(chart.getBoundingBoxStrokeStyle(),stroke);
  const shown=canvas();chart.paintFrame(shown.ctx);assert.equal(shown.strokes.length,12);assert.ok(shown.strokes.every(value=>value.width===3&&value.color===Styles.ColorHEX('#aabbcc').toCSS()));
  chart.setBoundingBoxStrokeStyle(previous=>new Styles.SolidLine({thickness:2,fillStyle:previous.getFillStyle()}));const changed=canvas();chart.paintFrame(changed.ctx);assert.ok(changed.strokes.every(value=>value.width===2));
 }finally{chart.dispose();}
});

test('UITextBox alias exposes the implemented calibration label methods and real measured size',()=>{
 const chart=new Chart3D();try{
  const ctx=canvas().ctx;(chart as any).overlay={getContext:()=>ctx};
  const label:UITextBox&UIElement=chart.addUIElement(Styles.UIElementBuilders.TextBox,chart.coordsRelative);
  label.setText('Offset').setTextFont(font=>font.setSize(12)).setPosition({x:10,y:20}).setOrigin(Styles.UIOrigins.LeftTop);
  assert.equal(label.getText(),'Offset');assert.deepEqual(label.getPosition(),{x:10,y:20});assert.ok(label.getSize().x>0);label.dispose();assert.equal(label.isDisposed(),true);
 }finally{chart.dispose();}
});
