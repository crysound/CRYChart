// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {Axis,type AxisHost,type TickStyle} from '../src/axis';
import {boundAxisLabelX,drawAxisCanvas,measureAxisCanvasLayout} from '../src/axis-canvas';
import {FontSettings,ColorRGBA,SolidFill} from '../src/core/styles';

test('actual asymmetric glyph bounds govern placement, not advance width',()=>{
  const ctx={font:'17px Georgia',textAlign:'center',measureText(){return{width:30,actualBoundingBoxLeft:13,actualBoundingBoxRight:23};}} as unknown as CanvasRenderingContext2D;
  assert.equal(boundAxisLabelX(ctx,'unchanged',10,10,110),23);
  assert.equal(boundAxisLabelX(ctx,'unchanged',110,10,110),87);
  assert.equal(boundAxisLabelX(ctx,'unchanged',60,10,110),60);
  assert.equal(ctx.font,'17px Georgia');assert.equal(ctx.textAlign,'center');
});

test('physical range ordering and a local screen range remain independent of axis direction',()=>{
  const ctx={measureText(){return{width:40,actualBoundingBoxLeft:20,actualBoundingBoxRight:20};}} as unknown as CanvasRenderingContext2D;
  for(const range of[[130,230],[230,130]]){
    assert.equal(boundAxisLabelX(ctx,'left',130,...range as [number,number]),150);
    assert.equal(boundAxisLabelX(ctx,'right',230,...range as [number,number]),210);
  }
});

test('a label wider than its axis is retained and explicitly aligned to the nearest end',()=>{
  const ctx={measureText(){return{width:180,actualBoundingBoxLeft:80,actualBoundingBoxRight:100};}} as unknown as CanvasRenderingContext2D;
  assert.equal(boundAxisLabelX(ctx,'full label',10,10,110),90);
  assert.equal(boundAxisLabelX(ctx,'full label',110,10,110),10);
  assert.equal(boundAxisLabelX(ctx,'full label',60,10,110),90);
  assert.ok(90+100>110,'the impossible fit is not silently described as contained');
});

test('advance width is a fallback only when a Canvas implementation lacks glyph bounds',()=>{
  const ctx={measureText(){return{width:32};}} as unknown as CanvasRenderingContext2D;
  assert.equal(boundAxisLabelX(ctx,'legacy Canvas',100,0,100),84);
  const empty={measureText(){return{width:0,actualBoundingBoxLeft:0,actualBoundingBoxRight:0};}} as unknown as CanvasRenderingContext2D;
  assert.equal(boundAxisLabelX(empty,'',100,0,100),100);
});

type TextCall={text:string;x:number;y:number;font:string;align:string;baseline:string;fill:string;left:number;right:number;top:number;bottom:number};
class CanvasOracle{
  font='11px initial';textAlign='right';textBaseline='top';fillStyle='initial-fill';strokeStyle='initial-stroke';lineWidth=7;lineDashOffset=3;
  stack:any[]=[];texts:TextCall[]=[];measurements:{font:string;text:string}[]=[];
  get ctx(){return this as unknown as CanvasRenderingContext2D;}
  save(){this.stack.push({font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,lineDashOffset:this.lineDashOffset});}
  restore(){Object.assign(this,this.stack.pop());}
  measureText(text:string){
    this.measurements.push({font:this.font,text});
    const size=Number(this.font.match(/([\d.]+)px/)?.[1]??12),width=text.length*size*.6;
    const left=this.textAlign==='center'?width/2:this.textAlign==='right'?width:0;
    return{width,actualBoundingBoxLeft:left,actualBoundingBoxRight:width-left,actualBoundingBoxAscent:size*.75,actualBoundingBoxDescent:size*.25};
  }
  fillText(text:string,x:number,y:number){const m=this.measureText(text);this.texts.push({text,x,y,font:this.font,align:this.textAlign,baseline:this.textBaseline,fill:String(this.fillStyle),left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});}
  beginPath(){}moveTo(){}lineTo(){}stroke(){}setLineDash(){}translate(){}rotate(){}
}
const plot={left:80,top:60,width:400,height:260};
const host:AxisHost={plot,invalidate(){},boundsFor(){return{start:0,end:10};}};
const makeAxis=(direction:'x'|'y',options:any={})=>{
  const axis=new Axis(host,direction,options).setInterval({start:0,end:10});
  axis.tickStrategy.setCustomTickPlacement({major:()=>[{position:0,label:'Full: 0.0'},{position:5,label:'Full: 5.0'},{position:10,label:'Full:10.0'}],minor:()=>[]});return axis;
};

