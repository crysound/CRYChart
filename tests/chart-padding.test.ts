import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Polar} from '../src/chart.js';

test('Chart padding exposes observed defaults and merges only supplied sides',()=>{
  const chart=new ChartXY();
  try{
    assert.deepEqual(chart.getPadding(),{left:7,right:7,top:7,bottom:7});
    assert.equal(chart.setPadding({left:16,right:16,top:32,bottom:8}),chart);
    chart.setPadding({right:64}).setPadding({top:0});
    assert.deepEqual(chart.getPadding(),{left:16,right:64,top:0,bottom:8});
    chart.setPadding({});assert.deepEqual(chart.getPadding(),{left:16,right:64,top:0,bottom:8});
    chart.setPadding(0).setPadding({left:5});
    assert.deepEqual(chart.getPadding(),{left:5,right:0,top:0,bottom:0});
  }finally{chart.dispose();}
});

test('numeric padding updates all sides and does not borrow caller state',()=>{
  const chart=new ChartXY();
  try{
    chart.setPadding(3);const input={bottom:11};chart.setPadding(input);input.bottom=99;
    const observed=chart.getPadding();observed.left=999;
    assert.deepEqual(chart.getPadding(),{left:3,right:3,top:3,bottom:11});
    chart.setPadding({left:undefined,right:0});assert.deepEqual(chart.getPadding(),{left:3,right:0,top:3,bottom:11});
  }finally{chart.dispose();}
});

test('invalid or throwing padding updates cannot partly commit earlier sides',()=>{
  const chart=new ChartXY().setPadding(4);
  try{
    for(const value of [NaN,Infinity,{left:12,right:NaN},{bottom:-Infinity},null,[]]){
      assert.throws(()=>chart.setPadding(value as any));
      assert.deepEqual(chart.getPadding(),{left:4,right:4,top:4,bottom:4});
    }
    assert.throws(()=>chart.setPadding({left:12,get right():number{throw new Error('caller getter');}}),/caller getter/);
    assert.deepEqual(chart.getPadding(),{left:4,right:4,top:4,bottom:4});
  }finally{chart.dispose();}
});

test('partial padding moves the actual plot while preserving data and axis intervals',()=>{
  const chart=new ChartXY().setPadding(0),x=chart.getDefaultAxisX(),y=chart.getDefaultAxisY();
  try{
    const series=chart.addLineSeries();series.add([{x:0,y:-1},{x:1,y:0},{x:2,y:1}]);
    x.setInterval({start:0,end:2});y.setInterval({start:-1,end:1});chart.resize(700,600);
    const baseline={...chart.plot};
    chart.setPadding({left:16,right:16,top:32,bottom:8}).resize(700,600);
    assert.deepEqual(chart.plot,{left:baseline.left+16,top:baseline.top+32,width:baseline.width-32,height:baseline.height-40});
    chart.setPadding({right:64}).resize(700,600);
    assert.deepEqual(chart.plot,{left:baseline.left+16,top:baseline.top+32,width:baseline.width-80,height:baseline.height-40});
    assert.deepEqual(x.getInterval(),{start:0,end:2});assert.deepEqual(y.getInterval(),{start:-1,end:1});
    assert.equal(series.getSampleCount(),3);assert.deepEqual([0,1,2].map(i=>series.getSample(i)),[{x:0,y:-1},{x:1,y:0},{x:2,y:1}]);
  }finally{chart.dispose();}
});

test('inherited Polar padding uses the same complete public state',()=>{
  const chart=new Polar();
  try{chart.setPadding(0).setPadding({top:12}).setPadding({left:8});assert.deepEqual(chart.getPadding(),{left:8,right:0,top:12,bottom:0});}
  finally{chart.dispose();}
});
