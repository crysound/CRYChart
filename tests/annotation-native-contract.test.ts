import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {beginAnnotationDrag,finishAnnotationDrag,pickAnnotation,updateAnnotationDrag,updateAnnotationHover} from '../src/annotation-interaction.js';
import {ColorRGBA,SolidFill,SolidLine,emptyFill,emptyLine} from '../src/core/styles.js';

const plot={left:0,top:0,width:1000,height:200};
function chart(){const value=new ChartXY();value.axisX.setInterval({start:0,end:1000,stopAxisAfter:true});value.axisY.setInterval({start:0,end:1,stopAxisAfter:true});return value;}

test('unprotected Preview and Judgment calls execute and undefined interactions disable the existing slider',()=>{
  const c=chart(),axis=c.axisX,stroke=new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(255,200,0)})});
  const center=axis.addBand({onTop:true}).setFillStyle(emptyFill).setStrokeStyle(stroke);
  center.setHighlight(false);center.setHighlightOnHover(false);center.setUserInteractions({move:{drag:true},scale:false});center.setBounds({start:200,end:500});
  for(const bounds of [{start:0,end:200},{start:500,end:1000}])axis.addBand({onTop:true}).setBounds(bounds).setPointerEvents(false).setHighlight(false).setHighlightOnHover(false);
  const drag=beginAnnotationDrag([axis],{x:300,y:100},plot)!;assert.ok(drag);
  center.setUserInteractions(undefined);assert.equal(center.draggable,false);assert.equal(drag.active,false);
  assert.equal(updateAnnotationDrag(drag,{x:400,y:100},plot),false);assert.deepEqual(center.getBounds(),{start:200,end:500});
  const line=c.axisY.addConstantLine({onTop:false}).setValue(.5).setStrokeStyle(stroke).setPointerEvents(false).setUserInteractions(undefined).setHighlight(false).setHighlightOnHover(false);
  assert.equal(line.onTop,false);assert.equal(line.getPointerEvents(),false);assert.equal(line.getHighlight(),0);assert.equal(line.getHighlightOnHover(),false);c.dispose();
});

test('pointer-disabled covers are penetrable; re-enabling cannot revive a cancelled drag',()=>{
  const c=chart(),band=c.axisX.addBand().setBounds({start:200,end:500}).setDraggable(true),cover=c.axisX.addBand().setBounds({start:0,end:1000});
  assert.equal(pickAnnotation([c.axisX],{x:300,y:100},plot),cover);assert.equal(beginAnnotationDrag([c.axisX],{x:300,y:100},plot),undefined);
  cover.setPointerEvents(false);assert.equal(pickAnnotation([c.axisX],{x:300,y:100},plot),band);
  let cancelled=0;const drag=beginAnnotationDrag([c.axisX],{x:300,y:100},plot,()=>cancelled++)!;
  band.setPointerEvents(false);assert.equal(cancelled,1);assert.equal(drag.active,false);assert.equal(band.events.listenerCount('annotationinteractionchange'),0);
  band.setPointerEvents(true);assert.equal(updateAnnotationDrag(drag,{x:450,y:100},plot),false);assert.deepEqual(band.getBounds(),{start:200,end:500});
  const restarted=beginAnnotationDrag([c.axisX],{x:300,y:100},plot)!;assert.equal(updateAnnotationDrag(restarted,{x:400,y:100},plot),true);assert.deepEqual(band.getBounds(),{start:300,end:600});finishAnnotationDrag(restarted);c.dispose();
});

