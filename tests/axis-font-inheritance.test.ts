// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {Axis, NumericTickStrategy, TickStyle, type AxisHost} from '../src/axis';
import {ChartXY, Polar} from '../src/chart';
import {AxisTickStrategies, FontSettings, emptyFill, emptyLine} from '../src/core/styles';
import {makeCustomTheme} from '../src/themes';
import {measureAxisCanvasLayout, drawAxisCanvas} from '../src/axis-canvas';

const describeFont = (font: FontSettings) => [font.getFamily(), font.getSize(), font.getWeight(), font.getStyle()];
const theme = (family='Courier New') => makeCustomTheme({fontFamily: family, fontSize: {other: 19}});
const axisHost = (font?: FontSettings): AxisHost => ({theme: {font}, invalidate() {}, boundsFor() {return undefined;}});
const sizes = (axis: Axis, value=12) => axis.setTickStrategy(AxisTickStrategies.Numeric, (strategy: NumericTickStrategy) => strategy.setTickStyle((tick: TickStyle) => tick.setLabelFont((font: FontSettings) => font.setSize(value))));

test('XY major and minor mutators receive the theme font before changing size', t => {
  const chart = new ChartXY({theme: theme()}); t.after(() => chart.dispose());
  for (const axis of [chart.getDefaultAxisX(), chart.getDefaultAxisY(), chart.addAxisY()]) {
    assert.deepEqual(describeFont(axis.tickStrategy.getMajorTickStyle().getLabelFont()), ['Courier New',19,'normal','normal']);
    assert.equal(axis.tickStrategy.getMajorTickStyle().hasLabelFontOverride(), false);
    const seen: unknown[] = [];
    axis.setTickStrategy(AxisTickStrategies.Numeric, (strategy: NumericTickStrategy) => strategy.setTickStyle((tick: TickStyle) => tick.setLabelFont((font: FontSettings) => {seen.push(describeFont(font)); return font.setSize(12);} )));
    assert.deepEqual(seen, [['Courier New',19,'normal','normal'],['Courier New',19,'normal','normal']]);
    for (const tick of [axis.tickStrategy.major, axis.tickStrategy.minor]) assert.deepEqual(describeFont(tick.getLabelFont()), ['Courier New',12,'normal','normal']);
  }
});

test('Empty, Numeric, Time and DateTime construction resolves current theme before styler callbacks', () => {
  const host = axisHost(new FontSettings({family:'Times New Roman',size:19})), axis = new Axis(host,'x');
  for (const kind of [AxisTickStrategies.Empty,AxisTickStrategies.Numeric,AxisTickStrategies.Time,AxisTickStrategies.DateTime,AxisTickStrategies.Numeric]) {
    axis.setTickStrategy(kind, (strategy: NumericTickStrategy) => {assert.equal(strategy.major.getLabelFont().getFamily(),'Times New Roman');return strategy.setTickStyle((tick:TickStyle)=>tick.setLabelFont((font:FontSettings)=>font.setSize(12)));});
    assert.equal(axis.tickStrategy.major.getLabelFont().getFamily(),'Times New Roman');
  }
  host.theme!.font = new FontSettings({family:'Courier New',size:22});
  const existing=axis.tickStrategy;
  sizes(axis); assert.equal(axis.tickStrategy,existing);
  assert.deepEqual(describeFont(axis.tickStrategy.major.getLabelFont()),['Times New Roman',12,'normal','normal'],'same-type configuration retains the existing style record');
  axis.setTickStrategy(AxisTickStrategies.Empty);sizes(axis);
  assert.deepEqual(describeFont(axis.tickStrategy.major.getLabelFont()),['Courier New',12,'normal','normal'],'a new strategy type resolves the current theme');
});

test('an explicit full font wins and a subsequent label mutator retains its family and weight', () => {
  const axis=new Axis(axisHost(theme().font as FontSettings),'x');
  const explicit=new FontSettings({family:'Georgia',size:17,weight:'bold',style:'italic'});
  axis.setTickStrategy(AxisTickStrategies.Numeric,(strategy:NumericTickStrategy)=>strategy.setMajorTickStyle((tick:TickStyle)=>tick.setLabelFont(explicit).setLabelFont((font:FontSettings)=>font.setSize(13))));
  assert.deepEqual(describeFont(axis.tickStrategy.major.getLabelFont()),['Georgia',13,'bold','italic']);
  assert.deepEqual(describeFont(explicit),['Georgia',17,'bold','italic']);
  assert.equal(axis.tickStrategy.major.hasLabelFontOverride(),true);
});

