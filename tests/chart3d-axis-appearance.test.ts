import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart';
import {makeCustomTheme} from '../src/themes';
import {ColorHEX, FontSettings, SolidFill, SolidLine, emptyFill, emptyLine} from '../src/core/styles';

class Probe extends Chart3D {paint(context: CanvasRenderingContext2D) {this.drawSpecial(context);}}
function recorder() {
  const texts: Array<{text:string;font:string;fill:string;rotation:number}> = [];
  const strokes: Array<{color:string;width:number}> = [];
  let angle=0;
  const stack:number[]=[];
  const context=new Proxy({font:'11px sans-serif',fillStyle:'',strokeStyle:'',lineWidth:1,
    save(){stack.push(angle);},restore(){angle=stack.pop()??0;},rotate(value:number){angle+=value;},
    measureText(text:string){const size=Number.parseFloat(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1]??'11');return{width:text.length*size*.55,actualBoundingBoxAscent:size*.75,actualBoundingBoxDescent:size*.25,actualBoundingBoxLeft:text.length*size*.275,actualBoundingBoxRight:text.length*size*.275};},
    fillText(text:string){texts.push({text,font:this.font,fill:String(this.fillStyle),rotation:angle});},
    stroke(){strokes.push({color:String(this.strokeStyle),width:this.lineWidth});}
  },{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
  return{context,texts,strokes};
}

test('3D axes draw the actual custom theme and per-axis overrides, including transparent backgrounds',()=>{
  const theme=makeCustomTheme({backgroundColor:emptyFill,textColor:ColorHEX('#304050'),gridLineColor:ColorHEX('#ccddee'),axisColor:ColorHEX('#708090'),fontSize:{axisTitle:14,other:13},fontFamily:'Arial'});
  const chart=new Probe({theme,legend:{visible:false}}).resize(1440,749),r=recorder();
  try{
    chart.axisX.setTitle('Time (s)').setInterval({start:0,end:2200});
    chart.axisY.setTitle('Level (dB)').setInterval({start:-85,end:-41});
    chart.axisZ.setTitle('Frequency (Hz)').setInterval({start:20,end:20000});
    chart.paint(r.context);
    const titles=r.texts.filter(t=>t.text.includes('('));
    assert.equal(titles.length,3);
    for(const title of titles){assert.equal(title.fill,theme.textColor.toCSS());assert.match(title.font,/14px Arial/);assert.ok(Math.abs(title.rotation)>.01,'3D titles follow the projected axis');}
    assert.ok(r.texts.filter(t=>!t.text.includes('(')).every(t=>t.fill===theme.textColor.toCSS()&&t.font.includes('13px Arial')));
    assert.ok(r.strokes.some(s=>s.color===ColorHEX('#ccddee').toCSS()));
    assert.ok(r.strokes.every(s=>[ColorHEX('#ccddee').toCSS(),ColorHEX('#708090').toCSS()].includes(s.color)),'No hard-coded dark bounding box');
    r.texts.length=0;r.strokes.length=0;
    for(const axis of[chart.axisX,chart.axisY,chart.axisZ])axis.setTitleFillStyle(emptyFill).setStrokeStyle(emptyLine).setTickStrategy('Empty');
    chart.paint(r.context);assert.deepEqual(r.texts,[]);assert.deepEqual(r.strokes,[]);
    chart.axisX.setTitleFillStyle(new SolidFill({color:ColorHEX('#112233')})).setTitleRotation(0).setTitleFont(new FontSettings({size:17,family:'serif'}));
    chart.axisX.setTickStrategy('Numeric',strategy=>strategy.setMajorTickStyle(style=>style.setLabelFillStyle(new SolidFill({color:ColorHEX('#445566')})).setLabelFont(new FontSettings({size:15,family:'serif'})).setGridStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorHEX('#778899')})}))));
    chart.paint(r.context);
    const title=r.texts.find(t=>t.text==='Time (s)')!;assert.equal(title.fill,ColorHEX('#112233').toCSS());assert.equal(title.rotation,0);assert.match(title.font,/17px serif/);
    assert.ok(r.texts.filter(t=>t.text!=='Time (s)').every(t=>t.fill===ColorHEX('#445566').toCSS()&&t.font.includes('15px serif')));
    assert.ok(r.strokes.some(s=>s.color===ColorHEX('#778899').toCSS()&&s.width===2));
    assert.ok(r.strokes.every(s=>s.color===ColorHEX('#778899').toCSS()||s.color===ColorHEX('#ccddee').toCSS()),'Minor grids keep their independent theme style');
  }finally{chart.dispose();}
});
