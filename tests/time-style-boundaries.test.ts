import assert from 'node:assert/strict';
import test from 'node:test';
import {Axis} from '../src/axis.js';
import {FontSettings,SolidFill,ColorRGBA,emptyFill} from '../src/core/styles.js';
import {drawAxisCanvas,measureAxisCanvasLayout} from '../src/axis-canvas.js';
function host(){return{plot:{left:0,top:0,width:620,height:400},theme:{font:new FontSettings({family:'Courier New',size:14}),tickLabelFillStyle:new SolidFill({color:ColorRGBA(210,220,230)})},invalidate(){},boundsFor(){return undefined;}};}
function draw(axis:any,theme:any){const drawn:any[]=[],measured:any[]=[],stack:any[]=[];const ctx:any={font:'initial',textAlign:'left',textBaseline:'top',fillStyle:'initial',save(){stack.push({font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,fillStyle:this.fillStyle});},restore(){Object.assign(this,stack.pop());},measureText(text:string){const n=Number(this.font.match(/([\d.]+)px/)?.[1]??14),w=text.length*n*.5;measured.push({font:this.font,text});return{width:w,actualBoundingBoxLeft:w/2,actualBoundingBoxRight:w/2,actualBoundingBoxAscent:n*.75,actualBoundingBoxDescent:n*.25};},fillText(text:string){drawn.push({text,font:this.font,fill:this.fillStyle});},beginPath(){},moveTo(){},lineTo(){},stroke(){},setLineDash(){},translate(){},rotate(){}};const layout=measureAxisCanvasLayout(ctx,[axis],[],theme);drawAxisCanvas(ctx,{plot:{left:0,top:0,width:620,height:400},axesX:[axis],axesY:[],theme,layout});return{drawn,measured,resolvedMajorFont:layout.axes.get(axis)?.labelFont.toCSS()};}
export function run(){const result:any={};
 for(const kind of ['Numeric','Time']){const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:2880000}).setTickStrategy(kind);h.theme.font=new FontSettings({family:'Georgia',size:20,weight:'bold'});result['late-theme-'+kind]=draw(axis,h.theme);}
 {const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:2880000}).setTickStrategy('Time',(s:any)=>s.setMajorTickStyle((t:any)=>t.setLabelFont(new FontSettings({family:'Arial',size:17}))).setMinorTickStyle((t:any)=>t.setLabelFont(new FontSettings({family:'Georgia',size:13})).setLabelFillStyle(emptyFill)));h.theme.font=new FontSettings({family:'Verdana',size:24});result['explicit-font-empty-fill']=draw(axis,h.theme);}
 {const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:2880000}).setTickStrategy('Time',(s:any)=>s.setMajorTickPlacement(()=>[0,900000,1800000,2700000].map(position=>({position}))).setFormattingFunction((v:number)=>String(v)));result['custom-major-original-format']=draw(axis,h.theme);result['custom-major-layout']=axis.tickLayout(620);}
 {const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:2880000}).setTickStrategy('Time',(s:any)=>s.setCustomTickPlacement({major:()=>[{position:900000,label:'Explicit major'}],minor:()=>[{position:600000,label:'Explicit minor'}]}));result['custom-both-original-style']=draw(axis,h.theme);}
 {const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:7200000}).setTickStrategy('Time',(s:any)=>s.setFormattingFunction((v:number)=>'T'+v));result['outside-bounded-custom-formatter']=draw(axis,h.theme);}
 return result;
}


