import test from 'node:test';
import assert from 'node:assert/strict';
import {Cursor,ResultTable} from '../src/ui';
import {FontSettings,SolidFill,SolidLine,ColorRGBA,emptyFill,emptyLine} from '../src/core/styles';

function drawing(){
  const text:any[]=[],symbols:any[]=[],rects:any[]=[],measurements:any[]=[],stack:any[]=[],paths:any[]=[];
  const state:any={font:'12px sans-serif',fillStyle:'',strokeStyle:'',textAlign:'left',textBaseline:'alphabetic'};
  const target:any={
    save(){stack.push({...state});},restore(){Object.assign(state,stack.pop());},
    measureText(value:string){const size=Number(state.font.match(/([\d.]+)px/)?.[1]??12),width=value.length*size*(state.font.includes('bold')?.62:.5),offset=state.textBaseline==='top'?-size*.8:state.textBaseline==='middle'?-size*.3:state.textBaseline==='bottom'?size*.2:0;measurements.push({value,font:state.font,width,baseline:state.textBaseline});return{width,actualBoundingBoxAscent:size*.8+offset,actualBoundingBoxDescent:size*.2-offset};},
    fillText(value:string,x:number,y:number){text.push({text:value,x,y,font:state.font,fill:state.fillStyle,baseline:state.textBaseline});},
    beginPath(){paths.length=0;},arc(...args:any[]){paths.push(args);},fill(){symbols.push({path:[...paths],fill:state.fillStyle});},
    fillRect(...args:any[]){rects.push({args,fill:state.fillStyle});},strokeRect(){},setLineDash(){},translate(){},rotate(){},rect(){},clip(){},stroke(){},moveTo(){},lineTo(){},closePath(){},
  };
  const ctx=new Proxy(target,{get:(object,key)=>key in object?object[key]:state[key],set:(_object,key,value)=>{state[key]=value;return true;}}) as CanvasRenderingContext2D;
  return{ctx,text,symbols,rects,measurements,state};
}
const rect={left:10,top:20,width:700,height:380};
const fill=(r:number,g:number,b:number)=>new SolidFill({color:ColorRGBA(r,g,b)});

test('rich values inherit theme family and explicit cell weight/size control both measurement and draw',()=>{
  const table=new ResultTable({theme:{font:new FontSettings({family:'Courier New',size:16}),textColor:ColorRGBA(51,65,85)}});
  const content=[[{component:{getName:()=> 'Sensor A'},componentColor:ColorRGBA(235,40,145)}],['Pressure','',{text:'300 Pa',font:{weight:'bold',size:20}}],['Voltage','',{text:'0.30 mV',font:{weight:'normal',size:12}}]];
  table.setContent(content).setPosition({x:50,y:60});const d=drawing(),layout=table.prepareLayout(d.ctx);table.draw(d.ctx,rect,p=>p,layout);
  assert.equal(layout.rich,true);assert.equal(table.bounds.width,layout.width);assert.equal(table.bounds.height,layout.height);
  assert.ok(d.text.find(t=>t.text==='Sensor A').font.includes('16px Courier New'));
  assert.ok(d.text.find(t=>t.text==='300 Pa').font.includes('bold 20px Courier New'));
  assert.ok(d.text.find(t=>t.text==='0.30 mV').font.includes('normal 12px Courier New'));
  for(const text of d.text){const measurement=d.measurements.find(m=>m.value===text.text&&m.font===text.font);assert.ok(measurement);assert.ok(text.x+measurement.width<=table.bounds.left+table.bounds.width-table.padding+1e-10);}
  assert.deepEqual(table.getContent(),content);assert.deepEqual(content[1]![2],{text:'300 Pa',font:{weight:'bold',size:20}});
});

test('prepared rich layout snapshots live component name once and explicit componentColor overrides series fill',()=>{
  let reads=0,name='initial';const component={getName(){reads++;return name;},getFillStyle:()=>fill(20,220,50)},table=new ResultTable();
  table.setContent([[{component,componentColor:ColorRGBA(235,40,145)}]]);const d=drawing(),layout=table.prepareLayout(d.ctx);name='later and much longer';table.draw(d.ctx,rect,p=>p,layout);
  assert.equal(reads,1);assert.deepEqual(d.text.map(t=>t.text),['initial']);assert.equal(d.symbols[0].fill,'rgba(235, 40, 145, 1)');
  const next=table.prepareLayout(d.ctx);assert.equal(reads,2);assert.ok(next.width>layout.width);
});

test('component cells infer visible fill then stroke through public style accessors',()=>{
  const table=new ResultTable();table.setContent([[{component:{getName:()=> 'Histogram',getFillStyle:()=>fill(20,220,50)}}],[{component:{getName:()=> 'Line',getFillStyle:()=>emptyFill,getStrokeStyle:()=>new SolidLine({fillStyle:fill(40,100,240)})}}]]);
  const d=drawing();table.draw(d.ctx,rect,p=>p);assert.deepEqual(d.symbols.map(s=>s.fill),['rgba(20, 220, 50, 1)','rgba(40, 100, 240, 1)']);assert.deepEqual(d.text.map(t=>t.text),['Histogram','Line']);
});

