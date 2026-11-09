import test from 'node:test';
import assert from 'node:assert/strict';
import {Axis,type AxisHost} from '../src/axis';
import {drawAxisCanvas,measureAxisCanvasLayout} from '../src/axis-canvas';
import {ColorRGBA,SolidFill,Themes} from '../src/core/styles';

const plot={left:180,top:120,width:400,height:300};
type Paint={x:number;y:number;width:number;height:number;fill:string};
class Canvas {
  font='11px original';fillStyle='original';strokeStyle='original-stroke';lineWidth=3;
  textAlign='left';textBaseline='top';globalAlpha=.7;globalCompositeOperation='source-over';lineDashOffset=2;
  paints:Paint[]=[];stack:Record<string,unknown>[]=[];throwOnFill=false;throwOnText=false;
  get context(){return this as unknown as CanvasRenderingContext2D;}
  state(){return {font:this.font,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,textAlign:this.textAlign,textBaseline:this.textBaseline,globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation,lineDashOffset:this.lineDashOffset};}
  save(){this.stack.push(this.state());}
  restore(){Object.assign(this,this.stack.pop());}
  fillRect(x:number,y:number,width:number,height:number){if(this.throwOnFill)throw new Error('paint failed');this.paints.push({x,y,width,height,fill:this.fillStyle});}
  measureText(text:string){return {width:text.length*6,actualBoundingBoxAscent:9,actualBoundingBoxDescent:3};}
  fillText(){if(this.throwOnText)throw new Error('text failed');}
  setLineDash(){}beginPath(){}moveTo(){}lineTo(){}stroke(){}translate(){}rotate(){}
}
function host(){let invalidations=0;const chart:AxisHost={plot,invalidate(){invalidations++;},boundsFor(){return {start:0,end:10};}};return {chart,count:()=>invalidations};}
function axis(direction:'x'|'y',options:{opposite?:boolean}={}){return new Axis(host().chart,direction,options).setTickStrategy('Empty');}
function draw(axes:Axis[],canvas=new Canvas(),light=false,theme?:typeof Themes.light){drawAxisCanvas(canvas.context,{plot,axesX:axes.filter(a=>a.direction==='x'),axesY:axes.filter(a=>a.direction==='y'),light,theme});return canvas;}

test('axis hover defaults on, invalidates only transitions, and preserves explicit highlight state',()=>{
  const h=host(),a=new Axis(h.chart,'y'),before=h.count();
  assert.equal(a.getHighlightOnHover(),true);assert.equal(a.getHighlight(),0);assert.equal(a.getEffectiveHighlight(),0);
  a.setPointerHover(true);assert.equal(h.count(),before+1);assert.equal(a.getEffectiveHighlight(),1);assert.equal(a.getHighlight(),0);
  a.setPointerHover(true);assert.equal(h.count(),before+1);
  a.setHighlightOnHover(false);assert.equal(h.count(),before+2);assert.equal(a.getEffectiveHighlight(),0);
  a.setHighlight(.4);assert.equal(h.count(),before+3);assert.equal(a.getEffectiveHighlight(),.4);assert.equal(a.getHighlight(),.4);
  a.setPointerHover(false);assert.equal(a.getEffectiveHighlight(),.4);
  a.setHighlight(0).setHighlightOnHover(true);assert.equal(a.getEffectiveHighlight(),0);
});

test('temporary export disable removes hover ink and restoring settings restores the same hovered axis',()=>{
  const a=axis('y');a.setPointerHover(true);a.setHighlight(.25);
  const initial=draw([a]).paints;assert.equal(initial.length,1);
  const settings={manual:a.getHighlight(),hover:a.getHighlightOnHover()};
  a.setHighlightOnHover(false).setHighlight(0);assert.deepEqual(draw([a]).paints,[]);
  a.setHighlightOnHover(settings.hover).setHighlight(settings.manual);
  assert.deepEqual(draw([a]).paints,initial);assert.equal(a.getHighlight(),.25);
  a.setPointerHover(false);assert.equal(a.getHighlight(),.25);assert.equal(a.getEffectiveHighlight(),.25);
});

