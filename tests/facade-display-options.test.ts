// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCRYChartAdapter } from '../src/adapters/opentest'
import { getWheelInteraction, resolveInteractionPolicy } from '../src/interaction-policy'

test('consumer initial fontSize applies to chart title, axis titles, and both major tick labels', () => {
  const api = createCRYChartAdapter(undefined, {fontSize: 19})
  try {
    const chart = api.getChart()
    assert.equal(chart.getTitleFont().getSize(), 19)
    for (const axis of [chart.getDefaultAxisX(), chart.getDefaultAxisY()]) {
      assert.equal(axis.getTitleFont().getSize(), 19)
      assert.equal(axis.tickStrategy.getMajorTickStyle().getLabelFont().getSize(), 19)
    }
  } finally { api.dispose() }
})

test('consumer fontSize updates both major tick labels and rejects an invalid update atomically', () => {
  const api = createCRYChartAdapter(undefined, {fontSize: 15})
  try {
    const chart = api.getChart()
    api.setData({schemaVersion: 1, seriesId: 'wave', kind: 'uniform', xStep: 1 / 48000, yValues: new Float64Array([1, -2, 3])})
    const snapshot = api.getSeriesSnapshot('wave')
    api.setOptions({fontSize: 23})
    const fonts = [chart.getTitleFont(), ...[chart.getDefaultAxisX(), chart.getDefaultAxisY()].flatMap(axis => [axis.getTitleFont(), axis.tickStrategy.getMajorTickStyle().getLabelFont()])]
    for (const font of fonts) assert.equal(font.getSize(), 23)
    assert.throws(() => api.setOptions({fontSize: -2, title: 'must not apply'}), RangeError)
    assert.equal(chart.getTitle(), '')
    assert.deepEqual(api.getSeriesSnapshot('wave'), snapshot)
    for (const font of fonts) assert.equal(font.getSize(), 23)
  } finally { api.dispose() }
})

for (const flag of [undefined, false, true]) test(`consumer showYCursor=${String(flag)} controls Y tick and horizontal guide together`, () => {
  const api = createCRYChartAdapter(undefined, {showYCursor: flag})
  try {
    const cursor = api.getChart().getCursor()
    assert.equal(cursor.getTickMarkerYVisible(), flag === true)
    assert.equal(cursor.getGridStrokeYStyle().getThickness() > 0, flag === true)
    assert.equal(cursor.getGridStrokeXStyle().getThickness() > 0, true)
    assert.equal(cursor.getTickMarkerXVisible(), true)
  } finally { api.dispose() }
})

test('both consumer axis lanes preserve toward-pointer zoom with only their own dimension', () => {
  const api = createCRYChartAdapter()
  try {
    for (const direction of ['x', 'y'] as const) {
      const result = getWheelInteraction(resolveInteractionPolicy(api.getChart().getUserInteractions(), {axis: direction}), {deltaY: -100})
      assert.equal(result.mode, 'toward-pointer')
      assert.equal(result.kind, 'zoom')
      assert.equal(result.x, direction === 'x')
      assert.equal(result.y, direction === 'y')
      assert.ok(result.factor < 1)
    }
  } finally { api.dispose() }
})
