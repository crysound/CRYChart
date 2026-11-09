import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY, Polar} from '../src/chart.js';
import {cryChart} from '../src/index.js';
import {Themes, SolidFill, PalettedFill, LUT, ColorRGBA, type Theme} from '../src/core/styles.js';
import {makeCustomTheme} from '../src/themes.js';

// 原样保存公开 Palette(0..127) 的颜色数据；不从被测取模实现生成预期。
const expected = {"darkGold":[[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255],[169,148,198,255],[148,226,198,255],[148,255,176,255],[180,255,165,255],[255,255,91,255],[255,205,91,255],[255,155,91,255],[255,196,188,255],[255,148,184,255],[219,148,198,255],[235,196,224,255]],"light":[[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255],[234,103,232,255],[62,183,179,255],[140,93,3,255],[155,158,186,255],[28,181,140,255],[255,132,0,255],[240,39,39,255],[86,121,251,255],[2,181,213,255],[13,212,158,255],[22,167,3,255]]} as const;
const fields = ['heatmapGridSeriesFillStyle', 'heatmapScrollingGridSeriesFillStyle', 'polarHeatmapSeriesFillStyle'] as const;
const kinds = ['fixed', 'scrolling', 'polar'] as const;
type Kind = typeof kinds[number];
const fieldFor = {fixed: fields[0], scrolling: fields[1], polar: fields[2]} as const;
const chartFor = (kind: Kind, theme: Theme) => kind === 'polar' ? new Polar({theme}) : new ChartXY({theme});
function add(chart: ChartXY | Polar, kind: Kind) {
  return kind === 'fixed' ? chart.addHeatmapGridSeries({columns: 1, rows: 1})
    : kind === 'scrolling' ? chart.addHeatmapScrollingGridSeries({resolution: 1, scrollDimension: 'columns'})
    : (chart as Polar).addHeatmapSeries({sectors: 1, annuli: 2, amplitudeStart: 0, amplitudeStep: 1});
}
function rgba(fill: any) {
  assert.ok(fill instanceof SolidFill, '真实存储必须是主题提供的 SolidFill');
  const c = fill.getColor(); return [c.getR(), c.getG(), c.getB(), c.getA()];
}
for (const name of ['darkGold', 'light'] as const) {
  test(`${name}：三个热图公开 Palette 的 0–127 颜色逐项匹配原始观测`, () => {
    for (const field of fields) {
      const palette = Themes[name][field]; assert.ok(typeof palette === 'function');
      for (let index = 0; index < 128; index++) assert.deepEqual(rgba(palette(index)), expected[name][index]);
    }
  });
  for (const kind of kinds) {
    test(`${name}/${kind}：128 条默认样式实际初始化，销毁后按活跃数量选择`, () => {
      const chart = chartFor(kind, Themes[name]);
      try {
        const series = [];
        for (let index = 0; index < 128; index++) {
          const heat = add(chart, kind); series.push(heat);
          assert.deepEqual(rgba(heat.getFillStyle()), expected[name][index]);
          assert.equal(heat.palette, heat.getFillStyle(), '渲染与getter读取同一个实际对象');
        }
        series[0]!.dispose();
        assert.deepEqual(rgba(add(chart, kind).getFillStyle()), expected[name][127]);
      } finally {chart.dispose();}
    });
    test(`${name}/${kind}：先创建 Line 后热图取得索引 1`, () => {
      const chart = chartFor(kind, Themes[name]);
      try {chart.addLineSeries(); assert.deepEqual(rgba(add(chart, kind).getFillStyle()), expected[name][1]);}
      finally {chart.dispose();}
    });
  }
}
test('省略 theme 的 ChartXY 使用 darkGold 热图样式', () => {
  const chart = new ChartXY();
  try {assert.deepEqual(rgba(chart.addHeatmapGridSeries({columns: 1, rows: 1}).getFillStyle()), expected.darkGold[0]);}
  finally {chart.dispose();}
});
test('同一引擎的两个新图表各自从索引 0 开始', () => {
  const engine = cryChart();
  try {
    const a = engine.ChartXY({theme: Themes.darkGold}), b = engine.ChartXY({theme: Themes.darkGold});
    assert.deepEqual(rgba(a.addHeatmapGridSeries({columns: 1, rows: 1}).getFillStyle()), expected.darkGold[0]);
    assert.deepEqual(rgba(b.addHeatmapGridSeries({columns: 1, rows: 1}).getFillStyle()), expected.darkGold[0]);
  } finally {engine.dispose();}
});
test('自有 dark 别名和 custom dark 继承 darkGold 的热图色序', () => {
  for (const theme of [Themes.dark, makeCustomTheme({isDark: true})]) for (const kind of kinds) {
    const chart = chartFor(kind, theme);
    try {
      for (let index = 0; index < 3; index++) assert.deepEqual(rgba(add(chart, kind).getFillStyle()), expected.darkGold[index]);
    } finally {chart.dispose();}
  }
});
test('custom dark 的三个显式热图字段优先于继承默认，dataColors 不暗中改写它们', () => {
  const fill = new SolidFill({color: ColorRGBA(71, 83, 97, 255)});
  const theme = makeCustomTheme({isDark: true, dataColors: [ColorRGBA(1, 2, 3)],
    heatmapGridSeriesFillStyle: fill, heatmapScrollingGridSeriesFillStyle: () => fill, polarHeatmapSeriesFillStyle: fill});
  for (const kind of kinds) {
    const chart = chartFor(kind, theme);
    try {assert.equal(add(chart, kind).getFillStyle(), fill);}
    finally {chart.dispose();}
  }
});
for (const kind of kinds) {
  test(`${kind}：完整自定义 Theme 的明确 FillStyle 原样初始化`, () => {
    const fill = new SolidFill({color: ColorRGBA(13, 47, 89, 255)});
    const theme = {...Themes.darkGold, [fieldFor[kind]]: fill};
    const chart = chartFor(kind, theme);
    try {const heat = add(chart, kind); assert.equal(heat.getFillStyle(), fill); assert.equal(heat.palette, fill);}
    finally {chart.dispose();}
  });
  test(`${kind}：自定义 Palette 实收 0、1、2，销毁后收到 2`, () => {
    const calls: number[] = [], fills: SolidFill[] = [];
    const theme = {...Themes.darkGold, [fieldFor[kind]]: (index: number) => {
      calls.push(index); const fill = new SolidFill({color: ColorRGBA(30 + index, 40, 50, 255)}); fills.push(fill); return fill;
    }};
    const chart = chartFor(kind, theme);
    try {
      const first = add(chart, kind); add(chart, kind); add(chart, kind); first.dispose();
      const last = add(chart, kind);
      assert.deepEqual(calls, [0, 1, 2, 2]); assert.equal(last.getFillStyle(), fills[3]);
    } finally {chart.dispose();}
  });
}
test('显式 PalettedFill 覆盖真实默认样式，数据和回调输入保持', () => {
  const chart = new ChartXY({theme: Themes.light});
  try {
    const heat = chart.addHeatmapGridSeries({columns: 2, rows: 1, dataOrder: 'rows'});
    heat.invalidateIntensityValues([[7, NaN]]); const before = [...heat.data], initial = heat.getFillStyle();
    const fill = new PalettedFill({lut: new LUT({units: 'explicit', steps: [{value: 0, color: ColorRGBA(12, 34, 56)}]})});
    heat.setFillStyle((previous: any) => {assert.equal(previous, initial); return fill;});
    assert.equal(heat.getFillStyle(), fill); assert.equal(heat.palette, fill); assert.deepEqual([...heat.data], before);
  } finally {chart.dispose();}
});
test('通用 dataColors 六色保持原样，不由热图默认色表替换', () => {
  const original = [[32,184,240,255],[245,185,66,255],[232,121,162,255],[67,198,162,255],[154,133,237,255],[241,139,83,255]];
  for (const theme of Object.values(Themes)) assert.deepEqual(theme.dataColors.map(c => [c.getR(), c.getG(), c.getB(), c.getA()]), original);
});
test('未取证的附加主题不注入猜测的热图默认值', () => {
  for (const theme of [Themes.lightNature, Themes.turquoiseHexagon, Themes.cyberSpace]) {
    for (const field of fields) assert.equal(theme[field], undefined);
    const chart = new ChartXY({theme});
    try {assert.equal(chart.addHeatmapGridSeries({columns: 1, rows: 1}).getFillStyle(), undefined);}
    finally {chart.dispose();}
  }
});
