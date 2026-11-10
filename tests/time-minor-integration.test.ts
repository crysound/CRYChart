import assert from 'node:assert/strict';
import test from 'node:test';
import {Axis,type AxisHost} from '../src/axis.js';
import {FontSettings,SolidFill,ColorRGBA,emptyFill} from '../src/core/styles.js';
import {numericTickPositions,logarithmicTickPositions} from '../src/grid-layout.js';
import {drawAxisCanvas,measureAxisCanvasLayout} from '../src/axis-canvas.js';
const makeHost=(font=new FontSettings({family:'Segoe UI, -apple-system, Verdana, Helvetica',size:14}),color=ColorRGBA(255,255,220)):AxisHost=>({plot:{width:619.7607439863349,height:400},theme:{font,tickLabelFillStyle:new SolidFill({color})},invalidate(){},boundsFor(){return undefined;}});
const measure=(_text:string,level:string)=>level==='major'?51.3515625:36.6796875;
const positions=[300000,600000,1200000,1500000,2100000,2400000];
test('Time默认次标签在主题family上为10px，复制主题填充而非暗色硬编码',()=>{
  for(const color of[ColorRGBA(255,255,220),ColorRGBA(33,43,49),ColorRGBA(160,25,130)]){const host=makeHost(new FontSettings({family:'Courier New',size:19,weight:'bold'}),color),axis=new Axis(host,'x').setInterval({start:0,end:2880000}).setTickStrategy('Time'),s=axis.tickStrategy;assert.equal(s.major.getLabelFont().getSize(),19);assert.equal(s.minor.getLabelFont().getSize(),10);assert.equal(s.minor.getLabelFont().getFamily(),'Courier New');assert.equal(s.minor.getLabelFont().getWeight(),'bold');assert.equal(s.minor.getLabelFillStyle(),host.theme!.tickLabelFillStyle);assert.equal(s.major.getLabelFillStyle(),host.theme!.tickLabelFillStyle);}
});
test('48分钟完整默认minor坐标与原时间文本，原始数据区间不变',()=>{
  const axis=new Axis(makeHost(),'x').setInterval({start:0,end:2880000}).setTickStrategy('Time'),before=axis.getInterval(),layout=axis.tickLayout(619.7607439863349,undefined,measure);assert.deepEqual(layout.minor.map(t=>t.value),positions);assert.deepEqual(layout.minor.map(t=>t.label),['00:05:00','00:10:00','00:20:00','00:25:00','00:35:00','00:40:00']);assert.deepEqual(layout.major.map(t=>t.value),[0,900000,1800000,2700000]);assert.deepEqual(axis.getInterval(),before);
});
test('真实测量入口保留负时间、origin和formatting offset原语义',()=>{
  const axis=new Axis(makeHost(),'x').setInterval({start:-2880000,end:0}).setTickStrategy('Time');let layout=axis.tickLayout(619.7607439863349,undefined,(_t,l)=>l==='major'?56.9501953125:40.6787109375);assert.deepEqual(layout.minor.map(t=>t.value),[-2400000,-2100000,-1500000,-1200000,-600000,-300000]);assert.equal(layout.minor[0].label,'-00:40:00');axis.tickStrategy.setTimeOrigin(86400000).setFormattingOffset(60000);layout=axis.tickLayout(619.7607439863349,undefined,measure);assert.equal(layout.minor[0].label,'23:21:00');assert.equal(axis.formatValue(-2400000),'23:21:00');
});
test('同型styler保留用户显式字体与emptyFill，计算不会重新激活标签',()=>{
  const axis=new Axis(makeHost(),'x').setInterval({start:0,end:2880000}).setTickStrategy('Time'),font=new FontSettings({family:'Georgia',size:13,weight:'bold',style:'italic'});axis.setTickStrategy('Time',(s:any)=>s.setMinorTickStyle((t:any)=>t.setLabelFont(font).setLabelFillStyle(emptyFill)));const strategy=axis.tickStrategy;axis.tickLayout(620,undefined,measure);axis.setTickStrategy('Time',(s:any)=>s);assert.equal(axis.tickStrategy,strategy);assert.equal(strategy.minor.getLabelFont(),font);assert.equal(strategy.minor.getLabelFillStyle(),emptyFill);
});
test('自定义formatters原值和完整文本原样输出，一次布局不重复调用同层同值',()=>{
  const calls:string[]=[],axis=new Axis(makeHost(),'x').setInterval({start:0,end:2880000}).setTickStrategy('Time',(s:any)=>s.setMajorFormattingFunction((v:number)=>{calls.push('M'+v);return'M:'+v;}).setMinorFormattingFunction((v:number)=>{calls.push('m'+v);return'm:'+v;}).setCursorFormatter((v:number)=>'C:'+v));const layout=axis.tickLayout(620,undefined,()=>20);for(const t of layout.major)assert.equal(t.label,'M:'+t.value);for(const t of layout.minor)assert.equal(t.label,'m:'+t.value);assert.equal(new Set(calls).size,calls.length);assert.ok(calls.every(v=>Number(v.slice(1))>=0&&Number(v.slice(1))<=2880000));assert.equal(axis.formatValue(.1234),'C:0.1234');
});
test('自定义placement文字和自动peer不被新密度逻辑重排',()=>{
  const axis=new Axis(makeHost(),'x').setInterval({start:0,end:2880000}).setTickStrategy('Time');axis.tickStrategy.setCustomTickPlacement({major:()=>[{position:123.25,label:'主原文'}],minor:()=>[{position:456.75,label:'次原文'}]});assert.deepEqual(axis.tickLayout(620,undefined,()=>999),{major:[{value:123.25,label:'主原文'}],minor:[{value:456.75,label:'次原文'}]});axis.tickStrategy.setMajorTickPlacement(()=>[{position:123.25,label:'主原文'}]);axis.tickStrategy.setMinorTickPlacement(undefined);assert.deepEqual(axis.tickLayout(620,undefined,()=>999).minor.map(t=>t.value),numericTickPositions(0,2880000,620).minor);
});
test('Numeric与logarithmic的所有旧坐标及空默认minor文字保留',()=>{
  const host=makeHost(),numeric=new Axis(host,'x').setInterval({start:0,end:2880000}).setTickStrategy('Numeric');assert.deepEqual(numeric.tickLayout(620).minor.map(t=>t.value),numericTickPositions(0,2880000,620).minor);assert.ok(numeric.tickLayout(620).minor.every(t=>t.label===''));const log=new Axis(host,'x',{type:'logarithmic'}).setInterval({start:1,end:100000}).setTickStrategy('Time');assert.deepEqual(log.tickLayout(620).major.map(t=>t.value),logarithmicTickPositions(1,100000).major);assert.ok(log.tickLayout(620).minor.every(t=>t.label===''));
});
test('小时和微小域不被新默认minor模型改变',()=>{
  for(const end of[1000,3600000,7200000]){const axis=new Axis(makeHost(),'x').setInterval({start:0,end}).setTickStrategy('Time');assert.ok(axis.tickLayout(620,undefined,()=>1).minor.every(t=>t.label===''));}
});
test('Canvas使用与密度计算相同的minor字体并实际绘制，emptyFill仍隐藏',()=>{
  const host=makeHost(),axis=new Axis(host,'x').setInterval({start:0,end:2880000}).setTickStrategy('Time'),drawn:any[]=[],measurements:any[]=[],stack:any[]=[];const ctx:any={font:'initial',textAlign:'left',textBaseline:'top',fillStyle:'initial',save(){stack.push({font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,fillStyle:this.fillStyle});},restore(){Object.assign(this,stack.pop());},measureText(text:string){const size=Number(this.font.match(/([\d.]+)px/)?.[1]??14),width=text.length*size*0.45849609375;measurements.push({font:this.font,text});return{width,actualBoundingBoxLeft:width/2,actualBoundingBoxRight:width/2,actualBoundingBoxAscent:size*.75,actualBoundingBoxDescent:size*.25};},fillText(text:string){drawn.push({font:this.font,text,fill:this.fillStyle});},beginPath(){},moveTo(){},lineTo(){},stroke(){},setLineDash(){},translate(){},rotate(){}};
  const plot={left:0,top:0,width:619.7607439863349,height:400};drawAxisCanvas(ctx,{plot,axesX:[axis],axesY:[],theme:host.theme,layout:measureAxisCanvasLayout(ctx,[axis],[],host.theme)});for(const text of['00:05:00','00:10:00','00:20:00','00:25:00','00:35:00','00:40:00'])assert.ok(drawn.some(r=>r.text===text&&r.font.includes('10px')),text+'须实际绘制');assert.ok(measurements.some(r=>r.text==='00:20:00'&&r.font.includes('10px')));assert.equal(ctx.font,'initial');drawn.length=0;axis.tickStrategy.setMinorTickStyle((t:any)=>t.setLabelFillStyle(emptyFill));drawAxisCanvas(ctx,{plot,axesX:[axis],axesY:[],theme:host.theme});assert.ok(!drawn.some(r=>r.text==='00:20:00'));
});

test('显式emptyFill隐藏文字但保留完整一分钟基础格线，主格线不重复',()=>{
  const axis=new Axis(makeHost(),'x').setInterval({start:0,end:2880000}).setTickStrategy('Time');axis.tickStrategy.setMinorTickStyle((t:any)=>t.setLabelFillStyle(emptyFill));const layout=axis.tickLayout(619.7607439863349,undefined,measure),major=new Set(layout.major.map(t=>t.value));assert.deepEqual(layout.minor.map(t=>t.value),Array.from({length:49},(_,i)=>i*60000).filter(v=>!major.has(v)));assert.equal(axis.tickStrategy.minor.getLabelFillStyle(),emptyFill);
});
