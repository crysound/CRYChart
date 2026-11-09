import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';

const close=(actual:number,expected:number,tolerance=2e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const configure=(chart:Chart3D)=>{
  (chart as any).plot={left:13,top:29,width:640,height:370};
  chart.axisX.setInterval({start:-10,end:30});chart.axisY.setInterval({start:-100,end:20});chart.axisZ.setInterval({start:chart.axisZ.type==='logarithmic'?1:0,end:20000});
  return chart;
};
function independentPixel(point:{x:number;y:number;z:number},chart:Chart3D,axes:any=chart.coordsAxis){
  const keys=['x','y','z'] as const;
  const values=keys.map(key=>{
    const axis=axes[key],{start,end}=axis.getInterval(),log=axis.type==='logarithmic',value=log?Math.log10(point[key]):point[key],lo=log?Math.log10(start):start,hi=log?Math.log10(end):end;
    let fraction=(value-lo)/(hi-lo);if(axis.inverted)fraction=1-fraction;return Math.fround(fraction*2-1);
  });
  const box=chart.getBoundingBox(),maximum=Math.max(box.x,box.y,box.z),[x,y,z]=values.map((value,index)=>value*box[keys[index]!]/maximum),camera=chart.getCameraLocation(),a=camera.azimuth,e=camera.elevation;
  const rx=Math.fround(Math.cos(a))*x!+Math.fround(-Math.sin(a))*z!;
  const ry=Math.fround(-Math.sin(e)*Math.sin(a))*x!+Math.fround(Math.cos(e))*y!+Math.fround(-Math.sin(e)*Math.cos(a))*z!;
  const rect=(chart as any).plot,scale=Math.min(rect.width,rect.height)*.34*camera.zoom;
  return{x:rect.left+rect.width/2+rx*scale,y:rect.top+rect.height/2-ry*scale};
}

test('explicit legacy full XYZ conversion preserves Z and matches independent camera equations',()=>{
  const chart=configure(new Chart3D());
  try{
    assert.equal(chart.coordsAxis.z,chart.axisZ);
    for(const camera of [{azimuth:0,elevation:0,zoom:1},{azimuth:Math.PI/2,elevation:.3,zoom:1.4},{azimuth:-.65,elevation:.48,zoom:1}])for(const box of [{x:1,y:1,z:1},{x:3,y:1,z:2}]){
      chart.setCameraLocation(camera).setBoundingBox(box);
      for(let i=0;i<33;i++){
        const point={x:-10+i*1.25,y:-100+120*Math.sin(i*.2)**2,z:i*625},actual=chart.translateCoordinate(point,chart.coordsAxis,chart.coordsPixel),expected=independentPixel(point,chart);
        close(actual.x,expected.x);close(actual.y,expected.y);
      }
    }
    const a=chart.translateCoordinate({x:10,y:-40,z:0},chart.coordsPixel),b=chart.translateCoordinate({x:10,y:-40,z:20000},chart.coordsPixel);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>10);
  }finally{chart.dispose();}
});

test('XYZ client coordinates honor offsets, reversed/log axes and explicit source axes',()=>{
  const chart=configure(new Chart3D({experimental3DCameraModel:'legacy',defaultAxisZ:{type:'logarithmic'}})),fixture=chart as any,originalOverlay=fixture.overlay;
  try{
    fixture.overlay={getBoundingClientRect:()=>({left:123.25,top:67.5})};chart.axisZ.setInterval({start:1,end:1e6});chart.axisY.setInterval({start:20,end:-100});chart.axisX.setInverted(true);
    const point={x:2.5,y:-30,z:1000},pixel=independentPixel(point,chart),client=chart.translateCoordinate(point,chart.coordsClient);
    close(client.clientX,pixel.x+123.25);close(client.clientY,pixel.y+67.5);
    const alternative={x:chart.addAxisX().setInterval({start:100,end:900}),y:chart.addAxisY().setInterval({start:-1,end:1}),z:chart.addAxisZ().setInterval({start:-5,end:5})};
    const p={x:200,y:.25,z:-1},actual=chart.translateCoordinate(p,alternative,chart.coordsPixel),expected=independentPixel(p,chart,alternative);
    close(actual.x,expected.x);close(actual.y,expected.y);assert.deepEqual(chart.translateCoordinate(p,alternative,alternative),p);
    const converted=chart.translateCoordinate(p,alternative,chart.coordsAxis);
    for(const key of ['x','y','z'] as const)close(chart.coordsAxis[key].valueToFraction(converted[key]),alternative[key].valueToFraction(p[key]),2e-14);
  }finally{fixture.overlay=originalOverlay;chart.dispose();}
});

