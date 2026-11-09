/** Public types for CRYChart contexts, data and interaction surfaces. These
 * aliases describe the implemented objects without adding runtime behavior. */
import type {Axis} from './axis.js';
import type {ChartOptions, Polar} from './chart.js';
import type {Interval, Point} from './contracts.js';
import type {DataSetSchema} from './core/data.js';
import type {GeometryOptions, GeometrySeries} from './geometry.js';
import type {cryChart} from './index.js';
import type {HeatmapSeries, PointLineAreaSeries, SeriesOptions} from './series.js';
import type {Cursor, UIElement} from './ui.js';

export type AxisInterval = Interval;
export interface AxisIntervalConfiguration {start?: number; end?: number; stopAxisAfter?: boolean;}
export type CursorXY = Cursor;
/** TextBox builders return the implemented UIElement text, layout and lifecycle surface. */
export type UITextBox = UIElement;
export type DataSetXYSchema = DataSetSchema;
export type CRYChart = ReturnType<typeof cryChart>;
export type CRYChartOptions = NonNullable<Parameters<typeof cryChart>[0]>;
export type ChartXYOptions = ChartOptions;
export type Chart3DOptions = ChartOptions;
export type PointLineAreaSeriesOptions = SeriesOptions;
export type RectangleSeriesOptions = GeometryOptions;
export type SeriesXY = PointLineAreaSeries | GeometrySeries | HeatmapSeries;
export type LineSeries3D = PointLineAreaSeries;
export type PointSeries3D = PointLineAreaSeries;
export type Point3D = Point & {z: number};
export type PolarChart = Polar;
export type HeatmapScrollingGridSeriesIntensityValues = HeatmapSeries;
/** Only intensity heatmaps are implemented; color-packed heatmaps are not
 * advertised by this compatibility type. */
export interface HeatmapScrollingGridSeriesOptions<DataType extends 'intensity' = 'intensity'> {
  dataType?: DataType;
  axisX?: Axis;
  axisY?: Axis;
  resolution?: number;
  scrollDimension?: 'columns' | 'rows';
  columns?: number;
  rows?: number;
  start?: {x: number; y: number};
  step?: {x: number; y: number};
  dataOrder?: 'columns' | 'rows';
  legend?: Record<string, unknown> | null;
}
