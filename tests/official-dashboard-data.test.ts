import test from 'node:test';
import assert from 'node:assert/strict';
import {SampleClock, RollingMean, columnSums, racingSample, trackPoint} from '../examples/official/dashboards-data.js';
import {confidenceEllipse, spatialIndex} from '../examples/official/xy-data.js';
import {dashboardEntries} from '../examples/official/dashboards.js';
import {largeLinkedXYEntries} from '../examples/official/xy-large-linked.js';
import {ChartXY} from '../src/chart.js';
import {Spider} from '../src/specialty.js';
import {Themes} from '../src/core/styles.js';

test('stream clock partitions elapsed time without inventing or omitting samples across fractional batches', () => {
  for (const rate of [1, 10, 50, 60, 1000]) {
    const clock = new SampleClock(rate), batch = new SampleClock(rate);
    let end = 0;
    for (let i = 0; i < 800; i++) {
      const delta = [1 / 128, 3 / 128, 0, 4 / 128][i % 4];
      const step = clock.advance(delta);
      assert.equal(step.start, end); end += step.count;
    }
    assert.equal(end, batch.advance(12.5).count);
    const before = clock.index;
    for (const invalid of [-1, NaN, Infinity]) assert.throws(() => clock.advance(invalid));
    assert.equal(clock.index, before);
    assert.equal(clock.advance(0).count, 0);
  }
});

test('rolling mean matches an independent retained window after repeated wrap and rejected input', () => {
  const actual = new RollingMean(37), window: number[] = [];
  for (let i = 0; i < 4096; i++) {
    const value = ((i * 97) % 211 - 103) / 8;
    window.push(value); if (window.length > 37) window.shift();
    if (i % 71 === 0) assert.throws(() => actual.push(NaN));
    assert.equal(actual.push(value), window.reduce((a, b) => a + b, 0) / window.length);
  }
});

test('fiber column reduction retains finite zero and uses Float64 sums without changing source IEEE bytes', () => {
  const values = new Float32Array([0, 1e8, NaN, 1, -1e8, Infinity, -0, 1, -Infinity]);
  const before = Buffer.from(values.buffer).toString('hex');
  assert.deepEqual(Array.from(columnSums(values, 3, 3)), [1, 1, 0]);
  assert.equal(Buffer.from(values.buffer).toString('hex'), before);
});

test('ellipse covariance uses all finite paired rows and agrees with a direct two-pass oracle', () => {
  const x = new Float64Array([1002, 996, 1011, 1000, 998, NaN]);
  const y = new Float64Array([-297, -306, -286, -299, -304, 900]);
  const ex = [...x].slice(0, 5), ey = [...y].slice(0, 5), mx = ex.reduce((a,b)=>a+b,0)/5, my = ey.reduce((a,b)=>a+b,0)/5;
  const xx = ex.reduce((s,v)=>s+(v-mx)**2,0)/4, yy = ey.reduce((s,v)=>s+(v-my)**2,0)/4, xy = ex.reduce((s,v,i)=>s+(v-mx)*(ey[i]-my),0)/4;
  const result = confidenceEllipse({x,y}, .9, 64);
  for (const [a,b] of [[result.covariance.xx,xx],[result.covariance.xy,xy],[result.covariance.yy,yy]]) assert.ok(Math.abs(a-b)<1e-10);
  const determinant = xx*yy-xy*xy;
  for (const p of result.points) {
    const dx=p.x-mx,dy=p.y-my,q=(yy*dx*dx-2*xy*dx*dy+xx*dy*dy)/determinant;
    assert.ok(Math.abs(q+2*Math.log(.1))<1e-9);
  }
});

test('indexed cursor searches original samples on thin and degenerate domains including boundary cells', () => {
  for (const x of [new Float64Array([0,0,0,0]), new Float64Array([-3,1,4,12])]) {
    const y=new Float64Array([-10,-1,2,11]),index=spatialIndex({x,y},7);
    for(let i=0;i<4;i++) assert.equal(index.nearest(x[i],y[i],.001,.001),i);
    assert.equal(index.nearest(x[0],30,1,1),undefined);
  }
});

test('racing replay has a continuous closed track and exact lap boundaries while retaining independent scalar values', () => {
  const before=racingSample(75-1e-6),at=racingSample(75),after=racingSample(75+1e-6);
  assert.equal(before.lap,0); assert.equal(at.lap,1); assert.equal(at.lapTime,0); assert.ok(after.lapTime>0);
  const origin=trackPoint(0);assert.deepEqual(at.coordinate,origin);
  assert.ok(Math.hypot(before.coordinate.x-after.coordinate.x,before.coordinate.y-after.coordinate.y)<.001);
  const gear=Math.max(1,Math.min(6,Math.floor(at.speed/45)+1));
  assert.equal(at.rpm,2200+at.speed/gear*110);assert.equal(at.fuel,80-75*.035);
});