test('manual and pointer highlights remain independent and unsupported animation is explicit',()=>{
  const c=chart(),band=c.axisX.addBand().setBounds({start:200,end:500}).setHighlight(.25);
  updateAnnotationHover([c.axisX],{x:300,y:100},plot);assert.equal(band.getPointed(),true);assert.equal(band.getHighlight(),.25);assert.equal(band.getHighlightStrength(),1);
  band.setHighlightOnHover(false);assert.equal(band.getHighlightStrength(),.25);assert.equal(band.getPointed(),true);
  band.setHighlight(false);assert.equal(band.getHighlightStrength(),0);
  band.setHighlightOnHover(true);assert.equal(band.getHighlightStrength(),1);band.setPointerEvents(false);assert.equal(band.getPointed(),false);assert.equal(band.getHighlightStrength(),0);
  band.setHighlight(true);assert.equal(band.getHighlightStrength(),1);assert.equal(band.getHighlight(),1);
  assert.equal(band.setAnimationHighlight(false).getAnimationHighlight(),false);assert.throws(()=>band.setAnimationHighlight(true),/does not yet implement/);
  assert.throws(()=>band.setHighlight(-.1),RangeError);assert.throws(()=>band.setHighlight(NaN),RangeError);assert.equal(band.getHighlight(),1);c.dispose();
});

test('legacy draggable mode remains explicit and drag subscriptions are removed on finish/hide/dispose',()=>{
  const c=chart(),line=c.axisX.addConstantLine().setValue(300).setDraggable(true);
  for(let i=0;i<10;i++){const drag=beginAnnotationDrag([c.axisX],{x:300,y:100},plot)!;assert.ok(drag);finishAnnotationDrag(drag);assert.equal(line.events.listenerCount('annotationinteractionchange'),0);}
  line.setUserInteractions(undefined);assert.equal(beginAnnotationDrag([c.axisX],{x:300,y:100},plot),undefined);
  line.setDraggable(true);const hidden=beginAnnotationDrag([c.axisX],{x:300,y:100},plot)!;line.setVisible(false);assert.equal(hidden.active,false);
  line.setVisible(true);const disposed=beginAnnotationDrag([c.axisX],{x:300,y:100},plot)!;line.dispose();assert.equal(disposed.active,false);assert.equal(line.events.listenerCount(),0);c.dispose();
});

class Overlay extends EventTarget{captures=0;releases=0;getBoundingClientRect(){return{left:0,top:0};}setPointerCapture(){this.captures++;}releasePointerCapture(){this.releases++;}}
class PointerChart extends ChartXY{attach(overlay:Overlay){Object.defineProperty(this,'overlay',{value:overlay});this.attachInteractions();}}
test('native pointer routing cancels an active captured drag immediately when its configuration is disabled',()=>{
  const c=new PointerChart(),overlay=new Overlay();c.axisX.setInterval({start:0,end:1000});c.axisY.setInterval({start:0,end:1});c.resize(800,400);c.attach(overlay);
  const band=c.axisX.addBand().setBounds({start:200,end:500}).setUserInteractions({move:{drag:true},scale:false});
  const pointer=(type:string,x:number)=>Object.assign(new Event(type),{clientX:c.plot.left+x/1000*c.plot.width,clientY:c.plot.top+20,button:0,pointerId:3});
  overlay.dispatchEvent(pointer('pointerdown',300));assert.equal(overlay.captures,1);assert.equal(band.events.listenerCount('annotationinteractionchange'),1);
  band.setUserInteractions(undefined);assert.equal(overlay.releases,1);assert.equal(band.events.listenerCount('annotationinteractionchange'),0);
  overlay.dispatchEvent(pointer('pointermove',400));overlay.dispatchEvent(pointer('pointerup',400));assert.deepEqual(band.getBounds(),{start:200,end:500});
  band.setDraggable(true);overlay.dispatchEvent(pointer('pointerdown',300));band.setPointerEvents(false);assert.equal(overlay.releases,2);overlay.dispatchEvent(pointer('pointermove',600));assert.deepEqual(band.getBounds(),{start:200,end:500});c.dispose();
});

