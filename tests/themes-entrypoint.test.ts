import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const {build} = require('esbuild') as typeof import('esbuild');
let directory: string;
let esm: typeof import('../src/index');
let cjs: typeof import('../src/index');
let themes: typeof import('../src/themes');

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'crychart-theme-entrypoints-'));
  // Use independent production-style bundles. A source-only import shares Color
  // identity and cannot reproduce the package subpath bug.
  await Promise.all([
    build({entryPoints:['src/index.ts'], bundle:true, format:'esm', target:'es2022', outfile:join(directory, 'crychart.mjs')}),
    build({entryPoints:['src/index.ts'], bundle:true, format:'cjs', target:'es2022', outfile:join(directory, 'crychart.cjs')}),
    build({entryPoints:['src/themes.ts'], bundle:true, format:'esm', target:'es2022', outfile:join(directory, 'themes.mjs')}),
  ]);
  esm = await import(pathToFileURL(join(directory, 'crychart.mjs')).href);
  cjs = require(join(directory, 'crychart.cjs'));
  themes = await import(pathToFileURL(join(directory, 'themes.mjs')).href);
});

after(async () => {
  if (!directory) return;
  const target = resolve(directory);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep));
  assert.ok(basename(target).startsWith('crychart-theme-entrypoints-'));
  await rm(target, {recursive:true, force:true});
});

for (const format of ['esm', 'cjs'] as const) {
  test(`independent ${format} Color keeps its RGBA in the themes subpath`, () => {
    const main = format === 'esm' ? esm : cjs;
    const color = main.ColorHEX('#12345680');
    const theme = themes.makeCustomTheme({backgroundColor:color});
    assert.notEqual(main.Color, themes.Themes.light.backgroundColor.constructor, 'the fixture must cross distinct Color constructors');
    assert.equal(theme.backgroundFillStyle.kind, 'solid');
    assert.equal(theme.backgroundFillStyle.getColor?.(), color, 'the original immutable color is preserved');
    assert.equal(theme.panelBackgroundFillStyle, theme.backgroundFillStyle);
    assert.equal(theme.backgroundColor, color);
    assert.equal(theme.backgroundColor.toCSS(), 'rgba(18, 52, 86, 0.5019607843137255)');
  });

  test(`independent ${format} fill objects pass through without flattening`, () => {
    const main = format === 'esm' ? esm : cjs;
    const color = main.ColorHEX('#456789');
    const gradient = new main.LinearGradientFill({angle:45, stops:[{offset:0,color},{offset:1,color:main.ColorHEX('#00000000')}]});
    const palette = new main.PalettedFill({lut:new main.LUT({steps:[{value:0,color}]})});
    const fills: import('../src/core/styles').FillStyle[] = [new main.SolidFill({color}), main.emptyFill, main.transparentFill, gradient, palette];
    for (const fill of fills) {
      const theme = themes.makeCustomTheme({backgroundColor:fill});
      assert.equal(theme.backgroundFillStyle, fill);
      assert.equal(theme.panelBackgroundFillStyle, fill);
      assert.equal(theme.backgroundFillStyle.kind, fill.kind);
      if (fill.getColor) assert.equal(theme.backgroundColor.toUint32(), fill.getColor().toUint32());
      else assert.equal(theme.backgroundColor.getA(), 0, 'a non-solid fill is retained rather than guessed from one color');
    }
  });
}

test('omitted background retains the selected theme default', () => {
  for (const isDark of [true, false]) {
    const theme = themes.makeCustomTheme({isDark});
    const expected = isDark ? themes.Themes.dark : themes.Themes.light;
    assert.equal(theme.backgroundFillStyle, expected.backgroundFillStyle);
    assert.equal(theme.backgroundColor.toUint32(), expected.backgroundColor.toUint32());
  }
});

for (const format of ['esm', 'cjs'] as const) {
  test(`${format} guards accept themes-subpath solid styles and retain negative cases`, () => {
    const main = format === 'esm' ? esm : cjs;
    const other = format === 'esm' ? cjs : esm;
    const theme = themes.makeCustomTheme({textColor:main.ColorHEX('#123456')});
    assert.equal(main.isSolidFill(theme.axisTitleFillStyle), true);
    assert.equal(main.isSolidLine(theme.axisStrokeStyle), true);
    assert.equal(main.isSolidFill(themes.Themes.light.backgroundFillStyle), true);
    assert.equal(main.isSolidLine(themes.Themes.light.axisStrokeStyle), true);
    assert.equal(main.isSolidFill(new other.SolidFill()), true);
    assert.equal(main.isSolidLine(new other.SolidLine()), true);
    const gradient = new other.LinearGradientFill();
    for (const fill of [other.emptyFill, new other.PalettedFill(), gradient, other.ColorHEX('#123456'), new other.SolidLine(), {kind:'solid'}, null, 'solid']) {
      assert.equal(main.isSolidFill(fill), false);
    }
    for (const line of [new other.DashedLine(), new other.SolidFill(), gradient, {kind:'solid',getThickness:()=>1}, null, 'solid']) {
      assert.equal(main.isSolidLine(line), false);
    }
  });

  test(`${format} gradient accepts themes-subpath colors and still validates color stops`, () => {
    const main = format === 'esm' ? esm : cjs;
    const first = themes.Themes.light.dataColors[0]!, second = themes.Themes.light.dataColors[1]!;
    assert.notEqual(first.constructor, main.Color, 'the test must use a foreign Color constructor');
    const gradient = new main.LinearGradientFill({stops:[{offset:0,color:first},{offset:1,color:second}]});
    assert.equal(gradient.getColorStops()[0]!.color, first);
    assert.equal(gradient.getColorStops()[1]!.color, second);
    assert.equal(gradient.sample(0).toCSS(), first.toCSS());
    assert.equal(gradient.sample(1).toCSS(), second.toCSS());
    const midpoint = gradient.sample(.5);
    for (const key of ['r','g','b','a'] as const) assert.equal(midpoint[key], first[key] + (second[key] - first[key]) * .5);
    const updated = gradient.setColorStops([{offset:0,color:second},{offset:1,color:first}]);
    assert.equal(updated.sample(0).toCSS(), second.toCSS());
    const invalidChannel = (name: string, value: number) => Object.defineProperty(Object.create(first), name, {value});
    for (const color of [null, '#123456', {r:0,g:0,b:0,a:1}, invalidChannel('r',NaN), invalidChannel('a',2)]) {
      assert.throws(()=>new main.LinearGradientFill({stops:[{offset:0,color:color as any}]}), /Gradient stops require Color values/);
    }
    assert.throws(()=>new main.LinearGradientFill({stops:[{offset:-.1,color:first}]}), /Gradient offsets/);
  });
}
