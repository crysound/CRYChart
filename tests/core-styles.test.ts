import test from 'node:test';
import assert from 'node:assert/strict';
import {ColorHEX, ColorRGBA, SolidFill, SolidLine, DashedLine, FontSettings, LUT, PalettedFill, regularColorSteps, Themes, disableThemeEffects, isSolidFill, isSolidLine, emptyFill, transparentFill} from '../src/core/styles.js';
import {Chart3D} from '../src/chart.js';
import {MeshModel3D,BoxSeries3D} from '../src/mesh3d.js';
import {NativeLegend} from '../src/native-legend.js';
import {fillCSS} from '../src/ui.js';

test('RGBA byte alpha, hex parsing and immutable color channel setters', () => {
  const color = ColorRGBA(255, 128, 0, 128);
  assert.equal(color.a, 128 / 255);
  assert.equal(color.getA(), 128);
  assert.equal(color.getR(), 255);
  assert.equal(color.setA(0).a, 0);
  assert.equal(color.a, 128 / 255);
  assert.equal(ColorHEX('#f008').getA(), 136);
  assert.equal(ColorHEX('#ff0080').toCSS(), 'rgba(255, 0, 128, 1)');
  assert.throws(() => ColorHEX('invalid'), /hexadecimal/);
});

test('style mutation preserves originals and concrete dashed type', () => {
  const fill = new SolidFill({color: ColorHEX('#336699')});
  const line = new SolidLine({fillStyle: fill, thickness: 2});
  const changed = line.setFillStyle(old => (old as SolidFill).setA(128)).setThickness(n => n * 2);
  assert.equal(line.getThickness(), 2);
  assert.equal(fill.getColor().getA(), 255);
  assert.equal(changed.getThickness(), 4);
  assert.equal((changed.getFillStyle() as SolidFill).getColor().getA(), 128);
  const dashed = new DashedLine({pattern: [4, 1], thickness: 2});
  assert.ok(dashed.setThickness(3) instanceof DashedLine);
  assert.deepEqual(dashed.setThickness(3).getPattern(), [4, 1]);
  assert.ok(isSolidFill(fill));
  assert.ok(isSolidLine(line));
  assert.equal(isSolidLine(dashed), false);
  assert.equal(isSolidFill(emptyFill), false);
  const font = new FontSettings({size: 12});
  assert.equal(font.setSize(n => n * 2).size, 24);
  assert.equal(font.size, 12);
});

test('LUT interpolates channels, steps at boundaries, handles gaps and stays immutable', () => {
  const lut = new LUT({steps: [{value: 10, color: ColorHEX('#ffffff')}, {value: 0, color: ColorHEX('#000000')}], interpolate: true});
  assert.equal(lut.getColor(5).r, .5);
  assert.equal(lut.getColor(NaN).a, 0);
  assert.equal(lut.setInterpolation(false).getColor(5).r, 0);
  assert.equal(lut.getInterpolation(), true);
  assert.equal(lut.setInterpolation(false).getColor(10).r, 1);
  const fill = new PalettedFill({lut, lookUpProperty: 'y'});
  assert.equal(fill.getPalette(), lut);
  assert.equal(fill.setLookUpProperty('value').getLookUpProperty(), 'value');
  assert.equal(fill.getLookUpProperty(), 'y');
  assert.deepEqual(regularColorSteps(-10, 10, [ColorHEX('000'), ColorHEX('fff')]).map(x => x.value), [-10, 10]);
  const steps = lut.getSteps(); steps[0].value = -999;
  assert.equal(lut.getSteps()[0].value, 0);
});

test('theme transforms retain the original and expose rendering flags', () => {
  const theme = disableThemeEffects(Themes.light);
  assert.equal(theme.effectsDisabled, true);
  assert.equal(Themes.light.effectsDisabled, undefined);
  assert.equal(theme.backgroundFillStyle, Themes.light.backgroundFillStyle);
});

test('EmptyFill is a style sentinel, distinct from a transparent solid color',()=>{
  assert.equal(emptyFill.kind,'empty');assert.equal(typeof (emptyFill as any).getColor,'undefined');
  assert.equal(transparentFill.kind,'solid');assert.equal(transparentFill.getColor().getA(),0);
  assert.equal(isSolidFill(emptyFill),false);assert.equal(isSolidFill(transparentFill),true);
  assert.equal(fillCSS(emptyFill,'#ffffff'),'rgba(0, 0, 0, 0)');
  assert.equal(fillCSS(undefined,'#ffffff'),'#ffffff');
});

test('EmptyFill keeps 3D mesh, wire and box packets invisible without changing source positions',()=>{
  const chart=new Chart3D(),mesh=new MeshModel3D(chart),boxes=new BoxSeries3D(chart);
  try{
    const positions=[0,0,0,1,0,0,0,1,0];mesh.setGeometry({positions,indices:[0,1,2]}).setFillStyle(emptyFill)
      .setWireframeStyle(new SolidLine({thickness:2,fillStyle:emptyFill}));
    const first=mesh.getDrawPackets(value=>value,'identity');assert.equal(first.length,1);
    assert.deepEqual([...first[0].positions],positions);assert.ok([...first[0].colors!].filter((_,i)=>i%4===3).every(v=>v===0));
    mesh.setFillStyle(new SolidFill({color:ColorRGBA(20,30,40)}));
    const visible=mesh.getDrawPackets(value=>value,'identity');assert.equal(visible.length,1);assert.deepEqual(visible[0].positions,first[0].positions);
    assert.ok([...visible[0].colors!].filter((_,i)=>i%4===3).every(v=>v===1));
    boxes.add([{xCenter:0,yCenter:1,zCenter:2,xSize:1,ySize:2,zSize:3}]).setFillStyle(emptyFill);
    const box=boxes.getDrawPackets(value=>value,'identity')[0];assert.equal(box.colors![3],0);assert.equal(box.boxTopColors![3],0);
    assert.deepEqual([...box.positions],[0,1,2]);
  }finally{mesh.dispose();boxes.dispose();chart.dispose();}
});

test('Native legend empty background and title keep transparent paint instead of fallback colors',()=>{
  const paints:string[]=[],stack:any[]=[],ctx:any={font:'',fillStyle:'',globalAlpha:1,
    save(){stack.push({font:this.font,fillStyle:this.fillStyle});},restore(){Object.assign(this,stack.pop());},
    beginPath(){},rect(){},clip(){},measureText(text:string){return{width:text.length*7};},
    fillRect(){paints.push(this.fillStyle);},fillText(){paints.push(this.fillStyle);}};
  const legend=new NativeLegend({invalidate(){}},{title:'Hidden ink',titleFillStyle:emptyFill,backgroundVisible:true,backgroundFillStyle:emptyFill});
  try{legend.draw(ctx,{left:0,top:0,width:700,height:600});assert.deepEqual(paints,['rgba(0, 0, 0, 0)','rgba(0, 0, 0, 0)']);assert.equal(stack.length,0);}
  finally{legend.dispose();}
});
