import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cryChart, DataSetXY, PointLineAreaSeries, Cursor, AxisPosition,
  type Axis, type AxisInterval, type AxisIntervalConfiguration, type Band, type ChartXY, type ConstantLine,
  type CursorTargetChangedEvent, type CursorXY, type DataSetXYSchema,
  type HeatmapScrollingGridSeriesIntensityValues, type HeatmapScrollingGridSeriesOptions,
  type CRYChart, type CRYChartOptions, type PointLineAreaSeriesOptions,
  type RectangleSeries, type RectangleSeriesOptions, type SeriesXY, type SolveResultXY, type Theme,
  type LineSeries3D, type PointSeries3D, type Point3D, type PolarChart, type PolarPoint, type PolarPointLineSeries,
} from '../src/index.js';

// This finite import surface comes from the eight selected consumers and their
// local type wrapper. Compilation checks the names without importing OpenTest.
const names: [AxisIntervalConfiguration, PointLineAreaSeriesOptions, RectangleSeriesOptions, HeatmapScrollingGridSeriesOptions<'intensity'>] = [
  {start: 0, end: 100, stopAxisAfter: false}, {schema: {x: {storage: Float64Array}, y: {storage: Float64Array}}}, {},
  {dataType: 'intensity', scrollDimension: 'columns', resolution: 2},
];

test('CRYChart public types refer to real chart, cursor, series and schema implementations', () => {
  assert.equal(cryChart.name, 'cryChart');
  const options: CRYChartOptions = {}, engine: CRYChart = cryChart(options);
  const chart: ChartXY = engine.ChartXY({renderer: 'canvas2d'}), axis: Axis = chart.getDefaultAxisX();
  axis.setInterval(names[0]); const interval: AxisInterval = axis.getInterval(); assert.deepEqual(interval, {start: 0, end: 100});
  const schema: DataSetXYSchema = {x: {storage: Float64Array, auto: true}, y: {storage: Float64Array}};
  const data = new DataSetXY({schema}), series: SeriesXY = chart.addLineSeries({dataSet: data});
  series.appendSamples({y: [1, 3, 2]}); assert.equal(series.getSampleCount(), 3);
  const cursor: CursorXY = chart.addCursor().setPosition({pointMarker: {x: 1, y: 3}, pointMarkerScale: {x: axis, y: chart.getDefaultAxisY()}});
  assert.ok(cursor instanceof Cursor); assert.deepEqual(cursor.getPosition(), {x: 1, y: 3});
  const heat: HeatmapScrollingGridSeriesIntensityValues = chart.addHeatmapScrollingGridSeries(names[3]);
  heat.addIntensityValues([[2, 3]]); assert.equal(heat.getSampleCount(), 1);
  const rectangle: RectangleSeries = chart.addRectangleSeries(names[2]); rectangle.add({x: 1, y: 0, width: 2, height: 4}); assert.equal(rectangle.getSampleCount(), 1);
  const line: ConstantLine = axis.addConstantLine(), band: Band = axis.addBand(); line.setValue(2); band.setStart(1).setEnd(3);
  assert.equal(line.getValue(), 2); assert.deepEqual(band.getBounds(), {start: 1, end: 3});
  const cursorEvent: CursorTargetChangedEvent<SolveResultXY> = {hit: undefined, hits: [], mouseLocation: {clientX: 1, clientY: 2}};
  assert.equal(cursorEvent.hits?.length, 0); assert.equal(AxisPosition.Left, 2);
  const theme: Theme = chart.theme; assert.ok(theme.backgroundFillStyle);
  engine.dispose(); assert.equal(data.getSampleCount(), 3); data.dispose();
});

test('3D and Polar type names retain actual three-coordinate input and atomic polar replacement', () => {
  const engine: CRYChart = cryChart(), chart3d = engine.Chart3D({renderer: 'canvas2d'});
  const points: Point3D[] = [{x: 1, y: 2, z: 3}, {x: 4, y: 5, z: 6}];
  const line: LineSeries3D = chart3d.addLineSeries(), point: PointSeries3D = chart3d.addPointSeries();
  line.add(points); point.add(points[1]); assert.ok(line instanceof PointLineAreaSeries); assert.equal(line.getSample(1).z, 6); assert.equal(point.getSample(0).z, 6);
  const polar: PolarChart = engine.Polar({renderer: 'canvas2d'}), polarSeries: PolarPointLineSeries = polar.addPointLineSeries();
  const polarPoints: PolarPoint[] = [{angle: 90, amplitude: -40}, {angle: 180, amplitude: -20}];
  polarSeries.setData(polarPoints); assert.equal(polarSeries.getData().length, 2); polarSeries.setData([]); assert.deepEqual(polarSeries.getData(), []);
  engine.dispose(); assert.equal(line.getSampleCount(), 0); assert.equal(point.getSampleCount(), 0);
});
