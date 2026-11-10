// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {Axis,type AxisHost,type TickStyle} from '../src/axis';
import {axisCanvasLaneOffset,drawAxisCanvas,measureAxisCanvasLayout,measureChartTitleContent} from '../src/axis-canvas';
import {ColorRGBA,DashedLine,FontSettings,SolidFill,SolidLine,emptyFill,emptyLine} from '../src/core/styles';

type Matrix=[number,number,number,number,number,number];
type TextCall={text:string;x:number;y:number;rotation:number;align:string;font:string;fill:string};
class CanvasOracle {
  font='10px initial';fillStyle='initial-fill';strokeStyle='initial-stroke';lineWidth=3;textAlign='left';textBaseline='top';lineDashOffset=2;
  dash:number[]=[2];matrix:Matrix=[1,0,0,1,0,0];stack:any[]=[];path:{x:number;y:number}[]=[];
  texts:TextCall[]=[];strokes:{path:{x:number;y:number}[];color:string;width:number;dash:number[]}[]=[];measureCalls:string[]=[];
  get context(){return this as unknown as CanvasRenderingContext2D;}
  save(){this.stack.push({font:this.font,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,textAlign:this.textAlign,textBaseline:this.textBaseline,lineDashOffset:this.lineDashOffset,dash:[...this.dash],matrix:[...this.matrix]});}
  restore(){Object.assign(this,this.stack.pop());}
  transformPoint(x:number,y:number){const[a,b,c,d,e,f]=this.matrix;return{x:a*x+c*y+e,y:b*x+d*y+f};}
  translate(x:number,y:number){const p=this.transformPoint(x,y);this.matrix[4]=p.x;this.matrix[5]=p.y;}
  rotate(angle:number){const[a,b,c,d,e,f]=this.matrix,co=Math.cos(angle),si=Math.sin(angle);this.matrix=[a*co+c*si,b*co+d*si,c*co-a*si,d*co-b*si,e,f];}
  setLineDash(value:number[]){this.dash=[...value];}
  beginPath(){this.path=[];}
  moveTo(x:number,y:number){this.path.push(this.transformPoint(x,y));}
  lineTo(x:number,y:number){this.path.push(this.transformPoint(x,y));}
  // Inspect every geometric segment even when the renderer batches same-style
  // segments in one native Canvas stroke. The separate grid contract tests
  // check the batching itself; these assertions retain their exact endpoints.
  stroke(){for(let i=0;i<this.path.length;i+=2)this.strokes.push({path:this.path.slice(i,i+2),color:String(this.strokeStyle),width:this.lineWidth,dash:[...this.dash]});}
  fillText(text:string,x:number,y:number){const p=this.transformPoint(x,y);this.texts.push({text,...p,rotation:Math.atan2(this.matrix[1],this.matrix[0]),align:this.textAlign,font:this.font,fill:String(this.fillStyle)});}
  measureText(text:string){const size=Number(this.font.match(/([\d.]+)px/)?.[1]??12);this.measureCalls.push(this.font+'\0'+text);return{width:text.length*size*.5,actualBoundingBoxAscent:size*.75,actualBoundingBoxDescent:size*.25};}
}
const plot={left:100,top:70,width:400,height:300};
const host:AxisHost={plot,invalidate(){},boundsFor(){return{start:0,end:10};}};
function axis(direction:'x'|'y',options:any={}){
  const a=new Axis(host,direction,options).setInterval({start:0,end:10});
  // These are layout/style tests with an explicit three-label fixture, not
  // assertions that the default Numeric strategy has no minor/tick strokes.
  a.ticks=()=>[{value:0,label:'0'},{value:5,label:'5'},{value:10,label:'10'}];
  a.tickLayout=()=>({major:a.ticks(),minor:[]});
  a.tickStrategy.setTickStyle((style:TickStyle)=>style.setTickStyle(emptyLine));
  return a;
}
function close(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);}

