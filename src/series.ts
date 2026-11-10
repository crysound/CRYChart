import {proveExtremaPair} from './line-extrema-pair-proof.js';
import {Icon} from './custom-icon.js';
import {
  DataSetXY,
  type DataSetXYOptions,
  type MaxSampleCount,
  type SampleColumns,
  type AppendSamplesOptions,
  type NumericArray,
} from "./core/data.js";
import { EventHub } from "./core/events.js";
import {
  SolidLine,
  SolidFill,
  ColorRGBA,
  emptyFill,
  emptyLine,
  type Color,
  TriangulatedPoints3D,
  assertColorShadingStyle,
  type ColorShadingStyle,
} from "./core/styles.js";
import { Axis, mutate } from "./axis.js";
import {
  UnsupportedFeatureError,
  type DrawPacket,
  type RenderHost,
  type Interval,
  type Rect,
} from "./contracts.js";
import { dashPattern, splinePositions } from "./stroke-geometry.js";
import { colorMappedLine, writeColor } from "./series-attributes.js";
import {domainForStack} from './axis-layout.js';
import {firstRunValue,projectXYRuns} from './data-runs.js';
import {getColumnBounds} from './data-bounds.js';
import {getColumnOrder} from './data-order.js';
import {HeatmapStream,type HeatmapCleaning,type HeatmapStreamUpdate} from './heatmap-stream.js';
import {LineBlockCache,type LineBlockResult} from './line-block-cache.js';
import {LineDisplayCache,type LineDisplayResult} from './line-display-cache.js';
import {visibleSourceSegments} from './viewport.js';
import {isDenseStreamingLineWindow,isDenseStreamingLineViewport,isAffineLineAxis,relativeProjectionPixelError} from './streaming-line-policy.js';
import {validateSolveMode,xyCursorHit,type CoordinateClient,type SolveNearestMode,type SolveResultXY,type SolveResultHeatmap,type SeriesCursorFormatter} from './cursor-api.js';

