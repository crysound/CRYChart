import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY, Polar} from '../src/chart.js';
import {ColorRGBA, LUT, PalettedFill, SolidFill, emptyFill} from '../src/core/styles.js';

const kinds = ['fixed', 'scroll-columns', 'scroll-rows', 'polar'] as const;
type Kind = typeof kinds[number];
function setup(kind: Kind) {
  if (kind === 'polar') {
    const chart = new Polar();
    const heat = chart.addHeatmapSeries({sectors: 3, annuli: 2, amplitudeStart: 0, amplitudeStep: 1, dataOrder: 'annuli'});
    heat.invalidateIntensityValues([[0, NaN, 2], [3, 4, 5]]);
    return {chart, heat};
  }
  const chart = new ChartXY();
  const heat = kind === 'fixed'
    ? chart.addHeatmapGridSeries({columns: 3, rows: 2, dataOrder: 'rows'})
    : chart.addHeatmapScrollingGridSeries({resolution: kind === 'scroll-columns' ? 2 : 3, scrollDimension: kind === 'scroll-columns' ? 'columns' : 'rows'});
  if (kind === 'fixed') heat.invalidateIntensityValues([[0, NaN, 2], [3, 4, 5]]);
  else heat.addIntensityValues(kind === 'scroll-columns' ? [[0, NaN], [2, 3], [4, 5]] : [[0, NaN, 2], [3, 4, 5]]);
  return {chart, heat};
}
function palette() {
  return new PalettedFill({lut: new LUT({units: 'dB', interpolate: false,
    steps: [{value: 0, color: ColorRGBA(0, 0, 0)}, {value: 75, color: ColorRGBA(255, 250, 175)}],
    fallbackColor: ColorRGBA(17, 19, 23, 77)})});
}
function state(heat: ReturnType<typeof setup>['heat']) {
  return {revision: heat.revision, paletteRevision: heat.paletteRevision, dataRevision: heat.dataRevision, values: [...heat.data]};
}
for (const kind of kinds) {
  test(`${kind}：读取已设置的真实调色板对象`, () => {
    const {chart, heat} = setup(kind);
    try {
      const fill = palette();
      assert.equal(heat.setFillStyle(fill), heat);
      const before = state(heat);
      assert.equal(heat.getFillStyle(), fill);
      assert.equal(heat.getFillStyle().getPalette(), fill.getPalette());
      assert.equal(heat.getFillStyle().getPalette().getUnits(), 'dB');
      const fallback = heat.getFillStyle().getPalette().getFallbackColor();
      assert.deepEqual([fallback.getR(), fallback.getG(), fallback.getB(), fallback.getA()], [17, 19, 23, 77]);
      assert.deepEqual(state(heat), before, 'getter 不修改数据或修订计数');
    } finally {chart.dispose();}
  });
  test(`${kind}：函数更新接收当前样式并返回新的真实样式`, () => {
    const {chart, heat} = setup(kind);
    try {
      const original = palette(); heat.setFillStyle(original);
      let calls = 0;
      const updated = original.setLUT(original.getPalette().setUnits('K').setFallbackColor(ColorRGBA(201, 17, 31, 255)));
      assert.equal(heat.setFillStyle((previous: PalettedFill) => {
        calls++; assert.equal(previous, original); return updated;
      }), heat);
      assert.equal(calls, 1);
      assert.equal(heat.getFillStyle(), updated);
      assert.equal(heat.getFillStyle().getPalette().getUnits(), 'K');
      assert.equal(original.getPalette().getUnits(), 'dB');
      assert.notEqual(heat.getFillStyle(), original);
    } finally {chart.dispose();}
  });
  test(`${kind}：SolidFill 与 emptyFill 原样读回且读取不修改数据`, () => {
    const {chart, heat} = setup(kind);
    try {
      const originalData = [...heat.data];
      for (const fill of [new SolidFill({color: ColorRGBA(23, 47, 89, 111)}), emptyFill]) {
        heat.setFillStyle(fill);
        const before = state(heat);
        assert.equal(heat.getFillStyle(), fill);
        assert.deepEqual(state(heat), before);
        assert.deepEqual([...heat.data], originalData);
      }
    } finally {chart.dispose();}
  });
}