test('default 128-pane layout uses zero text measurements and does not enumerate ticks',()=>{
  const ctx=new CanvasOracle(),x=axis('x'),ys=Array.from({length:128},(_,i)=>axis('y',{iStack:-i}));let tickCalls=0;
  for(const a of[x,...ys])a.ticks=()=>{tickCalls++;return[];};
  const layout=measureAxisCanvasLayout(ctx.context,[x],ys);assert.equal(tickCalls,0);assert.equal(ctx.measureCalls.length,0);
  assert.deepEqual(layout.extraMargins,{left:0,right:0,top:0,bottom:0});assert.ok([...layout.axes.values()].every(m=>!m.measured));
  const outerX=axis('x',{iParallel:1}),outerY=axis('y',{iParallel:1});const lanes=measureAxisCanvasLayout(ctx.context,[x,outerX],[ys[0]!,outerY]);
  assert.equal(axisCanvasLaneOffset(lanes,outerX),44);assert.equal(axisCanvasLaneOffset(lanes,outerY),54);
});

test('default labels and titles keep their established screen coordinates and restore Canvas state',()=>{
  const ctx=new CanvasOracle(),x=axis('x').setTitle('Time'),y=axis('y').setTitle('Amplitude');
  drawAxisCanvas(ctx.context,{plot,axesX:[x],axesY:[y],width:700,height:500});
  assert.deepEqual(ctx.texts.find(t=>t.text==='Time'),{text:'Time',x:300,y:413,rotation:0,align:'center',font:'normal normal normal 12px sans-serif',fill:ColorRGBA(190,200,215).toCSS()});
  const yTitle=ctx.texts.find(t=>t.text==='Amplitude')!;assert.equal(yTitle.x,52);assert.equal(yTitle.y,220);close(yTitle.rotation,-Math.PI/2);
  assert.ok(ctx.texts.some(t=>t.text==='5'&&t.x===300&&t.y===390));assert.ok(ctx.texts.some(t=>t.text==='5'&&t.x===91&&t.y===224));
  assert.equal(ctx.font,'10px initial');assert.equal(ctx.textBaseline,'top');assert.equal(ctx.fillStyle,'initial-fill');assert.deepEqual(ctx.dash,[2]);assert.equal(ctx.stack.length,0);
});

test('explicit grid/label styles really paint or hide, including dash scale and light-theme label color',()=>{
  const hidden=axis('x'),ctx=new CanvasOracle();hidden.tickStrategy.major.setGridStrokeStyle(emptyLine).setLabelFillStyle(emptyFill);
  drawAxisCanvas(ctx.context,{plot,axesX:[hidden],axesY:[]});assert.equal(ctx.strokes.length,0);assert.equal(ctx.texts.length,0);
  const styled=axis('y'),ink=ColorRGBA(240,40,80);styled.tickStrategy.major.setGridStrokeStyle(new DashedLine({thickness:2,fillStyle:new SolidFill({color:ink}),pattern:[3,2],patternScale:2})).setLabelFillStyle(new SolidFill({color:ink})).setLabelFont(new FontSettings({size:18,family:'monospace',weight:700}));
  const custom=new CanvasOracle();drawAxisCanvas(custom.context,{plot,axesX:[],axesY:[styled],light:true});
  assert.equal(custom.strokes.length,3);assert.ok(custom.strokes.every(s=>s.color===ink.toCSS()&&s.width===2&&s.dash.join(',')==='6,4'));
  assert.deepEqual(custom.strokes[1]!.path,[{x:100,y:220},{x:500,y:220}]);assert.ok(custom.texts.every(t=>t.fill===ink.toCSS()&&t.font==='normal normal 700 18px monospace'));
});

test('visible tick length determines real tick geometry and keeps labels beyond its tip',()=>{
  const x=axis('x'),ctx=new CanvasOracle(),tickInk=ColorRGBA(20,220,90);
  x.tickStrategy.major.setGridStrokeStyle(emptyLine).setTickStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:tickInk})})).setTickLength(19);
  drawAxisCanvas(ctx.context,{plot,axesX:[x],axesY:[]});assert.equal(ctx.strokes.length,3);
  for(const stroke of ctx.strokes){close(stroke.path[1]!.y-stroke.path[0]!.y,19);assert.equal(stroke.color,tickInk.toCSS());}
  const label=ctx.texts.find(t=>t.text==='5')!;assert.ok(label.y-9>389,'label glyph ascent must clear the 19px tick');
});