test('plain strings retain joined rows, newline split, prior font and exact bounds',()=>{
  const table=new ResultTable().setPosition({x:30,y:40});table.setContent([['alpha','300 Pa'],['two\nlines','0.30 mV']]);const d=drawing();table.draw(d.ctx,rect,p=>p);
  const lines=['alpha    300 Pa','two','lines    0.30 mV'];assert.deepEqual(d.text.map(t=>t.text),lines);
  assert.equal(table.bounds.left,30);assert.equal(table.bounds.top,40);assert.equal(table.bounds.width,Math.max(...lines.map(line=>line.length*6))+12);
  // The legacy UIElement first computes lineHeight, then multiplies by rows.
  // Preserve that floating-point evaluation order instead of a reassociated oracle.
  assert.equal(table.bounds.height,3*(12*1.35)+12);assert.equal(table.text,'');assert.equal(table.prepareLayout(d.ctx).rich,false);
});

test('rich row colors and explicitly empty text fill are retained without mutating caller styles',()=>{
  const table=new ResultTable();table.setContent([['Value',{text:'N/A',fillStyle:emptyFill,font:{weight:'bold'},rowFillStyle:fill(20,30,40)}]]);
  const d=drawing();table.draw(d.ctx,rect,p=>p);assert.equal(d.text.find(t=>t.text==='N/A').fill,'rgba(0, 0, 0, 0)');assert.ok(d.rects.some(r=>r.fill==='rgba(20, 30, 40, 1)'));assert.equal(table.getContent()[0]![1].fillStyle,emptyFill);
});

test('measured rich cursor table fits at all four pane corners without changing source position',()=>{
  const cursor=new Cursor();cursor.setPointMarkerVisible(false).setTickMarkerXVisible(false).setTickMarkerYVisible(false).setGridStrokeXStyle(emptyLine).setGridStrokeYStyle(emptyLine);
  cursor.setResultTable(table=>table.setTextFont(new FontSettings({family:'Arial',size:16})).setContent([[{component:{getName:()=> 'Pressure sensor channel with a long name'},componentColor:ColorRGBA(50,100,240)}],['Pressure','',{text:'300.125 Pa',font:{weight:'bold',size:20}}]]));
  for(const point of [{x:rect.left,y:rect.top},{x:rect.left+rect.width,y:rect.top},{x:rect.left,y:rect.top+rect.height},{x:rect.left+rect.width,y:rect.top+rect.height}]){
    cursor.setPosition({pointMarker:point,resultTable:point});const d=drawing();cursor.draw(d.ctx,rect,p=>p);const b=cursor.getResultTable().bounds;
    assert.ok(b.left>=rect.left-1e-9&&b.top>=rect.top-1e-9&&b.left+b.width<=rect.left+rect.width+1e-9&&b.top+b.height<=rect.top+rect.height+1e-9);
    assert.deepEqual(cursor.getPositions()[0]!.pointMarker,point);
  }
});

test('omitted font values inherit the table while explicit normal remains authoritative',()=>{
  const table=new ResultTable().setTextFont(new FontSettings({family:'monospace',size:18,weight:'bold'}));table.setContent([['Value',{text:'0 dB',font:{size:undefined,weight:'normal'}}]]);
  const d=drawing();table.draw(d.ctx,rect,p=>p);const actual=d.text.find(t=>t.text==='0 dB');assert.ok(actual.font.includes('normal 18px monospace'));assert.ok(!actual.font.includes('bold'));
});

test('rich measurement normalizes top/middle/bottom contexts to the draw baseline and restores caller state',()=>{
  const table=new ResultTable().setPosition({x:30,y:40});table.setContent([['Pressure',{text:'300 Pa',font:{weight:'bold',size:20}}],['Voltage',{text:'0.30 mV',font:{size:12}}]]);
  const original=drawing();table.draw(original.ctx,rect,p=>p);const expectedText=original.text.map(value=>({...value})),expectedBounds={...table.bounds};
  for(const baseline of ['top','middle','bottom']){
    const d=drawing();d.state.textBaseline=baseline;const layout=table.prepareLayout(d.ctx);assert.equal(d.state.textBaseline,baseline);assert.ok(d.measurements.every(value=>value.baseline==='alphabetic'));
    table.draw(d.ctx,rect,p=>p,layout);assert.deepEqual(table.bounds,expectedBounds);assert.deepEqual(d.text,expectedText);assert.ok(d.text.every(value=>value.baseline==='alphabetic'));assert.equal(d.state.textBaseline,baseline);
  }
  const plain=new ResultTable().setContent([['Plain','300 Pa']]),d=drawing();d.state.textBaseline='middle';plain.prepareLayout(d.ctx);assert.ok(d.measurements.every(value=>value.baseline==='middle'));assert.equal(d.state.textBaseline,'middle');
});