test('hover fill follows each physical side, parallel lane and stacked span without entering the plot',()=>{
  const left=axis('y'),parallel=axis('y'),right=axis('y',{opposite:true}),bottom=axis('x'),top=axis('x',{opposite:true});
  parallel.setScreenRange({start:.25,end:.75},1);parallel.iParallel=1;
  right.setScreenRange({start:0,end:.5});top.setScreenRange({start:.5,end:1});
  for(const a of [left,parallel,right,bottom,top])a.setPointerHover(true);
  const canvas=draw([left,parallel,right,bottom,top]);
  const rects=canvas.paints.map(({x,y,width,height})=>({x,y,width,height}));
  for(const r of [
    {x:126,y:120,width:54,height:300},
    {x:72,y:195,width:54,height:150},
    {x:580,y:270,width:54,height:150},
    {x:180,y:420,width:400,height:44},
    {x:380,y:76,width:200,height:44}
  ])assert.ok(rects.some(actual=>JSON.stringify(actual)===JSON.stringify(r)),JSON.stringify(r));
  assert.equal(rects.length,5);
  for(const r of rects)assert.ok(r.x+r.width<=plot.left||r.x>=plot.left+plot.width||r.y+r.height<=plot.top||r.y>=plot.top+plot.height);
});

test('hover uses the current light/dark theme and respects explicit per-axis color without changing styles',()=>{
  const a=axis('y');a.setPointerHover(true);
  const dark=draw([a],new Canvas(),false,Themes.dark).paints[0]!.fill;
  const light=draw([a],new Canvas(),true,Themes.light).paints[0]!.fill;
  assert.notEqual(dark,light);assert.match(dark,/, 0\.16\)$/);assert.match(light,/, 0\.16\)$/);
  const fill=new SolidFill({color:ColorRGBA(20,150,240)});a.setTitleFillStyle(fill);
  assert.equal(draw([a]).paints[0]!.fill,'rgba(20, 150, 240, 0.16)');assert.equal(a.getTitleFillStyle(),fill);
});

test('turning hover off and leaving removes ink; hidden or disposed axes never highlight',()=>{
  const a=axis('x');a.setPointerHover(true);assert.equal(draw([a]).paints.length,1);
  a.setHighlightOnHover(false);assert.equal(draw([a]).paints.length,0);
  a.setHighlightOnHover(true);a.setPointerHover(false);assert.equal(draw([a]).paints.length,0);
  a.setPointerHover(true);a.setVisible(false);assert.equal(draw([a]).paints.length,0);
  a.setVisible(true);assert.equal(draw([a]).paints.length,0);
  a.setPointerHover(true);a.dispose();assert.equal(a.getEffectiveHighlight(),0);assert.equal(draw([a]).paints.length,0);
});

test('highlight paint preserves Canvas state on normal drawing and on fill/text failures',()=>{
  const a=axis('y');a.setPointerHover(true);
  for(const fail of ['none','fill','text'] as const){
    const canvas=new Canvas(),initial=canvas.state();canvas.throwOnFill=fail==='fill';canvas.throwOnText=fail==='text';
    if(fail==='text')a.setTitle('Axis');
    if(fail==='none')draw([a],canvas);else assert.throws(()=>draw([a],canvas),new RegExp(fail==='fill'?'paint failed':'text failed'));
    assert.deepEqual(canvas.state(),initial);assert.equal(canvas.stack.length,0);
  }
});

test('hover has no effect on layout margins, tick output or axis data intervals',()=>{
  const a=axis('y').setTickStrategy('Numeric').setTitle('Amplitude'),before=measureAxisCanvasLayout(undefined,[],[a]),interval=a.getInterval();
  const ticks=a.tickLayout();a.setPointerHover(true);const after=measureAxisCanvasLayout(undefined,[],[a]);
  assert.deepEqual(after,before);assert.deepEqual(a.tickLayout(),ticks);assert.deepEqual(a.getInterval(),interval);
});
