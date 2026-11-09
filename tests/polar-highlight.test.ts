import test from 'node:test';
import assert from 'node:assert/strict';
import {Polar} from '../src/chart.js';
import {ComponentHighlightState,highlightColor} from '../src/component-highlight.js';
import {ColorRGBA,SolidFill,SolidLine,DashedLine,Themes,emptyFill,transparentFill} from '../src/core/styles.js';

class Probe extends Polar{
  paint(ctx:CanvasRenderingContext2D){this.drawSpecial(ctx);}
  tick(time:number){this.beforeScheduledAnimationFrame(time);}
  pending(){return this.hasPendingAnimationFrame();}
  cancel(){this.cancelScheduledAnimation();}
}
function context(){
  let state:any={strokeStyle:'prior',fillStyle:'prior',lineWidth:7,dash:[8,9]},path:any[]=[],stack:any[]=[];
  const calls:any[]=[];
  const target:any={save(){stack.push({...state,dash:[...state.dash]});},restore(){state=stack.pop();},beginPath(){path=[];},arc(...args:any[]){path.push(['arc',...args]);},rect(...args:any[]){path.push(['rect',...args]);},clip(){},moveTo(...args:any[]){path.push(['move',...args]);},lineTo(...args:any[]){path.push(['line',...args]);},closePath(){path.push(['close']);},setLineDash(dash:number[]){state.dash=[...dash];},fill(){calls.push({op:'fill',path:[...path],color:state.fillStyle,width:state.lineWidth,dash:[...state.dash]});},stroke(){calls.push({op:'stroke',path:[...path],color:state.strokeStyle,width:state.lineWidth,dash:[...state.dash]});}};
  const ctx=new Proxy(target,{get:(object,key)=>key in object?object[key]:state[key],set:(_object,key,value)=>{state[key]=value;return true;}}) as CanvasRenderingContext2D;
  return{ctx,calls,state:()=>state};
}
const data=[{angle:0,amplitude:-10.000000000000002},{angle:45,amplitude:-20},{angle:90,amplitude:NaN},{angle:135,amplitude:-20},{angle:180,amplitude:-10}];

test('Polar public boolean/number normalization retains configured values',()=>{
  const chart=new Probe(),series=chart.addPointLineSeries();
  for(const [input,expected] of [[false,0],[true,1],[.25,.25],[-1,0],[2,1],[Infinity,1],[-Infinity,0]] as const){assert.equal(series.setHighlight(input),series);assert.equal(series.getHighlight(),expected);assert.equal(typeof series.getHighlight(),'number');}
  series.setHighlight(NaN);assert.ok(Number.isNaN(series.getHighlight()));assert.equal(series.hasPendingHighlight(),false);assert.equal(series.getHighlightStrength(),0);
  series.setHighlight(false);assert.equal(series.getHighlight(),0);chart.dispose();
});

test('Time-based Polar pulse is bounded, static mode exact and hidden/error/dispose cannot keep scheduling',()=>{
  const state=new ComponentHighlightState();assert.equal(state.getAnimation(),true);state.set(.5);
  for(const time of [0,100,300,600,900,1200,100000]){state.advance(time);assert.ok(state.strength()>=0&&state.strength()<=.5);}
  state.setAnimation(false);assert.equal(state.strength(),.5);assert.equal(state.pending(),false);
  state.setAnimation(true);state.advance(0);state.advance(600);assert.equal(state.strength(),.5);state.cancel();assert.equal(state.pending(),false);
  const chart=new Probe(),series=chart.addLineSeries().setData(data).setHighlight(true);assert.equal(chart.pending(),true);
  chart.tick(0);chart.tick(600);assert.equal(series.getHighlightStrength(),1);
  series.setVisible(false);assert.equal(chart.pending(),false);series.setVisible(true);assert.equal(chart.pending(),true);
  series.setData([]);assert.equal(chart.pending(),false);series.setData(data);assert.equal(chart.pending(),true);
  chart.setVisible(false);assert.equal(chart.pending(),false);chart.setVisible(true);chart.tick(2000);assert.equal(series.getHighlightStrength(),0);
  chart.cancel();assert.equal(chart.pending(),false);series.setHighlight(true);assert.equal(chart.pending(),true);
  series.setHighlight(false);assert.equal(chart.pending(),false);series.setHighlight(true);series.dispose();assert.equal(chart.pending(),false);chart.dispose();
});

