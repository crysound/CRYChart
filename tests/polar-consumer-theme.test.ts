// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {Polar} from '../src/chart';
import {TickStyle} from '../src/axis';
import {makeCustomTheme} from '../src/themes';
import {AxisTickStrategies,ColorHEX,FontSettings,SolidFill,emptyFill,emptyLine,transparentFill} from '../src/core/styles';

function context(){
  const text:{text:string;font:string;fill:string}[]=[],strokes:{fill:string;width:number}[]=[];
  const target:any={font:'12px sans-serif',fillStyle:'',strokeStyle:'',lineWidth:1,
    fillText(value:string){text.push({text:value,font:this.font,fill:this.fillStyle});},
    stroke(){strokes.push({fill:this.strokeStyle,width:this.lineWidth});},
    measureText(value:string){const size=Number(this.font.match(/([\d.]+)px/)?.[1]??12);return{width:value.length*size*.5,actualBoundingBoxAscent:size*.75,actualBoundingBoxDescent:size*.25};},
  };
  const ctx=new Proxy(target,{get:(value,key)=>key in value?value[key]:()=>{},set:(value,key,next)=>{value[key]=next;return true;}}) as CanvasRenderingContext2D;
  return{ctx,text,strokes};
}
function chart(isDark:boolean){
  const theme=makeCustomTheme({isDark,effects:false,gradients:!isDark,backgroundColor:transparentFill,textColor:ColorHEX(isDark?'#e0e0e0':'#334155'),gridLineColor:ColorHEX(isDark?'#444444':'#CBD5E1'),axisColor:ColorHEX(isDark?'#707070':'#64748B'),fontSize:{axisTitle:14,chartTitle:14}});
  const chart=new Polar({theme});chart.setTitleFillStyle(emptyFill);
  chart.getRadialAxis().setTitleFillStyle(emptyFill).setNorth(0).setClockwise(true).setTickFormattingFunction(value=>{const degrees=((Math.round(value*180/Math.PI)%360)+360)%360;return degrees===90?'':String(degrees);});
  chart.getAmplitudeAxis().setTitleFillStyle(emptyFill).setTickStrategy(AxisTickStrategies.Numeric,strategy=>strategy.setFormattingFunction((value:number)=>String(value))).setInterval({start:-40,end:0});
  chart.getAmplitudeAxis().setUnits('dB',{displayOnAxis:false});
  return chart;
}
for(const dark of[true,false])test(`Polar consumer ${dark?'dark':'light'} theme controls actual text and grid despite transparent chart fill`,()=>{
  const p=chart(dark),c=context();p.updatePolarLayout(c.ctx);p.drawPolarAxes(c.ctx);
  const text=ColorHEX(dark?'#e0e0e0':'#334155').toCSS(),grid=ColorHEX(dark?'#444444':'#CBD5E1').toCSS(),axis=ColorHEX(dark?'#707070':'#64748B').toCSS();
  assert.ok(c.text.length>10);assert.ok(c.text.every(t=>t.fill===text));assert.ok(c.text.every(t=>t.font.includes('14px Arial')),'replacement Numeric strategy still receives theme font');
  assert.ok(c.text.some(t=>t.text==='-10'));assert.ok(!c.text.some(t=>t.text==='90'||t.text.includes('°')||t.text.includes('dB')));
  assert.ok(c.strokes.some(s=>s.fill===grid));assert.ok(c.strokes.some(s=>s.fill===axis));assert.ok(c.strokes.every(s=>s.fill===grid||s.fill===axis));
  p.dispose();
});
test('explicit 12px font, empty labels, and hidden grid override theme defaults',()=>{
  const p=chart(false),a=p.getAmplitudeAxis().tickStrategy;
  a.setTickStyle((style:TickStyle)=>style.setLabelFont(new FontSettings({size:12,family:'monospace'})).setLabelFillStyle(new SolidFill({color:ColorHEX('#ff00ff')})).setGridStrokeStyle(emptyLine));
  p.getRadialAxis().tickStrategy.setTickStyle((style:TickStyle)=>style.setLabelFillStyle(emptyFill).setGridStrokeStyle(emptyLine));
  const c=context();p.updatePolarLayout(c.ctx);p.drawPolarAxes(c.ctx);
  assert.ok(c.text.length>=4);assert.ok(c.text.every(t=>t.font.includes('12px monospace')&&t.fill===ColorHEX('#ff00ff').toCSS()));
  assert.equal(c.strokes.length,2,'only the outer axis and amplitude-axis line remain');p.dispose();
});
test('custom font family and size are measured and rendered without a fixed data-radius correction',()=>{
  const p=new Polar({theme:makeCustomTheme({isDark:false,fontFamily:'monospace',fontSize:{other:20}})}),c=context();
  p.updatePolarLayout(c.ctx);p.drawPolarAxes(c.ctx);assert.ok(c.text.every(t=>t.font.includes('20px monospace')));
  const layout=p.getPolarLayout();assert.equal(layout.plot.width,2*layout.dataRadius);assert.equal(layout.plot.height,2*layout.dataRadius);p.dispose();
});
test('TickStyle font override is explicit, cloned and not set by a failing mutator',()=>{
  const tick=new TickStyle();assert.equal(tick.hasLabelFontOverride(),false);
  assert.throws(()=>tick.setLabelFont(()=>{throw new Error('failed');}));assert.equal(tick.hasLabelFontOverride(),false);
  tick.setLabelFont(new FontSettings({size:12}));assert.equal(tick.hasLabelFontOverride(),true);assert.equal(tick.clone().hasLabelFontOverride(),true);
});