test('large fonts, margins, and parallel axes reserve separate lanes while stacked axes share a lane',()=>{
  const inside=axis('y').setTitle('Primary'),stacked=axis('y',{iStack:-1}).setTitle('Secondary'),outside=axis('y',{iParallel:1}).setTitle('Outer');
  inside.tickStrategy.major.setLabelFont(new FontSettings({size:24})).setLabelFormatter((v:number)=>String(v));inside.ticks=()=>[{value:5,label:'-12345.67'}];inside.setTitleFont(new FontSettings({size:20})).setMarginAfterTicks(17);
  const ctx=new CanvasOracle(),layout=measureAxisCanvasLayout(ctx.context,[],[inside,stacked,outside]),inner=layout.axes.get(inside)!;
  assert.ok(inner.laneSize>54);assert.equal(layout.axes.get(stacked)!.laneSize,inner.laneSize);assert.equal(axisCanvasLaneOffset(layout,outside),inner.laneSize);
  assert.equal(layout.extraMargins.left,inner.laneSize-54);drawAxisCanvas(ctx.context,{plot,axesX:[],axesY:[inside,stacked,outside],layout});
  const innerTitle=ctx.texts.find(t=>t.text==='Primary')!,outerLabel=ctx.texts.filter(t=>t.text==='5').at(-1)!;
  assert.ok(outerLabel.x<innerTitle.x-15,'outer label right edge must remain outside inner rotated title');
  const plain=axis('x').setTitle('Title'),withMargin=axis('x').setTitle('Title').setMarginAfterTicks(25),c0=new CanvasOracle(),c1=new CanvasOracle();
  drawAxisCanvas(c0.context,{plot,axesX:[plain],axesY:[]});const expanded=drawAxisCanvas(c1.context,{plot,axesX:[withMargin],axesY:[]});
  assert.equal(c1.texts.find(t=>t.text==='Title')!.y-c0.texts.find(t=>t.text==='Title')!.y,25);assert.ok(expanded.extraMargins.bottom>0);
});

test('title start/end/center/center-chart anchors use physical axis positions even with inversion',()=>{
  for(const direction of['x','y'] as const)for(const position of['start','end','center','center-chart'] as const){
    const a=axis(direction).setTitle('Title').setTitlePosition(position).setInverted(true);a.setScreenRange({start:.25,end:.75});const ctx=new CanvasOracle();
    drawAxisCanvas(ctx.context,{plot,axesX:direction==='x'?[a]:[],axesY:direction==='y'?[a]:[],width:700,height:500});
    const title=ctx.texts.find(t=>t.text==='Title')!,fraction=position==='start'?.25:position==='end'?.75:.5;
    const expected=position==='center-chart'?(direction==='x'?350:250):direction==='x'?100+400*fraction:70+300*(1-fraction);
    close(direction==='x'?title.x:title.y,expected);assert.equal(title.align,position==='start'?'left':position==='end'?'right':'center');
  }
  const rotated=axis('y').setTitle('Horizontal').setTitleRotation(0),ctx=new CanvasOracle();drawAxisCanvas(ctx.context,{plot,axesX:[],axesY:[rotated]});assert.equal(ctx.texts.find(t=>t.text==='Horizontal')!.rotation,0);
});

test('one layout pass shares repeated text measurements without caching later formatter output',()=>{
  let label='tick';const axes=Array.from({length:128},(_,i)=>{const a=axis('y',{iStack:-i}).setTitle('Channel');a.tickStrategy.major.setLabelFont(new FontSettings({size:18}));a.ticks=()=>[{value:5,label}];return a;});
  const ctx=new CanvasOracle();measureAxisCanvasLayout(ctx.context,[],axes);assert.equal(ctx.measureCalls.length,2);
  label='changed';measureAxisCanvasLayout(ctx.context,[],axes);assert.equal(ctx.measureCalls.length,4);assert.ok(ctx.measureCalls.at(-2)!.endsWith('\0changed'));
});

test('custom precision and visible minor labels reserve their full measured widths',()=>{
  const y=new Axis(host,'y').setInterval({start:0,end:1}).setTitle('Amplitude'),ctx=new CanvasOracle();
  y.tickStrategy.setCustomTickPlacement({major:()=>[0,.5,1],minor:()=>[.25,.75]})
    .setMajorFormattingFunction((v:number)=>v.toFixed(6))
    .setMinorFormattingFunction((v:number)=>'minor:'+v.toFixed(9))
    .setMinorTickStyle((style:TickStyle)=>style.setLabelFont(new FontSettings({size:18})).setLabelFillStyle(new SolidFill({color:ColorRGBA(200,100,40)})));
  const layout=measureAxisCanvasLayout(ctx.context,[],[y]),m=layout.axes.get(y)!;
  assert.equal(m.measured,true);assert.equal(m.labelWidth,'minor:0.250000000'.length*9);
  assert.ok(m.laneSize>=m.labelOffset+m.labelWidth+8);
  drawAxisCanvas(ctx.context,{plot,axesX:[],axesY:[y],layout});
  for(const text of ctx.texts.filter(t=>t.text!=='Amplitude')){
    const size=Number(text.font.match(/([\d.]+)px/)![1]),width=text.text.length*size*.5;
    assert.ok(plot.left-text.x+width<=m.laneSize,`${text.text} must fit its physical Y lane`);
  }
  assert.ok(ctx.measureCalls.some(t=>t.endsWith('\0minor:0.250000000')));
});

