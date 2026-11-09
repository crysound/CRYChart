import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

const context={font:'',save(){},restore(){},measureText:(text:string)=>({width:text.length*7})} as unknown as CanvasRenderingContext2D;
const area={left:0,top:0,width:600,height:400};
function hoveredChart(leave:()=>void=()=>{}){
  const chart=new ChartXY({legend:{addEntriesAutomatically:true,entries:{events:{pointerleave:leave}}}}).setAnimationsEnabled(false);
  const first=chart.addLineSeries().setName('Hovered').appendJSON([{x:0,y:1},{x:1,y:2}]).setHighlight(.25);
  const other=chart.addLineSeries().setName('Other').appendJSON([{x:0,y:3},{x:1,y:4}]);
  const updates:Array<{value:boolean|number;disposed:boolean}>=[],original=first.setHighlight.bind(first);
  first.setHighlight=(value:boolean|number)=>{updates.push({value,disposed:first.isDisposed()});return original(value);};
  const bounds=chart.legend.getLayout(context,area).entries[0]!.bounds;
  chart.legend.handlePointer('pointermove',{x:bounds.left+4,y:bounds.top+bounds.height/2});
  assert.equal(first.getHighlight(),1);assert.deepEqual(updates,[{value:1,disposed:false}]);
  return{chart,first,other,updates};
}
function leaves(error:unknown):unknown[]{return error instanceof AggregateError?error.errors.flatMap(leaves):[error];}

test('chart disposal while a real series legend is hovered skips disposed highlight restoration and emits departure once',()=>{
  let departed=0;const{chart,first,other,updates}=hoveredChart(()=>departed++);
  assert.doesNotThrow(()=>chart.dispose());
  assert.equal(chart.isDisposed(),true);assert.equal(first.isDisposed(),true);assert.equal(other.isDisposed(),true);
  assert.equal(departed,1);assert.deepEqual(updates,[{value:1,disposed:false}]);
  assert.equal(chart.legend.isDisposed(),true);assert.equal(chart.legend.getEntries().length,0);
  assert.equal(first.events.listenerCount(),0);assert.equal(other.events.listenerCount(),0);
  assert.doesNotThrow(()=>chart.dispose());assert.equal(departed,1);
});

test('disposing only the hovered real series removes its entry and subscriptions without destroying its chart or sibling',()=>{
  let departed=0;const{chart,first,other,updates}=hoveredChart(()=>departed++);
  assert.doesNotThrow(()=>first.dispose());
  assert.equal(first.isDisposed(),true);assert.equal(chart.isDisposed(),false);assert.equal(other.isDisposed(),false);
  assert.equal(departed,1);assert.deepEqual(updates,[{value:1,disposed:false}]);
  assert.deepEqual(chart.legend.getEntries().map(entry=>entry.component),[other]);assert.equal(first.events.listenerCount(),0);
  assert.equal(other.getSampleCount(),2);assert.doesNotThrow(()=>chart.dispose());
});

test('disposing a legend with a living hovered series still restores its exact previous highlight',()=>{
  let departed=0;const{chart,first,updates}=hoveredChart(()=>departed++);
  chart.legend.dispose();
  assert.equal(first.isDisposed(),false);assert.equal(first.getHighlight(),.25);assert.equal(departed,1);
  assert.deepEqual(updates,[{value:1,disposed:false},{value:.25,disposed:false}]);chart.dispose();
});

test('a real hovered series consumer departure exception is preserved while chart cleanup still completes',()=>{
  const sentinel=new Error('consumer departure failure');let departed=0;
  const{chart,first,other,updates}=hoveredChart(()=>{departed++;throw sentinel;});
  let failure:unknown;try{chart.dispose();}catch(error){failure=error;}
  assert.ok(failure instanceof AggregateError);assert.deepEqual(leaves(failure),[sentinel]);
  assert.equal(departed,1);assert.equal(chart.isDisposed(),true);assert.equal(first.isDisposed(),true);assert.equal(other.isDisposed(),true);
  assert.equal(chart.legend.isDisposed(),true);assert.equal(chart.legend.getEntries().length,0);
  assert.equal(first.events.listenerCount(),0);assert.equal(other.events.listenerCount(),0);
  assert.deepEqual(updates,[{value:1,disposed:false}]);assert.doesNotThrow(()=>chart.dispose());assert.equal(departed,1);
});