test('rendering preserves all text, font, Y positions and Canvas state while containing X ink',()=>{
  const x=makeAxis('x'),ctx=new CanvasOracle(),font=new FontSettings({family:'Georgia',size:17,weight:'bold'}),ink=ColorRGBA(120,20,170);
  x.tickStrategy.setTickStyle((style:TickStyle)=>style.setLabelFont(font).setLabelFillStyle(new SolidFill({color:ink})));
  const layout=measureAxisCanvasLayout(ctx.ctx,[x],[]),m=layout.axes.get(x)!;
  drawAxisCanvas(ctx.ctx,{plot,axesX:[x],axesY:[],width:520,height:400,layout});
  assert.deepEqual(ctx.texts.map(value=>value.text),['Full: 0.0','Full: 5.0','Full:10.0']);
  assert.ok(ctx.texts.every(value=>value.left>=80&&value.right<=480));
  assert.ok(ctx.texts.every(value=>value.font===font.toCSS()&&value.fill===ink.toCSS()));
  assert.ok(ctx.texts.every(value=>value.y===plot.top+plot.height+m.labelOffset));
  assert.equal(ctx.texts[1]!.x,280);assert.equal(ctx.font,'11px initial');assert.equal(ctx.textAlign,'right');assert.equal(ctx.textBaseline,'top');assert.equal(ctx.fillStyle,'initial-fill');assert.equal(ctx.lineWidth,7);assert.equal(ctx.stack.length,0);
});

test('inverted and opposite X axes keep their physical local screen range without changing values',()=>{
  for(const inverted of[false,true])for(const opposite of[false,true]){
    const axis=makeAxis('x',{opposite}).setInverted(inverted),ctx=new CanvasOracle();axis.setScreenRange({start:.25,end:.75});
    drawAxisCanvas(ctx.ctx,{plot,axesX:[axis],axesY:[],width:520,height:400});
    // This 200px lane cannot fit three 64.8px labels with their required gaps.
    // Keep the complete tick/grid domain while admitting the two endpoints.
    assert.deepEqual(axis.tickLayout().major.map(t=>t.label),['Full: 0.0','Full: 5.0','Full:10.0']);
    assert.equal(ctx.texts.length,2);assert.deepEqual(ctx.texts.map(t=>t.text),['Full: 0.0','Full:10.0']);assert.ok(ctx.texts.every(value=>value.left>=180&&value.right<=380));
    assert.ok(opposite?ctx.texts.every(value=>value.y<plot.top):ctx.texts.every(value=>value.y>plot.top+plot.height));
    assert.ok(inverted?ctx.texts[0]!.x>ctx.texts[1]!.x:ctx.texts[0]!.x<ctx.texts[1]!.x);
    const ordered=[...ctx.texts].sort((a,b)=>a.left-b.left);assert.ok(ordered[1]!.left-ordered[0]!.right>=4);
    assert.deepEqual(axis.getInterval(),{start:0,end:10});
  }
});

test('parallel X axes remain separate and neighboring Y labels are not repositioned',()=>{
  const bottom=makeAxis('x'),top=makeAxis('x',{opposite:true}),outer=makeAxis('x',{iParallel:1}),y=makeAxis('y'),ctx=new CanvasOracle();
  y.tickStrategy.setCustomTickPlacement({major:()=>[{position:0,label:'Y0'},{position:10,label:'Y10'}],minor:()=>[]});
  drawAxisCanvas(ctx.ctx,{plot,axesX:[bottom,top,outer],axesY:[y],width:520,height:440});
  const yTexts=ctx.texts.filter(value=>value.text.startsWith('Y'));
  assert.deepEqual(yTexts.map(value=>({text:value.text,x:value.x,y:value.y})),[{text:'Y0',x:71,y:324},{text:'Y10',x:71,y:64}]);
  const xTexts=ctx.texts.filter(value=>value.text.startsWith('Full'));assert.equal(xTexts.length,9);
  assert.equal(new Set(xTexts.map(value=>value.y)).size,3);assert.ok(xTexts.every(value=>value.left>=80&&value.right<=480));
  for(const a of xTexts)for(const b of yTexts)assert.ok(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);
});

test('default 128 Y-pane measurement fast path is unchanged and hidden X labels do not measure',()=>{
  const ctx=new CanvasOracle(),x=new Axis(host,'x').setInterval({start:0,end:10}),ys=Array.from({length:128},(_,i)=>new Axis(host,'y',{iStack:-i}).setInterval({start:0,end:10}));
  measureAxisCanvasLayout(ctx.ctx,[x],ys);assert.equal(ctx.measurements.length,0);
  x.tickStrategy.major.setLabelFillStyle(new SolidFill({color:ColorRGBA(0,0,0,0)}));
  drawAxisCanvas(ctx.ctx,{plot,axesX:[x],axesY:[],width:520,height:400});assert.equal(ctx.texts.length,0);assert.equal(ctx.measurements.length,0);
});