class RecordingCanvas {
  fillStyle:any='';strokeStyle:any='';lineWidth=1;lineDashOffset=0;textAlign='left';font='';stack:any[]=[];
  constructor(readonly layer:string,readonly log:any[]){}
  save(){this.stack.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,lineDashOffset:this.lineDashOffset,textAlign:this.textAlign,font:this.font});}
  restore(){Object.assign(this,this.stack.pop());}beginPath(){}rect(){}clip(){}moveTo(){}lineTo(){}setLineDash(){}setTransform(){}clearRect(){}
  fillRect(...bounds:number[]){this.log.push({kind:'fill',layer:this.layer,style:this.fillStyle,bounds});}
  strokeRect(...bounds:number[]){this.log.push({kind:'band-stroke',layer:this.layer,style:this.strokeStyle,width:this.lineWidth,bounds});}
  stroke(){this.log.push({kind:'line-stroke',layer:this.layer,style:this.strokeStyle,width:this.lineWidth});}fillText(){}
}
class PaintChart extends ChartXY{
  readonly log:any[]=[];
  paint(ctx:RecordingCanvas,onTop:boolean){this.drawAnnotations(ctx as any,onTop);}
  contexts(underlay:RecordingCanvas,overlay:RecordingCanvas){Object.defineProperty(this,'underlayContext',{value:underlay});Object.defineProperty(this,'overlayContext',{value:overlay});}
  protected override drawAxes(){}
  protected override drawCursor(){}
  protected override drawArea(){this.log.push({kind:'area'});}
  protected override renderData(){this.log.push({kind:'series'});}
}

test('transparent bands paint their actual stroke, with manual/hover effects disabled exactly',()=>{
  const c=new PaintChart(),log:any[]=[],ctx=new RecordingCanvas('top',log);c.axisX.setInterval({start:0,end:10});c.axisY.setInterval({start:0,end:1});
  const color=ColorRGBA(255,200,0),band=c.axisX.addBand().setBounds({start:2,end:5}).setFillStyle(emptyFill).setStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color})})).setHighlight(false).setHighlightOnHover(false);
  band.setPointed(true);c.paint(ctx,true);assert.equal(log.filter(x=>x.kind==='fill').length,0);assert.deepEqual(log.map(x=>[x.kind,x.style,x.width]),[['band-stroke',color.toCSS(),2]]);assert.equal(ctx.stack.length,0);
  log.length=0;band.setHighlight(.5);c.paint(ctx,true);assert.notEqual(log[0].style,color.toCSS());
  log.length=0;band.setStrokeStyle(emptyLine);c.paint(ctx,true);assert.equal(log.length,0);c.dispose();
});

test('onTop=false is drawn on the underlay before area/data; top bands remain on the overlay afterwards',()=>{
  const c=new PaintChart(),under=new RecordingCanvas('under',c.log),over=new RecordingCanvas('over',c.log);c.contexts(under,over);c.legend.setVisible(false);
  c.axisX.setInterval({start:0,end:10,stopAxisAfter:true});c.axisY.setInterval({start:0,end:1,stopAxisAfter:true});
  const below=c.axisY.addConstantLine({onTop:false}).setValue(.5).setPointerEvents(false).setStrokeStyle(new SolidLine({thickness:3,fillStyle:new SolidFill({color:ColorRGBA(0,0,255)})}));
  const above=c.axisX.addBand().setBounds({start:2,end:5}).setFillStyle(emptyFill).setStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(255,0,0)})}));
  c.addPointLineAreaSeries().setAreaFillStyle(new SolidFill({color:ColorRGBA(0,255,0)})).add([{x:0,y:0},{x:10,y:1}]);c.renderNow();
  const belowAt=c.log.findIndex(x=>x.kind==='line-stroke'&&x.layer==='under'),areaAt=c.log.findIndex(x=>x.kind==='area'),dataAt=c.log.findIndex(x=>x.kind==='series'),aboveAt=c.log.findIndex(x=>x.kind==='band-stroke'&&x.layer==='over');
  assert.ok(belowAt>=0&&belowAt<areaAt&&areaAt<dataAt&&dataAt<aboveAt);assert.equal(below.onTop,false);assert.equal(above.onTop,true);
  assert.equal(under.stack.length,0);assert.equal(over.stack.length,0);c.dispose();
});
