import test from 'node:test';
import assert from 'node:assert/strict';
import {Axis, type AxisHost, type NumericTickStrategy} from '../src/axis';
import {AxisTickStrategies, FontSettings} from '../src/core/styles';

function fixture() {
  let invalidations=0;
  const host:AxisHost={plot:{width:640,height:360},invalidate(){invalidations++;},boundsFor(){return undefined;}};
  const axis=new Axis(host,'x').setInterval({start:0,end:100});
  return{axis,invalidations:()=>invalidations};
}

for(const kind of ['Numeric','Time','DateTime','Empty'] as const) {
  test(`公开getTickStrategy严格返回${kind}类型常量`,()=>{
    const {axis,invalidations}=fixture();let captured:NumericTickStrategy|undefined,calls=0;
    const returnedAxis=kind==='Empty'?axis.setTickStrategy(AxisTickStrategies.Empty):axis.setTickStrategy(AxisTickStrategies[kind],strategy=>{captured=strategy;calls++;return strategy;});
    assert.equal(returnedAxis,axis);
    assert.equal(axis.getTickStrategy(),AxisTickStrategies[kind]);
    assert.equal(typeof axis.getTickStrategy(),'string');
    if(kind!=='Empty'){
      assert.equal(calls,1);assert.ok(captured);assert.notEqual(axis.getTickStrategy(),captured);
      assert.equal(axis.tickStrategy,captured,'styler仍提供实际状态对象');
    }else assert.equal(axis.tickStrategy.visible,false,'Empty仍使用既有隐藏刻度行为');
    const paints=invalidations(),state=axis.tickStrategy;
    for(let i=0;i<5;i++)assert.equal(axis.getTickStrategy(),AxisTickStrategies[kind]);
    assert.equal(invalidations(),paints,'读取类型不得触发重新配置或重绘');
    assert.equal(axis.tickStrategy,state,'读取类型不得更换策略对象');
    assert.deepEqual(axis.getInterval(),{start:0,end:100});
  });
}

test('默认Numeric及原有小写扩展均返回规范类型而不改变原配置语义',()=>{
  const {axis}=fixture();assert.equal(axis.getTickStrategy(),AxisTickStrategies.Numeric);
  for(const [input,expected]of [['numeric','Numeric'],['time','Time'],['datetime','DateTime'],['empty','Empty']] as const){
    axis.setTickStrategy(input);assert.equal(axis.getTickStrategy(),AxisTickStrategies[expected]);
  }
});

test('类型由setter选择，白盒可见状态变化不伪造Empty或其他类型',()=>{
  const {axis}=fixture();axis.setTickStrategy(AxisTickStrategies.Numeric);
  axis.tickStrategy.visible=false;assert.equal(axis.getTickStrategy(),AxisTickStrategies.Numeric);
  axis.setTickStrategy(AxisTickStrategies.Empty);axis.tickStrategy.visible=true;
  assert.equal(axis.getTickStrategy(),AxisTickStrategies.Empty);
  axis.setTickStrategy(AxisTickStrategies.Time);assert.equal(axis.getTickStrategy(),AxisTickStrategies.Time);
});

test('同类型styler重配置仍保留字体对象和formatter，公开getter保持字符串',()=>{
  const {axis}=fixture();let original:NumericTickStrategy|undefined,reconfigured:NumericTickStrategy|undefined;
  const font=new FontSettings({size:19,family:'Courier New'}),formatter=(value:number)=>`V${value.toFixed(3)}`;
  axis.setTickStrategy(AxisTickStrategies.Time,strategy=>{original=strategy;return strategy.setMajorTickStyle((tick:any)=>tick.setLabelFont(font)).setCursorFormatter(formatter);});
  const previousStyle=original!.getMajorTickStyle();
  axis.setTickStrategy(AxisTickStrategies.Time,strategy=>{reconfigured=strategy;return strategy;});
  assert.equal(reconfigured,original);assert.equal(reconfigured!.getMajorTickStyle(),previousStyle);
  assert.equal(reconfigured!.getMajorTickStyle().getLabelFont(),font);assert.equal(reconfigured!.getCursorFormatter(),formatter);
  assert.equal(axis.getTickStrategy(),AxisTickStrategies.Time);assert.equal(axis.formatCursorValue(1.25),'V1.250');
});