const observed=run();
test('TIME-REVIEW-01：迟绑定主题真正用于Time测量与绘制，默认种子不标显式',()=>{
  const r=observed['late-theme-Time'];assert.equal(r.resolvedMajorFont,'normal normal bold 20px Georgia');assert.ok(r.drawn.length>0);assert.ok(r.drawn.every((p:any)=>p.font==='normal normal bold 20px Georgia'||p.font==='normal normal bold 10px Georgia'));
  const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:900000}).setTickStrategy('Time');assert.equal(axis.tickStrategy.major.hasLabelFontOverride(),false);assert.equal(axis.tickStrategy.minor.hasLabelFontOverride(),false);h.theme.font=new FontSettings({family:'Georgia',size:20,weight:'bold'});const actual=draw(axis,h.theme);assert.ok(actual.drawn.some(p=>p.text==='00:03:00'&&p.font==='normal normal bold 10px Georgia'));assert.ok(actual.measured.some(p=>p.text==='00:03:00'&&p.font==='normal normal bold 10px Georgia'));assert.equal(axis.tickStrategy.getMinorTickStyle().getLabelFont().getFamily(),'Georgia');
});
test('TIME-REVIEW-02：自定义主placement+原formatter不额外画numeric peer',()=>{
  assert.deepEqual(observed['custom-major-original-format'].drawn.map((v:any)=>v.text),['0','900000','1800000','2700000']);
  assert.deepEqual(observed['custom-both-original-style'].drawn.map((v:any)=>v.text),['Explicit major']);
});
test('TIME-REVIEW-02：2小时自定义formatter保持仅原major三行',()=>{
  assert.deepEqual(observed['outside-bounded-custom-formatter'].drawn.map((v:any)=>v.text),['T0','T3600000','T7200000']);
});
test('显式Arial17/Georgia13和emptyFill跨主题变化仍优先',()=>{
  assert.equal(observed['explicit-font-empty-fill'].resolvedMajorFont,'normal normal normal 17px Arial');assert.ok(observed['explicit-font-empty-fill'].drawn.every((v:any)=>v.font==='normal normal normal 17px Arial'));
  const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:900000}).setTickStrategy('Time',(s:any)=>s.setMinorTickStyle((t:any)=>t.setLabelFont(new FontSettings({family:'Georgia',size:13})).setLabelFillStyle(emptyFill)));h.theme.font=new FontSettings({family:'Verdana',size:24});draw(axis,h.theme);assert.equal(axis.tickStrategy.getMinorTickStyle().getLabelFont().getFamily(),'Georgia');assert.equal(axis.tickStrategy.getMinorTickStyle().getLabelFont().getSize(),13);assert.equal(axis.tickStrategy.getMinorTickStyle().getLabelFillStyle(),emptyFill);
});
test('区间与placement来回切换不遗留默认minor可见性，保留原formatter',()=>{
  const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:900000}).setTickStrategy('Time',(s:any)=>s.setFormattingFunction((v:number)=>'V'+v));assert.ok(draw(axis,h.theme).drawn.some(p=>p.text==='V180000'));axis.setInterval({start:0,end:7200000});assert.deepEqual(draw(axis,h.theme).drawn.map(p=>p.text),['V0','V3600000','V7200000']);axis.setInterval({start:0,end:900000});assert.ok(draw(axis,h.theme).drawn.some(p=>p.text==='V180000'));axis.tickStrategy.setMajorTickPlacement(()=>[{position:0,label:'only-major'}]);assert.deepEqual(draw(axis,h.theme).drawn.map(p=>p.text),['only-major']);axis.tickStrategy.setCustomTickPlacement(undefined);assert.ok(draw(axis,h.theme).drawn.some(p=>p.text==='V180000'));
});
test('域外用户显式开启minor仍生效，默认范围保护不屏蔽用户样式',()=>{
  const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:7200000}).setTickStrategy('Time',(s:any)=>s.setFormattingFunction((v:number)=>'T'+v).setMinorTickStyle((t:any)=>t.setLabelFillStyle(new SolidFill({color:ColorRGBA(255,20,60)}))));h.theme.font=new FontSettings({family:'Georgia',size:20,weight:'bold'});const actual=draw(axis,h.theme);assert.ok(actual.drawn.some(p=>!['T0','T3600000','T7200000'].includes(p.text)));assert.ok(actual.drawn.every(p=>p.font==='normal normal bold 20px Georgia'));
});
test('限定默认minor颜色跟随后续绘制主题，用户major颜色不改默认minor颜色',()=>{
  const h=host(),axis=new Axis(h,'x').setInterval({start:0,end:900000}).setTickStrategy('Time');h.theme.tickLabelFillStyle=new SolidFill({color:ColorRGBA(10,40,90)});let actual=draw(axis,h.theme);assert.ok(actual.drawn.length>0);assert.ok(actual.drawn.every(p=>p.fill==='rgba(10, 40, 90, 1)'));axis.tickStrategy.setMajorTickStyle((t:any)=>t.setLabelFillStyle(new SolidFill({color:ColorRGBA(255,0,0)})));actual=draw(axis,h.theme);assert.ok(actual.drawn.some(p=>p.text==='00:03:00'&&p.fill==='rgba(10, 40, 90, 1)'));
});
test('Numeric迟绑定主题对照仍使用完整Georgia20字体',()=>{
  assert.equal(observed['late-theme-Numeric'].resolvedMajorFont,'normal normal bold 20px Georgia');assert.ok(observed['late-theme-Numeric'].drawn.every((v:any)=>v.font==='normal normal bold 20px Georgia'));
});

test('无theme.font时先styler后interval仍以Time默认family作种子，不从域外sans-serif取值',()=>{
  const h:any={plot:{left:0,top:0,width:620,height:400},theme:{},invalidate(){},boundsFor(){return undefined;}};let inherited='';const axis=new Axis(h,'x').setTickStrategy('Time',(s:any)=>s.setMinorTickStyle((t:any)=>t.setLabelFont((f:any)=>{inherited=f.getFamily();return f.setSize(12);})));assert.equal(inherited,'Segoe UI, -apple-system, Verdana, Helvetica');axis.setInterval({start:0,end:900000});const actual=draw(axis,h.theme);assert.ok(actual.drawn.some(p=>p.text==='00:03:00'&&p.font.includes('12px Segoe UI')));assert.equal(axis.tickStrategy.getMinorTickStyle().getLabelFont().getFamily(),inherited);
});
