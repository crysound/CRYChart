export * from "./core/data.js";
export * from "./core/styles.js";
export {Icon, type IconProperties, type ImageFillSource} from './custom-icon.js';
export * from "./core/events.js";
export * from "./contracts.js";
export * from "./axis.js";
export * from "./formatting-functions.js";
export * from "./time-formatting.js";
export * from "./series.js";
export * from "./geometry.js";
export * from "./hierarchy.js";
export * from "./ui.js";
export * from './native-legend.js';
export * from './cursor-api.js';
export * from './chart-events.js';
export * from './compatibility-types.js';
export * from "./chart.js";
export * from "./specialty.js";
export * from "./themes.js";
export * from "./gradients.js";
export * from "./point-fill.js";
export * from "./map.js";
export * from './polar-heatmap.js';
export * from './polar-series.js';
export * from './mesh3d.js';
export * from "./adapters/opentest.js";
import { ChartXY, Chart3D, Polar, type ChartOptions } from "./chart.js";
import {
  Pie,
  Gauge,
  Spider,
  BarChart,
  TreeMapChart,
  ParallelCoordinateChart,
  DataGrid,
} from "./specialty.js";
import { SunBurstChart, Funnel, Pyramid } from "./hierarchy.js";
import { MapChart, type MapOptions } from "./map.js";
import { EventHub, type EventListener } from './core/events.js';

/** Create a CRYChart context that owns its chart instances. */
export function cryChart(_options: Record<string, unknown> = {}) {
  const owned = new Set<any>();
  let disposed = false;
  const create = <T>(ctor: new (options: any) => T, options: any = {}): T => {
    if (disposed) throw new Error("Chart context has been disposed");
    const chart = new ctor(options);
    owned.add(chart);
    (chart as any).onDispose(() => owned.delete(chart));
    return chart;
  };
  return {
    ChartXY: (o?: ChartOptions) => create(ChartXY, o),
    Chart3D: (o?: ChartOptions) => create(Chart3D, o),
    Polar: (o?: ChartOptions) => create(Polar, o),
    Pie: (o?: any) => create(Pie, o),
    Gauge: (o?: any) => create(Gauge, o),
    Spider: (o?: any) => create(Spider, o),
    BarChart: (o?: any) => create(BarChart, o),
    TreeMapChart: (o?: any) => create(TreeMapChart, o),
    ParallelCoordinateChart: (o?: any) => create(ParallelCoordinateChart, o),
    DataGrid: (o?: any) => create(DataGrid, o),
    MapChart: (o?: MapOptions) => create(MapChart, o),
    SunBurstChart: (o?: any) => create(SunBurstChart, o),
    Funnel: (o?: any) => create(Funnel, o),
    Pyramid: (o?: any) => create(Pyramid, o),
    Dashboard: (o?: any) => create(Dashboard, o),
    dispose() {
      if (!disposed) {
        disposed = true;
        const pending = [...owned], errors: unknown[] = [];
        owned.clear();
        for (const chart of pending) try { chart.dispose(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Some chart disposal callbacks failed');
      }
    },
    isDisposed: () => disposed,
    /** Live charts owned by this context; disposed charts are released immediately. */
    getChartCount: () => owned.size,
  };
}
export const version = "1.0.1-opentest.23";
export class Dashboard {
  readonly root: HTMLDivElement;
  private cells = new Map<any, HTMLDivElement>();
  private children = new Set<any>();
  private events = new EventHub();
  private columns: number;
  private rows: number;
  disposed = false;
  constructor(options: any = {}) {
    if (typeof document === "undefined")
      throw new Error("Dashboard requires a DOM");
    const container =
      typeof options.container === "string"
        ? document.getElementById(options.container)
        : (options.container ?? document.body);
    if (!container) throw new Error("Dashboard container was not found");
    this.root = document.createElement("div");
    this.columns = options.numberOfColumns ?? 2;
    this.rows = options.numberOfRows ?? 2;
    this.root.style.cssText = `display:grid;width:100%;height:100%;grid-template-columns:repeat(${this.columns},minmax(0,1fr));grid-template-rows:repeat(${this.rows},minmax(0,1fr));gap:8px`;
    container.append(this.root);
  }
  private chart<T>(Ctor: new (o: any) => T, options: any = {}) {
    if (this.disposed) throw new Error('Dashboard has been disposed');
    const cell = document.createElement("div");
    cell.style.cssText = `min-height:0;min-width:0;grid-column:${(options.columnIndex ?? 0) + 1}/span ${options.columnSpan ?? 1};grid-row:${(options.rowIndex ?? 0) + 1}/span ${options.rowSpan ?? 1}`;
    this.root.append(cell);
    let chart: T;
    try { chart = new Ctor({ ...options, container: cell }); }
    catch (error) { cell.remove(); throw error; }
    this.cells.set(chart, cell);
    this.children.add(chart);
    (chart as any).onDispose(() => { this.children.delete(chart); this.cells.delete(chart); cell.remove(); });
    return chart;
  }
  createChartXY(options?: any) {
    return this.chart(ChartXY, options);
  }
  createChart3D(options?: any) {
    return this.chart(Chart3D, options);
  }
  createPolar(options?: any) {
    return this.chart(Polar, options);
  }
  createPie(options?: any) {
    return this.chart(Pie, options);
  }
  createGauge(options?: any) {
    return this.chart(Gauge, options);
  }
  createSpider(options?: any) {
    return this.chart(Spider, options);
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;
      const pending = [...this.children], errors: unknown[] = [];
      this.children.clear();
      for (const chart of pending) try { chart.dispose(); } catch (error) { errors.push(error); }
      for (const cell of this.cells.values()) cell.remove();
      this.cells.clear();
      this.root.remove();
      try { this.events.emit('dispose', this); } catch (error) { errors.push(error); }
      finally { this.events.clear(); }
      if (errors.length) throw new AggregateError(errors, 'Some dashboard disposal callbacks failed');
    }
    return this;
  }
  isDisposed() {
    return this.disposed;
  }
  onDispose(listener: EventListener) { return this.events.on('dispose', listener); }
  getChartCount() { return this.children.size; }
}
