import test from 'node:test';
import assert from 'node:assert/strict';
import {computePolarLayout,polarPosition,polarInverseNormalized,polarViewportUniforms,type PolarLayoutOptions,type PolarLabelPlacement} from '../src/polar-layout';
import {FontSettings} from '../src/core/styles';

const angularLabels=Array.from({length:12},(_,i)=>({angleRadians:i*Math.PI/6,text:`${i*30}°`}));
const amplitudeTicks=Array.from({length:6},(_,i)=>({fraction:i/5,text:String(-30+i*5)}));
function context(){return{font:'before',calls:0,measureText(this:{font:string;calls:number},text:string){this.calls++;const size=Number(this.font.match(/([\d.]+)px/)?.[1]??12);return{width:text.length*size*.52,actualBoundingBoxAscent:size*.72,actualBoundingBoxDescent:size*.2};}} as unknown as CanvasRenderingContext2D;}
const options:PolarLayoutOptions={width:760,height:650,angularLabels,amplitudeTicks,amplitudeTitle:{text:'Amplitude (dB)'}};
function close(a:number,b:number,tolerance=1e-9){assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);}
function overlaps(a:PolarLabelPlacement,b:PolarLabelPlacement){const x=a.bounds,y=b.bounds;return x.left<y.left+y.width&&x.left+x.width>y.left&&x.top<y.top+y.height&&x.top+x.height>y.top;}

test('polar is centered in its own content and uses one square data viewport',()=>{
  const ctx=context(),layout=computePolarLayout(ctx,options);
  assert.deepEqual(layout.center,{x:380,y:325});assert.deepEqual(layout.padding,{left:7,right:7,top:7,bottom:7});
  close(layout.plot.left+layout.plot.width/2,380);close(layout.plot.top+layout.plot.height/2,325);close(layout.plot.width,2*layout.dataRadius);close(layout.plot.width,layout.plot.height);
  assert.equal(ctx.font,'before');assert.ok(layout.dataRadius>260&&layout.dataRadius<285,'measured default labels leave a data circle comparable to the public geometry observation, without a per-container constant');
});

test('height and explicit padding affect radius in pixels instead of an extra fixed ratio',()=>{
  const small=computePolarLayout(context(),{...options,width:1200,height:400}),large=computePolarLayout(context(),{...options,width:1200,height:600});
  close(large.dataRadius-small.dataRadius,100);close(large.center.y-small.center.y,100);
  const p7=computePolarLayout(context(),options),p50=computePolarLayout(context(),{...options,padding:50});close(p7.dataRadius-p50.dataRadius,43);
  const none=computePolarLayout(context(),{...options,padding:0});assert.deepEqual(none.padding,{left:0,right:0,top:0,bottom:0});close(none.dataRadius-p7.dataRadius,7);
});

test('legend and title reserve real container space while asymmetric padding shifts the center',()=>{
  const baseline=computePolarLayout(context(),options),legend=computePolarLayout(context(),{...options,legendMargin:{right:80}});
  close(legend.center.x,baseline.center.x-40);close(legend.center.y,baseline.center.y);
  const padded=computePolarLayout(context(),{...options,padding:{left:40,right:20,top:10,bottom:30}});close(padded.center.x,390);close(padded.center.y,315);
  const titled=computePolarLayout(context(),{...options,chartTitle:{text:'Directivity',font:new FontSettings({size:20})},chartTitleMargin:{top:5,bottom:9}});
  assert.ok(titled.center.y>baseline.center.y);assert.ok(titled.dataRadius<baseline.dataRadius);assert.ok(titled.content.top>baseline.content.top);
});

test('larger and longer angular labels shrink the data circle and stay in available bounds',()=>{
  const normal=computePolarLayout(context(),options),large=computePolarLayout(context(),{...options,angularFont:new FontSettings({size:24})}),long=computePolarLayout(context(),{...options,angularLabels:angularLabels.map(p=>({...p,text:p.text+' bearing'}))});
  assert.ok(large.dataRadius<normal.dataRadius);assert.ok(long.dataRadius<normal.dataRadius);
  for(const layout of[normal,large,long])for(const label of layout.labels.filter(p=>p.visible)){
    assert.ok(label.bounds.left>=layout.content.left-1e-9);assert.ok(label.bounds.top>=layout.content.top-1e-9);assert.ok(label.bounds.left+label.bounds.width<=layout.content.left+layout.content.width+1e-9);assert.ok(label.bounds.top+label.bounds.height<=layout.content.top+layout.content.height+1e-9);
  }
});