for(const model of ['world','legacy'] as const)test('existing XY/client-relative values remain exact in '+model+' model',()=>{
  const chart=configure(new Chart3D({experimental3DCameraModel:model}));
  try{
    // Independent affine values for plot(13,29,640,370), X[-10,30], Y[-100,20].
    assert.deepEqual(chart.translateCoordinate({x:10,y:-40},chart.coordsAxis,chart.coordsClient),{clientX:333,clientY:214});
    assert.deepEqual(chart.translateCoordinate({x:-20,y:50},chart.coordsAxis,chart.coordsClient),{clientX:-147,clientY:-63.5});
    const relative=chart.translateCoordinate({clientX:110,clientY:150},chart.coordsRelative);
    close(relative.x,110);close(relative.y,chart.height-150);
    // Full XYZ now has a forward screen projection; relative remains CSS
    // pixels measured from the whole chart's bottom-left, not percentages.
    const pixel=chart.translateCoordinate({x:1,y:2,z:3},chart.coordsAxis,chart.coordsPixel);
    assert.deepEqual(chart.translateCoordinate({x:1,y:2,z:3},chart.coordsAxis,chart.coordsRelative),{x:pixel.x,y:chart.height-pixel.y});
    assert.throws(()=>chart.translateCoordinate({x:1,y:2,z:'3'},chart.coordsClient),error=>error instanceof TypeError&&/numeric/.test(error.message));
  }finally{chart.dispose();}
});

test('Z extrema remain exact under finite filtering, ring eviction, replacement and clear',()=>{
  const chart=new Chart3D(),data=new DataSetXY({schema:{time:{storage:Float64Array},a:{storage:Float64Array},height:{storage:Float64Array}}}).setMaxSampleCount(4);
  const series=chart.addLineSeries().setDataSet(data).setDataMapping({x:'time',y:'a',z:'height'});
  try{
    assert.equal(series.getZMin(),undefined);assert.equal(series.getZMax(),undefined);
    data.appendSamples({time:[0,1,2,3],a:[0,0,0,0],height:[-9,NaN,Infinity,7]});assert.equal(series.getZMin(),-9);assert.equal(series.getZMax(),7);
    data.appendSamples({time:[4,5,6],a:[0,0,0],height:[-Infinity,3,4]});assert.equal(series.getZMin(),3);assert.equal(series.getZMax(),7);
    data.replaceSamples({time:[10,11,12],a:[1,2,3],height:[1e200,-1e200,.1234567890123456]});assert.equal(series.getZMin(),-1e200);assert.equal(series.getZMax(),1e200);assert.equal(data.getValue('height',2),.1234567890123456);
    data.clear();assert.equal(series.getZMin(),undefined);assert.equal(series.getZMax(),undefined);
    data.appendSamples({time:[1],a:[1],height:[42]});series.dispose();assert.equal(data.getSampleCount(),1,'Externally shared data must outlive its series');
  }finally{chart.dispose();data.dispose();}
});

test('Z extrema honor mapping changes without mutating data or revision',()=>{
  const chart=new Chart3D(),data=new DataSetXY({schema:{x:{storage:Float64Array},y:{storage:Float64Array},z:{storage:Float64Array},other:{storage:Float64Array}}}),series=chart.addLineSeries().setDataSet(data).setDataMapping({x:'x',y:'y',z:'z'});
  try{
    data.appendSamples({x:[0,1,2],y:[1,2,3],z:[5,8,6],other:[-.5,.25,2]});const revision=data.revision;
    assert.equal(series.getZMin(),5);assert.equal(series.getZMax(),8);series.setDataMapping({x:'x',y:'y',z:'other'});assert.equal(series.getZMin(),-.5);assert.equal(series.getZMax(),2);assert.equal(data.revision,revision);
    assert.deepEqual([...data.getColumn('z')],[5,8,6]);assert.deepEqual([...data.getColumn('other')],[-.5,.25,2]);
  }finally{chart.dispose();data.dispose();}
});