test('formatting offsets and large default endpoints grow the lane without calling cursor formatters',()=>{
  const ctx=new CanvasOracle(),shifted=new Axis(host,'y').setInterval({start:0,end:1});
  shifted.tickStrategy.setFormattingOffset(1e12);
  const a=measureAxisCanvasLayout(ctx.context,[],[shifted]).axes.get(shifted)!;
  assert.ok(a.measured&&a.laneSize>54);
  const large=new Axis(host,'y').setInterval({start:1e12,end:1e12+1});let cursorCalls=0;
  large.tickStrategy.setCursorFormatter(()=>{cursorCalls++;return'cursor only';});
  const b=measureAxisCanvasLayout(ctx.context,[],[large]).axes.get(large)!;
  assert.ok(b.measured&&b.laneSize>54);assert.equal(cursorCalls,0);
});

test('custom placement label objects reserve room even without a formatter callback',()=>{
  const y=new Axis(host,'y').setInterval({start:0,end:1}),ctx=new CanvasOracle(),label='absolute timestamp 1700000000.123456';
  y.tickStrategy.setCustomTickPlacement({major:()=>[{position:.5,label}],minor:()=>[]});
  const m=measureAxisCanvasLayout(ctx.context,[],[y]).axes.get(y)!;
  assert.equal(m.measured,true);assert.equal(m.labelWidth,label.length*6);assert.ok(m.laneSize>=m.labelOffset+m.labelWidth+8);
});

test('text measurement uses the same alphabetic baseline as drawing and restores caller state',()=>{
  for(const baseline of['top','middle','bottom']){
    const y=new Axis(host,'y').setInterval({start:0,end:1}),ctx=new CanvasOracle(),seen:string[]=[];ctx.textBaseline=baseline;
    y.tickStrategy.setFormattingFunction((v:number)=>'value:'+v.toFixed(6));
    ctx.measureText=function(text:string){seen.push(this.textBaseline);return{width:text.length*6,actualBoundingBoxAscent:this.textBaseline==='alphabetic'?9:12,actualBoundingBoxDescent:this.textBaseline==='alphabetic'?3:0};};
    const m=measureAxisCanvasLayout(ctx.context,[],[y]).axes.get(y)!;
    assert.equal(m.labelAscent,9);assert.equal(m.labelDescent,3);assert.ok(seen.length>0&&seen.every(v=>v==='alphabetic'));assert.equal(ctx.textBaseline,baseline);assert.equal(ctx.font,'10px initial');
  }
});

test('title content extent follows public glyph/font observations instead of a fixed title height',()=>{
  // Fixed glyph metrics exercise title extents across font sizes.
  const rows=[['I',18,13,0,21],['gj',18,13,4,24],['Hello',18,14,0,22],['Public major / minor grid',12,9,3,19],['Public major / minor grid',18,14,4,25],['Public major / minor grid',36,27,8,42]] as const;
  for(const[text,size,ascent,descent,expected]of rows){
    const ctx:any={font:'original',textBaseline:'middle',measureText(){assert.equal(this.textBaseline,'alphabetic');return{width:20,actualBoundingBoxAscent:ascent,actualBoundingBoxDescent:descent};}};
    assert.equal(measureChartTitleContent(ctx,text,new FontSettings({size,family:'Segoe UI'})),expected);assert.equal(ctx.font,'original');assert.equal(ctx.textBaseline,'middle');
  }
  assert.equal(measureChartTitleContent(undefined,'',new FontSettings({size:36})),0);
});

