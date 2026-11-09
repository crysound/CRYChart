// 三类实际产品render回归；Canvas只记录绘制调用，消费者从正式源AST提取。
// 不依赖codex_artifact，也不把Node绘制采集器当Chrome参考验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {Pie} from '../src/specialty.js';
import {Funnel,Pyramid} from '../src/hierarchy.js';
const api:Record<string,any>={Pie,Funnel,Pyramid};
const ts=createRequire(import.meta.url)('typescript') as typeof import('typescript');

/** 从正式源提取实际formatter，保留lookup/donut闭包。 */
function actualConsumer(file:'business.ts'|'maps.ts',lookup=false,donut=false):(slice:any,relativeValue:number)=>string {
  const path=resolve('examples/official',file),text=readFileSync(path,'utf8');
  const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),callbacks:string[]=[];
  const visit=(node:import('typescript').Node)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='setLabelFormatter')callbacks.push(node.arguments[0].getText(source));ts.forEachChild(node,visit);};visit(source);
  if(callbacks.length!==1)throw new Error(file+': 应有唯一实际slice formatter，实际数量 '+callbacks.length);
  const compiled=ts.transpileModule('const selectedFormatter=('+callbacks[0]+');',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
  if(compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw new Error(file+': 实际formatter语法解析失败');
  return new Function('lookup','donut',compiled.outputText+'\nreturn selectedFormatter;')(lookup,donut);
}
const consumers={business:(lookup=false,donut=false)=>actualConsumer('business.ts',lookup,donut),maps:actualConsumer('maps.ts')};

const original:Record<string,Array<[string,number]>>={Pie:[['Planning',20],['Development',60],['Testing',30],['Review',12],['Bug Fixing',45]],Funnel:[['Prospects',2000],['Contacts',1540],['Leads',1095],['Customers',549]],Pyramid:[['2015 - 2016',3],['2016 - 2017',5],['2017 - 2018',10],['2018 - 2019',17]]};
function context(){const texts:string[]=[],geometry:any[]=[];const finite=(...values:any[])=>{for(const v of values)if(typeof v==='number')assert.ok(Number.isFinite(v),'实际绘制坐标必须有限');};const ctx=new Proxy({measureText:(text:any)=>({width:String(text).length*6}),fillText(text:any,...args:any[]){finite(...args);texts.push(String(text));},strokeText(text:any,...args:any[]){finite(...args);},createLinearGradient(...args:any[]){finite(...args);return{addColorStop(offset:number){assert.ok(offset>=0&&offset<=1);}};}},{get(t:any,k:any){return k in t?t[k]:(...args:any[])=>{finite(...args);geometry.push({method:String(k),args:args.filter(x=>typeof x==='number')});};},set(t:any,k:any,v:any){t[k]=v;return true;}});return{ctx,texts,geometry};}
function create(kind:string,data:any=original[kind],sliceMode?:number){const chart=new api[kind]({headless:true,width:900,height:700});activeCharts?.push(chart);if(sliceMode!==undefined)chart.setSliceMode(sliceMode);const slices=data.map(([name,value])=>chart.addSlice(name,value));return{chart,slices};}
function render(chart:any){const drawing=context();chart.render(drawing.ctx);return drawing;}
let activeCharts:any[]|undefined;
function check(id:string,execute:(observation:any)=>void){test(id,()=>{const previous=activeCharts,owned:any[]=[];activeCharts=owned;try{execute({});}finally{activeCharts=previous;for(const chart of owned)chart.dispose();}});}
for(const kind of ['Pie','Funnel','Pyramid']){
 check(kind+'-original-full-data-real-render-callback-relative-value',o=>{const modes=kind==='Pie'?[undefined]:[0,1];o.modes=[];for(const sliceMode of modes){const{chart,slices}=create(kind,original[kind],sliceMode),calls=[];chart.setLabelFormatter((slice,relativeValue)=>{const text=slice.getName()+': '+(relativeValue*100).toFixed(2)+'%';calls.push({name:slice.getName(),value:slice.getValue(),relativeValue,text});return text;});const drawn=render(chart),sum=original[kind].reduce((n,x)=>n+x[1],0);o.modes.push({sliceMode,calls,texts:drawn.texts,geometryOperations:drawn.geometry.length});assert.ok(drawn.geometry.length>0);assert.equal(calls.length,original[kind].length);for(const[name,value]of original[kind]){const c=calls.find(x=>x.name===name);assert.equal(c.value,value);assert.equal(c.relativeValue,value/sum);assert.ok(drawn.texts.includes(`${name}: ${(value/sum*100).toFixed(2)}%`));}assert.deepEqual(slices.map(s=>[s.getName(),s.getValue()]),original[kind]);chart.dispose();}});
 check(kind+'-visible-denominator-hide-restore-and-value-mutation',o=>{const{chart,slices}=create(kind),calls=[];chart.setLabelFormatter((s,v)=>{calls.push({name:s.getName(),value:s.getValue(),relativeValue:v});return s.getName();});slices[0].setVisible(false);render(chart);o.hidden=structuredClone(calls);const sum=original[kind].slice(1).reduce((n,x)=>n+x[1],0);assert.equal(calls.length,slices.length-1);for(const[name,value]of original[kind].slice(1))assert.equal(calls.find(x=>x.name===name).relativeValue,value/sum);slices[0].setVisible(true);slices[0].setValue(7);calls.length=0;render(chart);o.mutated=structuredClone(calls);assert.equal(calls.find(x=>x.name===original[kind][0][0]).relativeValue,7/(7+sum));slices[0].setValue(original[kind][0][1]);calls.length=0;render(chart);o.restored=structuredClone(calls);for(const[name,value]of original[kind])assert.equal(calls.find(x=>x.name===name).relativeValue,value/(sum+original[kind][0][1]));chart.dispose();});
 check(kind+'-single-positive-empty-and-all-zero',o=>{const calls=[],{chart}=create(kind,[['Only',5]]);chart.setLabelFormatter((s,v)=>{calls.push(v);return String(v);});render(chart);o.single=structuredClone(calls);assert.deepEqual(calls,[1]);chart.dispose();o.noPositive=[];for(const data of [[],[['Zero',0]]]){const x=create(kind,data);let count=0;x.chart.setLabelFormatter((_s,v)=>{count++;assert.ok(Number.isFinite(v));return String(v);});const drawn=render(x.chart);o.noPositive.push({data,calls:count,texts:drawn.texts});assert.equal(count,0);x.chart.dispose();}});
 check(kind+'-default-label-text-preserved',o=>{const{chart}=create(kind),drawn=render(chart);o.texts=drawn.texts;const total=original[kind].reduce((n,x)=>n+x[1],0),expected=kind==='Pie'?original[kind].map(x=>x[0]):original[kind].map(([name,value])=>`${name}: ${Number(value.toPrecision(4)).toLocaleString('en-US')} (${(value/total*100).toFixed(1)}%)`);assert.deepEqual(drawn.texts,expected);chart.dispose();});
}
check('business-original-five-visible-percentage-strings-preserved',o=>{const{chart}=create('Pie');chart.setLabelFormatter(consumers.business(false,false));const drawn=render(chart);o.texts=drawn.texts;assert.deepEqual(drawn.texts,['Planning: 11.98%','Development: 35.93%','Testing: 17.96%','Review: 7.19%','Bug Fixing: 26.95%']);chart.dispose();});
check('business-donut-and-lookup-absolute-values-preserved',o=>{o.modes=[];for(const flags of [[true,false],[false,true]]){const{chart}=create('Pie');chart.setLabelFormatter(consumers.business(...flags));const drawn=render(chart);o.modes.push({flags,texts:drawn.texts});assert.deepEqual(drawn.texts,original.Pie.map(([name,value])=>`${name}: ${value}`));chart.dispose();}});
check('maps-actual-formatter-seven-percent-threshold-and-rounded-text-preserved',o=>{const data=[['Below',6.9],['Boundary',7],['Above',7.5],['Rest',78.6]],{chart}=create('Pie',data);chart.setLabelFormatter(consumers.maps);const drawn=render(chart);o.texts=drawn.texts;assert.deepEqual(drawn.texts,['','7%','8%','79%']);chart.dispose();});