test('Polar uses one existing chart RAF and stops after false, hidden, disposed, or a drawing exception',()=>{
  const previousRAF=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame;
  let next=1;const queue=new Map<number,FrameRequestCallback>();
  globalThis.requestAnimationFrame=callback=>{const id=next++;queue.set(id,callback);return id;};globalThis.cancelAnimationFrame=id=>{queue.delete(id);};
  const flush=(time:number)=>{const batch=[...queue.values()];queue.clear();for(const callback of batch)callback(time);};
  try{
    const chart=new Probe();(chart as any).root={hidden:false,remove(){},style:{}};
    const series=chart.addPointLineSeries().setData(data).setHighlight(true);assert.equal(queue.size,1);flush(0);assert.equal(queue.size,1);flush(200);assert.equal(queue.size,1);
    series.setHighlight(false);flush(300);assert.equal(queue.size,0);
    series.setHighlight(true);chart.setVisible(false);flush(400);assert.equal(queue.size,0);
    chart.setVisible(true);flush(500);assert.equal(queue.size,1);series.setVisible(false);flush(600);assert.equal(queue.size,0);
    series.setVisible(true);flush(700);assert.equal(queue.size,1);
    const originalLayout=(chart as any).layout;(chart as any).layout=()=>{throw Error('draw failed');};
    assert.throws(()=>flush(800),/draw failed/);assert.equal(queue.size,0);assert.equal(chart.pending(),false);
    (chart as any).layout=originalLayout;series.setHighlight(true);assert.equal(queue.size,1);chart.dispose();assert.equal(queue.size,0);
  }finally{if(previousRAF)globalThis.requestAnimationFrame=previousRAF;else delete (globalThis as any).requestAnimationFrame;if(previousCancel)globalThis.cancelAnimationFrame=previousCancel;else delete (globalThis as any).cancelAnimationFrame;}
});

for(const isDark of [true,false])test(`Polar ${isDark?'dark':'light'} static highlighting changes colors only, preserving styles, paths, gaps, and restoration`,()=>{
  const chart=new Probe({theme:{...(isDark?Themes.dark:Themes.light),isDark}});chart.getAmplitudeAxis().setInterval({start:-40,end:0});chart.renderNow();
  const color=ColorRGBA(100,120,180),stroke=new DashedLine({thickness:2,fillStyle:new SolidFill({color}),pattern:[6,3]}),pointFill=new SolidFill({color});
  const series=chart.addPointLineSeries().setData(data).setStrokeStyle(stroke).setPointFillStyle(pointFill).setAnimationHighlight(false);
  const other=chart.addLineSeries().setData([{angle:0,amplitude:-3},{angle:180,amplitude:-4}]),otherStroke=other.getStrokeStyle();
  const initial=context();chart.paint(initial.ctx);const raw=series.getData(),dataset=series.getDataSet(),revision=dataset.revision;
  series.setHighlight(.5);const half=context();chart.paint(half.ctx);
  const geometry=(calls:any[])=>calls.map(({color,...rest})=>rest);assert.deepEqual(geometry(half.calls),geometry(initial.calls));
  const expected=ColorRGBA(...([100,120,180].map(value=>value+(isDark?30:-30)) as [number,number,number])).toCSS();assert.equal(half.calls[0].color,expected);
  assert.deepEqual(half.calls.at(-1),initial.calls.at(-1));assert.equal(other.getStrokeStyle(),otherStroke);assert.equal(other.getHighlight(),0);
  assert.equal(series.getStrokeStyle(),stroke);assert.equal(series.getPointFillStyle(),pointFill);assert.deepEqual(series.getData(),raw);assert.equal(dataset.revision,revision);
  assert.equal(half.calls[0].path.filter((command:any[])=>command[0]==='move').length,2);assert.deepEqual(half.calls[0].dash,[6,3]);assert.equal(half.calls[0].width,2);
  series.setHighlight(false);const restored=context();chart.paint(restored.ctx);assert.deepEqual(restored.calls,initial.calls);assert.deepEqual(restored.state(),initial.state());chart.dispose();
});

test('Explicit highlight offset and alpha are applied only at draw time; empty fills remain empty',()=>{
  const theme={...Themes.dark,highlightColorOffset:{getR:()=>40,getG:()=>-20,getB:()=>5,getA:()=>20}};
  const color=ColorRGBA(100,120,180,100);assert.deepEqual([highlightColor(color,.5,theme).getR(),highlightColor(color,.5,theme).getG(),highlightColor(color,.5,theme).getB(),highlightColor(color,.5,theme).getA()],[120,110,182.5,110]);
  assert.equal(highlightColor(color,0,theme),color);const empty=transparentFill.getColor();assert.equal(highlightColor(empty,1,theme),empty);
  assert.equal(highlightColor(color,NaN,theme),color);assert.equal(color.getA(),100);
});

test('Individual point colors and source precision survive highlight and return to the identical ordinary draw path',()=>{
  const chart=new Probe({theme:{...Themes.dark,isDark:true}});chart.getAmplitudeAxis().setInterval({start:-40,end:0});chart.renderNow();
  const source=[{angle:0,amplitude:-10.000000000000002,color:ColorRGBA(20,30,40)},{angle:180,amplitude:-20,color:ColorRGBA(100,110,120)}];
  const series=chart.addPointSeries().setData(source).setIndividualPointColorEnabled(true).setAnimationHighlight(false),raw=series.getData();
  const before=context();chart.paint(before.ctx);series.setHighlight(1);const active=context();chart.paint(active.ctx);
  assert.equal(active.calls[0].color,ColorRGBA(80,90,100).toCSS());assert.equal(active.calls[1].color,ColorRGBA(160,170,180).toCSS());assert.deepEqual(series.getData(),raw);
  series.setHighlight(false);const after=context();chart.paint(after.ctx);assert.deepEqual(after.calls,before.calls);chart.dispose();
});