test('hidden/disposed axes and explicit empty title fill paint no text and consume no lanes',()=>{
  const hidden=axis('x',{iParallel:1}).setVisible(false),disposed=axis('y',{iParallel:2}),empty=axis('x').setTitle('Hidden title').setTitleFillStyle(emptyFill);disposed.dispose();
  const ctx=new CanvasOracle(),layout=drawAxisCanvas(ctx.context,{plot,axesX:[hidden,empty],axesY:[disposed]});
  assert.equal(layout.axes.size,1);assert.deepEqual(layout.extraMargins,{left:0,right:0,top:0,bottom:0});assert.equal(ctx.texts.length,3);assert.ok(ctx.texts.every(t=>t.text!=='Hidden title'));
});

test('custom theme tick font is measured and drawn identically, with its real label and grid colors',()=>{
  const y=axis('y'),ctx=new CanvasOracle(),label='-12345.67';y.ticks=()=>[{value:5,label}];
  const theme={font:new FontSettings({size:28,family:'monospace',weight:700}),tickLabelFillStyle:new SolidFill({color:ColorRGBA(25,115,55)}),tickGridStrokeStyle:new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(180,35,75)})})};
  const layout=measureAxisCanvasLayout(ctx.context,[],[y],theme),measured=layout.axes.get(y)!;
  assert.equal(measured.labelWidth,label.length*28*.5);assert.ok(layout.extraMargins.left>0);
  assert.ok(ctx.measureCalls.includes(theme.font.toCSS()+'\0'+label));
  drawAxisCanvas(ctx.context,{plot,axesX:[],axesY:[y],layout,theme,light:true});
  assert.equal(ctx.texts[0]!.font,theme.font.toCSS());assert.equal(ctx.texts[0]!.fill,ColorRGBA(25,115,55).toCSS());
  assert.equal(ctx.strokes[0]!.color,ColorRGBA(180,35,75).toCSS());assert.equal(ctx.strokes[0]!.width,2);
});

test('explicit 12px font, label color and hidden grid override a large light custom theme',()=>{
  const x=axis('x'),ctx=new CanvasOracle(),ink=ColorRGBA(210,45,80);
  x.tickStrategy.setTickStyle((tick:TickStyle)=>tick.setLabelFont((font:FontSettings)=>font.setSize(12)).setLabelFillStyle(new SolidFill({color:ink})).setGridStrokeStyle(emptyLine));
  const theme={font:new FontSettings({size:32,family:'monospace'}),tickLabelFillStyle:new SolidFill({color:ColorRGBA(0,100,200)}),tickGridStrokeStyle:new SolidLine({thickness:3})};
  const layout=drawAxisCanvas(ctx.context,{plot,axesX:[x],axesY:[],theme,light:true});
  assert.equal(layout.axes.get(x)!.measured,false);
  assert.deepEqual(ctx.measureCalls,['0','5','10'].map(text=>'normal normal normal 12px sans-serif\0'+text),'drawing measures each X glyph for its physical boundary; the layout fast path remains unmeasured');
  assert.ok(ctx.texts.every(t=>t.font==='normal normal normal 12px sans-serif'&&t.fill===ink.toCSS()));assert.equal(ctx.strokes.length,0);
});

test('explicit and theme empty fills stay hidden instead of falling back to visible labels or grids',()=>{
  const x=axis('x'),ctx=new CanvasOracle(),theme={font:new FontSettings({size:19}),tickLabelFillStyle:new SolidFill({color:ColorRGBA(200,30,80)}),tickGridStrokeStyle:new SolidLine({thickness:2})};
  x.tickStrategy.major.setLabelFillStyle(emptyFill).setGridStrokeStyle(emptyLine);
  drawAxisCanvas(ctx.context,{plot,axesX:[x],axesY:[],theme});assert.equal(ctx.texts.length,0);assert.equal(ctx.strokes.length,0);
  const inherited=new CanvasOracle();drawAxisCanvas(inherited.context,{plot,axesX:[axis('x')],axesY:[],theme:{tickLabelFillStyle:emptyFill,tickGridStrokeStyle:emptyLine}});
  assert.equal(inherited.texts.length,0);assert.equal(inherited.strokes.length,0);
});

