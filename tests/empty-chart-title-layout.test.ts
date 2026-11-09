import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {AxisTickStrategies,emptyFill} from '../src/core/styles';

function chart(){
 const c=new ChartXY({legend:{visible:false}}).setTitle('').setTitleMargin({bottom:25}).setPadding({left:7,right:7,top:4,bottom:7});
 c.resize(680,420);
 c.getDefaultAxisX().setInterval({start:0,end:10,stopAxisAfter:true});
 c.getDefaultAxisY().setInterval({start:0,end:1,stopAxisAfter:true});
 return c;
}
function top(c:ChartXY){c.renderNow();return c.translateCoordinate({x:0,y:1},c.coordsAxis,c.coordsPixel).y;}

test('empty chart title and empty opposite coordinate-only X preserve source axes without reserving title or top-axis lanes',()=>{
 const c=chart();
 try{
  const before=top(c);assert.equal(before,4,'Empty chart title ignores its stored25px outer margin');
  const xTop=c.addAxisX({opposite:true}).setTickStrategy(AxisTickStrategies.Empty).setTitle('').setMarginAfterTicks(0).setInterval({start:0,end:10,stopAxisAfter:true});
  const s=c.addLineSeries({axisX:xTop}).add([{x:0,y:0},{x:10,y:1}]);
  assert.equal(top(c),before,'Coordinate-only top axis does not consume a44px decoration lane');
  assert.ok(c.getAxes().includes(xTop));assert.equal(s.getAxisX(),xTop);assert.deepEqual(xTop.getInterval(),{start:0,end:10});
  const endpoint=c.translateCoordinate({x:0,y:1},{x:xTop,y:c.getDefaultAxisY()},c.coordsPixel);assert.equal(endpoint.y,before);
 }finally{c.dispose();}
});

test('visible chart titles and numeric/top-axis titles keep their independent occupied lanes and restore after clearing',()=>{
 const c=chart();
 try{
  assert.equal(top(c),4);c.setTitle('Actual title');assert.equal(top(c),81,'52px title slot+25px margin+4px source padding');
  c.setTitleFillStyle(emptyFill);assert.equal(top(c),4,'Invisible title ink reserves no slot');
  c.setTitle('');const xTop=c.addAxisX({opposite:true}).setTickStrategy(AxisTickStrategies.Empty).setTitle('Top axis');
  assert.ok(top(c)>=48,'Empty ticks do not hide an actual axis title');
  xTop.setTitle('');assert.equal(top(c),4);xTop.setTickStrategy(AxisTickStrategies.Numeric);assert.ok(top(c)>=48);
  xTop.setTickStrategy(AxisTickStrategies.Empty);assert.equal(top(c),4);
 }finally{c.dispose();}
});

test('Empty opposite axes with live CustomTicks keep the needed lane until the actual ticks hide or dispose',()=>{
 const c=chart();
 try{
  const xTop=c.addAxisX({opposite:true}).setTickStrategy(AxisTickStrategies.Empty).setTitle('');
  const tick=xTop.addCustomTick().setValue(5).setTextFormatter(()=> 'Month');
  assert.ok(top(c)>=48,'Explicit CustomTicks remain a painted axis decoration even with Empty automatic ticks');
  tick.setVisible(false);assert.equal(top(c),4);tick.setVisible(true);assert.ok(top(c)>=48);
  tick.dispose();assert.equal(top(c),4);
 }finally{c.dispose();}
});