let nextSeriesId = 1;
const dataSetBindings=new WeakMap<DataSetXY,{count:number;owned:boolean}>();
interface SeriesReadBackResult {
  xValues: NumericArray;
  yValues: NumericArray;
  iSampleFirst: number;
  zValues?: NumericArray;
  lookupValues?: NumericArray;
  colors?: NumericArray;
  ids?: NumericArray;
  sizes?: NumericArray;
  rotations?: NumericArray;
  /** Legacy Core alias; nonenumerable so native consumers receive flat fields. */
  readonly data: Record<string, NumericArray>;
}
interface VisibleFitCache {
  data:DataSetXY;epoch:number;valueKey:string;filterKey:string;
  first:number;end:number;low:number;high:number;computed:boolean;result?:Interval;
  blocks:Map<number,Interval|undefined>;
}
function retainDataSet(data:DataSetXY,owned=false){
  if(data.isDisposed())throw new Error('Cannot bind a disposed data set');
  const binding=dataSetBindings.get(data)??{count:0,owned};binding.count++;dataSetBindings.set(data,binding);
}
function releaseDataSet(data:DataSetXY){
  const binding=dataSetBindings.get(data);if(!binding)return;
  if(--binding.count===0){dataSetBindings.delete(data);if(binding.owned)data.dispose();}
}
export const palette = [
  ColorRGBA(62, 204, 195),
  ColorRGBA(255, 178, 74),
  ColorRGBA(155, 133, 255),
  ColorRGBA(248, 106, 142),
  ColorRGBA(92, 181, 255),
  ColorRGBA(164, 214, 96),
];
export function fillColor(fill: any, fallback = palette[0]!): Color {
  return (
    fill?.getColor?.() ??
    fill?.color ??
    (fill?.kind === "empty" ? ColorRGBA(0, 0, 0, 0) : fallback)
  );
}
export interface SeriesOptions extends DataSetXYOptions {
  axisX?: Axis;
  axisY?: Axis;
  axisZ?: Axis;
  dataSet?: DataSetXY;
  dataPattern?: any;
  [key: string]: any;
}
import {ComponentHighlightState,highlightColor} from './component-highlight.js';
export class PointLineAreaSeries {
  private readonly componentHighlight=new ComponentHighlightState();
  readonly id = nextSeriesId++;
  readonly events = new EventHub();
  readonly axisX: Axis;
  readonly axisY: Axis;
  readonly axisZ?: Axis;
  readonly kind: string;
  name = "";
  visible = true;
  disposed = false;
  highlight = 0;
  mouseInteractions = true;
  cursorEnabled = true;
  private seriesCursorFormatting?:SeriesCursorFormatter;
  stroke: any;
  pointFill: any;
  pointStroke: any = emptyLine;
  areaFill: any = emptyFill;
  pointSize = 0;
  private individualSize = false;
  private individualRotation = false;
  private individualColor = false;
  private individualValue = false;
  private attributes = new Map<
    string,
    {
      revision: number;
      colors?: Float32Array;
      pointSizes?: Float32Array;
      pointRotations?: Float32Array;
      positions?: Float32Array;
    }
  >();
  pointShape: any = 1;
  pointRotation = 0;
  private colorShadingStyle: ColorShadingStyle | undefined;
  private visibleFitCache:VisibleFitCache|undefined;
  private highlightOnHover=false;
  private curvePreprocessing:{type:'spline';resolution:0}|undefined;
  areaBaseline = 0;
  protected dataSet: DataSetXY;
  protected changeToken: symbol;
  protected mapping: Record<string, string>;
  private usesDefaultColumns: boolean;
  protected styleRevision = 0;
  private packetRevision = -1;
  private packed?: DrawPacket;
  private projectionStorage?: Float32Array;
  private lineBlocks?:LineBlockCache;
  private lineBlockResult?:LineBlockResult;
  private lineDisplay?:LineDisplayCache;
  private lineDisplayResult?:LineDisplayResult;
  private projectionMonotonicX = true;
  private projectionStrictX=true;
  private projectionState?: {
    dataRevision: number;
    styleRevision: number;
    bindingRevision: number;
    nextIndex: number;
    firstIndex: number;
    count: number;
    logKey: string;
  };
  constructor(
    readonly chart: RenderHost,
    options: SeriesOptions = {},
    kind = "line",
  ) {
    this.kind = kind;
    this.axisX = options.axisX ?? chart.getDefaultAxisX();
    this.axisY = options.axisY ?? chart.getDefaultAxisY();
    this.axisZ = options.axisZ ?? chart.getDefaultAxisZ?.();
    this.usesDefaultColumns = options.schema === undefined && options.dataSet === undefined;
    this.dataSet =
      options.dataSet ??
      new DataSetXY({
        schema: options.schema ?? {
          xValues: { storage: Float64Array },
          yValues: { storage: Float64Array },
          ...(this.axisZ ? { zValues: { storage: Float64Array } } : {}),
        },
        includesNaN: options.includesNaN,
      });
    const keys = Object.keys(this.dataSet.schema);
    const implicitX = keys.length === 1 && !this.axisZ && keys[0] !== 'x' && keys[0] !== 'xValues';
    if (implicitX) this.dataSet.enableImplicitXColumn();
    this.mapping = {
      x: implicitX ? '_auto' : keys.includes("x")
        ? "x"
        : keys.includes("xValues")
          ? "xValues"
          : keys[0]!,
      y: keys.includes("y")
        ? "y"
        : keys.includes("yValues")
          ? "yValues"
          : keys[1]!,
      ...(this.axisZ ? { z: keys.includes("z") ? "z" : keys[2]! } : {}),
      ...Object.fromEntries(
        ["value", "size", "rotation", "color"]
          .filter((key) => keys.includes(key))
          .map((key) => [key, key]),
      ),
    };
    this.changeToken = this.dataSet.onChange(() => this.changed());
    retainDataSet(this.dataSet,options.dataSet===undefined);
    const color = palette[(this.id - 1) % palette.length]!;
    this.stroke = new SolidLine({
      fillStyle: new SolidFill({ color }),
      thickness: 1.5,
    });
    this.pointFill = kind === "points" ? new SolidFill({ color }) : emptyFill;
    if (kind === "points") this.pointSize = 5;
    this.pointShape = options.pointShape ?? this.pointShape;
    this.individualSize = !!options.individualPointSizeEnabled;
    this.individualRotation = !!options.individualPointRotationEnabled;
    this.individualColor = !!options.individualPointColorEnabled;
    this.individualValue = !!options.individualPointValueEnabled;
  }
  protected changed() {
    if(this.visibleFitCache&&this.visibleFitCache.epoch!==this.dataSet.getContentEpoch())this.visibleFitCache=undefined;
    if(this.dataSet.getSampleCount()===0){
      this.clearLineDisplayCache();
      this.lineBlocks?.clear();this.lineBlockResult=undefined;
      this.packed=undefined;this.projectionStorage=undefined;
      this.projectionState=undefined;this.packetRevision=-1;
    }
    this.chart.invalidate();
    this.events.emit("datachange", { series: this });
  }
  getDataSet() {
    return this.dataSet;
  }
  private bindingRevision = 0;
  getDataBindingRevision() {
    return this.bindingRevision;
  }
  getStyleRevision(){return this.styleRevision;}
  getLastPoint(){const count=this.getSampleCount();return count?this.getSample(count-1):undefined;}
  getXMin(){return this.bounds('x')?.start;}
  getXMax(){return this.bounds('x')?.end;}
  getYMin(){return this.bounds('y')?.start;}
  getYMax(){return this.bounds('y')?.end;}
  getZMin(){return this.bounds('z')?.start;}
  getZMax(){return this.bounds('z')?.end;}
  setDataSet(value: DataSetXY) {
    this.assertAlive();if(value===this.dataSet)return this;
    if (this.mapping.x === '_auto') value.enableImplicitXColumn();
    retainDataSet(value);
    const previous=this.dataSet;
    this.dataSet.offChange(this.changeToken);
    this.dataSet = value;
    this.usesDefaultColumns = false;
    this.changeToken = value.onChange(() => this.changed());
    this.packetRevision = -1;
    this.lineBlocks?.clear();this.lineBlockResult=undefined;
    this.clearLineDisplayCache();
    this.styleRevision++;
    this.bindingRevision++;
    try{this.changed();}finally{releaseDataSet(previous);}
    return this;
  }
  setDataMapping(value: Record<string, string>) {
    this.lineBlocks?.clear();this.lineBlockResult=undefined;
    this.clearLineDisplayCache();
    this.mapping = { ...this.mapping, ...value };
    this.usesDefaultColumns = false;
    this.styleRevision++;
    this.bindingRevision++;
    this.changed();
    return this;
  }
  getDataMapping() {
    return { ...this.mapping };
  }
  setCurvePreprocessing(value:{type:'spline';resolution?:number}|{type:'step';step?:string}|undefined){
    if(value!==undefined&&(value.type!=='spline'||value.resolution!==0))throw new UnsupportedFeatureError('This series supports spline preprocessing with resolution 0 only; use the dedicated spline or step API for other shapes');
    this.curvePreprocessing=value?{type:'spline',resolution:0}:undefined;
    this.styleRevision++;this.chart.invalidate();return this;
  }
  getCurvePreprocessing(){return this.curvePreprocessing?{...this.curvePreprocessing}:undefined;}
  appendSamples(values: SampleColumns, options?: AppendSamplesOptions) {
    this.assertAlive();
    let columns = values;
    if (this.usesDefaultColumns) {
      for (const dimension of ['x','y','z']) {
        const column = this.mapping[dimension];
        if (column && columns[column] === undefined && values[dimension] !== undefined) {
          if (columns === values) columns = {...values};
          columns[column] = values[dimension];
        }
      }
    }
    this.ensureAttributeColumns(Object.keys(columns));
    this.dataSet.appendSamples(columns, options);
    return this;
  }
  /** Row-oriented trajectory input, preserving the same data mapping and storage. */
  appendJSON(points:readonly Record<string,any>[]):this{
    if(!Array.isArray(points))throw new TypeError('appendJSON requires an array of samples');
    if(arguments.length>1)throw new UnsupportedFeatureError('appendJSON options and fill overrides');
    return this.add(points);
  }
  add(points: any | any[]) {
    this.assertAlive();
    const list = Array.isArray(points) ? points : [points];
    this.ensureAttributeColumns(
      ["value", "size", "rotation", "color"].filter((key) =>
        list.some((p) => p[key] !== undefined),
      ),
    );
    const columns: Record<string, number[]> = {};
    for (const name of Object.keys(this.dataSet.schema)) columns[name] = [];
    for (const p of list) {
      for (const [dimension, name] of Object.entries(this.mapping)) {
        if (columns[name])
          columns[name]!.push(
            dimension === "color"
              ? (p.color?.toUint32?.() ?? p.color ?? NaN)
              : (p[dimension] ?? NaN),
          );
      }
    }
    for (const [key, values] of Object.entries(columns))
      if (values.length !== list.length)
        columns[key] = Array(list.length).fill(NaN);
    return this.appendSamples(columns);
  }
  addArraysXY(x: ArrayLike<number>, y: ArrayLike<number>) {
    return this.appendSamples({ [this.mapping.x!]: x, [this.mapping.y!]: y });
  }
  addArraysXYZ(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    z: ArrayLike<number>,
  ) {
    return this.appendSamples({
      [this.mapping.x!]: x,
      [this.mapping.y!]: y,
      [this.mapping.z!]: z,
    });
  }
  addArrayY(y: ArrayLike<number>) {
    const n = this.dataSet.getNextSampleIndex();
    return this.addArraysXY(
      Float64Array.from({ length: y.length }, (_, i) => n + i),
      y,
    );
  }
  clear() {
    this.assertAlive();
    this.clearLineDisplayCache();
    this.dataSet.clear();
    return this;
  }
  setMaxSampleCount(value?: MaxSampleCount) {
    this.dataSet.setMaxSampleCount(value);
    return this;
  }
  getMaxSampleCount() {
    return this.dataSet.getMaxSampleCount();
  }
  getSampleCount() {
    return this.dataSet.getSampleCount();
  }
  getPointCount() {
    return this.getSampleCount();
  }
  getPointAmount() {
    return this.getSampleCount();
  }
  protected ensureAttributeColumns(keys: string[]) {
    const attributes = keys.filter((key) =>
      ["value", "size", "rotation", "color"].includes(key),
    );
    const missing = attributes.filter(
      (key) => !this.dataSet.schema[this.mapping[key] ?? key],
    );
    if (missing.length)
      this.dataSet.addColumns(
        Object.fromEntries(
          missing.map((key) => [
            this.mapping[key] ?? key,
            { storage: Float64Array },
          ]),
        ),
      );
    for (const key of attributes) this.mapping[key] ??= key;
  }
  getNextSampleIndex() {
    return this.dataSet.getNextSampleIndex();
  }
  readBack(options?: any): SeriesReadBackResult {
    const r = this.dataSet.readBack(
      options?.onlyInRange
        ? {
            ...options,
            onlyInRange: { key: this.mapping.x, ...options.onlyInRange },
          }
        : options,
    );
    const data = {
      ...r.data,
      x: r.data[this.mapping.x!] ?? (this.mapping.x === '_auto'
        ? Float64Array.from({length:r.data[this.mapping.y!]?.length ?? 0}, (_, i) =>
            this.dataSet.getValue('_auto', r.iSampleFirst - (this.getNextSampleIndex()-this.getSampleCount()) + i)!)
        : undefined!),
      y: r.data[this.mapping.y!]!,
      ...(this.mapping.z ? { z: r.data[this.mapping.z]! } : {}),
    };
    const result = {
      xValues: data.x,
      yValues: data.y,
      iSampleFirst: r.iSampleFirst,
    } as SeriesReadBackResult;
    for (const [property, mappingKey] of [
      ['zValues','z'], ['lookupValues','value'], ['colors','color'],
      ['ids','id'], ['sizes','size'], ['rotations','rotation'],
    ] as const) {
      const column = this.mapping[mappingKey];
      if (column && r.data[column]) result[property] = r.data[column];
    }
    // The public series API exposes mapped channels directly. DataSet.readBack
    // remains a raw-column wrapper; old Core callers can still access .data.
    return Object.defineProperty(result, 'data', {value:data, enumerable:false});
  }
  getPoints() {
    const out = [];
    for (let i = 0; i < this.getSampleCount(); i++) out.push(this.getSample(i));
    return out;
  }
  getSample(i: number) {
    const point: any = {
      x: this.dataSet.getValue(this.mapping.x!, i) ?? NaN,
      y: this.dataSet.getValue(this.mapping.y!, i) ?? NaN,
      ...(this.axisZ
        ? { z: this.dataSet.getValue(this.mapping.z!, i) ?? NaN }
        : {}),
    };
    for (const key of ["value", "size", "rotation", "color"]) {
      const name = this.mapping[key];
      if (name && this.dataSet.schema[name]) {
        const value = this.dataSet.getValue(name, i);
        if (value !== undefined && Number.isFinite(value))
          point[key] =
            key === "color"
              ? ColorRGBA(
                  (value >>> 24) & 255,
                  (value >>> 16) & 255,
                  (value >>> 8) & 255,
                  value & 255,
                )
              : value;
      }
    }
    return point;
  }
  private findNearestXIndex(target: number,dimension:'x'|'y'='x') {
    const n = this.getSampleCount();
    if (!n || !Number.isFinite(target)) return -1;
    const value = (i: number) =>
      this.dataSet.getValue(this.mapping[dimension]!, i) ?? NaN;
    // Order covers all retained samples, and advances only over newly appended
    // values. Cursor movement must not rescan the entire history each frame.
    let best = -1;
    if (getColumnOrder(this.dataSet, this.mapping[dimension]!).monotonic) {
      let low = 0,
        high = n;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (value(mid) < target) low = mid + 1;
        else high = mid;
      }
      best = Math.min(n - 1, low);
      if (
        best > 0 &&
        Math.abs(value(best - 1) - target) < Math.abs(value(best) - target)
      )
        best--;
    } else {
      let distance = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(value(i) - target);
        if (d < distance) {
          distance = d;
          best = i;
        }
      }
    }
    return best;
  }
  findNearestX(target:number){const index=this.findNearestXIndex(target);return index<0?undefined:this.getSample(index);}
  solveNearest(from:CoordinateClient|{x:number;y:number},mode:SolveNearestMode='show-nearest'):any{
    validateSolveMode(mode);
    if(this.disposed||!this.visible||!this.getSampleCount())return undefined;
    const host=this.chart as any;if(typeof host.translatePoint!=='function')return undefined;
    const client:CoordinateClient='clientX'in from?from:host.translatePoint(from,{x:this.axisX,y:this.axisY},host.coordsClient);
    const pixel=host.translatePoint(client,host.coordsClient,host.coordsPixel),axisPoint=host.translatePoint(client,host.coordsClient,{x:this.axisX,y:this.axisY});
    if(!Number.isFinite(pixel.x)||!Number.isFinite(pixel.y))return undefined;
    const dimension=this.mapping.x==='_auto'||this.dataSet.schema[this.mapping.x!]?.pattern==='progressive'?'x':this.dataSet.schema[this.mapping.y!]?.pattern==='progressive'?'y':undefined;
    if(dimension){
      const index=this.findNearestXIndex(axisPoint[dimension],dimension);if(index<0)return undefined;
      return xyCursorHit(this,this.getSample(index),client,{index,iSample:this.getNextSampleIndex()-this.getSampleCount()+index,pointShape:this.pointShape});
    }
    let best:SolveResultXY|undefined;
    const visit=(index:number)=>{
      const point=this.getSample(index);
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||(this.axisX.type==='logarithmic'&&point.x<=0)||(this.axisY.type==='logarithmic'&&point.y<=0))return;
      const hit=xyCursorHit(this,point,client,{index,iSample:this.getNextSampleIndex()-this.getSampleCount()+index,pointShape:this.pointShape});if(!best||hit.distanceSquared<best.distanceSquared)best=hit;
    };
    if(getColumnOrder(this.dataSet,this.mapping.x!).monotonic){
      const center=this.findNearestXIndex(axisPoint.x);if(center<0)return undefined;visit(center);
      for(const direction of [-1,1])for(let index=center+direction;index>=0&&index<this.getSampleCount();index+=direction){
        const x=this.dataSet.getValue(this.mapping.x!,index)!;
        const xPixel=host.translatePoint({x,y:axisPoint.y},{x:this.axisX,y:this.axisY},host.coordsPixel).x;
        if(best&&Number.isFinite(xPixel)&&(xPixel-pixel.x)**2>best.distanceSquared)break;
        visit(index);
      }
    }else for(let index=0;index<this.getSampleCount();index++)visit(index);
    return best;
  }
  setName(value: string) {
    this.name = value===''?'Series':value;
    this.chart.invalidate();
    return this;
  }
  getName() {
    return this.name;
  }
  setVisible(value: boolean) {
    this.visible = value;
    if(!value){this.componentHighlight.suspend();this.lineDisplay?.suspend();this.lineDisplayResult=undefined;}
    this.chart.invalidate();
    return this;
  }
  getVisible() {
    return this.visible;
  }
  setStrokeStyle(value: any) {
    this.stroke = mutate(this.stroke, value);
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getStrokeStyle() {
    return this.stroke;
  }
  setColorShadingStyle(value:ColorShadingStyle){
    if(!this.axisZ)throw new UnsupportedFeatureError('3D color shading on an XY series');
    assertColorShadingStyle(value);
    this.colorShadingStyle=value;this.styleRevision++;this.chart.invalidate();return this;
  }
  getColorShadingStyle(){return this.colorShadingStyle;}
  setHighlightOnHover(value:boolean){
    if(value!==false)throw new UnsupportedFeatureError('series hover highlighting is not implemented; only false is supported');
    this.highlightOnHover=false;this.chart.invalidate();return this;
  }
  getHighlightOnHover(){return this.highlightOnHover;}
  setPointFillStyle(value: any) {
    this.pointFill = mutate(this.pointFill, value);
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getPointFillStyle() {
    return this.pointFill;
  }
  setPointStrokeStyle(value: any) {
    this.pointStroke = mutate(this.pointStroke, value);
    this.chart.invalidate();
    return this;
  }
  getPointStrokeStyle() {
    return this.pointStroke;
  }
  setPointSize(value: number) {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError("Point size must be finite and nonnegative");
    this.pointSize = value;
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getPointSize() {
    return this.pointSize;
  }
  setPointStyle(value:TriangulatedPoints3D|((previous:TriangulatedPoints3D)=>TriangulatedPoints3D)){
    const style=mutate(this.getPointStyle(),value),size=style.getSize();
    if(!Number.isFinite(size)||size<0)throw new RangeError('Point size must be finite and nonnegative');
    this.pointFill=style.getFillStyle();this.pointSize=size;this.pointShape=style.getShape();this.styleRevision++;this.chart.invalidate();return this;
  }
  getPointStyle(){return new TriangulatedPoints3D({fillStyle:this.pointFill,size:this.pointSize,shape:this.pointShape});}
  setIndividualPointSizeEnabled(value: boolean) {
    this.individualSize = value;
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getIndividualPointSizeEnabled() {
    return this.individualSize;
  }
  setIndividualPointRotationEnabled(value: boolean) {
    this.individualRotation = value;
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getIndividualPointRotationEnabled() {
    return this.individualRotation;
  }
  setIndividualPointColorEnabled(value: boolean) {
    this.individualColor = value;
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getIndividualPointColorEnabled() {
    return this.individualColor;
  }
  setIndividualPointValueEnabled(value: boolean) {
    this.individualValue = value;
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getIndividualPointValueEnabled() {
    return this.individualValue;
  }
  setPointShape(value: number | string | Icon) {
    if(value instanceof Icon){
      if(value.isDisposed())throw new Error('Custom icon has been disposed');
      const size=value.getRasterSize();this.pointSize=Math.max(size.width,size.height);
    }
    this.pointShape = value;
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getPointShape() {
    return this.pointShape;
  }
  setPointRotation(value: number) {
    if (!Number.isFinite(value))
      throw new RangeError("Point rotation must be finite");
    this.pointRotation = value;
    this.styleRevision++;
    this.chart.invalidate();
    return this;
  }
  getPointRotation() {
    return this.pointRotation;
  }
  setAreaFillStyle(value: any) {
    this.areaFill = mutate(this.areaFill, value);
    this.chart.invalidate();
    return this;
  }
  getAreaFillStyle() {
    return this.areaFill;
  }
  setFillStyle(value: any) {
    return this.setAreaFillStyle(value);
  }
  getFillStyle() {
    return this.areaFill;
  }
  setAreaBaseline(value: number) {
    this.areaBaseline = value;
    this.chart.invalidate();
    return this;
  }
  setMouseInteractions(value: boolean) {
    this.mouseInteractions = value;
    return this;
  }
  setMouseInteractionsEnabled(value: boolean) {
    return this.setMouseInteractions(value);
  }
  setCursorEnabled(value: boolean) {
    this.cursorEnabled = value;
    return this;
  }
  getCursorEnabled() {
    return this.cursorEnabled;
  }
  setCursorResultTableFormatter(value: any) {
    this.cursorFormatter = value;
    return this;
  }
  setCursorFormattingOverride(formatter:SeriesCursorFormatter|undefined):this{
    if(formatter!==undefined&&typeof formatter!=='function')throw new TypeError('Cursor formatter must be a function');
    this.seriesCursorFormatting=formatter;this.chart.invalidate();return this;
  }
  getCursorFormattingOverride(){return this.seriesCursorFormatting;}
  formatCursorRows(hit:any,before:any[][]):any[][]|undefined{return this.seriesCursorFormatting?this.seriesCursorFormatting(hit,before):before;}
  cursorFormatter: any;
  setHighlight(value: boolean|number) {
    this.assertAlive();this.highlight = this.componentHighlight.set(value);
    this.chart.invalidate();
    return this;
  }
  getHighlight() {
    return this.highlight;
  }
  setAnimationHighlight(enabled:boolean):this{this.assertAlive();this.componentHighlight.setAnimation(enabled);this.chart.invalidate();return this;}
  getAnimationHighlight(){return this.componentHighlight.getAnimation();}
  advanceHighlight(timestamp:number){this.componentHighlight.advance(timestamp,this.visible&&!this.disposed&&this.getSampleCount()>0);}
  hasPendingHighlight(){return this.componentHighlight.pending(this.visible&&!this.disposed&&this.getSampleCount()>0);}
  getHighlightStrength(){return this.componentHighlight.strength();}
  cancelHighlightAnimation(){this.componentHighlight.cancel();}
  suspendHighlightAnimation(){this.componentHighlight.suspend();}

  resolveRenderColor(color:ReturnType<typeof fillColor>){return highlightColor(color,this.getHighlightStrength(),(this.chart as any).theme??{});}
  private highlightedLinePackets(packets:readonly DrawPacket[]):readonly DrawPacket[]{
    const strength=this.getHighlightStrength();if(!(strength>0))return packets;
    return packets.map(packet=>{const c=packet.color,color=highlightColor(ColorRGBA(c[0]*255,c[1]*255,c[2]*255,c[3]*255),strength,(this.chart as any).theme??{});return{...packet,color:[color.r,color.g,color.b,color.a] as [number,number,number,number]};});
  }
  setEffect(value: any) {
    if (value !== false && value !== undefined)
      throw new Error("CRYChart visual effects are not implemented");
    return this;
  }
  setDataCleaning(value: any) {
    if (typeof value?.minDataPointCount === "number")
      this.setMaxSampleCount(value.minDataPointCount);
    return this;
  }
  getAxisX() {
    return this.axisX;
  }
  getAxisY() {
    return this.axisY;
  }
  getAxisZ() {
    return this.axisZ;
  }
  on(type: string, fn: any) {
    return this.events.on(type, fn);
  }
  off(typeOrToken: any, token?: any) {
    return this.events.off(typeOrToken, token);
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;this.componentHighlight.cancel();
      this.seriesCursorFormatting=undefined;this.cursorFormatter=undefined;
      this.visibleFitCache=undefined;
      const failures:unknown[]=[],cleanup=(action:()=>unknown)=>{try{action();}catch(error){failures.push(error);}};
      cleanup(()=>this.dataSet.offChange(this.changeToken));
      cleanup(()=>this.events.clear());
      cleanup(()=>this.chart.removeSeries(this));
      this.packed = undefined;
      this.projectionStorage = undefined;
      this.projectionState = undefined;
      this.attributes.clear();
      cleanup(()=>this.lineBlocks?.dispose());this.lineBlockResult=undefined;
      cleanup(()=>this.lineDisplay?.dispose());this.lineDisplay=undefined;this.lineDisplayResult=undefined;
      cleanup(()=>releaseDataSet(this.dataSet));
      if(failures.length)throw new AggregateError(failures,'Series disposal completed with consumer or resource errors');
    }
    return this;
  }
  isDisposed() {
    return this.disposed;
  }
  protected assertAlive() {
    if (this.disposed) throw new Error("Series has been disposed");
  }
  bounds(dimension: "x" | "y" | "z"): Interval | undefined {
    const key=this.mapping[dimension];
    return key&&this.dataSet.hasColumn(key)?getColumnBounds(this.dataSet,key):undefined;
  }
  /** Internal sample-domain fit query. No source columns or readBack copies are materialized. */
  boundsWithinOtherAxis(dimension:'x'|'y',range:Interval):Interval|undefined{
    const data=this.dataSet,count=data.getSampleCount(),valueKey=this.mapping[dimension],filterKey=this.mapping[dimension==='x'?'y':'x'];
    if(!count||!valueKey||!filterKey||!data.hasColumn(valueKey)||!data.hasColumn(filterKey))return undefined;
    const epoch=data.getContentEpoch(),end=data.getNextSampleIndex(),first=end-count,low=Math.min(range.start,range.end),high=Math.max(range.start,range.end);
    let cache=this.visibleFitCache;
    if(!cache||cache.data!==data||cache.epoch!==epoch||cache.valueKey!==valueKey||cache.filterKey!==filterKey){
      cache={data,epoch,valueKey,filterKey,first:-1,end:-1,low:NaN,high:NaN,computed:false,blocks:new Map()};this.visibleFitCache=cache;
    }
    if(cache.computed&&cache.first===first&&cache.end===end&&cache.low===low&&cache.high===high)return cache.result&&{...cache.result};
    let min=Infinity,max=-Infinity;
    const take=(value:number|undefined)=>{if(value!==undefined&&Number.isFinite(value)){min=Math.min(min,value);max=Math.max(max,value);}};
    const order=getColumnOrder(data,filterKey);
    if(order.finite&&order.monotonic){
      const bound=(target:number,upper:boolean)=>{let a=0,b=count;while(a<b){const m=a+Math.floor((b-a)/2),v=data.getValue(filterKey,m)!;if(v<target||upper&&v===target)a=m+1;else b=m;}return a;};
      let from=first+bound(low,false),to=first+bound(high,true);
      const size=1024,firstFull=Math.ceil(first/size);
      for(const block of cache.blocks.keys())if(block<firstFull)cache.blocks.delete(block);
      while(from<to){
        const block=Math.floor(from/size),stop=Math.min(to,(block+1)*size);
        if(from===block*size&&stop===(block+1)*size){
          if(!cache.blocks.has(block)){
            let lo=Infinity,hi=-Infinity;
            for(let i=from;i<stop;i++){const value=data.getValue(valueKey,i-first);if(value!==undefined&&Number.isFinite(value)){lo=Math.min(lo,value);hi=Math.max(hi,value);}}
            cache.blocks.set(block,lo===Infinity?undefined:{start:lo,end:hi});
          }
          const bounds=cache.blocks.get(block);if(bounds){take(bounds.start);take(bounds.end);}
        }else for(let i=from;i<stop;i++)take(data.getValue(valueKey,i-first));
        from=stop;
      }
    }else{
      // Unordered/NaN filters require the exact finite pair predicate. Unchanged
      // data and range still reuse the result above; no sorted shadow source exists.
      cache.blocks.clear();
      for(let i=0;i<count;i++){const value=data.getValue(filterKey,i);if(value!==undefined&&Number.isFinite(value)&&value>=low&&value<=high)take(data.getValue(valueKey,i));}
    }
    cache.first=first;cache.end=end;cache.low=low;cache.high=high;cache.computed=true;cache.result=min===Infinity?undefined:{start:min,end:max};
    return cache.result&&{...cache.result};
  }
  /** Experimental block preparation; ChartXY invokes it only when explicitly
   * configured and using WebGL. The compatibility drawPacket API stays intact.
   */
  drawLinePackets(rect:Rect,dpr=1,plotRect:Rect=rect):readonly DrawPacket[]{
    this.assertAlive();
    this.clearLineDisplayCache();
    const fill=this.stroke?.getFillStyle?.(),thickness=this.stroke?.getThickness?.()??1;
    const fallback=()=>{this.lineBlocks?.clear();this.lineBlockResult=undefined;return[{...this.drawPacket('line'),clipRect:rect}];};
    if(this.constructor!==PointLineAreaSeries||this.kind==='points'||this.axisZ||!isAffineLineAxis(this.axisX.type)||!isAffineLineAxis(this.axisY.type)||this.pointSize>0||this.individualSize||this.stroke?.getPattern?.()?.length||fill?.getLUT?.()||fill?.kind==='individual'||this.resolveRenderColor(fillColor(fill)).a!==1||!Number.isFinite(thickness)||thickness<=0||this.getSampleCount()<4096)return fallback();
    const data=this.dataSet,x=this.mapping.x!,y=this.mapping.y!;
    if(!data.hasColumn(x)||!data.hasColumn(y))return fallback();
    const visibleSegments=visibleSourceSegments(data,x,this.axisX.getInterval(),rect.width,thickness);if(!visibleSegments)return fallback();
    const interval=(axis:Axis)=>{const value=axis.getRenderInterval?.()??axis.getInterval();return domainForStack(axis.inverted?{start:value.end,end:value.start}:value,axis.getScreenRange());};
    const color=fillColor(fill),next=data.getNextSampleIndex();this.lineBlocks??=new LineBlockCache();
    const result=this.lineBlocks.update({source:{identity:data,contentEpoch:data.getContentEpoch(),revision:data.revision,firstSampleIndex:next-data.getSampleCount(),nextSampleIndex:next,x:data.getColumnRuns(x),y:data.getColumnRuns(y)},strokeGroup:this.id,coordinateMode:'linear',projectionKey:`${x}:${y}:linear`,bindingRevision:this.bindingRevision,styleRevision:this.styleRevision,visibleSegments,domain:{x:interval(this.axisX),y:interval(this.axisY)},clipRect:rect,style:{color:[color.r,color.g,color.b,color.a],thickness},monotonicX:'verified-strict'});
    if(result.kind==='fallback')return fallback();
    if(!this.highPrecisionLinePacketsSafe(result.packets,plotRect,dpr))return fallback();
    this.lineBlockResult=result;
    this.packed=undefined;this.projectionStorage=undefined;this.projectionState=undefined;this.packetRevision=-1;
    return this.highlightedLinePackets(result.packets);
  }
  getLineBlockStats(){return this.lineBlockResult?.kind==='blocks'?{...this.lineBlockResult.stats}:undefined;}
  private clearLineDisplayCache(){this.lineDisplay?.clear();this.lineDisplayResult=undefined;}
  private highPrecisionLinePacketsSafe(packets:readonly DrawPacket[],plotRect:Rect,dpr:number):boolean{
    if(this.axisX.type!=='linear-highPrecision'&&this.axisY.type!=='linear-highPrecision')return true;
    const yBounds=this.axisY.type==='linear-highPrecision'?this.bounds('y'):undefined;
    for(const packet of packets){
      if(packet.count<2)continue;
      if(this.axisX.type==='linear-highPrecision'){
        if(!packet.strictlyMonotonicX)return false;
        const magnitude=Math.max(Math.abs(packet.positions[0]!),Math.abs(packet.positions[(packet.count-1)*2]!));
        if(relativeProjectionPixelError(packet.origin.x,packet.domain.x.start,packet.domain.x.end,magnitude,plotRect.width*dpr)>.125)return false;
      }
      if(this.axisY.type==='linear-highPrecision'&&yBounds){
        const magnitude=Math.max(Math.abs(yBounds.start-packet.origin.y),Math.abs(yBounds.end-packet.origin.y));
        if(relativeProjectionPixelError(packet.origin.y,packet.domain.y.start,packet.domain.y.end,magnitude,plotRect.height*dpr)>.125)return false;
      }
    }
    return true;
  }
  /** Dense bounded streams use a screen-space view only for opaque solid
   * lines. Source values, raw bounds and cursor lookup stay on the DataSet.
   * Small windows and unsupported styles keep the lossless block pipeline. */
  drawStreamingLinePackets(plotRect:Rect,clipRect:Rect=plotRect,dpr=1):readonly DrawPacket[]{
    const count=this.getSampleCount(),limit=this.getMaxSampleCount();
    const fill=this.stroke?.getFillStyle?.(),thickness=this.stroke?.getThickness?.()??1;
    const fallback=()=>this.drawLinePackets(clipRect,dpr,plotRect);
    if(!isDenseStreamingLineWindow(count,limit,plotRect.width,dpr)||
      this.constructor!==PointLineAreaSeries||this.kind==='points'||
      this.axisZ||!isAffineLineAxis(this.axisX.type)||!isAffineLineAxis(this.axisY.type)||
      this.pointSize>0||this.individualSize||!Number.isFinite(thickness)||thickness<=0||fillColor(fill).a!==1||
      this.stroke?.getPattern?.()?.length||fill?.getLUT?.()||fill?.kind==='individual'||
      this.areaFill?.hasVisibleStops?.()||fillColor(this.areaFill,ColorRGBA(0,0,0,0)).a>0)return fallback();
    const x=this.mapping.x!;
    if(!this.dataSet.hasColumn(x))return fallback();
    const visible=visibleSourceSegments(this.dataSet,x,this.axisX.getInterval(),clipRect.width,thickness);
    if(!visible||!isDenseStreamingLineViewport(visible.end-visible.first+1,plotRect.width,dpr))return fallback();
    return this.drawLineDisplayPackets(plotRect,clipRect,dpr,.5,false,true);
  }
  /** Explicit display-only candidate. Raw bounds, sample APIs and cursor lookup
   * retain the original DataSet. Unsupported geometry falls back atomically. */
  drawLineDisplayPackets(plotRect:Rect,clipRect:Rect=plotRect,dpr=1,maximumPixelSpan=1,pagePackets=false,streamingArena=false):readonly DrawPacket[]{
    this.assertAlive();
    const fallback=()=>{this.clearLineDisplayCache();return this.drawLinePackets(clipRect,dpr,plotRect);};
    if(this.resolveRenderColor(fillColor(this.stroke?.getFillStyle?.())).a!==1){
      this.clearLineDisplayCache();this.lineBlocks?.clear();this.lineBlockResult=undefined;
      return[{...this.drawPacket('line'),clipRect}];
    }
    const fill=this.stroke?.getFillStyle?.(),thickness=this.stroke?.getThickness?.()??1;
    if(!this.visible||this.constructor!==PointLineAreaSeries||this.kind==='points'||this.axisZ||!isAffineLineAxis(this.axisX.type)||!isAffineLineAxis(this.axisY.type)||this.pointSize>0||this.individualSize||this.stroke?.getPattern?.()?.length||fill?.getLUT?.()||fill?.kind==='individual'||!Number.isFinite(thickness)||thickness<=0||this.getSampleCount()<4096)return fallback();
    const data=this.dataSet,x=this.mapping.x!,y=this.mapping.y!;
    if(!data.hasColumn(x)||!data.hasColumn(y))return fallback();
    const visibleSegments=visibleSourceSegments(data,x,this.axisX.getInterval(),clipRect.width,thickness);if(!visibleSegments)return fallback();
    const interval=(axis:Axis)=>{const value=axis.getRenderInterval?.()??axis.getInterval();return domainForStack(axis.inverted?{start:value.end,end:value.start}:value,axis.getScreenRange());};
    const color=fillColor(fill),next=data.getNextSampleIndex();this.lineDisplay??=new LineDisplayCache();
    const arena=streamingArena||(this.chart as any).renderer?.lineCoverageUnion===true;
    const result=this.lineDisplay.update({source:{identity:data,contentEpoch:data.getContentEpoch(),revision:data.revision,firstSampleIndex:next-data.getSampleCount(),nextSampleIndex:next,x:data.getColumnRuns(x),y:data.getColumnRuns(y)},strokeGroup:this.id,coordinateMode:'linear',projectionKey:`${x}:${y}:linear`,bindingRevision:this.bindingRevision,styleRevision:this.styleRevision,visibleSegments,domain:{x:interval(this.axisX),y:interval(this.axisY)},clipRect,style:{color:[color.r,color.g,color.b,color.a],thickness},monotonicX:'verified-strict',plotRect,devicePixelRatio:dpr,maximumPixelSpan,extremaPairProof:color.a===1&&thickness===2&&!this.axisX.inverted&&!this.axisY.inverted?proveExtremaPair(data,x,y):undefined,reuseCertifiedPages:true,packetMode:arena?'arena':pagePackets?'pages':'flat',reuseUnchangedGroups:arena,collectSourceIndices:!arena});
    if(result.kind==='fallback')return fallback();
    if(!this.highPrecisionLinePacketsSafe(result.packets??(result.packet?[result.packet]:[]),plotRect,dpr))return fallback();
    this.lineDisplayResult=result;
    this.lineBlocks?.clear();this.lineBlockResult=undefined;
    this.packed=undefined;this.projectionStorage=undefined;this.projectionState=undefined;this.packetRevision=-1;
    return this.highlightedLinePackets(result.packets??(result.packet?[result.packet]:[]));
  }
  getLineDisplayStats(){return this.lineDisplayResult?.kind==='display'?{...this.lineDisplayResult.stats}:undefined;}
  getXYProjectionStorageBytes(){const stats=this.lineDisplayResult?.stats;return(this.projectionStorage?.byteLength??0)+(this.lineBlockResult?.stats.residentProjectionBytes??0)+(stats?.projectionBytes??0)+(stats?.cachedProjectionBytes??0);}
  drawPacket(
    mode: "line" | "points" = this.kind === "points" ? "points" : "line",
  ): DrawPacket {
    this.assertAlive();
    // A retention resize can leave the streaming dispatch while samples remain.
    // Release its previous view when returning to ordinary line geometry.
    // Point queries may coexist with an active line view and keep its cache.
    if(mode==='line'){
      this.clearLineDisplayCache();
      this.lineBlocks?.clear();this.lineBlockResult=undefined;
    }
    const n = this.getSampleCount();
    const logX = this.axisX.type === "logarithmic",
      logY = this.axisY.type === "logarithmic";
    const revision = (this.dataSet.revision * 100000 + this.styleRevision)*4+(logX?2:0)+(logY?1:0);
    const transform = (v: number, log: boolean) => (log ? Math.log10(v) : v);
    const logKey = `${logX}:${logY}`;
    if (
      this.packetRevision !== revision ||
      !this.packed ||
      this.projectionState?.logKey !== logKey
    ) {
      const xs = this.dataSet.hasColumn(this.mapping.x!)
          ? this.dataSet.getColumnRuns(this.mapping.x!)
          : undefined,
        ys = this.dataSet.hasColumn(this.mapping.y!)
          ? this.dataSet.getColumnRuns(this.mapping.y!)
          : undefined;
      const state = this.projectionState,
        nextIndex = this.dataSet.getNextSampleIndex(),
        firstIndex = nextIndex - n;
      const sameBinding =
        state?.bindingRevision === this.bindingRevision &&
        state?.logKey === logKey;
      const unchanged =
        sameBinding && state?.dataRevision === this.dataSet.revision;
      const append =
        !!this.packed &&
        sameBinding &&
        state?.dataRevision === this.dataSet.revision - 1 &&
        state.styleRevision === this.styleRevision &&
        firstIndex === state.firstIndex &&
        n > state.count &&
        nextIndex - state.nextIndex === n - state.count;
      const from = unchanged ? n : append ? state!.count : 0,
        previousRevision = this.packed?.revision;
      const x0 = transform(firstRunValue(xs), logX),
        y0 = transform(firstRunValue(ys), logY);
      const origin =
        (append || unchanged) && this.packed
          ? this.packed.origin
          : {
              x: Number.isFinite(x0) ? x0 : 0,
              y: Number.isFinite(y0) ? y0 : 0,
              z: 0,
            };
      if (!this.projectionStorage || this.projectionStorage.length < n * 2) {
        const storage = new Float32Array(
          n===0?0:Math.max(512, 2 ** Math.ceil(Math.log2(n * 2))),
        );
        if (from > 0 && this.projectionStorage)
          storage.set(this.projectionStorage.subarray(0, from * 2));
        this.projectionStorage = storage;
      }
      const positions = this.projectionStorage.subarray(0, n * 2);
      if(from===0){this.projectionMonotonicX=true;this.projectionStrictX=true;}
      if (!xs?.count || !ys?.count) positions.fill(NaN, from * 2);
      else {
        const order=projectXYRuns(xs,ys,positions,from,origin,logX,logY);
        this.projectionMonotonicX&&=order.monotonic;this.projectionStrictX&&=order.strict;
      }
      this.packed = {
        id: this.id,
        revision,
        positions,
        count: n,
        dimensions: 2,
        mode,
        color: [1, 1, 1, 1],
        thickness: 1,
        pointSize: this.pointSize,
        origin,
        domain: { x: { start: 0, end: 1 }, y: { start: 0, end: 1 } },
        updateFrom: append ? from : undefined,
        previousRevision,
        monotonicX:this.projectionMonotonicX&&!!xs?.count&&!!ys?.count,
        strictlyMonotonicX:this.projectionStrictX&&!!xs?.count&&!!ys?.count,
      };
      this.projectionState = {
        dataRevision: this.dataSet.revision,
        styleRevision: this.styleRevision,
        bindingRevision: this.bindingRevision,
        nextIndex,
        firstIndex,
        count: n,
        logKey,
      };
      this.packetRevision = revision;
    }
    const packet = this.packed,
      color = this.resolveRenderColor(fillColor(
        mode === "points" ? this.pointFill : this.stroke?.getFillStyle?.(),
      ));
    packet.color = [color.r, color.g, color.b, color.a];
    packet.mode = mode;
    packet.thickness = this.stroke?.getThickness?.() ?? 1;
    packet.pointSize = this.pointSize;
    packet.pointIcon=this.pointShape instanceof Icon?this.pointShape:undefined;
    packet.pointShape =
      typeof this.pointShape === "number"
        ? this.pointShape
        : ((
            {
              square: 0,
              circle: 1,
              triangle: 2,
              cross: 3,
              diamond: 4,
              plus: 5,
              minus: 6,
              arrow: 7,
              star: 8,
            } as Record<string, number>
          )[String(this.pointShape).toLowerCase()] ?? 1);
    packet.pointRotation = this.pointRotation;
    const outline = this.resolveRenderColor(fillColor(this.pointStroke.getFillStyle()));
    packet.pointStrokeColor = [outline.r, outline.g, outline.b, outline.a];
    packet.pointStrokeThickness = this.pointStroke.getThickness();
    packet.dashPattern = this.stroke?.getPattern
      ? dashPattern(
          this.stroke.getPattern(),
          this.stroke.getPatternScale?.() ?? 1,
        )
      : undefined;
    const xi = this.axisX.getRenderInterval?.()??this.axisX.getInterval(),
      yi = this.axisY.getRenderInterval?.()??this.axisY.getInterval();
    packet.domain = {
      x: domainForStack({
        start: transform(this.axisX.inverted ? xi.end : xi.start, logX),
        end: transform(this.axisX.inverted ? xi.start : xi.end, logX),
      },this.axisX.getScreenRange()),
      y: domainForStack({
        start: transform(this.axisY.inverted ? yi.end : yi.start, logY),
        end: transform(this.axisY.inverted ? yi.start : yi.end, logY),
      },this.axisY.getScreenRange()),
    };
    const fill =
        mode === "points" ? this.pointFill : this.stroke?.getFillStyle?.(),
      lut = fill?.getLUT?.();
    const individualColor = this.individualColor || fill?.kind === "individual";
    const needsAttributes =
      !!lut ||
      (mode === "points" &&
        (this.individualSize || individualColor || this.individualRotation));
    let attributes = needsAttributes ? this.attributes.get(mode) : undefined;
    if (needsAttributes && attributes?.revision !== revision) {
      attributes = { revision };
      const lookup = (key: string, i: number) => {
        if (mode === "points" && key === "value" && !this.individualValue)
          return undefined;
        const column = this.mapping[key] ?? key;
        return this.dataSet.schema[column]
          ? this.dataSet.getValue(column, i)
          : undefined;
      };
      if (lut && mode === "line") {
        const values = Float64Array.from(
          { length: n },
          (_, i) => lookup(fill.getLookUpProperty(), i) ?? NaN,
        );
        Object.assign(
          attributes,
          colorMappedLine(packet.positions, values, lut),
        );
      } else if (lut || individualColor) {
        attributes.colors = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          const packedColor = individualColor ? lookup("color", i) : undefined;
          const c =
            packedColor !== undefined && Number.isFinite(packedColor)
              ? ColorRGBA(
                  (packedColor >>> 24) & 255,
                  (packedColor >>> 16) & 255,
                  (packedColor >>> 8) & 255,
                  packedColor & 255,
                )
              : lut
                ? lut.getColor(lookup(fill.getLookUpProperty(), i) ?? NaN)
                : color;
          writeColor(attributes.colors, i * 4, c);
        }
      }
      if (mode === "points" && this.individualSize)
        attributes.pointSizes = Float32Array.from({ length: n }, (_, i) => {
          const v = lookup("size", i);
          return v !== undefined && Number.isFinite(v)
            ? Math.max(0, v)
            : this.pointSize;
        });
      if (mode === "points" && this.individualRotation)
        attributes.pointRotations = Float32Array.from({ length: n }, (_, i) => {
          const v = lookup("rotation", i);
          return v !== undefined && Number.isFinite(v) ? v : this.pointRotation;
        });
      this.attributes.set(mode, attributes);
    }
    if (attributes)
      return {
        ...packet,
        ...attributes,
        id: attributes.positions ? -packet.id : packet.id,
        count: attributes.positions
          ? attributes.positions.length / 2
          : packet.count,
        ...(attributes.positions
          ? { updateFrom: undefined, previousRevision: undefined }
          : {}),
      };
    return packet;
  }
}
export class SplineSeries extends PointLineAreaSeries {
  private interpolated?: { revision: number; positions: Float32Array };
  override dispose(){this.interpolated=undefined;return super.dispose();}
  override drawPacket(mode: "line" | "points" = "line"): DrawPacket {
    const source = super.drawPacket(mode);
    if (mode === "points") return source;
    if (source.colors)
      throw new UnsupportedFeatureError("palette-mapped splines");
    if (this.interpolated?.revision !== source.revision)
      this.interpolated = {
        revision: source.revision,
        positions: splinePositions(source.positions),
      };
    return {
      ...source,
      id: -source.id,
      positions: this.interpolated!.positions,
      count: this.interpolated!.positions.length / 2,
      updateFrom: undefined,
      previousRevision: undefined,
      monotonicX:false,
      strictlyMonotonicX:false,
    };
  }
}
export class HeatmapSeries {
  readonly id = nextSeriesId++;
  readonly kind = "heatmap";
  readonly axisX: Axis;
  readonly axisY: Axis;
  name = "";
  visible = true;
  disposed = false;
  cursorEnabled = true;
  private seriesCursorFormatting?:SeriesCursorFormatter;
  revision = 0;
  dataRevision = 0;
  dataUpdate?:{x:number;y:number;width:number;height:number;previousRevision:number};
  private pendingFullDataUpdate = false;
  paletteRevision = 0;
  columns: number;
  rows: number;
  start: { x: number; y: number };
  step: { x: number; y: number };
  private configuredStep: { x: number; y: number };
  private explicitGridEnd?: { x: number; y: number };
  data: Float32Array;
  palette: any;
  dataOrder: string;
  scrolling: boolean;
  scrollDimension: string;
  sampleCount = 0;
  intensityRange = { start: 0, end: 1 };
  private intensityInterpolation: "disabled" | "bilinear" = "disabled";
  wireframe: any = emptyLine;
  private stream?:HeatmapStream;
  constructor(
    readonly chart: RenderHost,
    options: any = {},
    scrolling = false,
  ) {
    this.axisX = options.axisX ?? chart.getDefaultAxisX();
    this.axisY = options.axisY ?? chart.getDefaultAxisY();
    this.scrolling = scrolling;
    this.scrollDimension = options.scrollDimension ?? "columns";
    this.columns = options.columns ?? options.resolution ?? 100;
    this.rows = options.rows ?? options.resolution ?? 100;
    this.start = options.start ?? { x: 0, y: 0 };
    this.step = options.step ?? { x: 1, y: 1 };
    this.configuredStep = { ...this.step };
    this.dataOrder = options.dataOrder ?? "columns";
    if(scrolling){
      if(this.scrollDimension!=='columns'&&this.scrollDimension!=='rows')throw new RangeError('Unknown heatmap scroll dimension');
      this.stream=new HeatmapStream(this.scrollDimension==='columns'?this.rows:this.columns,this.scrollDimension,this.scrollDimension==='columns'?options.columns:options.rows);
      this.columns=this.stream.columns;this.rows=this.stream.rows;this.data=this.stream.data;
    }else{this.data = new Float32Array(this.columns * this.rows);this.data.fill(this.getClearIntensityValue());}
  }
  private changed(dataChanged = false, update?:typeof this.dataUpdate) {
    this.revision++;
    if (dataChanged) {
      const previousRevision=this.dataRevision++;
      if(!update){
        // A whole-grid write cannot be narrowed by a later small patch before upload.
        this.pendingFullDataUpdate=true;
        this.dataUpdate=undefined;
      }else if(!this.pendingFullDataUpdate){
        const pending=this.dataUpdate;
        if(pending){
          const x=Math.min(pending.x,update.x),y=Math.min(pending.y,update.y);
          this.dataUpdate={x,y,width:Math.max(pending.x+pending.width,update.x+update.width)-x,height:Math.max(pending.y+pending.height,update.y+update.height)-y,previousRevision:pending.previousRevision};
        }else this.dataUpdate={...update,previousRevision};
      }
    }
    this.chart.invalidate();
    return this;
  }
  /** Only the renderer that actually uploaded this revision may discard pending edits. */
  acknowledgeDataRevision(revision:number):void {
    if(revision!==this.dataRevision)return;
    this.dataUpdate=undefined;
    this.pendingFullDataUpdate=false;
  }
  /** Validate and snapshot caller-owned input before changing any live cell or
   * revision. A later malformed vector or throwing getter cannot leave a
   * partial replacement, and overlapping input views cannot overwrite unread
   * values during the column-to-row conversion. */
  private stageIntensityValues(values:any,width:number,height:number):Float32Array {
    const isVector=(value:any):value is ArrayLike<number>=>Array.isArray(value)||ArrayBuffer.isView(value)&&typeof (value as any).length==='number';
    if(!isVector(values))throw new TypeError('Heatmap intensity values must be numeric arrays');
    const columnOrder=this.dataOrder==='columns',outer=columnOrder?width:height,inner=columnOrder?height:width;
    const nested=Array.isArray(values)&&values.length>0&&typeof values[0]!=='number';
    const vectors:any[]=nested?Array.from(values):[];
    if(nested){
      if(vectors.length!==outer||vectors.some(vector=>!isVector(vector)||vector.length!==inner))
        throw new RangeError('Heatmap intensity matrix must match its rectangular range dimensions');
    }else if(values.length!==width*height)throw new RangeError('Heatmap intensity count does not match rectangular range dimensions');
    const next=new Float32Array(width*height);
    for(let r=0;r<height;r++)for(let c=0;c<width;c++){
      const value=nested?(columnOrder?vectors[c][r]:vectors[r][c]):values[columnOrder?c*height+r:r*width+c];
      if(typeof value!=='number')throw new TypeError('Heatmap intensity cells must be numbers');
      next[r*width+c]=value;
    }
    return next;
  }
  invalidateIntensityValues(values: any) {
    if(this.stream&&values&&Object.prototype.hasOwnProperty.call(values,'iSample'))return this.writeSamples(values.iSample,values.values);
    const patch=values&&!Array.isArray(values)&&Object.prototype.hasOwnProperty.call(values,'values')?values:undefined;
    const matrix=patch?patch.values:values,columnOrder=this.dataOrder==='columns';
    const nested=Array.isArray(matrix)&&(matrix.length===0||typeof matrix[0]!=='number');
    const outer=matrix?.length??0,inner=nested?(matrix[0]?.length??0):0;
    const x=patch?.iColumn??0,y=patch?.iRow??0;
    const width=nested?(columnOrder?outer:inner):(patch?patch.columns??0:this.columns);
    const height=nested?(columnOrder?inner:outer):(patch?patch.rows??0:this.rows);
    if(![x,y,width,height].every(v=>Number.isSafeInteger(v)&&v>=0)||x+width>this.columns||y+height>this.rows)
      throw new RangeError('Heatmap partial update must be a rectangular range within its dimensions');
    const next=this.stageIntensityValues(matrix,width,height);
    if(!width||!height)return this;
    // A rectangular matrix may describe a prefix of the grid without an
    // explicit origin. Only a complete replacement marks the whole grid dirty.
    const wholeGrid=!patch&&width===this.columns&&height===this.rows;
    const update=wholeGrid?undefined:{x,y,width,height,previousRevision:this.dataRevision};
    if(wholeGrid)this.data.set(next);
    else for(let r=0;r<height;r++)for(let c=0;c<width;c++)this.data[(y+r)*this.columns+x+c]=next[r*width+c];
    return this.changed(true,update);
  }
  addIntensityValues(values: any) {
    const list = typeof values[0] === "number" ? [values] : values;
    if (!list.length) return this;
    if(!this.stream)throw new Error('Appending heatmap samples requires a scrolling series');
    return this.writeSamples(this.stream.next,list);
  }
  private applyStreamUpdate(result:HeatmapStreamUpdate){
    const stream=this.stream!;this.data=stream.data;this.columns=stream.columns;this.rows=stream.rows;this.sampleCount=stream.next;
    if(!result.changed)return this;
    const update=!result.full&&result.physicalCount>0?(this.scrollDimension==='rows'?{x:0,y:result.firstPhysical,width:this.columns,height:result.physicalCount,previousRevision:this.dataRevision}:{x:result.firstPhysical,y:0,width:result.physicalCount,height:this.rows,previousRevision:this.dataRevision}):undefined;
    return this.changed(true,update);
  }
  private writeSamples(index:number,values:readonly ArrayLike<number>[]){
    if(this.disposed)throw new Error('Heatmap has been disposed');
    const dimension=this.scrollDimension==='columns'?'x':'y',axis=dimension==='x'?this.axisX:this.axisY;
    return this.applyStreamUpdate(this.stream!.write(index,values,axis.getInterval(),this.start[dimension],this.step[dimension]));
  }
  setDataCleaning(value:HeatmapCleaning){
    if(!this.stream)throw new Error('Heatmap data cleaning requires a scrolling series');
    if(this.disposed)throw new Error('Heatmap has been disposed');
    const dimension=this.scrollDimension==='columns'?'x':'y',axis=dimension==='x'?this.axisX:this.axisY;
    return this.applyStreamUpdate(this.stream.configure(value,axis.getInterval(),this.start[dimension],this.step[dimension]));
  }
  getDataCleaning(){return this.stream?.getCleaning();}
  getFirstRetainedSampleIndex(){return this.stream?.first??0;}
  getRetainedSampleCount(){return this.stream?this.stream.next-this.stream.first:this.columns*this.rows;}
  getIntensityValue(sampleIndex:number,cellIndex:number){return this.stream?.getValue(sampleIndex,cellIndex);}
  setCursorEnabled(value:boolean){this.cursorEnabled=value;this.chart.invalidate();return this;}
  getCursorEnabled(){return this.cursorEnabled;}
  setCursorFormattingOverride(formatter:SeriesCursorFormatter|undefined):this{
    if(formatter!==undefined&&typeof formatter!=='function')throw new TypeError('Cursor formatter must be a function');
    this.seriesCursorFormatting=formatter;this.chart.invalidate();return this;
  }
  getCursorFormattingOverride(){return this.seriesCursorFormatting;}
  formatCursorRows(hit:any,before:any[][]):any[][]|undefined{return this.seriesCursorFormatting?this.seriesCursorFormatting(hit,before):before;}
  solveNearest(from:CoordinateClient,mode:SolveNearestMode='show-nearest'):SolveResultHeatmap|undefined{
    validateSolveMode(mode);
    // Public queries are independent of automatic cursor/visibility settings.
    // Chart-level picking applies those filters before calling this method.
    if(this.disposed||!this.columns||!this.rows||this.stream&&this.stream.next===this.stream.first)return undefined;
    const host=this.chart as any;if(typeof host.translatePoint!=='function')return undefined;
    const point=host.translatePoint(from,host.coordsClient,{x:this.axisX,y:this.axisY}),rawColumn=(point.x-this.start.x)/this.step.x,rawRow=(point.y-this.start.y)/this.step.y;
    if(!Number.isFinite(rawColumn)||!Number.isFinite(rawRow))return undefined;
    const startColumn=this.stream&&this.scrollDimension==='columns'?this.stream.first:0,startRow=this.stream&&this.scrollDimension==='rows'?this.stream.first:0;
    const endColumn=this.stream&&this.scrollDimension==='columns'?this.stream.next:this.columns,endRow=this.stream&&this.scrollDimension==='rows'?this.stream.next:this.rows;
    // Public heatmap queries clamp existing edges in every solve mode. A
    // scrolling dimension has no cell beyond its last written sample; native
    // pointed cursor coverage is checked separately by the chart.
    if(this.stream&&(this.scrollDimension==='columns'?rawColumn:rawRow)>=this.stream.next)return undefined;
    const column=Math.max(startColumn,Math.min(endColumn-1,Math.floor(rawColumn))),row=Math.max(startRow,Math.min(endRow-1,Math.floor(rawRow)));
    const intensity=this.stream?(this.scrollDimension==='columns'?this.stream.getValue(column,row):this.stream.getValue(row,column)):this.data[row*this.columns+column];
    return xyCursorHit(this,{x:this.start.x+(column+.5)*this.step.x,y:this.start.y+(row+.5)*this.step.y},from,{column,row,intensity:intensity??NaN,lut:this.palette?.lut}) as SolveResultHeatmap;
  }
  private publicBounds(dim:'x'|'y'){
    const bounds=this.bounds(dim);
    // XY fixed-grid public extrema are numeric limits. Texture coordinates,
    // scrolling endpoints and Polar's inherited getters keep their direction.
    return !bounds||this.scrolling||('polar' in this&&this.polar===true)?bounds:{start:Math.min(bounds.start,bounds.end),end:Math.max(bounds.start,bounds.end)};
  }
  getXMin(){return this.publicBounds('x')?.start??this.start.x;}
  getXMax(){return this.publicBounds('x')?.end??this.start.x;}
  getYMin(){return this.publicBounds('y')?.start??this.start.y;}
  getYMax(){return this.publicBounds('y')?.end??this.start.y;}
  getScrollOffset() {
    const shift=this.stream?.offset??0;
    return {
      x: this.scrollDimension === "columns" ? shift : 0,
      y: this.scrollDimension === "rows" ? shift : 0,
    };
  }
  orderedData() {
    if (!this.scrolling) return this.data;
    const out = new Float32Array(this.data.length);
    const shift=this.stream?.offset??0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.columns; c++) {
        const sr =
            this.scrollDimension === "rows" ? (r + shift) % this.rows : r,
          sc =
            this.scrollDimension === "columns" ? (c + shift) % this.columns : c;
        out[r * this.columns + c] = this.data[sr * this.columns + sc]!;
      }
    return out;
  }
  getSampleCount() {
    return this.scrolling ? this.sampleCount : this.data.length;
  }
  setStart(value: any) {
    this.start = value === undefined ? { x: 0, y: 0 } : { ...this.start, ...value };
    this.resolveGridStep();
    return this.changed();
  }
  getStart() { return { ...this.start }; }
  setStep(value: any) {
    this.configuredStep = value === undefined ? { x: 1, y: 1 } : { ...this.configuredStep, ...value };
    this.resolveGridStep();
    return this.changed();
  }
  getStep() { return { ...this.step }; }
  setEnd(value: { x: number; y: number } | undefined) {
    this.explicitGridEnd = value === undefined ? undefined : { ...value };
    this.resolveGridStep();
    return this.changed();
  }
  getEnd() {
    return this.explicitGridEnd ? { ...this.explicitGridEnd } : {
      x: this.start.x + this.columns * this.step.x,
      y: this.start.y + this.rows * this.step.y,
    };
  }
  private resolveGridStep() {
    // An explicit end fixes the grid extent; the requested step is retained for
    // when that end is reset. No source data or texture allocation is changed.
    this.step = this.explicitGridEnd ? {
      x: (this.explicitGridEnd.x - this.start.x) / this.columns,
      y: (this.explicitGridEnd.y - this.start.y) / this.rows,
    } : { ...this.configuredStep };
  }
  setFillStyle(value: any) {
    this.palette = mutate(this.palette, value);
    this.paletteRevision++;
    return this.changed();
  }
  getFillStyle() {
    return this.palette;
  }
  setIntensityRange(value: any) {
    this.intensityRange = { ...value };
    this.paletteRevision++;
    return this.changed();
  }
  setIntensityInterpolation(value: "disabled" | "bilinear" | undefined) {
    if (value !== undefined && value !== "disabled" && value !== "bilinear")
      throw new TypeError("Heatmap interpolation must be disabled or bilinear");
    this.intensityInterpolation = value ?? "disabled";
    return this.changed();
  }
  getIntensityInterpolation() {
    return this.intensityInterpolation;
  }
  setPixelInterpolationMode(value: "disabled" | "bilinear" | undefined) {
    return this.setIntensityInterpolation(value);
  }
  getPixelInterpolationMode() {
    return this.getIntensityInterpolation();
  }
  setName(value: string) {
    this.name = value;
    return this;
  }
  getName() {
    return this.name;
  }
  setWireframeStyle(value: any) {
    this.wireframe = mutate(this.wireframe, value);
    return this.changed();
  }
  getWireframeStyle() {
    return this.wireframe;
  }
  setVisible(value: boolean) {
    this.visible = value;
    return this.changed();
  }
  getVisible() {
    return this.visible;
  }
  setMouseInteractions(_value: boolean) {
    return this;
  }
  setEffect(value: any) {
    if (value !== false) throw new Error("Heatmap effects are not implemented");
    return this;
  }
  protected getClearIntensityValue() { return 0; }
  clear() {
    if(this.disposed)throw new Error('Heatmap has been disposed');
    // A fixed grid keeps its geometry and resets the existing cells to zero.
    // A scrolling grid has no retained samples after clear; explicit NaN input
    // remains a missing cell in either series type.
    if(!this.stream)this.data.fill(this.getClearIntensityValue());
    this.sampleCount = 0;
    this.stream?.clear();
    return this.changed(true);
  }
  bounds(dim: "x" | "y" | "z") {
    if (dim === "z") return undefined;
    const size = dim === "x" ? this.columns : this.rows;
    const along=!!this.stream&&(dim==='x')===(this.scrollDimension==='columns');
    if(along&&this.stream!.next===this.stream!.first)return undefined;
    const scroll=along?this.stream!.first:0,count=along?this.stream!.next-this.stream!.first:size;
    return {
      start: this.start[dim] + scroll * this.step[dim],
      end: this.start[dim] + (scroll + count) * this.step[dim],
    };
  }
  /** Allocated grid extent includes unused NaN cells; data bounds do not. */
  textureBounds(dim:'x'|'y'){
    const size=dim==='x'?this.columns:this.rows,scroll=this.stream&&(dim==='x')===(this.scrollDimension==='columns')?this.stream.first:0;
    return{start:this.start[dim]+scroll*this.step[dim],end:this.start[dim]+(scroll+size)*this.step[dim]};
  }
  dispose() {
    if(this.disposed)return this;
    this.disposed = true;
    this.seriesCursorFormatting=undefined;
    this.stream?.dispose();this.data=new Float32Array(0);this.dataUpdate=undefined;
    this.chart.removeSeries(this);
    return this;
  }
  isDisposed() {
    return this.disposed;
  }
}
export type LineSeries = PointLineAreaSeries;
export type PointSeries = PointLineAreaSeries;
export type PointLineSeries = PointLineAreaSeries;
export type AreaSeries = PointLineAreaSeries;
export type PointLineAreaSeries3D = PointLineAreaSeries;