class Element {
  style:Record<string,any>={};dataset:Record<string,string>={};children:Element[]=[];parent?:Element;clientWidth=900;clientHeight=620;className='';textContent='';
  listeners=new Map<string,((e:any)=>void)[]>();constructor(readonly tag:string){}
  append(...children:Element[]){for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  insertBefore(child:Element,before?:Element){child.remove();child.parent=this;const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,child);}
  get firstChild(){return this.children[0];}
  setAttribute(){} getContext(){return null;} getBoundingClientRect(){return{left:0,top:0,width:900,height:620};}
  querySelector(selector:string):Element|undefined{return this.walk().find(e=>selector.startsWith('.')&&e.className.split(' ').includes(selector.slice(1)));}
  walk():Element[]{return this.children.flatMap(child=>[child,...child.walk()]);}
  addEventListener(type:string,listener:(e:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  dispatch(type:string,extra:Record<string,unknown>={}){for(const listener of this.listeners.get(type)??[])listener({pointerId:1,preventDefault(){},stopPropagation(){},...extra});}
}
function withMount(id:string,fn:(mounted:any,host:Element)=>void){
  const previous=globalThis.document,host=new Element('host'),doc={createElement:(tag:string)=>new Element(tag),body:host};
  Object.assign(globalThis,{document:doc});let mounted:any;
  try{
    const engine={ChartXY(options:any){Reflect.deleteProperty(globalThis,'document');try{const chart=new ChartXY({...options,width:900,height:620});Object.assign(chart,{root:new Element('div'),overlay:new Element('canvas')});return chart;}finally{Object.assign(globalThis,{document:doc});}},Spider:(options:any)=>new Spider({...options,headless:true})};
    const definition=[...dashboardEntries,...largeLinkedXYEntries].find(entry=>entry.id.includes(`-${id}-`))!;
    mounted=definition.mount!({host:host as unknown as HTMLElement,engine,theme:Themes.darkGold});fn(mounted,host);
  }finally{mounted?.dispose?.();mounted?.charts.forEach((c:any)=>c.dispose());if(previous===undefined)Reflect.deleteProperty(globalThis,'document');else Object.assign(globalThis,{document:previous});}
}

test('0042 top axes occupy six disjoint physical ranges and preserve individual channel values',()=>withMount('0042',(mounted)=>{
  mounted.update(1,1);
  for(const [panel,expected]of[[0,2],[1,4]]){
    const chart=mounted.charts[panel];chart.layout();const axes=chart.axesX.filter((axis:any)=>axis.opposite);
    assert.equal(axes.length,expected);
    axes.forEach((axis:any,i:number)=>assert.deepEqual(axis.getScreenRange(),{start:i/expected,end:(i+1)/expected}));
    for(const series of chart.series){assert.equal(series.getSampleCount(),100);assert.equal(series.getSample(99).y,990);assert.ok(axes.includes(series.getAxisX()));}
  }
}));

test('0500 cancelled divider cannot keep resizing on subsequent pointer movement',()=>withMount('0500',(mounted,host)=>{
  const divider=host.walk().find(el=>el.dataset.control==='column-divider')!;
  divider.dispatch('pointerdown');divider.dispatch('pointermove',{clientX:630});assert.equal(mounted.snapshot().columnRatio,.7);
  divider.dispatch('pointercancel');divider.dispatch('pointermove',{clientX:240});assert.equal(mounted.snapshot().columnRatio,.7);
  assert.equal(mounted.charts[0].legend.getOptions().visible,false);
}));

test('0511 cancelled reorder cannot move a channel on a later pointerup',()=>withMount('0511',(mounted,host)=>{
  const handle=host.walk().find(el=>el.dataset.control==='reorder-0')!;
  handle.dispatch('pointerdown');handle.dispatch('pointercancel');handle.dispatch('pointerup',{clientY:610});assert.deepEqual(mounted.snapshot().order,[0,1,2,3,4]);
}));

test('0513 cancelled panel drag keeps its last confirmed position',()=>withMount('0513',(mounted,host)=>{
  const handle=host.walk().find(el=>el.dataset.control==='drag-panel-18')!;
  handle.dispatch('pointerdown',{clientX:10,clientY:20});handle.dispatch('pointermove',{clientX:40,clientY:50});const before=mounted.snapshot().panels[18];
  handle.dispatch('pointercancel');handle.dispatch('pointermove',{clientX:90,clientY:120});assert.deepEqual(mounted.snapshot().panels[18],before);
}));