test('new tick strategies and changed theme fonts recompute layout without overwriting explicit FontSettings',()=>{
  const y=axis('y'),ctx=new CanvasOracle(),small={font:new FontSettings({size:14,family:'Arial'})},large={font:new FontSettings({size:26,family:'monospace'})};
  y.ticks=()=>[{value:5,label:'12345'}];
  const first=measureAxisCanvasLayout(ctx.context,[],[y],small),second=measureAxisCanvasLayout(ctx.context,[],[y],large);
  assert.equal(first.axes.get(y)!.labelWidth,35);assert.equal(second.axes.get(y)!.labelWidth,65);
  const explicit=new FontSettings({size:12,family:'Courier New'});y.tickStrategy.major.setLabelFont(explicit);
  drawAxisCanvas(ctx.context,{plot,axesX:[],axesY:[y],theme:large});assert.equal(ctx.texts.at(-1)!.font,explicit.toCSS());
  y.setTickStrategy('numeric');drawAxisCanvas(ctx.context,{plot,axesX:[],axesY:[y],theme:large});assert.equal(ctx.texts.at(-1)!.font,large.font.toCSS());
  const variant={font:new FontSettings({variant:'small-caps'})};
  assert.equal(measureAxisCanvasLayout(ctx.context,[],[y],variant).axes.get(y)!.measured,true,'Font variants must not enter the unmeasured default-font fast path');
});

test('long timestamp labels stay disjoint through resizes and precision changes while every grid tick remains',()=>{
  const origin=1767268800000;
  for(const width of [300,600,1050])for(const precision of [0,3]){
    const area={left:20,top:30,width,height:250},ctx=new CanvasOracle();
    const host:AxisHost={plot:area,invalidate(){},boundsFor(){return undefined;}};
    const x=new Axis(host,'x').setInterval({start:origin,end:origin+10000});
    x.setTickStrategy('Numeric',ticks=>ticks.setFormattingFunction((value:number)=>value.toFixed(precision)));
    const ticks=x.tickLayout(width);drawAxisCanvas(ctx.context,{plot:area,axesX:[x],axesY:[]});
    const labels=ctx.texts.map(t=>({...t,width:t.text.length*6})).sort((a,b)=>a.x-b.x);
    assert.ok(labels.length>=2);assert.ok(labels.every(t=>ticks.major.some(tick=>tick.label===t.text)), 'rendered text preserves the configured full precision');
    for(let i=1;i<labels.length;i++)assert.ok(labels[i]!.x-labels[i]!.width/2-(labels[i-1]!.x+labels[i-1]!.width/2)>=4-1e-9,'adjacent glyphs retain a four-pixel gap');
    assert.ok(labels.every(t=>t.x-t.width/2>=area.left&&t.x+t.width/2<=area.left+area.width));
    const grids=ctx.strokes.filter(s=>s.path.length===2&&s.path[0]!.x===s.path[1]!.x&&Math.abs(s.path[0]!.y-s.path[1]!.y)===area.height);
    assert.equal(grids.length,ticks.major.length+ticks.minor.length,'label admission must not thin the fine grid');
    assert.deepEqual(x.getInterval(),{start:origin,end:origin+10000});
  }
});

test('visible minor labels use remaining gaps and cannot paint over major labels',()=>{
  const area={left:0,top:0,width:200,height:100},ctx=new CanvasOracle(),host:AxisHost={plot:area,invalidate(){},boundsFor(){return undefined;}};
  const x=new Axis(host,'x').setInterval({start:0,end:10});
  x.setTickStrategy('Numeric',s=>s.setCustomTickPlacement({major:()=>[0,5,10],minor:()=>[1,2,3,4,6,7,8,9]})
    .setFormattingFunction((value:number)=>value.toFixed(2)).setMinorTickStyle((style:TickStyle)=>style.setLabelFillStyle(new SolidFill({color:ColorRGBA(40,200,240)}))));
  drawAxisCanvas(ctx.context,{plot:area,axesX:[x],axesY:[]});
  const labels=ctx.texts.map(t=>({...t,width:t.text.length*6})).sort((a,b)=>a.x-b.x);
  for(const text of ['0.00','5.00','10.00'])assert.ok(labels.some(t=>t.text===text));
  for(let i=1;i<labels.length;i++)assert.ok(labels[i]!.x-labels[i]!.width/2-(labels[i-1]!.x+labels[i-1]!.width/2)>=4-1e-9);
  const grids=ctx.strokes.filter(s=>s.path.length===2&&s.path[0]!.x===s.path[1]!.x&&Math.abs(s.path[0]!.y-s.path[1]!.y)===area.height);assert.equal(grids.length,11);
});