test('cloning a theme-seeded TickStyle isolates later mutators and explicit hidden styles', () => {
  const initial = new Axis(axisHost(theme().font as FontSettings),'x').tickStrategy.major;
  const copy=initial.clone().setLabelFont((font:FontSettings)=>font.setSize(12)).setLabelFillStyle(emptyFill).setGridStrokeStyle(emptyLine);
  assert.deepEqual(describeFont(initial.getLabelFont()),['Courier New',19,'normal','normal']);
  assert.equal(initial.hasLabelFontOverride(),false);
  const strategy=new NumericTickStrategy().setTickStyle(copy);
  assert.notEqual(strategy.major,strategy.minor);assert.notEqual(strategy.major,copy);
  strategy.major.setLabelFont((font:FontSettings)=>font.setSize(20));
  assert.equal(strategy.minor.getLabelFont().getSize(),12);assert.equal(copy.getLabelFont().getSize(),12);
  assert.equal(strategy.major.getLabelFillStyle(),emptyFill);assert.equal(strategy.minor.getGridStrokeStyle(),emptyLine);
});

test('standalone and default-theme styles retain 12px sans-serif and rejected callbacks do not set overrides', () => {
  for(const tick of [new TickStyle(),new NumericTickStrategy().major,new Axis(axisHost(),'x').tickStrategy.major]){
    assert.deepEqual(describeFont(tick.getLabelFont()),['sans-serif',12,'normal','normal']);
    assert.throws(()=>tick.setLabelFont(()=>{throw new Error('reject');}),/reject/);
    assert.equal(tick.hasLabelFontOverride(),false);assert.equal(tick.getLabelFont().getSize(),12);
  }
});

test('Polar mutators inherit global theme font; its existing polarAxisTickFont extension keeps precedence', t => {
  const plain=new Polar({theme:theme('Times New Roman')});t.after(()=>plain.dispose());
  sizes(plain.getAmplitudeAxis());assert.deepEqual(describeFont(plain.getAmplitudeAxis().tickStrategy.major.getLabelFont()),['Times New Roman',12,'normal','normal']);
  const custom={...theme(),polarAxisTickFont:new FontSettings({family:'Georgia',size:23,weight:'bold'})},polar=new Polar({theme:custom});t.after(()=>polar.dispose());
  for(const axis of [polar.getAmplitudeAxis(),polar.getRadialAxis()]){
    assert.deepEqual(describeFont(axis.tickStrategy.major.getLabelFont()),['Georgia',23,'bold','normal']);
    assert.equal(axis.tickStrategy.major.hasLabelFontOverride(),false);
    sizes(axis);assert.deepEqual(describeFont(axis.tickStrategy.major.getLabelFont()),['Georgia',12,'bold','normal']);
  }
  const explicit=new FontSettings({family:'Courier New',size:12});
  polar.getAmplitudeAxis().tickStrategy.major.setLabelFont(explicit);
  assert.equal((polar as any).polarTickAppearance(polar.getAmplitudeAxis()).font,explicit);
});

test('chart recreation with a second theme does not retain the first font seed', () => {
  for(const family of ['Courier New','Times New Roman','Georgia']){
    const chart=new ChartXY({theme:theme(family)});sizes(chart.getDefaultAxisX());
    assert.equal(chart.getDefaultAxisX().tickStrategy.major.getLabelFont().getFamily(),family);chart.dispose();
  }
});

test('XY measures and draws the exact size-mutated family, while preserving Canvas state', () => {
  const host=axisHost(theme().font as FontSettings),axis=new Axis(host,'x').setInterval({start:0,end:10});sizes(axis);
  axis.tickStrategy.setCustomTickPlacement({major:()=>[{position:0,label:'Width 000000'},{position:10,label:'Width 999999'}],minor:()=>[]});
  const calls:{kind:string;font:string;text:string}[]=[],stack:any[]=[];
  const ctx:any={font:'initial',textAlign:'right',textBaseline:'top',fillStyle:'red',strokeStyle:'blue',lineWidth:2,
    save(){stack.push({font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth});},restore(){Object.assign(this,stack.pop());},
    measureText(text:string){calls.push({kind:'measure',font:this.font,text});return {width:text.length*12*.6,actualBoundingBoxAscent:9,actualBoundingBoxDescent:3};},
    fillText(text:string){calls.push({kind:'draw',font:this.font,text});},beginPath(){},moveTo(){},lineTo(){},stroke(){},setLineDash(){},translate(){},rotate(){}
  };
  const layout=measureAxisCanvasLayout(ctx,[axis],[],host.theme),resolved=layout.axes.get(axis)!.labelFont;
  assert.deepEqual(describeFont(resolved),['Courier New',12,'normal','normal']);
  assert.equal(layout.axes.get(axis)!.labelWidth,12*12*.6);
  drawAxisCanvas(ctx,{plot:{left:100,top:30,width:400,height:250},axesX:[axis],axesY:[],layout,theme:host.theme});
  const text=calls.filter(call=>call.text.startsWith('Width'));
  assert.equal(text.filter(call=>call.kind==='draw').length,2);assert.ok(text.every(call=>call.font===resolved.toCSS()));
  assert.equal(ctx.font,'initial');assert.equal(ctx.textAlign,'right');assert.equal(ctx.textBaseline,'top');assert.equal(stack.length,0);
});