test('tangential angle labels and the outer amplitude label no longer collide',()=>{
  const layout=computePolarLayout(context(),options),angle0=layout.labels.find(l=>l.kind==='angle'&&l.angleRadians===0)!,angle90=layout.labels.find(l=>l.kind==='angle'&&l.angleRadians===Math.PI/2)!,amplitudeMax=layout.labels.find(l=>l.kind==='amplitude'&&l.fraction===1)!;
  close(Math.abs(angle0.rotation),Math.PI/2);close(angle90.rotation,0);assert.equal(angle0.visible,true);assert.equal(amplitudeMax.visible,true);assert.equal(overlaps(angle0,amplitudeMax),false);
  assert.ok(amplitudeMax.bounds.left+amplitudeMax.bounds.width<layout.center.x+layout.dataRadius);
  const minimum=layout.labels.find(l=>l.kind==='amplitude'&&l.fraction===0)!;assert.ok(minimum.bounds.top>layout.center.y+6,'minimum label clears the center marker');
  const visible=layout.labels.filter(l=>l.visible);for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++)assert.equal(overlaps(visible[i]!,visible[j]!),false,`${visible[i]!.text} overlaps ${visible[j]!.text}`);
});

test('physical amplitude-axis rotation is independent from angular label orientation',()=>{
  const layout=computePolarLayout(context(),{...options,radialAxisAngleRadians:Math.PI/2}),label=layout.labels.find(l=>l.kind==='amplitude'&&l.fraction===.4)!,title=layout.labels.find(l=>l.kind==='amplitude-title')!;
  assert.ok(label.x>layout.center.x);assert.ok(label.y<layout.center.y);close(label.rotation,-Math.PI/2);assert.ok(title.x>layout.center.x);close(title.rotation,-Math.PI/2);
  const radial=layout.labels.find(l=>l.kind==='angle'&&l.angleRadians===0)!;close(Math.abs(radial.rotation),Math.PI/2);
});

test('CPU projection, inverse and shader UV uniforms share the identical geometry',()=>{
  const layout=computePolarLayout(context(),{...options,padding:{left:15,right:27,top:8,bottom:31},legendMargin:{right:90}}),viewport={left:12,top:19,width:900,height:500},u=polarViewportUniforms(layout,viewport);
  for(const angle of[0,Math.PI/6,Math.PI/2,Math.PI,Math.PI*1.5,-.7])for(const fraction of[0,.2,.5,1]){
    const p=polarPosition(layout,angle,fraction),inverse=polarInverseNormalized(layout,p),gpuX=((p.x-viewport.left)/viewport.width-u.center.x)*u.scale.x,gpuY=((p.y-viewport.top)/viewport.height-u.center.y)*u.scale.y;
    close(gpuX,Math.cos(angle)*fraction);close(gpuY,-Math.sin(angle)*fraction);close(inverse.fraction,fraction);
    if(fraction){close(Math.cos(inverse.angleRadians),Math.cos(angle));close(Math.sin(inverse.angleRadians),Math.sin(angle));}
  }
  const own=polarViewportUniforms(layout);assert.deepEqual(own.center,{x:.5,y:.5});close(own.scale.x,2);close(own.scale.y,2);
});

test('dense labels have explicit overlap diagnostics and tiny containers stay finite',()=>{
  const many=Array.from({length:180},(_,i)=>({angleRadians:i*Math.PI/90,text:`${i*2}°`})),layout=computePolarLayout(context(),{...options,width:400,height:400,angularLabels:many});
  assert.ok(layout.labels.some(l=>!l.visible&&l.reason==='overlap'));assert.ok(layout.dataRadius>0);
  const visible=layout.labels.filter(l=>l.visible);for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++)assert.equal(overlaps(visible[i]!,visible[j]!),false);
  const tiny=computePolarLayout(context(),{...options,width:20,height:15,padding:50,angularFont:new FontSettings({size:40})});assert.equal(tiny.dataRadius,0);assert.ok(tiny.labels.every(l=>!l.visible));assert.ok(Object.values(tiny.plot).every(Number.isFinite));assert.deepEqual(polarViewportUniforms(tiny).scale,{x:0,y:0});
});