test('calibration Time labels with explicit14px HH:mm:ss stay disjoint after endpoint clamping without removing grid ticks',()=>{
  const area={left:89,top:30,width:864.857,height:380},ctx=new CanvasOracle();
  const timeHost:AxisHost={plot:area,invalidate(){},boundsFor(){return undefined;}};
  const x=new Axis(timeHost,'x').setInterval({start:0,end:60000});
  x.setTickStrategy('Time',s=>s
    .setMajorTickStyle((style:TickStyle)=>style.setLabelFont((font:FontSettings)=>font.setSize(14)))
    .setMinorTickStyle((style:TickStyle)=>style.setLabelFont((font:FontSettings)=>font.setSize(14)))
    .setFormattingFunction((value:number)=>`00:${Math.floor(value/60000).toString().padStart(2,'0')}:${Math.floor(value/1000%60).toString().padStart(2,'0')}`));
  const layout=x.tickLayout(area.width,undefined,()=>56);
  drawAxisCanvas(ctx.context,{plot:area,axesX:[x],axesY:[]});
  const labels=ctx.texts.filter(t=>/^00:\d\d:\d\d$/.test(t.text)).sort((a,b)=>a.x-b.x);
  assert.ok(labels.length>=5);
  assert.ok(labels.some(t=>t.text==='00:00:00'));
  assert.ok(labels.some(t=>t.text==='00:01:00'));
  assert.ok(labels.every(t=>t.font.includes('14px')));
  for(let i=1;i<labels.length;i++)assert.ok(labels[i].x-labels[i-1].x>=56+4-1e-9,
    `configured full time labels overlap: ${labels[i-1].text} and ${labels[i].text}`);
  const grids=ctx.strokes.filter(s=>s.path.length===2&&s.path[0].x===s.path[1].x&&Math.abs(s.path[0].y-s.path[1].y)===area.height);
  assert.equal(grids.length,layout.major.length+layout.minor.length);
  assert.deepEqual(x.getInterval(),{start:0,end:60000});
});

test('calendar layout measures the configured font and keeps a visible great context label separate from major labels',()=>{
  const ctx=new CanvasOracle(),start=Date.UTC(2022,5,1),end=Date.UTC(2022,8,1);
  const x=new Axis(host,'x').setInterval({start,end}).setTickStrategy('DateTime');
  const strategy=x.tickStrategy as import('../src/axis').DateTimeTickStrategy;
  strategy.setUTC(true).setLocale('en-US').setFormatting(()=> 'G:2022',(value:number)=>new Date(value).toLocaleString('en-US',{month:'long',timeZone:'UTC'}));
  strategy.setGreatTickStyle((style:TickStyle)=>style.setLabelFillStyle(new SolidFill({color:ColorRGBA(0,255,255)})));
  strategy.setMajorTickStyle((style:TickStyle)=>style.setLabelFont(new FontSettings({family:'monospace',size:22})));
  const layout=drawAxisCanvas(ctx.context,{plot,axesX:[x],axesY:[]});
  const great=ctx.texts.filter(t=>t.text==='G:2022');assert.equal(great.length,1);
  assert.equal(great[0]!.align,'left');assert.equal(great[0]!.fill,ColorRGBA(0,255,255).toCSS());
  assert.equal(great[0]!.x,plot.left+2);
  const major=ctx.texts.filter(t=>t.text!=='G:2022');assert.ok(major.length>0);
  assert.ok(major.some(t=>t.font.includes('22px monospace')));
  assert.ok(ctx.measureCalls.some(call=>call.includes('22px monospace\0June')));
  const bounds=ctx.texts.map(t=>{const size=Number(t.font.match(/([\d.]+)px/)![1]),width=t.text.length*size*.5;return{left:t.x-(t.align==='center'?width/2:0),right:t.x+(t.align==='center'?width/2:width)};}).sort((a,b)=>a.left-b.left);
  for(let i=1;i<bounds.length;i++)assert.ok(bounds[i]!.left-bounds[i-1]!.right>=4-1e-9);
  const ticks=x.tickLayout(plot.width,undefined,(text,level)=>text.length*(level==='major'?22:level==='minor'?10:14)*.5);
  const grids=ctx.strokes.filter(s=>Math.abs(s.path[1]!.y-s.path[0]!.y)===plot.height);
  assert.equal(grids.length,ticks.major.length+ticks.minor.length,'the great label cannot remove a data grid line');
  assert.deepEqual(x.getInterval(),{start,end});assert.equal(layout.axes.get(x)!.labelFont.getSize(),22);
});
