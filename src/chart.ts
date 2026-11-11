import {getColumnOrder} from './data-order.js';
import {CssTextFonts} from './css-text-fonts.js';
import {pointStrokeRadius} from './point-stroke-geometry.js';
import { Axis, PolarAxisRadial, mutate } from "./axis.js";
import {
  PointLineAreaSeries,
  SplineSeries,
  HeatmapSeries,
  fillColor,
  type SeriesOptions,
} from "./series.js";
import {
  ColorRGBA,
  SolidFill,
  SolidLine,
  FontSettings,
  Themes,
  emptyFill,
  emptyLine,
  type LineStyle,
  type ValueOrMutator,
} from "./core/styles.js";
import { EventHub } from "./core/events.js";
import { DataRenderer } from "./render.js";
import {rasterTargetForRect, type GpuClipPolicy} from './raster-clip.js';
import { DataRenderer3D, cameraVolumeScale, projectNormalized3D, worldStylePixels3D, type DrawPacket3D } from "./render3d.js";
import {
  DataRendererHeatmap,
  buildHeatmapPalette,
  sampleHeatmapIntensity,
  type DrawPacketHeatmap,
} from "./render-heatmap.js";
import { UIElement, Cursor, LegendBox } from "./ui.js";
import {NativeLegend,type LegendOptions} from './native-legend.js';
import {IconRegistry,type ImageFillSource,type IconProperties} from './custom-icon.js';
import {validateSolveMode,xyCursorHit,defaultXYCursorRows,type SolveNearestMode,type CoordinateClient,type CursorTargetChangedEvent} from './cursor-api.js';
import {PolarSeries,PolarLineSeries,PolarPointSeries,PolarPointLineSeries,type PolarSolveMode,type PolarSolveResult} from './polar-series.js';
import {highlightColor as componentHighlightColor} from './component-highlight.js';
import {
  GeometrySeries,
  RectangleSeries,
  PolygonSeries,
  SegmentSeries,
  RangeSeries,
  OHLCSeries,
  BoxSeries,
} from "./geometry.js";
import {UnsupportedFeatureError,type DrawPacket,type Interval,type Rect} from "./contracts.js";
import { LinearGradientFill, canvasGradient } from "./gradients.js";
import {colorMappedLine3D} from './line-palette-3d.js';
import {PolarHeatmapSeries,type PolarHeatmapOptions,type PolarHeatmapSolveResult} from './polar-heatmap.js';
import {Series3DBase,SurfaceGrid3D,SurfaceMesh3D,MeshModel3D,BoxSeries3D} from './mesh3d.js';
import {layoutAxisStacks,parallelAxisCount} from './axis-layout.js';
import {drawAxisCanvas,measureAxisCanvasLayout,measureChartTitleContent,axisCanvasLaneOffset,resolvedTickFill,type AxisCanvasLayout} from './axis-canvas.js';
import {layoutAxis3DTicks,type Axis3DTickRequest} from './axis3d-label-layout.js';
import {computePolarLayout,polarPosition,polarInverseNormalized,type PolarLayout,type PolarInsets} from './polar-layout.js';
import {PublicEventAdapter,getChartAxes,getChartSizePixels,type AxisPosition,type PublicEventListener,type ChartEventListenerOptions} from './chart-events.js';
import {beginAnnotationDrag,updateAnnotationDrag,finishAnnotationDrag,updateAnnotationHover,type AnnotationDrag} from './annotation-interaction.js';
import {resolveInteractionPolicy,getDragInteraction,getWheelInteraction,getDoubleClickInteraction,wheelAnchorFraction,axisAcceptsChartInteraction,type InteractionDecisionBase,type ChartInteractionKind} from './interaction-policy.js';

import {WorldZoomInput,WorldZoomInstantInput,type WorldZoomStep} from './zoom-clock.js';
import {DEFAULT_WORLD_ORBIT,createWorldCameraFrame,clampManualCamera3D,worldScale3D,normalizedToWorld3D,worldToNormalized3D,projectWorldNormalized3D,clipWorldSegment3D,orbitWorldCamera3D,zoomWorldCameraStep3D,type WorldCameraFrame,type Projection3D,type Vec3} from './world-camera.js';
import {createWorldAxisConversion,worldAxisValueToFraction,worldAxisFractionToValue,type WorldAxisConversion} from './world-axis.js';

export interface ChartOptions {
  /** Artifact research switch; this candidate defaults to the world camera. */
  experimental3DCameraModel?:'world'|'legacy';
  container?: HTMLElement | string;
  antialias?: boolean;
  renderer?: 'auto'|'webgl2'|'canvas2d';
  /** Explicit diagnostic opt-in. Pixel and paired-performance validation is ongoing. */
  experimentalLineBlocks?:boolean;
  /** Display-only extrema candidate; disabled unless an explicit pixel span is supplied. */
  experimentalLineDisplayPixels?:number;
  /** Explicit page-packet experiment. Requires display pixels and coverage union. */
  experimentalLineDisplayPackets?:boolean;
  /** Explicit conservative stroke-coverage candidate; disabled by default. */
  experimentalLineCoverage?:boolean;
  /** Explicit ownership: pure coverage frames establish the private GL baseline. */
  experimentalOwnedCoverageFrame?:boolean;
  /** Explicit WebGL2 data clipping candidate; Canvas/3D/UI are not affected. */
  experimentalGpuClipPolicy?:'contained';
  theme?: any;
  legend?: LegendOptions;
  defaultAxisX?: any;
  defaultAxisY?: any;
  defaultAxisZ?: any;
  [key: string]: any;
}
export const AutoCursorModes = Object.freeze({
  disabled: 0,
  snapToClosest: 1,
  onHover: 2,
});
export interface ChartPadding {left:number;right:number;top:number;bottom:number;}
export interface AxisXYLayoutInfo {left:number;right:number;bottom:number;top:number;width:number;height:number;}
export interface ChartXYLayoutInfo {
  viewportWidth:number;viewportHeight:number;chartWidth:number;chartHeight:number;
  margins:{left:number;right:number;bottom:number;top:number};
  axes:Map<Axis,AxisXYLayoutInfo>;
}
export interface ChartXYLayoutChangedEvent extends ChartXYLayoutInfo {userChangedLayout:()=>void;}

export class ChartXY {
  readonly events = new EventHub();
  private readonly publicEvents=new PublicEventAdapter(this.events,{kind:'chart',getSize:()=>({width:this.width,height:this.height})});
  readonly axesX: Axis[] = [];
  readonly axesY: Axis[] = [];
  readonly axesZ: Axis[] = [];
  readonly ui: any[] = [];
  readonly series: any[] = [];
  readonly container?: HTMLElement;
  readonly root?: HTMLDivElement;
  readonly canvas?: HTMLCanvasElement;
  readonly underlay?: HTMLCanvasElement;
  readonly overlay?: HTMLCanvasElement;
  readonly renderer?: DataRenderer;
  readonly engine: any;
  readonly legend: NativeLegend;
  private readonly customIcons=new IconRegistry(()=>this.invalidate());
  private readonly experimentalLineBlocks:boolean;
  private readonly experimentalLineDisplayPixels?:number;
  private readonly experimentalLineDisplayPackets:boolean;
  private readonly gpuClipPolicy:GpuClipPolicy;
  readonly coordsAxis: any;
  readonly coordsRelative: any = { kind: "relative" };
  private readonly coordsPlotPercentage = {kind:'plot-percentage'};
  readonly coordsPixel: any = { kind: "pixel" };
  readonly coordsClient: any = { kind: "client" };
  title = "";
  private titlePosition:'left-top'|'center-top'|'right-top'='center-top';
  private titleMargin={left:0,right:0,top:0,bottom:0};
  private titleMarginRequest:Partial<ChartPadding>={};
  titleFont = new FontSettings({ size: 18, family:'Segoe UI, -apple-system, Verdana, Helvetica' });
  titleFill: any;
  theme: any;
  background: any;
  plotBackground: any;
  disposed = false;
  visible = true;
  width = 800;
  height = 500;
  dpr = 1;
  plot: Rect = { left: 64, top: 54, width: 710, height: 392 };
  padding: ChartPadding = {left:7,right:7,top:7,bottom:7};
  private axisCanvasLayout?:AxisCanvasLayout;
  private cssTextFonts?:CssTextFonts;
  readonly resolveTextFont=(font:FontSettings):FontSettings=>this.cssTextFonts?.resolve(font)??font;
  private customTickPlacementLengths?:Map<Axis,number>;
  private placementTitleMeasure?:{text:string;font:FontSettings;dpr:number;height:number};
  private frame = 0;
  private readonly scrollingAxes=new Set<Axis>();
  private rendering = false;
  private notifyingLayout = false;
  private lastPublicLayout?:ChartXYLayoutInfo;
  private observer?: ResizeObserver;
  private overlayContext?: CanvasRenderingContext2D | null;
  private underlayContext?: CanvasRenderingContext2D | null;
  private heatmapRenderer?: DataRendererHeatmap;
  private heatmapPalettes = new Map<
    number,
    { style: any; min: number; max: number; bytes: Uint8Array; stops?:Float32Array }
  >();
  private heatCache = new Map<
    number,
    { revision: number; canvas: HTMLCanvasElement; samplingKey?: string }
  >();
  private cleanups: (() => void)[] = [];
  protected cursor: Cursor;
  private autoCursorMode: number = AutoCursorModes.snapToClosest;
  private nativeCursorMode:SolveNearestMode|undefined='show-all';
  private structuredCursor=true;
  private cursorFormatting?:((chart:any,hit:any,hits:any[])=>any[][]|undefined);
  protected customCursor?:((event:CursorTargetChangedEvent<any>)=>unknown);
  private customCursorAnnotationHold=false;
  private lastCursorClient?:CoordinateClient;
  private lastEmptyCursorClient?:CoordinateClient;
  protected pointer?: { x: number; y: number };
  private annotationDrag?:AnnotationDrag;
  protected drag?: {
    x: number;
    y: number;
    mode: "zoom" | "pan" | "rotate";
    stopScroll?: boolean;
    sensitivity?: number;
    intervals: { axis: Axis; interval: Interval }[];
  };
  protected interaction: any = {};
  protected kind = "xy";
  /** Internal Axis host capability; Polar and 3D keep their existing policies. */
  supportsAxisIntervalMaxRestrictions(){return this.kind==='xy';}
  getAxisInitialInterval(axis:Axis):Interval|undefined{
    // XY's empty numeric axes start at 0..10. Derived chart coordinate systems
    // keep their own initialization even while their base constructor runs.
    return axis.type==='linear'&&!(this instanceof Polar)&&!(this instanceof Chart3D)?{start:0,end:10}:undefined;
  }
  getAxisDefaultFitMargins(_axis:Axis):{start:number;end:number}|undefined{
    return this.kind==='xy'?{start:0,end:0}:undefined;
  }
  protected polarAngleOrigin = 0;
  protected polarClockwise = false;
  protected polarAngle(degrees: number) {
    return (
      ((this.polarAngleOrigin + (this.polarClockwise ? -degrees : degrees)) *
        Math.PI) /
      180
    );
  }
  protected camera = { azimuth: -0.65, elevation: 0.48, zoom: 1 };
  protected surfaceSeries: SurfaceGridSeries[] = [];
  protected createDefaultAxisX(options:any){return new Axis(this,'x',options);}
  constructor(options: ChartOptions = {}) {
    if(options.experimentalGpuClipPolicy!==undefined&&options.experimentalGpuClipPolicy!=='contained')throw new TypeError('Experimental GPU clip policy must be contained');
    this.gpuClipPolicy=options.experimentalGpuClipPolicy??'legacy';
    this.experimentalLineBlocks=options.experimentalLineBlocks===true;
    if(options.experimentalLineDisplayPixels!==undefined&&(!Number.isFinite(options.experimentalLineDisplayPixels)||options.experimentalLineDisplayPixels<=0||options.experimentalLineDisplayPixels>4))throw new RangeError('Experimental line display span must be greater than zero and at most four physical pixels');
    this.experimentalLineDisplayPixels=options.experimentalLineDisplayPixels;
    this.experimentalLineDisplayPackets=options.experimentalLineDisplayPackets===true;
    if(this.experimentalLineDisplayPackets&&(this.experimentalLineDisplayPixels===undefined||options.experimentalLineCoverage!==true))throw new TypeError('Experimental display page packets require a display pixel span and line coverage union');
    if(typeof options.animationsEnabled==='boolean'){this.explicitAnimationsEnabled=options.animationsEnabled;this.animationsEnabled=options.animationsEnabled;}
    this.theme = options.theme ?? Themes.darkGold;
    if(!(this instanceof Polar)&&!(this instanceof Chart3D))this.title='ChartXY';
    this.titleFont = this.theme.chartXYTitleFont ?? this.theme.chartTitleFont ?? this.titleFont;
    this.legend = new NativeLegend(this,options.legend);
    this.background =
      this.theme.chartXYBackgroundFillStyle ??
      this.theme.chartBackgroundFillStyle ??
      this.theme.backgroundFillStyle ??
      new SolidFill({ color: ColorRGBA(17, 23, 37) });
    this.plotBackground =
      this.theme.chartXYSeriesBackgroundFillStyle ?? emptyFill;
    this.titleFill =
      this.theme.chartXYTitleFillStyle ?? this.theme.chartTitleFillStyle ??
      new SolidFill({ color: ColorRGBA(222, 232, 242) });
    this.axesX.push(this.createDefaultAxisX(options.defaultAxisX));
    this.axesY.push(new Axis(this, "y", options.defaultAxisY));
    this.coordsAxis = { x: this.axesX[0], y: this.axesY[0] };
    this.cursor = new Cursor(this,true);
    if (typeof document !== "undefined") {
      const container =
        typeof options.container === "string"
          ? document.getElementById(options.container)
          : (options.container ?? document.body);
      if (!container) throw new Error("CRYChart container was not found");
      this.container = container;
      const root = document.createElement("div");
      root.className = "crychart";
      root.style.cssText =
        "position:relative;width:100%;height:100%;min-height:100px;overflow:hidden;touch-action:none;outline:none";
      root.tabIndex = 0;
      root.setAttribute("role", "img");
      root.setAttribute("aria-label", this.title||"Interactive chart");
      this.root = root;
      container.append(root);
      if(options.textRenderer?.kind==='html'){
        this.cssTextFonts=new CssTextFonts(root,()=>this.invalidate());
        this.cleanups.push(()=>this.cssTextFonts?.dispose());
      }
      const underlay = document.createElement("canvas"),
        data = document.createElement("canvas"),
        overlay = document.createElement("canvas");
      for (const canvas of [underlay, data, overlay]) {
        canvas.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%";
        root.append(canvas);
      }
      this.canvas = data;
      this.underlay = underlay;
      this.overlay = overlay;
      try {
        this.renderer = new DataRenderer(data, { antialias: options.antialias,renderer:options.renderer,lineCoverageUnion:options.experimentalLineCoverage===true,ownedCoverageFrame:options.experimentalOwnedCoverageFrame===true,gpuClipPolicy:this.gpuClipPolicy });
      } catch (error) {
        this.cssTextFonts?.dispose();
        root.remove();
        throw error;
      }
      try {
        this.overlayContext = overlay.getContext("2d");
        this.underlayContext = underlay.getContext("2d");
      } catch {}
      this.resize();
      this.attachInteractions();
      if (typeof ResizeObserver !== "undefined") {
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(container);
      }
    }
    this.engine = {
      container: this.root ?? this.container,
      canvas: this.canvas,
      dispose: () => this.dispose(),
      getContainer: () => this.container,
      addCustomIcon: (source:ImageFillSource,opts:Partial<IconProperties>={})=>this.customIcons.add(source,opts),
      captureFrame: (type = "image/png") => this.captureFrame(type),
      getBackgroundFillStyle: () => this.getBackgroundFillStyle(),
      setBackgroundFillStyle: (value:any) => {this.setBackgroundFillStyle(value);return this.engine;},
      getRenderStats: () => this.getRenderStats(),
    };
    this.invalidate();
  }
  getDefaultAxisX() {
    return this.axesX[0]!;
  }
  get axisX(){return this.getDefaultAxisX();}
  get axisY(){return this.getDefaultAxisY();}
  protected rotate3DCamera(dx:number,dy:number,_event?:PointerEvent):void{this.camera.azimuth+=dx*.008;this.camera.elevation=Math.max(-1.4,Math.min(1.4,this.camera.elevation+dy*.008));}
  protected zoom3DCamera(delta:number,_event?:WheelEvent):boolean|void{this.camera.zoom=Math.max(.25,Math.min(4,this.camera.zoom*Math.exp(-delta*.001)));}
  getSizePixels(){return getChartSizePixels(this);}
  getAxes(...positions:AxisPosition[]){return getChartAxes(this,...positions);}
  addEventListener(type:string,listener:PublicEventListener,options?:ChartEventListenerOptions){this.publicEvents.addEventListener(type,listener,options);}
  removeEventListener(type:string,listener:PublicEventListener){this.publicEvents.removeEventListener(type,listener);}
  getDefaultAxisY() {
    return this.axesY[0]!;
  }
  getDefaultAxisZ() {
    return this.axesZ[0];
  }
  addAxisX(options: any = {}) {
    if(options.iParallel===undefined&&options.iStack===undefined)options={...options,iParallel:Math.max(-1,...this.axesX.filter(axis=>!axis.disposed&&axis.opposite===!!options.opposite).map(axis=>axis.iParallel))+1};
    const a = new Axis(this, "x", options);
    this.axesX.push(a);
    this.invalidate();
    return a;
  }
  addAxisY(options: any = {}) {
    if(options.iParallel===undefined&&options.iStack===undefined)options={...options,iParallel:Math.max(-1,...this.axesY.filter(axis=>!axis.disposed&&axis.opposite===!!options.opposite).map(axis=>axis.iParallel))+1};
    const a = new Axis(this, "y", options);
    this.axesY.push(a);
    this.invalidate();
    return a;
  }
  protected addSeries(options: SeriesOptions = {}, kind = "line") {
    const s = new PointLineAreaSeries(
      this,
      {
        ...options,
        axisX: options.axisX ?? options.xAxis,
        axisY: options.axisY ?? options.yAxis,
        axisZ: options.axisZ ?? options.zAxis,
      },
      kind,
    );
    if(this.kind==='xy'){
      const index=options.automaticColorIndex??this.series.length;
      if(kind==='points'){
        const fill=this.theme.pointSeriesFillStyle,stroke=this.theme.pointSeriesStrokeStyle;
        if(fill!==undefined)s.setPointFillStyle(typeof fill==='function'?fill(index):fill);
        if(stroke!==undefined)s.setPointStrokeStyle(typeof stroke==='function'?stroke(index):stroke);
        s.setPointSize(7).setStrokeStyle(emptyLine);
      }else{
        const stroke=this.theme.lineSeriesStrokeStyle;
        if(stroke!==undefined)s.setStrokeStyle(typeof stroke==='function'?stroke(index):stroke);
      }
    }else if(this.kind==='3d'&&(kind==='line'||kind==='points')){
      const index=options.automaticColorIndex??this.series.length;
      if(kind==='points'){
        const style=this.theme.pointSeries3DPointStyle;
        if(style!==undefined)s.setPointStyle(typeof style==='function'?style(index):style);
      }else{
        const stroke=this.theme.lineSeries3DStrokeStyle;
        if(stroke!==undefined)s.setStrokeStyle(typeof stroke==='function'?stroke(index):stroke);
      }
    }
    this.series.push(s);
    this.initializeSeriesAnimation(s);this.legend.registerSeries(s,options.legend);
    this.invalidate();
    return s;
  }
  addLineSeries(options: SeriesOptions = {}) {
    return this.addSeries(options);
  }
  addSplineSeries(options: SeriesOptions = {}) {
    const series = new SplineSeries(this, options, "line");
    if (this.kind === "xy") {
      // 公开主题的样条点默认：使用本图表入列前的活跃系列索引。
      const pointFill = this.theme.pointSeriesFillStyle, pointStroke = this.theme.pointSeriesStrokeStyle;
      const index=options.automaticColorIndex??this.series.length,lineStroke=this.theme.lineSeriesStrokeStyle;
      if(lineStroke!==undefined)series.setStrokeStyle(typeof lineStroke==='function'?lineStroke(index):lineStroke);
      if (pointFill !== undefined) {
        series.setPointFillStyle(typeof pointFill === "function" ? pointFill(index) : pointFill);
        series.setPointSize(7);
      }
      if (pointStroke !== undefined) series.setPointStrokeStyle(typeof pointStroke === "function" ? pointStroke(index) : pointStroke);
    }
    this.series.push(series);
    this.initializeSeriesAnimation(series);this.legend.registerSeries(series,options.legend);
    this.invalidate();
    return series;
  }
  addPointLineAreaSeries(options: SeriesOptions = {}) {
    return this.addSeries(options);
  }
  addPointSeries(options: SeriesOptions = {}) {
    return this.addSeries(options, "points");
  }
  addPointLineSeries(options: SeriesOptions = {}) {
    return this.addSeries(options)
      .setPointSize(4)
      .setPointFillStyle(new SolidFill({ color: ColorRGBA(62, 204, 195) }));
  }
  addAreaSeries(options: SeriesOptions = {}) {
    return this.addSeries(options, "area").setAreaFillStyle(
      new SolidFill({ color: ColorRGBA(62, 204, 195, 70) }),
    );
  }
  protected initializeHeatmapFillStyle<T extends HeatmapSeries>(series: T, field: "heatmapGridSeriesFillStyle" | "heatmapScrollingGridSeriesFillStyle" | "polarHeatmapSeriesFillStyle"): T {
    const value = this.theme[field];
    // 在入列前使用本图表的活跃 series 数量；公开回调观测包含 Line 前置与销毁后新增。
    if (value !== undefined) series.setFillStyle(typeof value === "function" ? value(this.series.length) : value);
    return series;
  }
  protected initializeHeatmapWireframeStyle<T extends HeatmapSeries>(series: T, field: "heatmapGridSeriesWireframeStyle" | "heatmapScrollingGridSeriesWireframeStyle"): T {
    const value = this.theme[field];
    if (value !== undefined) series.setWireframeStyle(typeof value === "function" ? value(this.series.length) : value);
    return series;
  }
  addHeatmapGridSeries(options: any = {}) {
    const s = this.initializeHeatmapWireframeStyle(this.initializeHeatmapFillStyle(new HeatmapSeries(this, options), "heatmapGridSeriesFillStyle"), "heatmapGridSeriesWireframeStyle");
    this.series.push(s);
    this.initializeSeriesAnimation(s);this.legend.registerSeries(s,options.legend);
    this.invalidate();
    return s;
  }
  addHeatmapScrollingGridSeries(options: any = {}) {
    const s = this.initializeHeatmapWireframeStyle(this.initializeHeatmapFillStyle(new HeatmapSeries(this, options, true), "heatmapScrollingGridSeriesFillStyle"), "heatmapScrollingGridSeriesWireframeStyle");
    this.series.push(s);
    this.initializeSeriesAnimation(s);this.legend.registerSeries(s,options.legend);
    this.invalidate();
    return s;
  }
  addSurfaceGridSeries(options: any = {}):any {
    const s = new SurfaceGridSeries(this, options);
    this.surfaceSeries.push(s);
    this.series.push(s);
    this.initializeSeriesAnimation(s);this.legend.registerSeries(s,options.legend);
    this.invalidate();
    return s;
  }
  private geometry<T extends GeometrySeries>(
    Ctor: new (host: any, options: any) => T,
    options: any = {},
  ) {
    const s = new Ctor(this, options);
    this.series.push(s);
    this.initializeSeriesAnimation(s);this.legend.registerSeries(s,options.legend);
    this.invalidate();
    return s;
  }
  addRectangleSeries(options: any = {}) {
    return this.geometry(RectangleSeries, options);
  }
  addPolygonSeries(options: any = {}) {
    return this.geometry(PolygonSeries, options);
  }
  addSegmentSeries(options: any = {}) {
    return this.geometry(SegmentSeries, options);
  }
  addAreaRangeSeries(options: any = {}) {
    return this.geometry(RangeSeries, options);
  }
  addRangeSeries(options: any = {}) {
    return this.geometry(RangeSeries, options);
  }
  addOHLCSeries(options: any = {}) {
    return this.geometry(OHLCSeries, options);
  }
  addBoxSeries(options: any = {}):any {
    return this.geometry(BoxSeries, options);
  }
  getSeries() {
    return this.series.filter((s) => !s.disposed);
  }
  removeSeries(series: any) {
    try {this.legend.removeSeries(series);} finally {
      const i = this.series.indexOf(series);
      if (i >= 0) this.series.splice(i, 1);
      const j = this.surfaceSeries.indexOf(series);
      if (j >= 0) this.surfaceSeries.splice(j, 1);
      this.heatCache.delete(series.id);
      this.heatmapPalettes.delete(series.id);
      this.invalidate();
    }
  }
  setTitle(value: string) {
    this.title = value;
    this.root?.setAttribute("aria-label", value || "Interactive chart");
    this.invalidate();
    return this;
  }
  getTitle() {
    return this.title;
  }
  setTitlePosition(position:'left-top'|'center-top'|'right-top'){
    if(this.kind!=='xy'||!['left-top','center-top','right-top'].includes(position))throw new TypeError('CRYChart does not yet implement this chart title position');
    this.titlePosition=position;this.invalidate();return this;
  }
  getTitlePosition(){
    if(this.kind!=='xy')throw new TypeError('CRYChart does not yet implement title positions for this chart type');
    return this.titlePosition;
  }
  setTitleMargin(value:number|{left?:number;right?:number;top?:number;bottom?:number}){
    const margin=typeof value==='number'?{left:value,right:value,top:value,bottom:value}:{left:value.left??0,right:value.right??0,top:value.top??0,bottom:value.bottom??0};
    if(Object.values(margin).some(item=>!Number.isFinite(item)))throw new RangeError('Title margins must be finite');
    this.titleMarginRequest=typeof value==='number'?{...margin}:{left:value.left,right:value.right,top:value.top,bottom:value.bottom};
    this.titleMargin=margin;this.invalidate();return this;
  }
  getTitleMargin(){return{...this.titleMarginRequest};}
  getAxisCustomTickPlacementPixelLength(axis:Axis){return this.kind==='xy'?this.customTickPlacementLengths?.get(axis):undefined;}
  private prepareCustomTickPlacementLengths(axesX:readonly Axis[],axesY:readonly Axis[]){
    if(this.kind!=='xy'||![...axesX,...axesY].some(axis=>{const strategy=axis.tickStrategy;return strategy.customMajor||strategy.customMinor;})){
      this.customTickPlacementLengths=undefined;return;
    }
    let titleHeight=0;
    if(this.hasVisibleChartTitle()){
      const cached=this.placementTitleMeasure,font=this.resolveTextFont(this.titleFont);
      if(!cached||cached.text!==this.title||cached.font!==font||cached.dpr!==this.dpr)this.placementTitleMeasure={text:this.title,font,dpr:this.dpr,height:measureChartTitleContent(this.overlayContext??undefined,this.title,font,this.dpr)};
      titleHeight=this.placementTitleMeasure!.height+(this.titleMarginRequest.top??0)+(this.titleMarginRequest.bottom??5);
    }
    const width=Math.max(1,this.width-this.padding.left-this.padding.right),height=Math.max(1,this.height-this.padding.top-this.padding.bottom-titleHeight),lengths=new Map<Axis,number>();
    const used=new Set<Axis>();for(const series of this.series)if(!series.disposed){if(series.axisX)used.add(series.axisX);if(series.axisY)used.add(series.axisY);}
    for(const[axes,length]of[[this.axesX,width],[this.axesY,height]] as const){
      const participants=axes.filter(axis=>!axis.disposed&&(axis.visible||used.has(axis)));
      for(const[axis,{range}]of layoutAxisStacks(participants,length))lengths.set(axis,length*Math.abs(range.end-range.start));
    }
    this.customTickPlacementLengths=lengths;
  }
  /** Marker/stroke extent used by the explicit pixel-based axis scroll margins. */
  getAxisAutoScrollMargins(axis:Axis){
    let extent=0;
    for(const series of this.series){
      if(series.disposed||!series.visible||(series.axisX!==axis&&series.axisY!==axis&&series.axisZ!==axis))continue;
      extent=Math.max(extent,(series.getPointSize?.()??0)/2,(series.getStrokeStyle?.()?.getThickness?.()??0)/2);
    }
    return{start:extent,end:extent};
  }
  /** Internal XY default for omitted fit stop policy; no source data scan. */
  getAxisDefaultFitStop(axis:Axis):boolean|undefined{
    if(this.kind!=='xy'||(!this.axesX.includes(axis)&&!this.axesY.includes(axis)))return undefined;
    let progressive=false,generic=false;
    for(const series of this.series){
      if(series.disposed||series[axis.direction==='x'?'axisX':'axisY']!==axis)continue;
      const mapping=series.getDataMapping?.(),data=series.getDataSet?.();
      const key=mapping?.[axis.direction],pattern=key===undefined?undefined:data?.schema?.[key]?.pattern;
      if(pattern==='progressive')progressive=true;
      else if(pattern==null)generic=true;
      else return undefined;
      // Mixed patterns were not isolated by the finite native observations.
      if(progressive&&generic)return undefined;
    }
    // Includes no bound series, missing schema and empty generic series.
    return !progressive;
  }
  /** Internal default XY fit footprint; explicit margin policy stays in Axis. */
  getAxisDefaultGeometryMargins(axis:Axis):{start:number;end:number}|undefined{
    if(this.kind!=='xy'||axis.type!=='linear')return undefined;
    let extent=0;
    for(const series of this.series){
      if(!(series instanceof PointLineAreaSeries)||series.disposed||!series.visible||series.axisZ||
        (series.axisX!==axis&&series.axisY!==axis)||series.getSampleCount()===0)continue;
      // A constant-size footprint cannot stand in for unknown per-point sizes.
      if(series.getIndividualPointSizeEnabled())return undefined;
      const stroke=series.getStrokeStyle(),lineWidth=stroke.getThickness();
      if(series.kind!=='points'&&lineWidth>0&&fillColor(stroke.getFillStyle(),ColorRGBA(0,0,0,0)).a>0)
        extent=Math.max(extent,lineWidth/2);
      const size=series.getPointSize(),outline=series.getPointStrokeStyle(),outlineWidth=outline.getThickness();
      const visibleOutline=outlineWidth>0&&fillColor(outline.getFillStyle(),ColorRGBA(0,0,0,0)).a>0;
      const visibleFill=fillColor(series.getPointFillStyle(),ColorRGBA(0,0,0,0)).a>0||series.getIndividualPointColorEnabled();
      if(size>0&&(visibleFill||visibleOutline))extent=Math.max(extent,size/2+(visibleOutline?outlineWidth/2:0));
    }
    return{start:extent,end:extent};
  }
  setTitleFont(value: any) {
    this.titleFont = mutate(this.titleFont, value);
    this.invalidate();
    return this;
  }
  getTitleFont() {
    return this.titleFont;
  }
  setTitleFillStyle(value: any) {
    this.titleFill = mutate(this.titleFill, value);
    this.invalidate();
    return this;
  }
  getTitleFillStyle(){return this.titleFill;}
  setBackgroundFillStyle(value: any) {
    this.background = mutate(this.background, value);
    this.invalidate();
    return this;
  }
  getBackgroundFillStyle() {
    return this.background;
  }
  setSeriesBackgroundFillStyle(value: any) {
    this.plotBackground = mutate(this.plotBackground, value);
    this.invalidate();
    return this;
  }
  getSeriesBackgroundFillStyle() { return this.plotBackground; }
  setPadding(value: number | Partial<ChartPadding>) {
    if(typeof value!=='number'&&(typeof value!=='object'||value===null||Array.isArray(value)))
      throw new TypeError('Chart padding must be a number or an object of pixel distances');
    const next={...this.padding};
    for(const side of ['left','right','top','bottom'] as const){
      const supplied=typeof value==='number'?value:value[side];
      if(supplied===undefined)continue;
      if(!Number.isFinite(supplied))throw new RangeError('Chart padding must contain finite pixel distances');
      next[side]=supplied;
    }
    this.padding=next;
    this.invalidate();
    return this;
  }
  getPadding():ChartPadding {return {...this.padding};}
  setVisible(value: boolean) {
    this.visible = value;
    if (this.root) this.root.hidden = !value;
    if(!value)this.cancelAxisScrollAnimations();
    if(!value)for(const series of this.series)series.suspendHighlightAnimation?.();
    this.invalidate();
    return this;
  }
  getVisible() {
    return this.visible;
  }
  setCursor(value: any) {
    this.cursor = mutate(this.cursor, value) ?? this.cursor;
    this.invalidate();
    return this;
  }
  getCursor() {
    return this.cursor;
  }
  setAutoCursor(value: any) {
    return this.setCursor(value);
  }
  getAutoCursor() {
    return this.cursor;
  }
  setAutoCursorMode(mode: number | string) {
    const normalized =
      typeof mode === "string"
        ? AutoCursorModes[mode as keyof typeof AutoCursorModes]
        : mode;
    if (normalized !== 0 && normalized !== 1 && normalized !== 2)
      throw new RangeError("Unknown automatic cursor mode");
    this.autoCursorMode = normalized;
    this.structuredCursor=false;
    if (normalized === 0) this.cursor.positioned = false;
    this.invalidate();
    return this;
  }
  getAutoCursorMode() {
    return this.autoCursorMode;
  }
  setCursorMode(mode:SolveNearestMode|undefined){
    if(mode!==undefined)validateSolveMode(mode);
    this.nativeCursorMode=mode;this.structuredCursor=true;
    // Pausing native solving must not discard the cursor positions explicitly
    // restored by consumers such as BaseChartV2's image-export lifecycle.
    this.autoCursorMode=mode===undefined?AutoCursorModes.disabled:AutoCursorModes.snapToClosest;
    this.invalidate();return this;
  }
  getCursorMode(){return this.nativeCursorMode;}
  setCustomCursor(callback:((event:CursorTargetChangedEvent<any>)=>unknown)|undefined){
    if(callback!==undefined&&typeof callback!=='function')throw new TypeError('Custom cursor must be a function');
    this.customCursor=callback;this.customCursorAnnotationHold=false;this.lastEmptyCursorClient=undefined;this.structuredCursor=true;this.invalidate();return this;
  }
  protected dispatchCustomCursor(hits:any[],mouseLocation?:CoordinateClient):boolean{
    if(!this.customCursor)return false;
    if(this.customCursorAnnotationHold)return true;
    if(mouseLocation&&Number.isFinite(mouseLocation.clientX)&&Number.isFinite(mouseLocation.clientY))this.lastCursorClient={...mouseLocation};
    const last=this.lastCursorClient;
    if(!last)return true;
    if(!hits.length){
      if(this.lastEmptyCursorClient?.clientX===last.clientX&&this.lastEmptyCursorClient.clientY===last.clientY)return true;
      this.lastEmptyCursorClient={...last};
    }else this.lastEmptyCursorClient=undefined;
    this.customCursor({hit:hits[0],hits,mouseLocation:{...last}});return true;
  }
  setCursorFormatting(formatter:((chart:any,hit:any,hits:any[])=>any[][]|undefined)|undefined){
    if(formatter!==undefined&&typeof formatter!=='function')throw new TypeError('Cursor formatter must be a function');
    this.cursorFormatting=formatter;this.structuredCursor=true;this.invalidate();return this;
  }
  getCursorFormatting(){return this.cursorFormatting??defaultXYCursorRows;}
  solveNearest(from?:CoordinateClient,mode:SolveNearestMode=this.nativeCursorMode??'show-nearest'):any[]{
    validateSolveMode(mode);
    if(mode==='show-pointed')return[];
    const coordinate=from??(this.pointer?this.translatePoint(this.pointer,this.coordsPixel,this.coordsClient):undefined);
    if(!coordinate)return[];
    const pixel=this.translatePoint(coordinate,this.coordsClient,this.coordsPixel),hits:any[]=[];
    for(const series of this.series){
      if(series.disposed||!series.visible||series.cursorEnabled===false)continue;
      let hit=typeof series.solveNearest==='function'?series.solveNearest(coordinate,mode):undefined;
      if(!hit&&series instanceof GeometrySeries){
        const geometry=series.hitTest(pixel,this.getSeriesScreenRect(series));
        if(geometry)hit=xyCursorHit(series,{x:geometry.x??geometry.xValue,y:geometry.y??geometry.yValue},coordinate,geometry);
      }
      if(!hit||!Number.isFinite(hit.x)||!Number.isFinite(hit.y))continue;
      hits.push(hit);
    }
    if(mode==='show-all')return hits;
    hits.sort((a,b)=>a.distanceSquared-b.distanceSquared);return hits.slice(0,1);
  }
  addUIElement(builder: any, coordinates?: any) {
    const u = new UIElement(this, builder, coordinates);
    return this.ownUI(u);
  }
  addLegendBox(_builder?: any, options?: any) {
    const u = new LegendBox(this, options);
    return this.ownUI(u);
  }
  addCursor() {
    const c = new Cursor(this);
    return this.ownUI(c);
  }
  private ownUI<T extends UIElement>(element:T):T{
    this.ui.push(element);element.onDispose(()=>{const index=this.ui.indexOf(element);if(index>=0)this.ui.splice(index,1);this.invalidate();});
    this.invalidate();return element;
  }
  setUserInteractions(value: any) {
    if(this.kind==='xy')resolveInteractionPolicy(value);
    this.interaction = value;
    return this;
  }
  validateAxisInteractions(axis:Axis,value:any){
    if(this.kind==='xy')resolveInteractionPolicy(this.interaction,{axis:axis.direction as 'x'|'y',axisConfig:value});
  }
  getUserInteractions() {
    return this.interaction;
  }
  setMouseInteractions(value: any) {
    return this.setUserInteractions(value);
  }
  setMouseInteractionsEnabled(value: boolean) {
    return this.setUserInteractions(value);
  }
  setAnimationsEnabled(value: boolean) {
    this.animationsEnabled = value;this.explicitAnimationsEnabled=value;
    for(const series of this.series)series.setAnimationHighlight?.(value);
    this.invalidate();return this;
  }
  animationsEnabled = false;
  private readonly defaultSeriesDrawOrder=new WeakMap<object,number>();
  private nextSeriesDrawOrder=0;
  private customSeriesDrawOrder=false;
  /** Internal notification used by implemented XY geometry series ordering. */
  onSeriesDrawOrderChanged(){this.customSeriesDrawOrder=true;}
  protected orderedSeriesForDrawing():any[]{
    if(!this.customSeriesDrawOrder)return this.series;
    return this.series.map((series,index)=>({series,index,order:series.getSeriesDrawOrderIndex?.()??this.defaultSeriesDrawOrder.get(series)??index}))
      .sort((a,b)=>a.order-b.order||a.index-b.index).map(entry=>entry.series);
  }
  private explicitAnimationsEnabled:boolean|undefined;
  protected initializeSeriesAnimation(series:any){
    this.defaultSeriesDrawOrder.set(series,this.nextSeriesDrawOrder++);
    if(this.explicitAnimationsEnabled!==undefined)series.setAnimationHighlight?.(this.explicitAnimationsEnabled);
  }
  on(type: string, fn: any) {
    return this.events.on(type, fn);
  }
  off(typeOrToken: any, token?: any) {
    return this.events.off(typeOrToken, token);
  }
  onResize(fn: any) {
    return this.on("layoutchange", fn);
  }
  onDispose(fn: any) {
    return this.on("dispose", fn);
  }
  boundsFor(axis: Axis,considerVisibleRangeOnly=false): Interval | undefined {
    if(considerVisibleRangeOnly&&(this.kind!=='xy'||axis.direction==='z'))throw new UnsupportedFeatureError('visible-range fitting outside ordinary XY series');
    let lo = Infinity,
      hi = -Infinity;
    for (const s of this.series) {
      if (
        !s.visible ||
        s.disposed ||
        s[`axis${axis.direction.toUpperCase()}`] !== axis
      )
        continue;
      if(considerVisibleRangeOnly&&!(s instanceof PointLineAreaSeries))throw new UnsupportedFeatureError('visible-range fitting for non-PointLineArea XY geometry');
      const b = considerVisibleRangeOnly
        ?s.boundsWithinOtherAxis(axis.direction,s[axis.direction==='x'?'axisY':'axisX'].getInterval())
        :s.bounds?.(axis.direction);
      if (b) {
        if (axis.type === "logarithmic" && b.end <= 0) continue;
        lo = Math.min(
          lo,
          axis.type === "logarithmic"
            ? Math.max(b.start, b.end * 1e-6)
            : b.start,
        );
        hi = Math.max(hi, b.end);
      }
    }
    return lo === Infinity ? undefined : { start: lo, end: hi };
  }
  fit() {
    for (const a of [...this.axesX, ...this.axesY, ...this.axesZ])
      if (!a.disposed) a.fit(false, false);
    this.invalidate();
    return this;
  }
  fitToData() {
    return this.fit();
  }
  resize(width?: number, height?: number) {
    if (this.disposed) return this;
    // The canvases fill the chart root's content area. Container borders and
    // padding are outside that area and must not distort pixel coordinates.
    const rect = this.root?.getBoundingClientRect() ?? this.container?.getBoundingClientRect();
    this.width = width ?? rect?.width ?? this.width;
    this.height = height ?? rect?.height ?? this.height;
    if (this.width <= 0) this.width = 800;
    if (this.height <= 0) this.height = 500;
    this.dpr =
      typeof devicePixelRatio === "number" ? Math.min(devicePixelRatio, 3) : 1;
    for (const c of [this.underlay, this.canvas, this.overlay])
      if (c) {
        const w = Math.round(this.width * this.dpr),
          h = Math.round(this.height * this.dpr);
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
      }
    this.layout();
    this.publishLayoutChange(true);
    this.invalidate();
    return this;
  }
  protected usesWholeControl3DLayout(){return false;}
  protected layout() {
    const active = (axis: Axis) => axis.visible && !axis.disposed;
    const axesX=this.axesX.filter(active),axesY=this.axesY.filter(active);
    this.prepareCustomTickPlacementLengths(axesX,axesY);
    // An Empty opposite axis can still carry a title or explicit CustomTicks.
    // Keep its identity and coordinate range, but reserve an outside lane only
    // when it has decorations to paint. In particular OpenTest creates an
    // Empty/title-less top axis solely as an application coordinate surface.
    const layoutAxesX=axesX.filter(axis=>this.hasAxisLaneContent(axis));
    const layoutAxesY=axesY.filter(axis=>this.hasAxisLaneContent(axis));
    this.axisCanvasLayout=this.kind==='xy'?measureAxisCanvasLayout(this.overlayContext??undefined,layoutAxesX,layoutAxesY,this.theme,this.resolveTextFont,!!this.cssTextFonts):undefined;
    const axisExtra=this.axisCanvasLayout?.extraMargins??{left:0,right:0,top:0,bottom:0};
    const legendMargin=this.overlayContext?this.legend.getLayout(this.overlayContext,this.legendArea()).margin:{left:0,right:0,top:0,bottom:0};
    if(this.kind==='polar'){
      (this as unknown as Polar).updatePolarLayout(this.overlayContext??undefined,legendMargin,this.titleMargin);
      return;
    }
    if(this.usesWholeControl3DLayout()){
      // 3D decorations are projected around the box. Cartesian label lanes
      // would cut the already fitted bottom/front edges off the scene.
      const left=legendMargin.left+(this.padding.left??0),right=legendMargin.right+(this.padding.right??0);
      const top=legendMargin.top+(this.padding.top??0)+(this.hasVisibleChartTitle()?52+this.titleMargin.top+this.titleMargin.bottom:0);
      const bottom=legendMargin.bottom+(this.padding.bottom??0);
      this.plot={left,top,width:Math.max(20,this.width-left-right),height:Math.max(20,this.height-top-bottom)};
      return;
    }
    const left =
        (axesY.some(axis=>!axis.opposite)&&!layoutAxesY.some(axis=>!axis.opposite)?0:66) + axisExtra.left + legendMargin.left +
        Math.max(0,parallelAxisCount(layoutAxesY,false)-1) *
          54,
      right =
        (axesY.some(axis=>axis.opposite)&&!layoutAxesY.some(axis=>axis.opposite)?0:22) + axisExtra.right + legendMargin.right + parallelAxisCount(layoutAxesY,true) * 60;
    const top =
        (this.hasVisibleChartTitle()?52+this.titleMargin.top+this.titleMargin.bottom:0) + axisExtra.top + legendMargin.top + parallelAxisCount(layoutAxesX,true) * 44,
      bottom =
        (axesX.some(axis=>!axis.opposite)&&!layoutAxesX.some(axis=>!axis.opposite)?0:53) + axisExtra.bottom + legendMargin.bottom + Math.max(0,parallelAxisCount(layoutAxesX,false)-1) *
          44;
    const contentMargins=this.axisCanvasLayout?.contentMargins;
    const layoutLeft=contentMargins?contentMargins.left+legendMargin.left:left;
    const layoutRight=contentMargins?contentMargins.right+legendMargin.right:right;
    const layoutTop=contentMargins?(this.hasVisibleChartTitle()?this.resolveTextFont(this.titleFont).getSize()+16+this.titleMargin.top+this.titleMargin.bottom:0)+contentMargins.top+legendMargin.top:top;
    const layoutBottom=contentMargins?contentMargins.bottom+legendMargin.bottom:bottom;
    this.plot = {
      left: layoutLeft + (this.padding.left ?? 0),
      top: layoutTop + (this.padding.top ?? 0),
      width: Math.max(
        20,
        this.width -
          layoutLeft -
          layoutRight -
          (this.padding.left ?? 0) -
          (this.padding.right ?? 0),
      ),
      height: Math.max(
        20,
        this.height -
          layoutTop -
          layoutBottom -
          (this.padding.top ?? 0) -
          (this.padding.bottom ?? 0),
      ),
    };
    const used=new Set<Axis>();for(const series of this.series)if(!series.disposed){if(series.axisX)used.add(series.axisX);if(series.axisY)used.add(series.axisY);}
    for(const axes of [this.axesX,this.axesY]){
      for(const axis of axes)axis.setScreenRange({start:0,end:1});
      if(this.kind!=='xy')continue;
      const participants=axes.filter(axis=>!axis.disposed&&(axis.visible||used.has(axis))),length=axes===this.axesX?this.plot.width:this.plot.height;
      for(const [axis,item]of layoutAxisStacks(participants,length))axis.setScreenRange(item.range,item.lane);
    }
  }
  private legendArea():Rect{
    const top=this.hasVisibleChartTitle()?44+this.titleMargin.top+this.titleMargin.bottom:0;
    return{left:0,top,width:this.width,height:Math.max(0,this.height-top)};
  }
  private hasVisibleChartTitle(){return this.title.length>0&&fillColor(this.titleFill).a>0;}
  private currentLayoutInfo():ChartXYLayoutInfo{
    const r=this.plot,axes=new Map<Axis,AxisXYLayoutInfo>();
    for(const axis of [...this.axesX,...this.axesY]){
      if(axis.disposed)continue;
      const range=axis.getScreenRange(),lane=this.axisCanvasLayout?axisCanvasLaneOffset(this.axisCanvasLayout,axis):axis.parallelLane*(axis.direction==='x'?44:54);
      const horizontal=axis.direction==='x';
      const left=horizontal?r.left+range.start*r.width:axis.opposite?r.left+r.width+lane:r.left-lane;
      const top=horizontal?(axis.opposite?r.top-lane:r.top+r.height+lane):r.top+(1-range.end)*r.height;
      const width=horizontal?(range.end-range.start)*r.width:0,height=horizontal?0:(range.end-range.start)*r.height;
      axes.set(axis,{left,top,width,height,right:this.width-left-width,bottom:this.height-top-height});
    }
    return{viewportWidth:r.width,viewportHeight:r.height,chartWidth:this.width,chartHeight:this.height,margins:{left:r.left,right:this.width-r.left-r.width,top:r.top,bottom:this.height-r.top-r.height},axes};
  }
  async getLayout():Promise<ChartXYLayoutInfo>{
    if(this.kind!=='xy')throw new Error('getLayout currently supports ChartXY layout only');
    this.layout();return this.currentLayoutInfo();
  }
  private publishLayoutChange(force=false){
    if(this.notifyingLayout)return;
    if(this.kind!=='xy'){
      if(force)this.events.emit('layoutchange',{chart:this,width:this.width,height:this.height});
      return;
    }
    // No public or token subscribers means no payload allocation on hot frames.
    if(this.events.listenerCount('layoutchange')===0){this.lastPublicLayout=undefined;return;}
    const next=this.currentLayoutInfo(),previous=this.lastPublicLayout;
    const same=previous&&previous.chartWidth===next.chartWidth&&previous.chartHeight===next.chartHeight&&previous.viewportWidth===next.viewportWidth&&previous.viewportHeight===next.viewportHeight&&
      (['left','right','top','bottom'] as const).every(side=>previous.margins[side]===next.margins[side])&&previous.axes.size===next.axes.size&&
      [...next.axes].every(([axis,position])=>{const old=previous.axes.get(axis);return old&&(['left','right','top','bottom','width','height'] as const).every(key=>old[key]===position[key]);});
    if(!force&&same)return;
    this.lastPublicLayout=next;this.notifyingLayout=true;
    try{
      this.events.emit('layoutchange',{...next,chart:this,width:this.width,height:this.height,
        // A real host resize/layout refresh applies caller CSS/padding changes
        // immediately; nested notification is suppressed while callbacks run.
        userChangedLayout:()=>{if(!this.disposed)this.resize();},
      } satisfies ChartXYLayoutChangedEvent&{chart:ChartXY;width:number;height:number});
    }finally{this.notifyingLayout=false;}
  }
  private hasAxisLaneContent(axis:Axis){
    if(axis.tickStrategy.visible)return true;
    if(axis.getDisplayTitle().length>0&&fillColor(axis.titleFill).a>0)return true;
    if(axis.annotations.some(annotation=>annotation.kind==='tick'&&annotation.visible&&!annotation.disposed))return true;
    return (axis.stroke?.getThickness?.()??0)>0&&fillColor(axis.stroke?.getFillStyle?.()).a>0;
  }
  /** Plot rectangle occupied by the series' two independent axis stacks. */
  getSeriesScreenRect(series:{axisX:Axis;axisY:Axis}):Rect{
    const x=series.axisX.getScreenRange(),y=series.axisY.getScreenRange(),r=this.plot;
    return{left:r.left+x.start*r.width,top:r.top+(1-y.end)*r.height,width:(x.end-x.start)*r.width,height:(y.end-y.start)*r.height};
  }
  protected beforeScheduledAnimationFrame(timestamp:number):void{
    if(!this.visible||this.disposed)return;
    this.advanceAxisScrollAnimations(timestamp);
    for(const series of this.series)series.advanceHighlight?.(timestamp);
  }
  requestAxisScrollAnimation(axis:Axis){if(!this.disposed&&this.visible){this.scrollingAxes.add(axis);this.invalidate();}}
  cancelAxisScrollAnimation(axis:Axis){this.scrollingAxes.delete(axis);}
  protected advanceAxisScrollAnimations(timestamp:number){for(const axis of this.scrollingAxes)axis.advanceScrollAnimation(timestamp);}
  protected hasPendingAxisScrollAnimations(){return this.scrollingAxes.size>0;}
  protected cancelAxisScrollAnimations(){for(const axis of this.scrollingAxes)axis.cancelScrollAnimation();this.scrollingAxes.clear();}
  protected hasPendingAnimationFrame():boolean{return this.visible&&!this.disposed&&(this.hasPendingAxisScrollAnimations()||this.series.some(series=>series.hasPendingHighlight?.()));}
  protected cancelScheduledAnimation():void{this.cancelAxisScrollAnimations();for(const series of this.series)series.cancelHighlightAnimation?.();}
  invalidate() {
    if (this.disposed || this.frame || this.rendering || !this.root) return;
    if (typeof requestAnimationFrame === "function")
      this.frame = requestAnimationFrame(timestamp => {
        this.frame = 0;
        try{this.beforeScheduledAnimationFrame(timestamp);this.renderNow();}
        catch(error){this.cancelScheduledAnimation();throw error;}
      });
  }
  renderNow() {
    if (this.disposed || !this.visible) return;
    if (this.frame && typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.rendering = true;
    try {
      this.layout();
      this.publishLayoutChange();
      for (const a of [...this.axesX, ...this.axesY, ...this.axesZ])
        if (!a.disposed && (!a.stopped || a.hasPendingFit())) a.updateAuto();
      const ctx = this.overlayContext;
      const backdrop = this.underlayContext;
      if (backdrop) {
        backdrop.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        backdrop.clearRect(0, 0, this.width, this.height);
        backdrop.fillStyle = fillColor(
          this.plotBackground,
          ColorRGBA(0, 0, 0, 0),
        ).toCSS();
        backdrop.fillRect(
          this.plot.left,
          this.plot.top,
          this.plot.width,
          this.plot.height,
        );
      }
      if (ctx) {
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        if (this.root)
          this.root.style.background = fillColor(this.background).toCSS();
        if(this.kind==='polar')(this as unknown as Polar).drawPolarAxes(backdrop??ctx,'grid');
        else this.drawAxes(backdrop ?? ctx);
      }
      if(backdrop??ctx)this.drawAnnotations((backdrop??ctx)!,false);
      const packets: DrawPacket[] = [];
      if (this.kind === "xy") {
        for (const s of this.orderedSeriesForDrawing()) {
          if (s.disposed || !s.visible) continue;
          if (s instanceof PointLineAreaSeries) {
            // Cull complete blocks only. Keep every retained sample, and leave
            // spline overshoot and arbitrary per-point sizes to GPU clipping.
            if (!(s instanceof SplineSeries) && !s.getIndividualPointSizeEnabled()) {
              const bounds=s.bounds('x');
              if(bounds){
                const a=s.axisX.valueToFraction(bounds.start),b=s.axisX.valueToFraction(bounds.end);
                const margin=Math.max((s.stroke?.getThickness?.()??0)*2+2,pointStrokeRadius(s.pointSize,s.pointStroke?.getThickness?.()??0,s.getPointShape()))/Math.max(1,this.plot.width);
                if(Number.isFinite(a)&&Number.isFinite(b)&&(Math.max(a,b)<-margin||Math.min(a,b)>1+margin))continue;
              }
            }
            const clipRect=this.getSeriesScreenRect(s);
            if (s.kind !== "points") {
              // Large bounded streams use the dense view while history grows
              // as well as after the first retention wrap. Raw samples remain
              // complete; unsupported styles keep exact source blocks.
              const retained=s.getSampleCount(),limit=s.getMaxSampleCount();
              const boundedStreamingWindow=retained>=65536&&limit!==undefined&&(retained>=limit||retained>=262144);
              if(this.experimentalLineDisplayPixels!==undefined&&this.renderer?.gl)packets.push(...s.drawLineDisplayPackets(this.plot,clipRect,this.dpr,this.experimentalLineDisplayPixels,this.experimentalLineDisplayPackets));
              else if(this.experimentalLineBlocks&&this.renderer?.gl)packets.push(...s.drawLinePackets(clipRect,this.dpr,this.plot));
              else if(boundedStreamingWindow&&this.renderer?.gl)packets.push(...s.drawStreamingLinePackets(this.plot,clipRect,this.dpr));
              else packets.push({ ...s.drawPacket("line"),clipRect });
            }
            if (
              (s.pointSize > 0 || s.getIndividualPointSizeEnabled()) &&
              (fillColor(s.pointFill).a > 0 ||
                s.getIndividualPointColorEnabled() ||
                s.pointFill?.kind === "individual" ||
                s.pointStroke.getThickness() > 0)
            )
              packets.push({ ...s.drawPacket("points"),clipRect });
            if (
              backdrop &&
              (s.areaFill instanceof LinearGradientFill
                ? s.areaFill.hasVisibleStops()
                : fillColor(s.areaFill).a > 0)
            )
              this.drawArea(backdrop, s);
          } else if (
            s instanceof HeatmapSeries &&
            backdrop &&
            !this.gpuHeatmap(s)
          )
            this.drawHeatmap(backdrop, s);
          else if (s instanceof GeometrySeries && backdrop)
            s.draw(
              s instanceof SegmentSeries && ctx ? ctx : backdrop,
              this.getSeriesScreenRect(s),
            );
        }
      } else if (ctx)
        this.drawSpecial(this.kind === "3d" ? (backdrop ?? ctx) : ctx);
      this.renderData(packets);
      if (ctx) {
        if(this.kind==='polar')this.drawAxes(ctx);
        this.drawAnnotations(ctx,true);
        this.drawCursor(ctx);
        if (this.drag?.mode === "zoom" && this.pointer) {
          const x = Math.max(
            this.plot.left,
            Math.min(this.drag.x, this.pointer.x),
          );
          const y = Math.max(
            this.plot.top,
            Math.min(this.drag.y, this.pointer.y),
          );
          const right = Math.min(
            this.plot.left + this.plot.width,
            Math.max(this.drag.x, this.pointer.x),
          );
          const bottom = Math.min(
            this.plot.top + this.plot.height,
            Math.max(this.drag.y, this.pointer.y),
          );
          ctx.fillStyle = "rgba(65,180,220,.13)";
          ctx.strokeStyle = "rgba(115,215,245,.9)";
          ctx.lineWidth = 1;
          ctx.fillRect(x, y, Math.max(0, right - x), Math.max(0, bottom - y));
          ctx.strokeRect(x, y, Math.max(0, right - x), Math.max(0, bottom - y));
        }
        for (const u of this.ui)
          if (!u.disposed)
            u.draw(ctx, this.plot, (p: any, coords: any) =>
              this.translatePoint(
                p,
                coords ??
                  (u instanceof LegendBox
                    ? this.kind==='polar'?this.coordsRelative:this.coordsPlotPercentage
                    : this.coordsAxis),
                this.coordsPixel,
              ),
            );
        this.legend.draw(ctx,this.legendArea());
      }
      this.events.emit("render", { chart: this, stats: this.getRenderStats() });
    } catch(error){this.cancelScheduledAnimation();throw error;} finally {
      this.rendering = false;
      if(this.hasPendingAnimationFrame())this.invalidate();
    }
    this.afterRender();
  }
  /** Internal post-render publication hook; consumer callbacks may request a new frame. */
  protected afterRender():void{}
  protected drawPlotFrame(ctx:CanvasRenderingContext2D){
    if(this.kind!=='xy')return;
    const stroke=this.theme.chartXYSeriesBackgroundStrokeStyle,thickness=stroke?.getThickness?.()??0;
    if(!Number.isFinite(thickness)||thickness<=0)return;
    const ink=fillColor(stroke.getFillStyle?.(),ColorRGBA(0,0,0,0));if(ink.a<=0)return;
    ctx.save();try{
      ctx.strokeStyle=ink.toCSS();ctx.lineWidth=thickness;ctx.setLineDash(stroke.getPattern?.().map((part:number)=>part*(stroke.getPatternScale?.()??1))??[]);
      ctx.strokeRect(this.plot.left,this.plot.top,this.plot.width,this.plot.height);
    }finally{ctx.restore();}
  }
  protected drawAxes(ctx: CanvasRenderingContext2D) {
    const r = this.plot,
      light = fillColor(this.background).r > 0.5;
    ctx.fillStyle = fillColor(
      this.plotBackground,
      ColorRGBA(0, 0, 0, 0),
    ).toCSS();
    ctx.font = this.cssTextFonts?this.resolveTextFont(this.titleFont).toCSS():`${this.titleFont.getSize()}px ${this.titleFont.getFamily()}`;
    ctx.fillStyle = fillColor(this.titleFill).toCSS();
    const topTitlePosition=this.kind==='xy'?this.titlePosition:'left-top';
    ctx.textAlign=topTitlePosition==='center-top'?'center':topTitlePosition==='right-top'?'right':'left';
    const titleLeft=this.kind==='xy'?this.titleMargin.left:r.left+this.titleMargin.left,titleRight=this.kind==='xy'?this.width-this.titleMargin.right:r.left+r.width-this.titleMargin.right;
    ctx.fillText(this.title,topTitlePosition==='center-top'?(titleLeft+titleRight)/2:topTitlePosition==='right-top'?titleRight:titleLeft,29+this.titleMargin.top,Math.max(1,titleRight-titleLeft));
    if (this.kind === "polar") {
      (this as unknown as Polar).drawPolarAxes(ctx,'labels');
      return;
    }
    if (this.kind === "3d") return;
    drawAxisCanvas(ctx,{plot:r,axesX:this.axesX,axesY:this.axesY,light,width:this.width,height:this.height,layout:this.axisCanvasLayout,theme:this.theme,resolveFont:this.resolveTextFont,paintFrame:()=>this.drawPlotFrame(ctx)});
  }
  protected drawAnnotations(ctx: CanvasRenderingContext2D,onTop=true) {
    const r = this.plot;
    ctx.save();
    try{
    ctx.beginPath();
    ctx.rect(r.left, r.top, r.width, r.height);
    ctx.clip();
    for (const a of [...this.axesX, ...this.axesY]){
      if(a.disposed)continue;
      const range=a.getScreenRange();
      ctx.save();ctx.beginPath();
      if(a.direction==='x')ctx.rect(r.left+range.start*r.width,r.top,(range.end-range.start)*r.width,r.height);
      else ctx.rect(r.left,r.top+(1-range.end)*r.height,r.width,(range.end-range.start)*r.height);
      ctx.clip();
      try{
      for (const n of a.annotations) {
        if (!n.visible || n.disposed || n.onTop!==onTop) continue;
        const horizontal = a.direction === "x",
          at = (v: number) =>
            horizontal
              ? r.left + a.valueToScreenFraction(v) * r.width
              : r.top + r.height - a.valueToScreenFraction(v) * r.height;
        const intensity=n.getHighlightStrength(),highlight=(color:ReturnType<typeof fillColor>)=>{
          if(intensity===0)return color;
          const target=color.getHighlight();return ColorRGBA((color.r+(target.r-color.r)*intensity)*255,(color.g+(target.g-color.g)*intensity)*255,(color.b+(target.b-color.b)*intensity)*255,color.a*255);
        };
        const strokeColor=highlight(fillColor(n.stroke?.getFillStyle?.())),fill=highlight(fillColor(n.fill));
        const thickness=n.stroke?.getThickness?.()??1,hasStroke=Number.isFinite(thickness)&&thickness>0&&strokeColor.a>0;
        ctx.strokeStyle = strokeColor.toCSS();
        ctx.setLineDash(n.stroke?.getPattern?.().map((value:number)=>value*(n.stroke.getPatternScale?.()??1))??[]);
        ctx.lineDashOffset=0;
        if(hasStroke)ctx.lineWidth = thickness;
        ctx.fillStyle = fill.toCSS();
        if (n.kind === "band") {
          const start = at(n.start),
            end = at(n.end);
          if(!Number.isFinite(start)||!Number.isFinite(end))continue;
          const bounds=horizontal?[Math.min(start,end),r.top,Math.abs(end-start),r.height]:[r.left,Math.min(start,end),r.width,Math.abs(end-start)];
          if(fill.a>0)ctx.fillRect(bounds[0]!,bounds[1]!,bounds[2]!,bounds[3]!);
          if(hasStroke)ctx.strokeRect(bounds[0]!,bounds[1]!,bounds[2]!,bounds[3]!);
        } else {
          const p = at(n.value);
          if(!Number.isFinite(p))continue;
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(p, r.top);
            ctx.lineTo(p, r.top + r.height);
          } else {
            ctx.moveTo(r.left, p);
            ctx.lineTo(r.left + r.width, p);
          }
          if(hasStroke)ctx.stroke();
          if (n.text) {
            ctx.font = "11px sans-serif";
            ctx.fillStyle = ctx.strokeStyle;
            ctx.textAlign = "left";
            ctx.fillText(
              n.text,
              horizontal ? p + 4 : r.left + 6,
              horizontal ? r.top + 15 : p - 5,
            );
          }
        }
      }
      }finally{ctx.restore();}
    }
    }finally{ctx.restore();}
  }
  protected drawArea(ctx: CanvasRenderingContext2D, s: PointLineAreaSeries) {
    const r = this.getSeriesScreenRect(s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left, r.top, r.width, r.height);
    ctx.clip();
    let open = false,
      lastX = 0;
    const base =
      r.top + r.height - s.axisY.valueToFraction(s.areaBaseline) * r.height;
    if (!Number.isFinite(base)) {
      ctx.restore();
      return;
    }
    if (s.areaFill instanceof LinearGradientFill) {
      let minX = Infinity,
        maxX = -Infinity,
        minY = base,
        maxY = base;
      for (let i = 0, n = s.getSampleCount(); i < n; i++) {
        const p = s.getSample(i),
          x = r.left + s.axisX.valueToFraction(p.x) * r.width,
          y = r.top + r.height - s.axisY.valueToFraction(p.y) * r.height;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      if (!Number.isFinite(minX)) {
        ctx.restore();
        return;
      }
      ctx.fillStyle = canvasGradient(ctx, s.areaFill, {
        left: minX,
        top: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      });
    } else ctx.fillStyle = s.resolveRenderColor(fillColor(s.areaFill)).toCSS();
    const finish = () => {
      if (open) {
        ctx.lineTo(lastX, base);
        ctx.closePath();
        ctx.fill();
        open = false;
      }
    };
    for (let i = 0, n = s.getSampleCount(); i < n; i++) {
      const p = s.getSample(i),
        x = r.left + s.axisX.valueToFraction(p.x) * r.width,
        y = r.top + r.height - s.axisY.valueToFraction(p.y) * r.height;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        finish();
        continue;
      }
      if (!open) {
        ctx.beginPath();
        ctx.moveTo(x, base);
        open = true;
      }
      ctx.lineTo(x, y);
      lastX = x;
    }
    finish();
    ctx.restore();
  }
  protected drawHeatmap(ctx: CanvasRenderingContext2D, s: HeatmapSeries) {
    if (
      s.getIntensityInterpolation() === "bilinear" ||
      s.axisX.type === "logarithmic" ||
      s.axisY.type === "logarithmic"
    ) {
      this.drawSampledHeatmap(ctx, s);
      this.drawHeatmapWireframe(ctx, s);
      return;
    }
    let cache = this.heatCache.get(s.id);
    if (!cache || cache.revision !== s.revision) {
      const canvas = cache?.canvas ?? document.createElement("canvas");
      canvas.width = s.columns;
      canvas.height = s.rows;
      const c = canvas.getContext("2d")!,
        pixels = c.createImageData(s.columns, s.rows),
        values = s.orderedData();
      for (let row = 0; row < s.rows; row++)
        for (let col = 0; col < s.columns; col++) {
          const v = values[row * s.columns + col]!,
            j = ((s.rows - 1 - row) * s.columns + col) * 4;
          if (!Number.isFinite(v)) continue;
          const color =
            s.palette?.lut?.getColor?.(v) ??
            s.palette?.getLUT?.()?.getColor?.(v);
          if (color) {
            pixels.data[j] = color.r * 255;
            pixels.data[j + 1] = color.g * 255;
            pixels.data[j + 2] = color.b * 255;
            pixels.data[j + 3] = color.a * 255;
          } else {
            const f = Math.max(
              0,
              Math.min(
                1,
                (v - s.intensityRange.start) /
                  (s.intensityRange.end - s.intensityRange.start),
              ),
            );
            pixels.data[j] = 255 * f;
            pixels.data[j + 1] = 220 * Math.sin((f * Math.PI) / 2);
            pixels.data[j + 2] = 150 * (1 - f) + 40;
            pixels.data[j + 3] = 255;
          }
        }
      c.putImageData(pixels, 0, 0);
      cache = { revision: s.revision, canvas };
      this.heatCache.set(s.id, cache);
    }
    const xb = s.textureBounds("x"),
      yb = s.textureBounds("y"),
      r = this.getSeriesScreenRect(s),
      x0 = r.left + s.axisX.valueToFraction(xb.start) * r.width,
      x1 = r.left + s.axisX.valueToFraction(xb.end) * r.width,
      y0 = r.top + r.height - s.axisY.valueToFraction(yb.end) * r.height,
      y1 = r.top + r.height - s.axisY.valueToFraction(yb.start) * r.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left, r.top, r.width, r.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cache.canvas, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    this.drawHeatmapWireframe(ctx, s);
  }
  /** Canvas fallback uses the same series axes, clip and public line style. */
  protected drawHeatmapWireframe(ctx: CanvasRenderingContext2D, s: HeatmapSeries) {
    if (s instanceof PolarHeatmapSeries || s.axisX.type === "linear-highPrecision" || s.axisY.type === "linear-highPrecision") return;
    const style = s.getWireframeStyle(), thickness = style?.getThickness?.() ?? 0;
    const ink = fillColor(style?.getFillStyle?.(), ColorRGBA(0,0,0,0));
    if (!(thickness > 0) || ink.a <= 0 || s.columns < 1 || s.rows < 1) return;
    const r = this.getSeriesScreenRect(s), xb = s.textureBounds("x"), yb = s.textureBounds("y");
    const xi = s.axisX.getInterval(), yi = s.axisY.getInterval();
    const xLow = Math.max(Math.min(xb.start, xb.end), Math.min(xi.start, xi.end));
    const xHigh = Math.min(Math.max(xb.start, xb.end), Math.max(xi.start, xi.end));
    const yLow = Math.max(Math.min(yb.start, yb.end), Math.min(yi.start, yi.end));
    const yHigh = Math.min(Math.max(yb.start, yb.end), Math.max(yi.start, yi.end));
    if (!(xHigh >= xLow && yHigh >= yLow)) return;
    const px = (value: number) => r.left + s.axisX.valueToFraction(value) * r.width;
    const py = (value: number) => r.top + (1 - s.axisY.valueToFraction(value)) * r.height;
    const left = px(xLow), right = px(xHigh), top = py(yHigh), bottom = py(yLow);
    if (![left,right,top,bottom].every(Number.isFinite)) return;
    ctx.save(); ctx.beginPath(); ctx.rect(r.left,r.top,r.width,r.height); ctx.clip();
    ctx.strokeStyle = ink.toCSS(); ctx.lineWidth = thickness;
    ctx.setLineDash(style?.getPattern?.().map((value: number) => value * (style.getPatternScale?.() ?? 1)) ?? []);
    ctx.lineDashOffset = 0; ctx.beginPath();
    for (let column = 0; column <= s.columns; column++) {
      const value = xb.start + (xb.end - xb.start) * column / s.columns;
      if (value < xLow || value > xHigh) continue;
      const x = px(value); if (!Number.isFinite(x)) continue;
      ctx.moveTo(x,top); ctx.lineTo(x,bottom);
    }
    for (let row = 0; row <= s.rows; row++) {
      const value = yb.start + (yb.end - yb.start) * row / s.rows;
      if (value < yLow || value > yHigh) continue;
      const y = py(value); if (!Number.isFinite(y)) continue;
      ctx.moveTo(left,y); ctx.lineTo(right,y);
    }
    ctx.stroke(); ctx.restore();
  }
  protected drawSpecial(_ctx: CanvasRenderingContext2D) {}
  private drawSampledHeatmap(ctx: CanvasRenderingContext2D, s: HeatmapSeries) {
    const r = this.getSeriesScreenRect(s),
      width = Math.max(1, Math.round(r.width * this.dpr)),
      height = Math.max(1, Math.round(r.height * this.dpr)),
      x = s.axisX.getInterval(),
      y = s.axisY.getInterval();
    const samplingKey = [
      width,
      height,
      x.start,
      x.end,
      y.start,
      y.end,
      s.axisX.inverted,
      s.axisY.inverted,
      s.axisX.type,
      s.axisY.type,
    ].join(":");
    let cache = this.heatCache.get(s.id);
    if (
      !cache ||
      cache.revision !== s.revision ||
      cache.samplingKey !== samplingKey
    ) {
      const canvas = cache?.canvas ?? document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const c = canvas.getContext("2d")!,
        pixels = c.createImageData(width, height),
        xb = s.textureBounds("x"),
        yb = s.textureBounds("y"),
        offset = s.getScrollOffset(),
        lut = s.palette?.getLUT?.();
      for (let row = 0; row < height; row++)
        for (let col = 0; col < width; col++) {
          const rawX = s.axisX.fractionToValue((col + 0.5) / width),
            rawY = s.axisY.fractionToValue(1 - (row + 0.5) / height),
            v = sampleHeatmapIntensity(
              s.data,
              s.columns,
              s.rows,
              ((rawX - xb.start) / (xb.end - xb.start)) * s.columns,
              ((rawY - yb.start) / (yb.end - yb.start)) * s.rows,
              s.getIntensityInterpolation(),
              offset,
            );
          if (!Number.isFinite(v)) continue;
          const f = Math.max(
              0,
              Math.min(
                1,
                (v - s.intensityRange.start) /
                  (s.intensityRange.end - s.intensityRange.start || 1),
              ),
            ),
            color =
              lut?.getColor(v) ??
              s.palette?.getColor?.() ??
              ColorRGBA(
                255 * f,
                220 * Math.sin((f * Math.PI) / 2),
                150 * (1 - f) + 40,
              ),
            i = (row * width + col) * 4;
          pixels.data[i] = color.r * 255;
          pixels.data[i + 1] = color.g * 255;
          pixels.data[i + 2] = color.b * 255;
          pixels.data[i + 3] = color.a * 255;
        }
      c.putImageData(pixels, 0, 0);
      cache = { revision: s.revision, canvas, samplingKey };
      this.heatCache.set(s.id, cache);
    }
    ctx.drawImage(cache.canvas, r.left, r.top, r.width, r.height);
  }
  protected renderData(packets: DrawPacket[]) {
    const grids: DrawPacketHeatmap[] = [];
    for (const s of this.series) {
      if (
        !(s instanceof HeatmapSeries) ||
        !s.visible ||
        s.disposed ||
        !this.gpuHeatmap(s)
      )
        continue;
      if(s instanceof PolarHeatmapSeries&&s.step.y===0)continue;
      const lut = s.palette?.getLUT?.() ?? s.palette?.lut,
        steps = lut?.getSteps?.(),
        min = steps?.length ? steps[0].value : s.intensityRange.start,
        max = steps?.length
          ? steps[steps.length - 1].value
          : s.intensityRange.end;
      let cache = this.heatmapPalettes.get(s.id);
      if (
        !cache ||
        cache.style !== s.palette ||
        cache.min !== min ||
        cache.max !== max
      ) {
        const sample = lut
          ? (v: number) => lut.getColor(v)
          : s.palette?.getColor
            ? () => s.palette.getColor()
            : (value: number) => {
                const f = Math.max(
                  0,
                  Math.min(1, (value - min) / (max - min || 1)),
                );
                return {
                  r: f,
                  g: (220 / 255) * Math.sin((f * Math.PI) / 2),
                  b: (150 * (1 - f) + 40) / 255,
                  a: 1,
                };
              };
        cache = {
          style: s.palette,
          min,
          max,
          bytes: buildHeatmapPalette(sample, min, max),
        };
        if(steps?.length){const entries=steps.length===1?[steps[0],steps[0]]:steps;cache.stops=Float32Array.from(entries,(step:any)=>step.value);cache.bytes=new Uint8Array(entries.length*4);entries.forEach((step:any,index:number)=>{const color=step.color;cache!.bytes.set([color.r*255,color.g*255,color.b*255,color.a*255].map(Math.round),index*4);});}
        this.heatmapPalettes.set(s.id, cache);
      }
      const x = s.textureBounds("x"),
        y = s instanceof PolarHeatmapSeries?s.getRadialNodeRange():s.textureBounds("y");
      const wire = s.getWireframeStyle(), wireColor = fillColor(wire?.getFillStyle?.(), ColorRGBA(0,0,0,0));
      const wireThickness = wire?.getThickness?.() ?? 0;
      const wireframe = !(s instanceof PolarHeatmapSeries) && s.axisX.type !== "linear-highPrecision" && s.axisY.type !== "linear-highPrecision" && wireThickness > 0 && wireColor.a > 0
        ? {thickness: wireThickness, color: [wireColor.r, wireColor.g, wireColor.b, wireColor.a] as const} : undefined;
      grids.push({
        id: s.id,
        wireframe,
        ...(this.gpuClipPolicy==='contained'?{clipRect:s instanceof PolarHeatmapSeries?this.plot:this.getSeriesScreenRect(s)}:{}),
        revision: s.dataRevision,
        values: s.data,
        columns: s.columns,
        rows: s.rows,
        extent: s instanceof PolarHeatmapSeries ? [0,1,0,1] : [
          s.axisX.valueToScreenFraction(x.start),
          s.axisX.valueToScreenFraction(x.end),
          s.axisY.valueToScreenFraction(y.start),
          s.axisY.valueToScreenFraction(y.end),
        ],
        intensityRange: { start: min, end: max },
        palette: cache.bytes,
        paletteStops:cache.stops,
        paletteRevision: s.paletteRevision,
        paletteFilter:
          lut?.getInterpolation?.() === false ? "nearest" : "linear",
        scrollOffset: s.getScrollOffset(),
        intensityInterpolation: s.getIntensityInterpolation(),
        update:s.dataUpdate,
        ...(s instanceof PolarHeatmapSeries?{polar:{angleOrigin:this.polarAngleOrigin*Math.PI/180,direction:(this.polarClockwise?-1:1) as 1|-1,innerRadius:s.axisY.valueToFraction(y.start),outerRadius:s.axisY.valueToFraction(y.end),radiusFraction:(this as unknown as Polar).getPolarLayout().dataRadius/Math.max(1e-12,Math.min(this.plot.width,this.plot.height)),nodeSampling:true}}:{}),
      });
    }
    if (
      grids.length &&
      !this.heatmapRenderer &&
      this.renderer?.gl &&
      this.canvas
    )
      this.heatmapRenderer = new DataRendererHeatmap(
        this.renderer.gl,
        this.canvas,
        {clipPolicy:this.gpuClipPolicy},
      );
    const gl=this.renderer?.gl;
    const rasterTarget=this.gpuClipPolicy==='contained'&&gl?rasterTargetForRect(null,gl.drawingBufferWidth,gl.drawingBufferHeight,this.plot,this.dpr):undefined;
    this.heatmapRenderer?.render(grids, this.plot, this.dpr, {
      clear: grids.length > 0,
      rasterTarget,
    });
    for(const grid of grids)if(this.heatmapRenderer?.getUploadedRevision(grid.id)===grid.revision){const series=this.series.find(series=>series.id===grid.id);if(series instanceof HeatmapSeries)series.acknowledgeDataRevision(grid.revision);}
    this.renderer?.render(packets, this.plot, this.dpr, {
      experimentalHiddenLineOwners:this.kind==='xy'?new Set(this.series.filter(s=>s.constructor===PointLineAreaSeries&&s.kind==='line'&&!s.disposed&&!s.visible&&!s.axisZ&&s.getSampleCount()>0).map(s=>s.id)):undefined,
      clear: grids.length === 0,
      rasterTarget,
    });
  }
  private gpuHeatmap(s: HeatmapSeries) {
    return (
      !!this.renderer?.gl &&
      s.axisX.type !== "logarithmic" &&
      s.axisY.type !== "logarithmic"
    );
  }
  protected drawCursor(ctx: CanvasRenderingContext2D) {
    if(this.kind==='xy'&&(this.structuredCursor||this.series.some(series=>series.getCursorFormattingOverride?.()))){this.drawStructuredCursor(ctx);return;}
    if (
      !this.pointer ||
      this.kind !== "xy" ||
      !this.cursor.visible ||
      this.autoCursorMode === AutoCursorModes.disabled
    ) {
      this.cursor.positioned=false;this.cursor.resultTable.content=[];return;
    }
    const p = this.pointer,
      r = this.plot;
    if (
      p.x < r.left ||
      p.x > r.left + r.width ||
      p.y < r.top ||
      p.y > r.top + r.height
    ) {
      this.cursor.positioned=false;this.cursor.resultTable.content=[];return;
    }
    const fractionX=(p.x-r.left)/r.width,fractionY=1-(p.y-r.top)/r.height;
    const activeAxis=(axes:Axis[],fraction:number)=>axes.find(axis=>{const range=axis.getScreenRange();return!axis.disposed&&axis.visible&&fraction>=range.start&&fraction<=range.end;})??axes.find(axis=>!axis.disposed)??axes[0]!;
    const coordinates={x:activeAxis(this.axesX,fractionX),y:activeAxis(this.axesY,fractionY)};
    const point = this.translatePoint(p, this.coordsPixel, coordinates),
      rows: any[][] = [["X", coordinates.x.formatCursorValue(point.x)]];
    for (const s of this.series) {
      if (
        !(s instanceof PointLineAreaSeries) ||
        !s.visible ||
        !s.cursorEnabled ||
        !s.getSampleCount()
      )
        continue;
      const target = s.axisX.screenFractionToValue((p.x - r.left) / r.width),
        sample = s.findNearestX(target);
      if (!sample || !Number.isFinite(sample.y)) continue;
      const pixel = this.translatePoint(
        sample,
        { x: s.axisX, y: s.axisY },
        this.coordsPixel,
      );
      if (
        this.autoCursorMode === AutoCursorModes.onHover &&
        Math.hypot(pixel.x - p.x, pixel.y - p.y) > Math.max(8, s.pointSize / 2)
      )
        continue;
      rows.push([s.name || `Series ${s.id}`, s.axisY.formatCursorValue(sample.y)]);
      if (this.cursor.pointMarker) {
        ctx.save();
        ctx.fillStyle = fillColor(s.stroke.getFillStyle()).toCSS();
        ctx.beginPath();
        ctx.arc(pixel.x, pixel.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    if (this.autoCursorMode === AutoCursorModes.onHover && rows.length === 1) {
      this.cursor.positioned=false;this.cursor.resultTable.content=[];return;
    }
    this.cursor.position = point;
    this.cursor.positioned = true;
    this.cursor.resultTable.content = rows;
    this.cursor.draw(ctx, r, (value) => this.translatePoint(value, coordinates, this.coordsPixel),{x:value=>coordinates.x.formatValue(value),y:value=>coordinates.y.formatValue(value)});
  }
  private drawStructuredCursor(ctx:CanvasRenderingContext2D){
    const p=this.pointer,r=this.plot,enabled=this.nativeCursorMode!==undefined&&this.autoCursorMode!==AutoCursorModes.disabled;
    if(!enabled){this.dispatchCustomCursor([],p?this.translatePoint(p,this.coordsPixel,this.coordsClient):undefined);return;}
    const inside=!!p&&p.x>=r.left&&p.x<=r.left+r.width&&p.y>=r.top&&p.y<=r.top+r.height;
    let hits=enabled&&inside?this.solveNearest(undefined,this.nativeCursorMode==='show-pointed'?'show-all':this.nativeCursorMode):[];
    if(this.nativeCursorMode==='show-pointed'&&p)hits=this.pointedCursorHits(hits,p);
    const hit=hits[0],mouseLocation=p?this.translatePoint(p,this.coordsPixel,this.coordsClient):undefined;
    if(this.dispatchCustomCursor(hits,mouseLocation))return;
    if(!hit||!this.cursor.visible){this.cursor.positioned=false;this.cursor.resultTable.content=[];return;}
    // The default formatter handles each series independently. An explicit
    // chart formatter owns the complete table and is not rewritten by a series.
    const rows=this.getCursorFormatting()(this,hit,hits);
    this.cursor.setPosition(...hits.map(item=>item.cursorPosition));this.cursor.resultTable.content=rows??[];
    this.cursor.draw(ctx,r,(value,scale)=>this.translatePoint(value,scale??{x:hit.axisX,y:hit.axisY},this.coordsPixel),{x:(value,position)=>(position.pointMarkerScale?.x??hit.axisX).formatCursorValue(value),y:(value,position)=>(position.pointMarkerScale?.y??hit.axisY).formatCursorValue(value)});
  }
  private pointedCursorHits(candidates:any[],pixel:{x:number;y:number}):any[]{
    // Native pointed results follow visible shape coverage in reverse draw order.
    // Programmatic solveNearest(show-pointed) has no DOM pick state.
    for(const candidate of [...candidates].reverse()){
      const series=candidate.series;
      if(series instanceof GeometrySeries){
        const pointed=series.hitTest(pixel,this.getSeriesScreenRect(series));if(!pointed)continue;
        const position=pointed.positionAndSize?{x:pointed.positionAndSize.x+pointed.positionAndSize.width/2,y:pointed.positionAndSize.y+pointed.positionAndSize.height/2}:pointed;
        return[xyCursorHit(series,position,this.translatePoint(pixel,this.coordsPixel,this.coordsClient),{...pointed,...position})];
      }
      if(series instanceof HeatmapSeries){
        const scale={x:series.axisX,y:series.axisY},first=this.translatePoint({x:series.start.x+candidate.column*series.step.x,y:series.start.y+candidate.row*series.step.y},scale,this.coordsPixel),last=this.translatePoint({x:series.start.x+(candidate.column+1)*series.step.x,y:series.start.y+(candidate.row+1)*series.step.y},scale,this.coordsPixel);
        if(pixel.x>=Math.min(first.x,last.x)&&pixel.x<=Math.max(first.x,last.x)&&pixel.y>=Math.min(first.y,last.y)&&pixel.y<=Math.max(first.y,last.y))return[candidate];
      }else if(candidate.distanceSquared<=Math.max(3,(series.pointSize||series.stroke?.getThickness?.()||0)/2+2)**2)return[candidate];
    }
    return[];
  }
  translatePoint(
    p: any,
    source: any = this.coordsAxis,
    target: any = this.coordsPixel,
  ) {
    const r = this.plot,bounds=this.overlay?.getBoundingClientRect()??{left:0,top:0};
    const pixel =
      source?.kind === "client"
        ? {x:(p.clientX??p.x)-bounds.left,y:(p.clientY??p.y)-bounds.top}
        : source?.kind === "pixel"
        ? p
        : source?.kind === "relative"
        ? {x:p.x,y:this.height-p.y}
        : source?.kind === "plot-percentage"
          ? {
              x: r.left + (p.x / 100) * r.width,
              y: r.top + (1 - p.y / 100) * r.height,
            }
          : {
              x:
                r.left +
                (source?.x ?? this.getDefaultAxisX()).valueToScreenFraction(p.x) *
                  r.width,
              y:
                r.top +
                (1 -
                  (source?.y ?? this.getDefaultAxisY()).valueToScreenFraction(p.y)) *
                  r.height,
            };
    return target?.kind === "client"
      ? {clientX:pixel.x+bounds.left,clientY:pixel.y+bounds.top}
      : target?.kind === "pixel"
      ? { ...pixel }
      : target?.kind === "relative"
      ? {x:pixel.x,y:this.height-pixel.y}
      : target?.kind === "plot-percentage"
        ? {
            x: ((pixel.x - r.left) / r.width) * 100,
            y: (1 - (pixel.y - r.top) / r.height) * 100,
          }
        : {
            x: (target?.x ?? this.getDefaultAxisX()).screenFractionToValue(
              (pixel.x - r.left) / r.width,
            ),
            y: (target?.y ?? this.getDefaultAxisY()).screenFractionToValue(
              1 - (pixel.y - r.top) / r.height,
            ),
          };
  }
  translateCoordinate(point:any,sourceOrTarget:any,target?:any):any{
    if(!point)throw new TypeError('Coordinate is required');
    return target===undefined?this.translatePoint(point,('clientX'in point||'clientY'in point)?this.coordsClient:this.coordsPixel,sourceOrTarget):this.translatePoint(point,sourceOrTarget,target);
  }
  private axesAtPoint(point:{x:number;y:number}){
    return [...this.axesX,...this.axesY].filter(axis=>{if(axis.disposed||axis.getUserInteractions()===false)return false;const range=axis.getScreenRange(),fraction=axis.direction==='x'?(point.x-this.plot.left)/this.plot.width:1-(point.y-this.plot.top)/this.plot.height;return fraction>=range.start&&fraction<=range.end;});
  }
  /** Axis events address the actual label/title lane, including stacked spans. */
  private axisAtPixel(point:{x:number;y:number}):Axis|undefined{
    if(this.kind!=='xy')return undefined;
    const r=this.plot;
    return [...this.axesX,...this.axesY].reverse().find(axis=>{
      if(axis.disposed||!axis.visible)return false;
      const horizontal=axis.direction==='x',range=axis.getScreenRange(),metrics=this.axisCanvasLayout?.axes.get(axis),offset=metrics?.laneOffset??axis.parallelLane*(horizontal?44:54),size=metrics?.laneSize??(horizontal?44:54);
      const line=horizontal?(axis.opposite?r.top-offset:r.top+r.height+offset):(axis.opposite?r.left+r.width+offset:r.left-offset);
      const along=horizontal?(point.x-r.left)/r.width:1-(point.y-r.top)/r.height;
      const outward=horizontal?(axis.opposite?line-point.y:point.y-line):(axis.opposite?point.x-line:line-point.x);
      return along>=range.start&&along<=range.end&&outward>=0&&outward<size;
    });
  }
  private xyInteractionAt(point:{x:number;y:number}){
    const axis=this.axisAtPixel(point),r=this.plot;
    if(!axis&&(point.x<r.left||point.x>r.left+r.width||point.y<r.top||point.y>r.top+r.height))return undefined;
    return {axis,policy:resolveInteractionPolicy(this.interaction,axis?{axis:axis.direction as 'x'|'y',axisConfig:axis.getUserInteractions()}:undefined)};
  }
  private interactionAxes(point:{x:number;y:number},lane:Axis|undefined,decision:InteractionDecisionBase,kind:ChartInteractionKind){
    return (lane?[lane]:this.axesAtPoint(point)).filter(axis=>
      (axis.direction==='x'?decision.x:decision.y)&&(!!lane||axisAcceptsChartInteraction(axis.getUserInteractions(),kind)));
  }
  private updateAxisPointerHover(axis?:Axis):void{
    for(const candidate of [...this.axesX,...this.axesY])candidate.setPointerHover(candidate===axis);
  }
  protected attachInteractions() {
    const el = this.overlay!;
    let activePointerId:number|undefined;
    const on = (type: string, fn: any, options?: any) => {
      el.addEventListener(type, fn, options);
      this.cleanups.push(() => el.removeEventListener(type, fn, options));
    };
    const point = (e: Pick<MouseEvent,'clientX'|'clientY'>) => {
      const b = el.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const cancelGesture=(event:PointerEvent)=>{
      if(activePointerId!==undefined&&event.pointerId!==undefined&&event.pointerId!==activePointerId)return;
      activePointerId=undefined;
      this.drag=undefined;
      if(this.annotationDrag)finishAnnotationDrag(this.annotationDrag);
      this.annotationDrag=undefined;
      this.updateAxisPointerHover();
      updateAnnotationHover([...this.axesX,...this.axesY],undefined,this.plot);
      this.invalidate();
    };
    this.publicEvents.bindDOM(el,['pointerdown','pointermove','pointerup','pointerenter','pointerleave','pointercancel','wheel']);
    for(const type of ['pointerdown','pointermove','pointerup','click','dblclick','wheel'])on(type,(event:PointerEvent)=>this.axisAtPixel(point(event))?.emitPublicInteraction(type,event));
    on('pointerenter',(event:PointerEvent)=>this.updateAxisPointerHover(this.axisAtPixel(point(event))));
    on("pointerdown", (e: PointerEvent) => {
      const p = point(e);
      if(this.legend.handlePointer('pointerdown',p,e))return;
      if(e.defaultPrevented)return;
      if (this.interaction === false) return;
      for (const u of [...this.ui].reverse())
        if (u.hitTest?.(p)) {
          u.handlePointer?.("pointerdown", p, e);
          return;
        }
      if(e.button===0&&this.kind==='xy'){
        const annotation=beginAnnotationDrag([...this.axesX,...this.axesY],p,this.plot,cancelled=>{
          if(this.annotationDrag!==cancelled)return;
          this.annotationDrag=undefined;
          try{el.releasePointerCapture?.(e.pointerId);}catch{}
          this.invalidate();
        });
        if(annotation){this.annotationDrag=annotation;this.customCursorAnnotationHold=true;activePointerId=e.pointerId;el.setPointerCapture?.(e.pointerId);annotation.annotation.emitPublicInteraction('dragstart',e,{annotation:annotation.annotation});return;}
      }
      if(this.kind==='xy'){
        const context=this.xyInteractionAt(p);if(!context)return;
        const decision=getDragInteraction(context.policy,e);if(decision.kind==='none')return;
        const axes=this.interactionAxes(p,context.axis,decision,decision.kind==='pan'?'pan':'rectangleZoom');
        if(!axes.length)return;
        this.drag={...p,mode:decision.kind==='pan'?'pan':'zoom',stopScroll:decision.stopScroll,sensitivity:decision.sensitivity,
          intervals:axes.map(axis=>({axis,interval:axis.getInterval()}))};
        activePointerId=e.pointerId;
        e.preventDefault();el.setPointerCapture?.(e.pointerId);return;
      }
      this.drag = {
        ...p,
        mode:
          this.kind === "3d"
            ? "rotate"
            : e.button === 2 || e.shiftKey
              ? "pan"
              : "zoom",
        intervals: this.axesAtPoint(p).map((axis) => ({
          axis,
          interval: axis.getInterval(),
        })),
      };
      activePointerId=e.pointerId;
      el.setPointerCapture?.(e.pointerId);
    });
    on("pointermove", (e: PointerEvent) => {
      const p = point(e);
      // A consumer can capture on an ancestor before our pending capture ever
      // activates, so the overlay may receive neither pointerup nor lostcapture.
      if(e.buttons===0&&(this.drag||this.annotationDrag))cancelGesture(e);
      if(!this.annotationDrag)this.customCursorAnnotationHold=false;
      if(!this.drag&&!this.annotationDrag&&this.legend.handlePointer('pointermove',p,e)){this.updateAxisPointerHover();updateAnnotationHover([...this.axesX,...this.axesY],undefined,this.plot);this.pointer=undefined;this.invalidate();return;}
      this.updateAxisPointerHover(this.axisAtPixel(p));
      this.pointer = p;
      if(this.kind==='xy')updateAnnotationHover([...this.axesX,...this.axesY],p,this.plot);
      if(this.annotationDrag){const dragged=this.annotationDrag;if(!updateAnnotationDrag(dragged,p,this.plot)){finishAnnotationDrag(dragged);this.annotationDrag=undefined;try{el.releasePointerCapture?.(e.pointerId);}catch{}}this.invalidate();return;}
      if (this.drag) {
        if (this.kind === "3d") {
          this.rotate3DCamera(p.x-this.drag.x,p.y-this.drag.y,e);
          this.drag.x = p.x;
          this.drag.y = p.y;
        } else if (this.drag.mode === "pan")
          for (const { axis, interval } of this.drag.intervals) {
            const range=axis.getScreenRange(),diff =
              (axis.direction === "x"
                ? -(p.x - this.drag.x) / this.plot.width
                : (p.y - this.drag.y) / this.plot.height)/(range.end-range.start)*(axis.inverted?-1:1)*(this.drag.sensitivity??1);
            if (axis.type === "logarithmic") {
              const scale = (interval.end / interval.start) ** diff;
              axis.setInterval({
                start: interval.start * scale,
                end: interval.end * scale,
                stopAxisAfter:this.drag.stopScroll??true,
              });
            } else {
              const shift = diff * (interval.end - interval.start);
              axis.setInterval({
                start: interval.start + shift,
                end: interval.end + shift,
                stopAxisAfter:this.drag.stopScroll??true,
              });
            }
          }
      }
      this.events.emit("mousemove", {
        chart: this,
        event:e,
        location: p,
        ...this.translatePoint(p, this.coordsPixel, this.coordsAxis),
      });
      this.invalidate();
    });
    on("pointerup", (e: PointerEvent) => {
      if(activePointerId!==undefined&&e.pointerId!==undefined&&e.pointerId!==activePointerId)return;
      activePointerId=undefined;
      const p = point(e);
      if(this.annotationDrag){const dragged=this.annotationDrag;this.annotationDrag=undefined;finishAnnotationDrag(dragged);try{el.releasePointerCapture?.(e.pointerId);}catch{}dragged.annotation.emitPublicInteraction('dragend',e,{annotation:dragged.annotation});this.invalidate();return;}
      if(!this.drag&&this.legend.handlePointer('pointerup',p,e))return;
      if (this.drag?.mode === "zoom") {
        for (const { axis } of this.drag.intervals) {
          const horizontal = axis.direction === "x",
            first = horizontal ? this.drag.x : this.drag.y,
            last = horizontal ? p.x : p.y;
          if (Math.abs(last - first) < 5) continue;
          const fraction = (v: number) =>
            horizontal
              ? (v - this.plot.left) / this.plot.width
              : 1 - (v - this.plot.top) / this.plot.height;
          const range=axis.getScreenRange(),a = axis.screenFractionToValue(
              Math.max(range.start, Math.min(range.end, fraction(first))),
            ),
            b = axis.screenFractionToValue(Math.max(range.start, Math.min(range.end, fraction(last))));
          if (a !== b)
            axis.setInterval({ start: Math.min(a, b), end: Math.max(a, b),stopAxisAfter:this.drag.stopScroll??true });
        }
      }
      this.drag = undefined;
      this.invalidate();
      for (const u of this.ui) u.handlePointer?.("pointerup", p, e);
    });
    on('click',(e:PointerEvent)=>{this.legend.handlePointer('click',point(e),e);});
    on("pointerleave", (e:PointerEvent) => {
      this.updateAxisPointerHover();
      updateAnnotationHover([...this.axesX,...this.axesY],undefined,this.plot);
      this.legend.handlePointer('pointerleave',point(e),e);
      if (!this.drag&&!this.annotationDrag) this.pointer = undefined;
      if(!this.drag&&!this.annotationDrag)this.dispatchCustomCursor([],{clientX:e.clientX,clientY:e.clientY});
      this.invalidate();
    });
    on("pointercancel", cancelGesture);
    on("lostpointercapture", cancelGesture);
    on("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      this.axisAtPixel(point(event))?.emitPublicInteraction('contextmenu',event);
    });
    on(
      "wheel",
      (e: WheelEvent) => {
        if (this.interaction === false||e.defaultPrevented) return;
        if (this.kind === "3d") {
          if(this.zoom3DCamera(e.deltaY,e)!==false){e.preventDefault();this.invalidate();}
          return;
        }
        if(this.kind==='xy'){
          const p=point(e as unknown as PointerEvent),context=this.xyInteractionAt(p);if(!context)return;
          const decision=getWheelInteraction(context.policy,e,this.plot.height);if(decision.kind==='none')return;
          const axes=this.interactionAxes(p,context.axis,decision,'zoom');if(!axes.length)return;
          e.preventDefault();
          for(const axis of axes){
            const r=axis.getScreenRange(),screen=axis.direction==='x'?(p.x-this.plot.left)/this.plot.width:1-(p.y-this.plot.top)/this.plot.height;
            const paneFraction=(screen-r.start)/(r.end-r.start),dataFraction=axis.inverted?1-paneFraction:paneFraction;
            const f=wheelAnchorFraction(decision.mode,dataFraction),iv=axis.getInterval(),factor=axis.limitIntervalZoomFactor(decision.factor);
            if(factor===1){axis.setInterval({...iv,stopAxisAfter:decision.stopScroll});continue;}
            const anchor=axis.type==='logarithmic'?iv.start*(iv.end/iv.start)**f:iv.start+(iv.end-iv.start)*f;
            axis.setInterval(axis.type==='logarithmic'
              ?{start:anchor*(iv.start/anchor)**factor,end:anchor*(iv.end/anchor)**factor,stopAxisAfter:decision.stopScroll}
              :{start:anchor+(iv.start-anchor)*factor,end:anchor+(iv.end-anchor)*factor,stopAxisAfter:decision.stopScroll});
          }
          return;
        }
        e.preventDefault();
        const b = el.getBoundingClientRect(),
          p = { x: e.clientX - b.left, y: e.clientY - b.top },
          factor = Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.001)));
        for (const axis of this.axesAtPoint(p)) {
          const f =
              axis.direction === "x"
                ? (p.x - this.plot.left) / this.plot.width
                : 1 - (p.y - this.plot.top) / this.plot.height,
            anchor = axis.screenFractionToValue(f),
            iv = axis.getInterval();
          axis.setInterval(
            axis.type === "logarithmic"
              ? {
                  start: anchor * (iv.start / anchor) ** factor,
                  end: anchor * (iv.end / anchor) ** factor,
                }
              : {
                  start: anchor + (iv.start - anchor) * factor,
                  end: anchor + (iv.end - anchor) * factor,
                },
          );
        }
      },
      { passive: false },
    );
    on("dblclick", (e: MouseEvent) => {
      this.events.emit("dblclick", { chart: this, event: e });
      if(e.defaultPrevented||this.interaction===false)return;
      if(this.kind==='xy'){
        const p=point(e as PointerEvent),context=this.xyInteractionAt(p);if(!context)return;
        const decision=getDoubleClickInteraction(context.policy,e);if(decision.kind==='none')return;
        const axes=this.interactionAxes(p,context.axis,decision,'restoreDefault');if(!axes.length)return;
        e.preventDefault();for(const axis of axes)axis.fit(false,decision.stopScroll);
      }else this.fit();
    });
    on("click", (e: PointerEvent) => {
      for (const u of this.ui) u.handlePointer?.("click", point(e), e);
      this.events.emit("click", { chart: this, event: e });
    });
    const restored = () => this.invalidate();
    this.canvas?.addEventListener("crychartcontextrestored", restored);
    this.cleanups.push(() =>
      this.canvas?.removeEventListener("crychartcontextrestored", restored),
    );
  }
  getRenderStats() {
    return {
      backend: this.renderer?.backend ?? "headless",
      ...(this.renderer?.stats ?? {}),
      heatmapBackend: this.heatmapRenderer ? "webgl2" : undefined,
      heatmapStats: this.heatmapRenderer
        ? { ...this.heatmapRenderer.stats }
        : undefined,
      series: this.series.length,
      samples: this.series.reduce((n, s) => n + (s.getSampleCount?.() ?? 0), 0),
      width: this.width,
      height: this.height,
      devicePixelRatio: this.dpr,
    };
  }
  private captureCanvas(): HTMLCanvasElement {
    if (this.disposed) throw new Error("Cannot export a disposed chart");
    if (!this.canvas || !this.overlay)
      throw new Error("Image export requires a browser canvas");
    this.renderNow();
    const image = document.createElement("canvas");
    image.width = this.canvas.width;
    image.height = this.canvas.height;
    const ctx = image.getContext("2d")!;
    ctx.fillStyle = fillColor(this.background).toCSS();
    ctx.fillRect(0, 0, image.width, image.height);
    if (this.underlay) ctx.drawImage(this.underlay, 0, 0);
    ctx.drawImage(this.canvas, 0, 0);
    ctx.drawImage(this.overlay, 0, 0);
    return image;
  }
  captureFrame(type = "image/png", quality = 0.92): Blob {
    const encoded = this.captureCanvas().toDataURL(type, quality),
      split = encoded.indexOf(","),
      binary = atob(encoded.slice(split + 1)),
      bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: encoded.slice(5, encoded.indexOf(";")) });
  }
  async exportToImage(options: any = {}): Promise<Blob> {
    const image = this.captureCanvas();
    return new Promise((resolve, reject) =>
      image.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Canvas image export failed")),
        options.type ?? "image/png",
        options.quality ?? 0.92,
      ),
    );
  }
  exportImage(options?: any) {
    return this.exportToImage(options);
  }
  captureImage(options?: any) {
    return this.exportToImage(options);
  }
  async downloadPNG(name = "crychart.png") {
    const blob = await this.exportToImage(),
      url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name.endsWith(".png") ? name : `${name}.png`;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  dispose() {
    if (this.disposed) return this;
    this.disposed = true;
    this.cancelAxisScrollAnimations();
    const failures:unknown[]=[],cleanup=(action:()=>void)=>{try{action();}catch(error){failures.push(error);}};
    if (this.frame && typeof cancelAnimationFrame === "function")
      cleanup(()=>cancelAnimationFrame(this.frame));
    this.frame = 0;
    cleanup(()=>this.observer?.disconnect());
    this.cleanups.forEach(cleanup);this.cleanups.length=0;
    for (const s of [...this.series]) cleanup(()=>s.dispose());
    for (const a of [...this.axesX, ...this.axesY, ...this.axesZ]) cleanup(()=>a.dispose());
    for (const u of [...this.ui]) cleanup(()=>u.dispose());
    this.ui.length=0;
    cleanup(()=>this.legend.dispose());
    cleanup(()=>this.cursor.dispose());
    cleanup(()=>this.customIcons.dispose());
    this.customCursor=undefined;this.cursorFormatting=undefined;
    this.lastCursorClient=undefined;this.lastEmptyCursorClient=undefined;
    if(this.annotationDrag)finishAnnotationDrag(this.annotationDrag);this.annotationDrag=undefined;
    cleanup(()=>this.renderer?.dispose());
    cleanup(()=>this.heatmapRenderer?.dispose());
    this.heatmapPalettes.clear();
    this.heatCache.clear();
    cleanup(()=>this.root?.remove());
    cleanup(()=>this.events.emit("dispose", { chart: this }));this.events.clear();
    cleanup(()=>this.publicEvents.dispose());
    if(failures.length)throw new AggregateError(failures,'Chart disposal completed with consumer or resource errors');
    return this;
  }
  isDisposed() {
    return this.disposed;
  }
}

type PolarCursorHit=PolarSolveResult|PolarHeatmapSolveResult;
function defaultPolarCursorRows(chart:Polar,hit:PolarCursorHit,_hits:PolarCursorHit[]):any[][]{
  const color='intensity'in hit?(Number.isFinite(hit.intensity)?hit.lut?.getColor?.(hit.intensity):undefined):fillColor(hit.series.stroke.getFillStyle());
  const rows:any[][]=[[{component:hit.series,componentColor:color,rowFillStyle:emptyFill}],['Angle','',{text:chart.getRadialAxis().formatCursorValue(hit.angle),font:{weight:'bold'}}],['Amplitude','',{text:hit.series.axisY.formatCursorValue(hit.amplitude),font:{weight:'bold'}}]];
  if('intensity'in hit)rows.push(['Value','',{text:Number.isFinite(hit.intensity)?hit.intensity.toFixed(1):String(hit.intensity),font:{weight:'bold'}}]);
  return rows;
}
export class Polar extends ChartXY {
  protected override beforeScheduledAnimationFrame(timestamp:number):void{
    if(!this.visible||this.disposed)return;
    this.advanceAxisScrollAnimations(timestamp);
    for(const series of this.series)if(series instanceof PolarSeries)series.advanceHighlight(timestamp);
  }
  protected override hasPendingAnimationFrame():boolean{
    return this.visible&&!this.disposed&&(this.hasPendingAxisScrollAnimations()||this.series.some(series=>series instanceof PolarSeries&&series.hasPendingHighlight()));
  }
  protected override cancelScheduledAnimation():void{
    this.cancelAxisScrollAnimations();
    for(const series of this.series)if(series instanceof PolarSeries)series.cancelHighlightAnimation();
  }
  override setVisible(value:boolean){
    if(!value)for(const series of this.series)if(series instanceof PolarSeries)series.suspendHighlightAnimation();
    return super.setVisible(value);
  }
  /** Keep Polar's existing theme-font extension when a label mutator changes only size. */
  getAxisTickFont() { return this.theme.polarAxisTickFont ?? this.theme.font ?? new FontSettings({size:14,family:'Segoe UI, -apple-system, Verdana, Helvetica'}); }
  protected override kind = "polar";
  override readonly coordsAxis:any={kind:'polar'};
  private polarLayout?:PolarLayout;
  private polarCursorMode:PolarSolveMode|undefined='show-nearest';
  private polarCursorFormatting?:((chart:Polar,hit:PolarCursorHit,hits:PolarCursorHit[])=>any[][]|undefined);
  protected override createDefaultAxisX(options:any){return new PolarAxisRadial(this,options);}
  private radialAxisAngle = 0;
  private polarHeatCache=new Map<number,{key:string;canvas:HTMLCanvasElement}>();
  private polarCursorScaleByAxis=new WeakMap<Axis,object>();
  private polarCursorAxisByScale=new WeakMap<object,Axis>();
  constructor(options:ChartOptions={}){
    super(options);
    // Polar's native 2D cursor does not draw XY crosshair guides by default.
    // Explicit CRY guide setters remain available for applications that opt in.
    this.cursor.setGridStrokeXStyle(emptyLine).setGridStrokeYStyle(emptyLine);
    const family='Segoe UI, -apple-system, Verdana, Helvetica';
    for(const axis of[this.getRadialAxis(),this.getAmplitudeAxis()]){
      // Defaults are resolved at draw time. A later setTickStrategy creates new
      // TickStyles and must retain the theme rather than revert to XY defaults.
      axis.setTitleFont(this.theme.axisTitleFont??new FontSettings({size:16,family}));
    }
    this.titleFont=this.theme.chartTitleFont??this.titleFont;
    this.layout();
  }
  private polarTickAppearance(axis:Axis){
    const style=axis.tickStrategy.major;
    const font=style.hasLabelFontOverride()?style.getLabelFont():this.theme.polarAxisTickFont??this.theme.font??new FontSettings({size:14,family:'Segoe UI, -apple-system, Verdana, Helvetica'});
    const label=style.hasLabelFillStyleOverride()?style.getLabelFillStyle():this.theme.tickLabelFillStyle??(this.theme.textColor?new SolidFill({color:this.theme.textColor}):new SolidFill({color:ColorRGBA(167,182,201)}));
    const grid=style.hasGridStrokeStyleOverride()?style.getGridStrokeStyle():this.theme.tickGridStrokeStyle??new SolidLine({thickness:1,fillStyle:new SolidFill({color:ColorRGBA(52,64,85)})});
    return {style,font:this.resolveTextFont(font),label,grid};
  }
  /** Internal layout bridge; callers reuse its geometry for all projections. */
  updatePolarLayout(ctx?:CanvasRenderingContext2D,legendMargin?:PolarInsets,titleMargin?:PolarInsets){
    const angular=this.getRadialAxis(),amplitude=this.getAmplitudeAxis(),angularAppearance=this.polarTickAppearance(angular),amplitudeAppearance=this.polarTickAppearance(amplitude),angularStyle=angularAppearance.style,amplitudeStyle=amplitudeAppearance.style;
    const count=Math.max(1,Math.floor((angular as any).getDivision?.()??12));
    const angularLabels=angular.visible&&!angular.disposed?Array.from({length:count},(_,index)=>{const degrees=index*360/count;return{angleRadians:this.polarAngle(degrees),text:String(angular.getTickFormattingFunction()(degrees*Math.PI/180))};}):[];
    const amplitudeTicks=amplitude.visible&&!amplitude.disposed?amplitude.ticks(5).map(tick=>({fraction:amplitude.valueToFraction(tick.value),text:tick.label})):[];
    const title=(axis:Axis)=>({text:axis.visible&&fillColor(axis.titleFill,ColorRGBA(0,0,0,0)).a>0?axis.getDisplayTitle():'',font:this.resolveTextFont(axis.titleFont)});
    this.polarLayout=computePolarLayout(ctx,{width:this.width,height:this.height,padding:this.padding,legendMargin,chartTitle:{text:this.title,font:this.resolveTextFont(this.titleFont)},chartTitleMargin:titleMargin,angularLabels,amplitudeTicks,angularFont:angularAppearance.font,amplitudeFont:amplitudeAppearance.font,amplitudeTitle:title(amplitude),angularTitle:title(angular),radialAxisAngleRadians:this.radialAxisAngle*Math.PI/180,tickLength:Math.max(angularStyle.getTickLength(),amplitudeStyle.getTickLength()),marginAfterAngularTicks:angular.getMarginAfterTicks(),marginAfterAmplitudeTicks:amplitude.getMarginAfterTicks()});
    this.plot=this.polarLayout.plot;
    for(const axis of[...this.axesX,...this.axesY])axis.setScreenRange({start:0,end:1});
  }
  getPolarLayout():PolarLayout{if(!this.polarLayout)this.layout();return this.polarLayout!;}
  /** Grid paints below data; text paints above data so center markers stay clear. */
  drawPolarAxes(ctx:CanvasRenderingContext2D,pass:'grid'|'labels'|'all'='all'){
    const layout=this.getPolarLayout(),{center,dataRadius}=layout,angular=this.getRadialAxis(),amplitude=this.getAmplitudeAxis();
    const angularAppearance=this.polarTickAppearance(angular),amplitudeAppearance=this.polarTickAppearance(amplitude);
    const stroke=(style:any,draw:()=>void)=>{
      const thickness=style?.getThickness?.()??0,ink=fillColor(style?.getFillStyle?.(),ColorRGBA(0,0,0,0));
      if(thickness<=0||ink.a<=0)return;
      ctx.lineWidth=thickness;ctx.strokeStyle=ink.toCSS();ctx.setLineDash(style?.getPattern?.()??[]);ctx.beginPath();draw();ctx.stroke();
    };
    ctx.save();ctx.setLineDash([]);
    if(pass!=='labels'&&dataRadius>0){
      for(const label of layout.labels){
        if(label.kind==='amplitude'&&label.fraction!>0&&label.fraction!<=1)stroke(amplitudeAppearance.grid,()=>ctx.arc(center.x,center.y,dataRadius*label.fraction!,0,Math.PI*2));
        else if(label.kind==='angle'){const end=polarPosition(layout,label.angleRadians!,1);stroke(angularAppearance.grid,()=>{ctx.moveTo(center.x,center.y);ctx.lineTo(end.x,end.y);});}
      }
      const axisStroke=this.theme.axisStrokeStyle;
      if(angular.visible&&!angular.disposed)stroke(axisStroke,()=>ctx.arc(center.x,center.y,dataRadius,0,Math.PI*2));
      if(amplitude.visible&&!amplitude.disposed){const end=polarPosition(layout,this.radialAxisAngle*Math.PI/180,1);stroke(axisStroke,()=>{ctx.moveTo(center.x,center.y);ctx.lineTo(end.x,end.y);});}
    }
    if(pass!=='grid')for(const label of layout.labels){
      if(!label.visible)continue;
      const title=label.kind==='amplitude-title'||label.kind==='angular-title',isAngular=label.kind==='angle'||label.kind==='angular-title',axis=isAngular?angular:amplitude;
      const ink=fillColor(title?axis.titleFill:(isAngular?angularAppearance:amplitudeAppearance).label,ColorRGBA(0,0,0,0));
      if(ink.a===0)continue;
      ctx.font=label.font.toCSS();ctx.fillStyle=ink.toCSS();ctx.textAlign='center';ctx.textBaseline='middle';
      if(Math.abs(label.rotation)<1e-12)ctx.fillText(label.text,label.x,label.y);
      else{ctx.save();ctx.translate(label.x,label.y);ctx.rotate(label.rotation);ctx.fillText(label.text,0,0);ctx.restore();}
    }
    ctx.restore();
  }
  addHeatmapSeries(options:PolarHeatmapOptions){const s=this.initializeHeatmapFillStyle(new PolarHeatmapSeries(this,options),'polarHeatmapSeriesFillStyle');this.series.push(s);this.initializeSeriesAnimation(s);this.legend.registerSeries(s,(options as any).legend);this.invalidate();return s;}
  setRadialAxisAngle(value: number) {
    if (!Number.isFinite(value))
      throw new RangeError("Radial axis angle must be finite");
    this.radialAxisAngle = value;
    this.invalidate();
    return this;
  }
  getRadialAxisAngle() {
    return this.radialAxisAngle;
  }
  setAngleOrigin(value: number) {
    if (!Number.isFinite(value))
      throw new RangeError("Angle origin must be finite");
    this.polarAngleOrigin = value;
    this.invalidate();
    return this;
  }
  getAngleOrigin() {
    return this.polarAngleOrigin;
  }
  setClockwise(value: boolean) {
    this.polarClockwise = value;
    this.invalidate();
    return this;
  }
  getClockwise() {
    return this.polarClockwise;
  }
  getAngularAxis() {
    return this.getDefaultAxisX() as PolarAxisRadial;
  }
  projectPolarPoint(
    point: { angle: number; amplitude: number },
    axis: Axis = this.getAmplitudeAxis(),
  ) {
    return polarPosition(this.getPolarLayout(),this.polarAngle(point.angle),Math.max(0,axis.valueToFraction(point.amplitude)));
  }
  getAmplitudeAxis() {
    return this.getDefaultAxisY();
  }
  getRadialAxis() {
    return this.getDefaultAxisX() as PolarAxisRadial;
  }
  /** Cursor scale is opaque; callers pass it back to translation or Cursor.setPosition. */
  getPolarCursorPosition(point:{angle:number;amplitude:number;color?:unknown},axis:Axis){
    let scale=this.polarCursorScaleByAxis.get(axis);
    if(!scale){scale=Object.freeze({});this.polarCursorScaleByAxis.set(axis,scale);this.polarCursorAxisByScale.set(scale,axis);}
    const amplitude=point.amplitude-axis.getInterval().start,angle=this.polarAngle(point.angle),cartesian={x:amplitude*Math.cos(angle),y:amplitude*Math.sin(angle),color:point.color};
    return{pointMarker:cartesian,pointMarkerScale:scale,resultTable:cartesian,resultTableScale:scale};
  }
  override translatePoint(point:any,source:any=this.coordsAxis,target:any=this.coordsPixel):any{
    const bounds=this.overlay?.getBoundingClientRect()??{left:0,top:0};
    let pixel:{x:number;y:number};
    const cursorAxis=source&&typeof source==='object'?this.polarCursorAxisByScale?.get(source):undefined;
    if(cursorAxis){
      const length=Math.hypot(point.x,point.y),fraction=cursorAxis.valueToFraction(cursorAxis.getInterval().start+length),layout=this.getPolarLayout();
      pixel={x:layout.center.x+(length?point.x/length*fraction*layout.dataRadius:0),y:layout.center.y-(length?point.y/length*fraction*layout.dataRadius:0)};
    }else if(source===this.coordsAxis||source?.kind==='polar')pixel=this.projectPolarPoint({angle:point.angle??point.x,amplitude:point.amplitude??point.y});
    else if(source?.kind==='relative')pixel={x:point.x,y:this.height-point.y};
    else if(source?.kind==='client')pixel={x:(point.clientX??point.x)-bounds.left,y:(point.clientY??point.y)-bounds.top};
    else if(source?.kind==='pixel')pixel={x:point.x,y:point.y};
    else return super.translatePoint(point,source,target);
    if(target?.kind==='pixel')return pixel;
    if(target?.kind==='client')return{clientX:pixel.x+bounds.left,clientY:pixel.y+bounds.top};
    if(target?.kind==='relative')return{x:pixel.x,y:this.height-pixel.y};
    const targetCursorAxis=target&&typeof target==='object'?this.polarCursorAxisByScale?.get(target):undefined;
    if(targetCursorAxis){const layout=this.getPolarLayout(),dx=pixel.x-layout.center.x,dy=layout.center.y-pixel.y,length=Math.hypot(dx,dy),fraction=polarInverseNormalized(layout,pixel).fraction,amplitude=targetCursorAxis.fractionToValue(fraction)-targetCursorAxis.getInterval().start;return{x:length?dx/length*amplitude:0,y:length?dy/length*amplitude:0};}
    if(target===this.coordsAxis||target?.kind==='polar'){
      const inverse=polarInverseNormalized(this.getPolarLayout(),pixel),fraction=inverse.fraction;
      const raw=(inverse.angleRadians*180/Math.PI-this.polarAngleOrigin)*(this.polarClockwise?-1:1);
      const angle=fraction<1e-12?0:((raw%360)+360)%360;
      return{angle,amplitude:this.getAmplitudeAxis().fractionToValue(fraction)};
    }
    return super.translatePoint(pixel,this.coordsPixel,target);
  }
  override translateCoordinate(point:any,sourceOrTarget:any,target?:any):any{
    if(!point)throw new TypeError('Coordinate is required');
    if(target!==undefined)return this.translatePoint(point,sourceOrTarget,target);
    const source=('angle'in point||'amplitude'in point)?this.coordsAxis:('clientX'in point||'clientY'in point)?this.coordsClient:this.coordsRelative;
    return this.translatePoint(point,source,sourceOrTarget);
  }
  setCursorMode(mode:PolarSolveMode|undefined){
    if(mode!==undefined&&!['show-nearest','show-all','show-pointed'].includes(mode))throw new RangeError('Interpolated polar cursors are not implemented');
    this.polarCursorMode=mode;super.setAutoCursorMode(mode===undefined?AutoCursorModes.disabled:AutoCursorModes.snapToClosest);return this;
  }
  getCursorMode(){return this.polarCursorMode;}
  setCursorFormatting(formatter:((chart:Polar,hit:PolarCursorHit,hits:PolarCursorHit[])=>any[][]|undefined)|undefined){
    if(formatter!==undefined&&typeof formatter!=='function')throw new TypeError('Cursor formatter must be a function');
    this.polarCursorFormatting=formatter;this.invalidate();return this;
  }
  getCursorFormatting(){return this.polarCursorFormatting??defaultPolarCursorRows;}
  solveNearest(from?:{clientX:number;clientY:number},mode:PolarSolveMode=this.polarCursorMode??'show-nearest'):PolarCursorHit[]{
    if(!['show-nearest','show-all','show-pointed'].includes(mode))throw new RangeError('Interpolated polar hit testing is not implemented');
    const coordinate=from??(this.pointer?this.translatePoint(this.pointer,this.coordsPixel,this.coordsClient):undefined);
    if(!coordinate)return[];
    // The observed public Polar method does not use the native pointed-element
    // state. Native pointer routing below performs its own shape hit selection.
    if(mode==='show-pointed')return[];
    const hits:PolarCursorHit[]=[];
    for(const series of this.series){if(!(series instanceof PolarSeries)&&!(series instanceof PolarHeatmapSeries))continue;const hit=series.solveNearest(coordinate,mode);if(hit)hits.push(hit);}
    if(mode==='show-all')return hits;
    hits.sort((a,b)=>a.distanceSquared-b.distanceSquared);
    return hits.slice(0,1);
  }
  protected override drawCursor(ctx:CanvasRenderingContext2D){
    const pointer=this.pointer,r=this.plot;
    const mouseLocation=pointer?this.translatePoint(pointer,this.coordsPixel,this.coordsClient):undefined;
    if(!pointer||this.polarCursorMode===undefined||this.getAutoCursorMode()===AutoCursorModes.disabled||pointer.x<r.left||pointer.x>r.left+r.width||pointer.y<r.top||pointer.y>r.top+r.height){
      this.cursor.positioned=false;this.cursor.resultTable.content=[];this.dispatchCustomCursor([],mouseLocation);return;
    }
    const all=this.solveNearest(undefined,'show-all'),pointed=[...all].reverse().find(hit=>{
      if(hit.series instanceof PolarHeatmapSeries)return true;
      const series=hit.series,marker=series.pointSize>0&&(fillColor(series.pointFill).a>0||series.pointStroke.getThickness()>0),width=marker?series.pointSize:series.stroke.getThickness();
      return width>0&&hit.distanceSquared<=(width/2+1)**2;
    });
    const hits=this.polarCursorMode==='show-all'?all:this.polarCursorMode==='show-pointed'?(pointed?[pointed]:[]):pointed?[pointed]:this.solveNearest();
    if(this.dispatchCustomCursor(hits,mouseLocation))return;
    if(!this.cursor.visible)return;
    if(!hits.length){this.cursor.positioned=false;this.cursor.resultTable.content=[];return;}
    const hit=hits[0]!,pixel=this.projectPolarPoint(hit,hit.series.axisY),layout=this.getPolarLayout(),cx=layout.center.x,cy=layout.center.y;
    const rows=this.getCursorFormatting()(this,hit,hits);
    this.cursor.position={x:hit.angle,y:hit.amplitude};this.cursor.positioned=true;
    this.cursor.resultTable.content=rows?(hit.series as any).formatCursorRows(hit,rows)??[]:[];
    ctx.save();ctx.beginPath();ctx.arc(cx,cy,layout.dataRadius,0,Math.PI*2);ctx.clip();
    const stroke=(style:any,draw:()=>void)=>{
      const thickness=style?.getThickness?.()??0,color=fillColor(style?.getFillStyle?.(),ColorRGBA(0,0,0,0));
      if(thickness<=0||color.a<=0)return;
      ctx.strokeStyle=color.toCSS();ctx.lineWidth=thickness;ctx.setLineDash(style?.getPattern?.()??[]);ctx.beginPath();draw();ctx.stroke();
    };
    stroke(this.cursor.gridX,()=>{const end=polarPosition(layout,this.polarAngle(hit.angle),1);ctx.moveTo(cx,cy);ctx.lineTo(end.x,end.y);});
    stroke(this.cursor.gridY,()=>ctx.arc(cx,cy,Math.hypot(pixel.x-cx,pixel.y-cy),0,Math.PI*2));
    ctx.restore();
    if(this.cursor.pointMarker){
      // Grid lines remain inside the circle; a marker whose center is inside
      // the data interval keeps its full glyph at the interval boundary.
      const fraction=hit.series.axisY.valueToFraction(hit.amplitude);
      if(fraction>=0&&fraction<=1){const color='intensity'in hit?(Number.isFinite(hit.intensity)?hit.lut?.getColor?.(hit.intensity)??ColorRGBA(255,255,255):ColorRGBA(0,0,0,0)):fillColor(hit.series.pointFill,fillColor(hit.series.stroke.getFillStyle()));ctx.save();ctx.beginPath();ctx.rect(layout.content.left,layout.content.top,layout.content.width,layout.content.height);ctx.clip();ctx.fillStyle=color.toCSS();ctx.beginPath();ctx.arc(pixel.x,pixel.y,4,0,Math.PI*2);ctx.fill();ctx.restore();}
    }
    if(this.cursor.resultVisible&&this.cursor.resultTable.content.length){
      const table=this.cursor.resultTable,layout=table.prepareLayout(ctx);
      if(layout.rich)this.cursor.drawResultTable(ctx,r,pixel,layout);
      else{table.position={x:Math.min(pixel.x+12,r.left+r.width-160),y:Math.max(r.top,pixel.y-35)};table.draw(ctx,r,point=>point,layout);}
    }
  }
  private createPolarSeries<T extends PolarSeries>(ctor:new(chart:Polar,options:SeriesOptions,kind:string)=>T,options:SeriesOptions,kind:string):T{
    const series=new ctor(this,{...options,axisX:options.axisX??options.xAxis,axisY:options.axisY??options.yAxis},kind);
    this.series.push(series);this.initializeSeriesAnimation(series);this.legend.registerSeries(series,options.legend);this.invalidate();return series;
  }
  override addLineSeries(options:SeriesOptions={}){return this.createPolarSeries(PolarLineSeries,options,'line');}
  override addPointSeries(options:SeriesOptions={}){return this.createPolarSeries(PolarPointSeries,options,'points');}
  override addPointLineSeries(options:SeriesOptions={}){
    const series=this.createPolarSeries(PolarPointLineSeries,options,'line');
    return series.setPointSize(4).setPointFillStyle(series.getStrokeStyle().getFillStyle());
  }
  protected override addSeries(options: SeriesOptions = {}, kind = "line") {
    return this.createPolarSeries(kind==='points'?PolarPointSeries:PolarLineSeries,options,kind);
  }
  protected override drawSpecial(ctx: CanvasRenderingContext2D) {
    const layout=this.getPolarLayout(),rad=layout.dataRadius,cx=layout.center.x,cy=layout.center.y;
    for (const s of this.series) {
      if(s instanceof PolarHeatmapSeries&&s.visible&&!s.disposed&&!this.renderer?.gl){this.drawPolarHeatmap(ctx,s);continue;}
      if (!(s instanceof PointLineAreaSeries) || !s.visible || s.disposed) continue;
      const strength=s instanceof PolarSeries?s.getHighlightStrength():0;
      const highlight=(color:ReturnType<typeof fillColor>)=>componentHighlightColor(color,strength,this.theme);
      if(s.kind!=='points'){
        ctx.save();ctx.beginPath();ctx.arc(cx,cy,rad,0,Math.PI*2);ctx.clip();
        ctx.strokeStyle=highlight(fillColor(s.stroke.getFillStyle())).toCSS();
        const strokeWidth=s.stroke.getThickness(),areaVisible=fillColor(s.areaFill,ColorRGBA(0,0,0,0)).a>0;
        if(strokeWidth>0)ctx.lineWidth=strokeWidth;
        ctx.setLineDash(s.stroke.getPattern?.()?.map((value:number)=>value*(s.stroke.getPatternScale?.()??1))??[]);
        ctx.beginPath();let pen=false;
        for(let i=0;i<s.getSampleCount();i++){
          const point=s.getSample(i),pixel=this.projectPolarPoint({angle:point.x,amplitude:point.y},s.axisY);
          if(!Number.isFinite(pixel.x)||!Number.isFinite(pixel.y)){if(pen&&areaVisible)ctx.closePath();pen=false;continue;}
          if(pen)ctx.lineTo(pixel.x,pixel.y);else ctx.moveTo(pixel.x,pixel.y);pen=true;
        }
        if(areaVisible){ctx.closePath();ctx.fillStyle=highlight(fillColor(s.areaFill)).toCSS();ctx.fill();}
        if(strokeWidth>0&&fillColor(s.stroke.getFillStyle(),ColorRGBA(0,0,0,0)).a>0)ctx.stroke();
        ctx.restore();
      }
      if((s.pointSize>0||s.getIndividualPointSizeEnabled())&&(fillColor(s.pointFill,ColorRGBA(0,0,0,0)).a>0||s.getIndividualPointColorEnabled()||s.pointStroke.getThickness()>0)){
        const attributes=s.drawPacket('points'),strokeWidth=s.pointStroke.getThickness(),strokeColor=highlight(fillColor(s.pointStroke.getFillStyle(),ColorRGBA(0,0,0,0)));
        ctx.save();ctx.beginPath();ctx.rect(layout.content.left,layout.content.top,layout.content.width,layout.content.height);ctx.clip();ctx.setLineDash([]);
        for(let i=0;i<s.getSampleCount();i++){
          const point=s.getSample(i),fraction=s.axisY.valueToFraction(point.y);
          // Exclude centers outside the data interval without trimming an
          // in-range point's footprint against the data circle itself.
          if(!Number.isFinite(fraction)||fraction<0||fraction>1)continue;
          const pixel=this.projectPolarPoint({angle:point.x,amplitude:point.y},s.axisY),radius=(attributes.pointSizes?.[i]??s.pointSize)/2;
          if(!Number.isFinite(pixel.x)||!Number.isFinite(pixel.y)||!(radius>0))continue;
          const colors=attributes.colors,offset=i*4;
          ctx.fillStyle=colors?(strength>0?highlight(ColorRGBA(colors[offset]!*255,colors[offset+1]!*255,colors[offset+2]!*255,colors[offset+3]!*255)).toCSS():`rgba(${colors[offset]! *255},${colors[offset+1]! *255},${colors[offset+2]! *255},${colors[offset+3]})`):highlight(fillColor(s.pointFill)).toCSS();
          ctx.beginPath();ctx.arc(pixel.x,pixel.y,radius,0,Math.PI*2);ctx.fill();
          if(strokeWidth>0&&strokeColor.a>0){ctx.strokeStyle=strokeColor.toCSS();ctx.lineWidth=strokeWidth;ctx.stroke();}
        }
        ctx.restore();
      }
    }
  }
  private drawPolarHeatmap(ctx:CanvasRenderingContext2D,s:PolarHeatmapSeries){
    const layout=this.getPolarLayout(),r=layout.plot,width=Math.ceil(r.width*this.dpr),height=Math.ceil(r.height*this.dpr),radius=r.width>0?layout.dataRadius*width/r.width:0,range=s.getRadialNodeRange(),inner=s.axisY.valueToFraction(range.start),outer=s.axisY.valueToFraction(range.end);
    if(!(radius>0)||width<1||height<1)return;
    const key=[s.revision,width,height,inner,outer,this.polarAngleOrigin,this.polarClockwise].join(':');let cached=this.polarHeatCache.get(s.id);
    if(cached?.key!==key){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d')!,image=context.createImageData(width,height),lut=s.palette?.getLUT?.();
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const dx=(x+.5-width/2)/radius,dy=(height/2-y-.5)/radius,length=Math.hypot(dx,dy);if(length>1)continue;
        const raw=(Math.atan2(dy,dx)-this.polarAngleOrigin*Math.PI/180)*(this.polarClockwise?-1:1),angular=((raw%(2*Math.PI)+2*Math.PI)%(2*Math.PI))/(2*Math.PI),value=s.sampleRenderedIntensity(angular*360,s.axisY.fractionToValue(length));if(!Number.isFinite(value))continue;
        const color=lut?.getColor(value)??fillColor(s.palette),offset=(y*width+x)*4;image.data[offset]=color.r*255;image.data[offset+1]=color.g*255;image.data[offset+2]=color.b*255;image.data[offset+3]=color.a*255;
      }context.putImageData(image,0,0);cached={key,canvas};this.polarHeatCache.set(s.id,cached);
    }ctx.drawImage(cached.canvas,r.left,r.top,r.width,r.height);
  }
  override dispose(){this.polarHeatCache?.clear();return super.dispose();}
}
export class Chart3D extends ChartXY {
  protected override usesWholeControl3DLayout(){return this.kind==='3d'&&this.cameraModel!=='legacy';}
  getAxisDefaultStrokeStyle():LineStyle|undefined{return this.theme.axisStrokeStyle;}
  get axisZ(){return this.getDefaultAxisZ()!;}
  protected override kind = "3d";
  /** Original world-camera candidate. The stable/legacy path remains isolated. */
  readonly coordsWorld:any={kind:'world3d'};
  private cameraModel:'world'|'legacy'='world';
  private worldProjection:Projection3D='perspective';
  private worldAutoFit=true;
  private worldPosition:Vec3={...DEFAULT_WORLD_ORBIT};
  private worldManualDirection?:Vec3;
  private worldFrame?:WorldCameraFrame;
  private worldFrameKey='';
  private worldFrameBuilds=0;
  private lastPublishedCameraView:string|undefined;
  protected override afterRender():void{
    if(this.disposed)return;
    const frame=this.cameraModel==='world'?this.ensureWorldFrame():undefined,location=this.getCameraLocation();
    const key=JSON.stringify([this.cameraModel,location,frame?.forward,frame?.projection,this.width,this.height,this.plot,this.boundingBox,
      this.getAxes().map(axis=>[axis.direction,this.worldAxisCacheKey(axis),axis.inverted,axis.type])]);
    if(key===this.lastPublishedCameraView)return;
    this.lastPublishedCameraView=key;
    this.events.emit('camerachange',{cameraLocation:{...location}});
  }
  private worldFitBuilds=0;
  private worldAxisConversions=new WeakMap<Axis,WorldAxisConversion>();
  private worldAnimationZoom=true;
  private worldZoomInput=new WorldZoomInput();
  private worldZoomInstant=new WorldZoomInstantInput();
  private worldZoomLastTimestamp?:number;
  private worldZoomLastStep?:WorldZoomStep;
  private worldZoomFrames=0;
  setAnimationZoom(value:boolean){
    if(typeof value!=='boolean')throw new TypeError('Zoom animation flag must be boolean');
    if(this.cameraModel==='legacy'&&value)throw new Error('Animated wheel requires the world-camera model');
    this.worldAnimationZoom=value;return this;
  }
  getAnimationZoom(){return this.cameraModel==='world'&&this.worldAnimationZoom;}
  override setAnimationsEnabled(value:boolean){super.setAnimationsEnabled(value);if(this.cameraModel==='world')this.setAnimationZoom(value);return this;}
  protected override beforeScheduledAnimationFrame(timestamp:number):void{
    super.beforeScheduledAnimationFrame(timestamp);
    if(this.cameraModel!=='world'){this.worldZoomInput.clear();this.worldZoomInstant.clear();this.worldZoomLastTimestamp=timestamp;return;}
    const elapsed=this.worldZoomLastTimestamp===undefined?undefined:timestamp-this.worldZoomLastTimestamp;this.worldZoomLastTimestamp=timestamp;
    const instantFactor=this.worldZoomInstant.takeFactor();
    if(!this.worldZoomInput.getPending()&&instantFactor===undefined)return;
    const step=this.worldZoomInput.advance(this.ensureWorldFrame().position,elapsed,instantFactor??1);this.worldZoomLastStep=step;this.worldZoomFrames++;
    this.worldPosition=step.position;this.worldManualDirection=undefined;
  }
  protected override hasPendingAnimationFrame(){return super.hasPendingAnimationFrame()||(this.cameraModel==='world'&&this.visible&&!this.disposed&&(this.worldZoomInput.getPending()!==0||this.worldZoomInstant.hasPending()));}
  protected override cancelScheduledAnimation(){super.cancelScheduledAnimation();this.worldZoomInput?.clear();this.worldZoomInstant?.clear();}
  getWorldZoomDiagnostics(){return{pending:this.worldZoomInput.getPending(),instantPending:this.worldZoomInstant.hasPending(),instantFactor:this.worldZoomInstant.getPendingFactor(),instantStoredScalars:this.worldZoomInstant.getStoredScalarCount(),frames:this.worldZoomFrames,lastTimestamp:this.worldZoomLastTimestamp,lastStep:this.worldZoomLastStep?{...this.worldZoomLastStep,position:{...this.worldZoomLastStep.position}}:undefined};}
  /** World 3D uses raw fit bounds; its converter separately reserves geometry margins. */
  getAxisDefaultFitMargins(_axis:Axis):{start:number;end:number}|undefined{
    return this.cameraModel==='world'?{start:0,end:0}:undefined;
  }
  /** Internal publication hook. Requested Axis intervals retain their public values. */
  onAxisIntervalRequested(axis:Axis,requested:{start:number;end:number}):boolean{
    if(this.cameraModel!=='world'){this.worldAxisConversions?.delete(axis);return false;}
    const setting=axis.getScrollMargins();let margin={start:0,end:0};
    if(setting===true){
      let size=0;
      for(const series of this.series){
        if(series.disposed||!(series instanceof PointLineAreaSeries))continue;
        const bound=axis.direction==='x'?series.axisX:axis.direction==='y'?series.axisY:series.axisZ;
        if(bound!==axis)continue;
        const stroke=series.kind==='points'?0:series.stroke.getThickness(),marker=series.pointSize/2;
        size=Math.max(size,Number.isFinite(stroke)?Math.max(0,stroke):0,Number.isFinite(marker)?Math.max(0,marker):0);
      }
      margin={start:size,end:size};
    }else if(setting!==false)margin={...setting};
    const scale=worldScale3D(this.boundingBox),next=createWorldAxisConversion(requested,axis.type==='logarithmic',Math.abs(scale[axis.direction])*2,margin);
    const previous=this.worldAxisConversions.get(axis),changed=!previous||previous.logarithmic!==next.logarithmic||previous.transformed.start!==next.transformed.start||previous.transformed.end!==next.transformed.end;
    this.worldAxisConversions.set(axis,next);return changed;
  }
  private axisValueToWorldFraction(axis:Axis,value:number):number{
    const conversion=this.cameraModel==='world'?this.worldAxisConversions.get(axis):undefined;
    return conversion?worldAxisValueToFraction(value,conversion,axis.inverted):axis.valueToFraction(value);
  }
  private worldFractionToAxisValue(axis:Axis,fraction:number):number{
    const conversion=this.cameraModel==='world'?this.worldAxisConversions.get(axis):undefined;
    return conversion?worldAxisFractionToValue(fraction,conversion,axis.inverted):axis.fractionToValue(fraction);
  }
  private worldAxisCacheKey(axis:Axis){return this.cameraModel==='world'?(this.worldAxisConversions.get(axis)?.transformed??axis.getInterval()):axis.getInterval();}
  private ensureWorldFrame():WorldCameraFrame{
    const viewport={left:0,top:0,width:Math.max(1,this.width),height:Math.max(1,this.height)};
    const key=JSON.stringify([viewport,this.plot,this.boundingBox,this.worldPosition,this.worldManualDirection,this.worldProjection,this.worldAutoFit]);
    if(!this.worldFrame||this.worldFrameKey!==key){
      // Perspective automatic fitting reserves a whole-control gutter. Public
      // padding controls rendering independently; it must not zoom the camera.
      const mx=Math.min(50,(viewport.width-1)/2),my=Math.min(50,(viewport.height-1)/2);
      const fitArea=this.worldAutoFit&&this.worldProjection==='perspective'
        ?{left:mx,top:my,width:viewport.width-2*mx,height:viewport.height-2*my}:undefined;
      this.worldFrame=createWorldCameraFrame({position:this.worldPosition,forward:this.worldManualDirection,projection:this.worldProjection,autoFit:this.worldAutoFit,box:this.boundingBox,viewport,clip:this.plot,fitArea});
      this.worldFrameKey=key;this.worldFrameBuilds++;if(this.worldAutoFit)this.worldFitBuilds++;
    }
    return this.worldFrame;
  }
  /** Candidate diagnostics describe its own cache; they are not a reference API. */
  getWorldCameraDiagnostics(){const frame=this.cameraModel==='world'?this.ensureWorldFrame():undefined;return{model:this.cameraModel,frameBuilds:this.worldFrameBuilds,fitBuilds:this.worldFitBuilds,fit:frame?.fit,viewport:frame?.viewport,clip:frame?.clip,safe:frame?.safe,near:frame?.near,far:frame?.far};}
  setProjection(value:Projection3D){if(value!=='perspective'&&value!=='orthographic')throw new TypeError('Unknown 3D projection');this.cameraModel='world';this.worldProjection=value;this.invalidate();return this;}
  getProjection():Projection3D{return this.cameraModel==='legacy'?'orthographic':this.worldProjection;}
  setCameraAutomaticFittingEnabled(value:boolean){
    if(typeof value!=='boolean')throw new TypeError('Automatic fitting flag must be boolean');
    if(this.cameraModel==='world'&&!value&&this.worldAutoFit){const frame=this.ensureWorldFrame();this.worldPosition={...frame.position};this.worldManualDirection={...frame.forward};}
    this.cameraModel='world';this.worldAutoFit=value;this.invalidate();return this;
  }
  getCameraAutomaticFittingEnabled(){return this.cameraModel==='world'&&this.worldAutoFit;}
  getCameraDirection():Vec3{
    if(this.cameraModel==='world')return{...this.ensureWorldFrame().forward};
    const a=this.camera.azimuth,e=this.camera.elevation;return{x:-Math.cos(e)*Math.sin(a),y:-Math.sin(e),z:-Math.cos(e)*Math.cos(a)};
  }
  protected override rotate3DCamera(dx:number,dy:number,event?:PointerEvent):void{
    if(this.cameraModel==='legacy'){super.rotate3DCamera(dx,dy,event);return;}
    const interactions=this.getUserInteractions();
    if(interactions===false||interactions===undefined||interactions?.rotate===false)return;
    const rotate=interactions?.rotate;
    let drag=rotate?.drag;
    for(const [pressed,key]of [[event?.ctrlKey,'ctrl'],[event?.shiftKey,'shift'],[event?.altKey,'alt']] as const)if(pressed){drag=rotate?.[key]?.drag??false;break;}
    if(drag===false)return;
    const sensitivity=rotate?.sensitivity??1;
    this.worldPosition=orbitWorldCamera3D(this.ensureWorldFrame().position,dx,dy,sensitivity);this.worldManualDirection=undefined;
  }
  protected override zoom3DCamera(delta:number,event?:WheelEvent):boolean|void{
    if(this.cameraModel==='legacy'){super.zoom3DCamera(delta,event);return;}
    const interactions=this.getUserInteractions(),zoom=interactions?.zoom;
    if(interactions===false||interactions===undefined||zoom===false||zoom?.camera===false)return false;
    let wheel=zoom?.wheel;for(const [pressed,key]of [[event?.ctrlKey,'ctrl'],[event?.shiftKey,'shift'],[event?.altKey,'alt']] as const)if(pressed){wheel=zoom?.[key]?.wheel??false;break;}
    if(wheel===false)return false;
    const sensitivity=zoom?.sensitivity??1,frame=this.ensureWorldFrame();
    if(!Number.isFinite(delta)||!Number.isFinite(sensitivity))throw new RangeError('Wheel input must be finite');
    if(delta===0||sensitivity===0)return false;
    if(this.worldAnimationZoom){this.worldZoomInput.enqueue(delta,sensitivity);this.worldPosition={...frame.position};}
    else{this.worldZoomInstant.enqueue(delta,sensitivity);this.worldPosition={...frame.position};}
    this.worldAutoFit=false;this.worldManualDirection=undefined;return true;
  }
  override translateCoordinate(point:any,sourceOrTarget:any,target?:any):any{
    if(this.cameraModel==='legacy')return this.translateLegacy3DCoordinate(point,sourceOrTarget,target);
    if(!point)throw new TypeError('Coordinate is required');
    if(!('z'in point))return super.translateCoordinate(point,sourceOrTarget,target);
    const source=target===undefined?this.coordsAxis:sourceOrTarget,destination=(target===undefined?sourceOrTarget:target)??this.coordsPixel;
    if(source?.kind==='client'||source?.kind==='pixel'||source?.kind==='relative')return super.translateCoordinate(point,sourceOrTarget,target);
    if(![point.x,point.y,point.z].every(value=>typeof value==='number'))throw new TypeError('3D coordinates require numeric x, y and z');
    let normalized:Vec3;
    if(source===this.coordsWorld||source?.kind==='world3d')normalized=worldToNormalized3D(point,this.boundingBox);
    else if(source?.kind)throw new TypeError('Unsupported 3D source coordinate system');
    else{const axes=[source?.x??this.getDefaultAxisX(),source?.y??this.getDefaultAxisY(),source?.z??this.getDefaultAxisZ()];normalized={x:this.axisValueToWorldFraction(axes[0]!,point.x)*2-1,y:this.axisValueToWorldFraction(axes[1]!,point.y)*2-1,z:this.axisValueToWorldFraction(axes[2]!,point.z)*2-1};}
    if(destination===this.coordsWorld||destination?.kind==='world3d')return normalizedToWorld3D(normalized,this.boundingBox);
    if(destination?.kind===undefined){const axes=[destination?.x??this.getDefaultAxisX(),destination?.y??this.getDefaultAxisY(),destination?.z??this.getDefaultAxisZ()];return{x:this.worldFractionToAxisValue(axes[0]!, (normalized.x+1)/2),y:this.worldFractionToAxisValue(axes[1]!, (normalized.y+1)/2),z:this.worldFractionToAxisValue(axes[2]!, (normalized.z+1)/2)};}
    if(destination.kind!=='client'&&destination.kind!=='pixel'&&destination.kind!=='relative')throw new TypeError('Unsupported 3D projection target');
    const pixel=projectWorldNormalized3D(normalized,this.ensureWorldFrame());
    if(destination.kind==='pixel')return{x:pixel.x,y:pixel.y};
    if(destination.kind==='relative')return{x:pixel.x,y:this.height-pixel.y};
    const bounds=this.overlay?.getBoundingClientRect()??{left:0,top:0};return{clientX:pixel.x+bounds.left,clientY:pixel.y+bounds.top};
  }

  private boundingBox={x:1,y:1,z:1};
  private boundingBoxStroke:LineStyle|undefined;
  setBoundingBoxStrokeStyle(value:ValueOrMutator<LineStyle>){
    const stroke=mutate(this.getBoundingBoxStrokeStyle(),value);
    if(!stroke||typeof stroke.getThickness!=='function'||typeof stroke.getFillStyle!=='function')throw new TypeError('Bounding box stroke requires a line style');
    this.boundingBoxStroke=stroke;this.invalidate();return this;
  }
  getBoundingBoxStrokeStyle():import('./core/styles.js').LineStyle{
    if(this.boundingBoxStroke!==undefined)return this.boundingBoxStroke;
    return new SolidLine({thickness:1,fillStyle:new SolidFill({color:fillColor(this.background).r>.5?ColorRGBA(130,148,165):ColorRGBA(113,128,153)})});
  }
  private gpu3d?: DataRenderer3D;
  /** Equal endpoints and a finite monotonic source certificate prove an
   * entire retained coordinate is constant, including hidden rows and gaps. */
  protected getConstantCoordinates(series:PointLineAreaSeries):Partial<Vec3>{
    const data=series.getDataSet(),mapping=series.getDataMapping(),count=data.getSampleCount(),constant:Partial<Vec3>={};
    if(!count)return constant;
    for(const dimension of ['x','y','z'] as const){
      const key=mapping[dimension];
      if(!key||!data.schema[key]){if(dimension==='z')constant.z=0;continue;}
      const first=data.getValue(key,0),last=data.getValue(key,count-1);
      if(first!==last||!Number.isFinite(first))continue;
      const order=getColumnOrder(data,key);
      if(order.finite&&order.monotonic)constant[dimension]=first;
    }
    return constant;
  }
  private gpuPackets = new Map<number, { key: string; packet: DrawPacket3D; markers?:DrawPacket3D }>();
  private gpuRevision = 0;
  constructor(options: ChartOptions = {}) {
    super({ ...options, antialias: options.antialias ?? true });
    this.cameraModel=options.experimental3DCameraModel==='legacy'?'legacy':'world';
    this.axesZ.push(new Axis(this, "z", options.defaultAxisZ));
    this.coordsAxis.z=this.axesZ[0];
    if (this.renderer?.gl && this.canvas)
      this.gpu3d = new DataRenderer3D(this.renderer.gl, this.canvas);
    this.invalidate();
  }
  /** Project full XYZ axis coordinates with the existing original GPU camera
   * model. This API-only repair does not change any draw or camera defaults. */
  private translateLegacy3DCoordinate(point:any,sourceOrTarget:any,target?:any):any{
    if(!point)throw new TypeError('Coordinate is required');
    if(!('z' in point))return super.translateCoordinate(point,sourceOrTarget,target);
    const source=target===undefined?this.coordsAxis:sourceOrTarget;
    const destination=(target===undefined?sourceOrTarget:target)??this.coordsPixel;
    // Client/pixel/relative 2D translations retain their previous contract.
    if(source?.kind==='client'||source?.kind==='pixel'||source?.kind==='relative')return super.translateCoordinate(point,sourceOrTarget,target);
    if(source?.kind)throw new TypeError('Unsupported 3D source coordinate system');
    const axes=[source?.x??this.getDefaultAxisX(),source?.y??this.getDefaultAxisY(),source?.z??this.getDefaultAxisZ()];
    const values=[point.x,point.y,point.z];
    if(values.some(value=>typeof value!=='number'))throw new TypeError('3D coordinates require numeric x, y and z');
    const fractions=values.map((value,index)=>axes[index]!.valueToFraction(value));
    if(destination?.kind===undefined){
      const outputAxes=[destination?.x??this.getDefaultAxisX(),destination?.y??this.getDefaultAxisY(),destination?.z??this.getDefaultAxisZ()];
      const mapped=fractions.map((fraction,index)=>axes[index]===outputAxes[index]?values[index]:outputAxes[index]!.fractionToValue(fraction));
      return{x:mapped[0],y:mapped[1],z:mapped[2]};
    }
    if(destination.kind!=='client'&&destination.kind!=='pixel'&&destination.kind!=='relative')throw new TypeError('This 3D projection supports axis, client, pixel and relative targets');
    // DataRenderer3D receives Float32 normalized positions. Match that input
    // conversion, then reuse its camera matrix, volume and viewport transform.
    const normalized={x:Math.fround(fractions[0]!*2-1),y:Math.fround(fractions[1]!*2-1),z:Math.fround(fractions[2]!*2-1)};
    const pixel=projectNormalized3D(normalized,this.plot,{...this.camera,boundingBox:this.boundingBox});
    if(destination.kind==='pixel')return{x:pixel.x,y:pixel.y};
    if(destination.kind==='relative')return{x:pixel.x,y:this.height-pixel.y};
    const bounds=this.overlay?.getBoundingClientRect()??{left:0,top:0};
    return{clientX:pixel.x+bounds.left,clientY:pixel.y+bounds.top};
  }

  private geometry3D<T extends Series3DBase>(ctor:new(chart:Chart3D,options:any)=>T,options:any):T{const s=new ctor(this,options);this.series.push(s);this.initializeSeriesAnimation(s);this.legend.registerSeries(s,options.legend);this.invalidate();return s;}
  override addBoxSeries(options:any={}){return this.geometry3D(BoxSeries3D,options);}
  override addSurfaceGridSeries(options:any={}){return this.geometry3D(SurfaceGrid3D,options);}
  addSurfaceMeshSeries(options:any={}){return this.geometry3D(SurfaceMesh3D,options);}
  addMeshModel(options:any={}){return this.geometry3D(MeshModel3D,options);}
  override solveNearest(from?:CoordinateClient,mode:SolveNearestMode=this.getCursorMode()??'show-nearest'):any[]{
    validateSolveMode(mode);
    const client=from??(this.pointer?this.translatePoint(this.pointer,this.coordsPixel,this.coordsClient):undefined);
    if(!client||mode==='show-pointed')return[];
    const hits:any[]=[];
    for(const series of this.series){
      if(series.disposed||!series.visible||series.cursorEnabled===false)continue;
      if(series instanceof SurfaceGrid3D){const hit=series.solveNearest3D(client);if(hit)hits.push(hit);}
    }
    hits.sort((a,b)=>a.distanceSquared-b.distanceSquared);
    return mode==='show-all'?hits:hits.slice(0,1);
  }
  protected override drawCursor(ctx:CanvasRenderingContext2D){
    const mode=this.getCursorMode(),pointer=this.pointer,mouse=pointer?this.translatePoint(pointer,this.coordsPixel,this.coordsClient):undefined;
    const inside=pointer&&pointer.x>=this.plot.left&&pointer.x<=this.plot.left+this.plot.width&&pointer.y>=this.plot.top&&pointer.y<=this.plot.top+this.plot.height;
    let hits=inside&&mode!==undefined&&this.getAutoCursorMode()!==AutoCursorModes.disabled?this.solveNearest(mouse,mode==='show-pointed'?'show-all':mode):[];
    if(mode==='show-pointed')hits=hits.filter(hit=>hit.distanceSquared<=9).slice(0,1);
    if(this.dispatchCustomCursor(hits,mouse))return;
    const hit=hits[0];
    if(!hit||!this.cursor.visible){this.cursor.positioned=false;this.cursor.resultTable.content=[];return;}
    const formatter=this.getCursorFormatting();
    const rows=formatter===defaultXYCursorRows?[[{component:hit.series}],...(['x','y','z'] as const).map(dimension=>{const axis=hit['axis'+dimension.toUpperCase()];return[axis.getTitle()||dimension.toUpperCase(),'',{text:axis.formatCursorValue(hit[dimension]),font:{weight:'bold'}}];})]:formatter(this,hit,hits);
    const positions=hits.map(item=>item.cursorPosition),previous=this.cursor.getPositions();
    if(previous.length!==positions.length||positions.some((position,index)=>['x','y','z'].some(key=>position.pointMarker[key]!==previous[index]?.pointMarker[key])))this.cursor.setPosition(...positions);
    this.cursor.resultTable.content=rows??[];
    this.cursor.draw(ctx,this.plot,(point,scale)=>this.translateCoordinate(point,scale??this.coordsAxis,this.coordsPixel));
  }
  protected override renderData(_packets: DrawPacket[]) {
    const worldFrame=this.cameraModel==='world'?this.ensureWorldFrame():undefined;
    if (!this.gpu3d) {
      super.renderData([]);
      return;
    }
    const packets: DrawPacket3D[] = [],
      live = new Set<number>();
    for (const s of this.series) {
      if (!s.visible || s.disposed) continue;
      live.add(s.id);
      const axes = [
        s.axisX ?? this.getDefaultAxisX(),
        s.axisY ?? this.getDefaultAxisY(),
        s.axisZ ?? this.getDefaultAxisZ(),
      ];
      const normalize = (value: number, index: number) =>
        this.axisValueToWorldFraction(axes[index]!,value) * 2 - 1;
      if(s instanceof Series3DBase){packets.push(...s.getDrawPackets(normalize,JSON.stringify(axes.map(a=>[this.worldAxisCacheKey(a),a.inverted,a.type]))));continue;}
      const sourceConstants=s instanceof PointLineAreaSeries?this.getConstantCoordinates(s):{};
      // Use exactly the Float32 coordinates that full CPU normalization stored.
      // The GPU receives these unchanged values, with no affine approximation.
      const constantCoordinates:Partial<Vec3>={};
      for(const [index,dimension]of(['x','y','z'] as const).entries()){
        const value=sourceConstants[dimension];
        if(value!==undefined)constantCoordinates[dimension]=Math.fround(normalize(value,index));
      }
      if(Object.values(constantCoordinates).some(value=>!Number.isFinite(value)))continue;
      const key = JSON.stringify([
        s instanceof PointLineAreaSeries
          ? [s.getDataSet().revision, s.getDataBindingRevision(),s.getStyleRevision()]
          : s.revision,
        axes.map((a,index) => sourceConstants[(['x','y','z'] as const)[index]!]!==undefined?null:[this.worldAxisCacheKey(a), a.inverted,a.type]),
        s instanceof SurfaceGridSeries
          ? [s.start, s.step, s.fill]
          : s.getDataMapping?.(),
      ]);
      let cached = this.gpuPackets.get(s.id);
      if (!cached || cached.key !== key) {
        let positions: Float32Array,
          colors: Float32Array | undefined,
          pointSizes:Float32Array|undefined,
          pointShape:DrawPacket3D['pointShape'],
          count: number,
          mode: DrawPacket3D["mode"],markers:DrawPacket3D|undefined;
        if (s instanceof SurfaceGridSeries) {
          count = Math.max(0, (s.columns - 1) * (s.rows - 1) * 6);
          positions = new Float32Array(count * 3);
          colors = new Float32Array(count * 4);
          mode = "triangles";
          let vertex = 0;
          for (let row = 0; row < s.rows - 1; row++)
            for (let col = 0; col < s.columns - 1; col++)
              for (const [dc, dr] of [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
                [1, 1],
                [0, 1],
              ]) {
                const c = col + dc!,
                  r = row + dr!,
                  value = s.values[r * s.columns + c]!,
                  y = normalize(value, 1),
                  f = Math.max(0, Math.min(1, (y + 1) / 2));
                positions[vertex * 3] = normalize(s.start.x + c * s.step.x, 0);
                positions[vertex * 3 + 1] = y;
                positions[vertex * 3 + 2] = normalize(
                  s.start.z + r * s.step.z,
                  2,
                );
                const color =
                  s.fill?.lut?.getColor?.(value) ?? s.fill?.getColor?.();
                colors[vertex * 4] = color?.r ?? 0.15 + f * 0.55;
                colors[vertex * 4 + 1] = color?.g ?? 0.3 + f * 0.6;
                colors[vertex * 4 + 2] = color?.b ?? 0.8 - f * 0.6;
                colors[vertex * 4 + 3] = color?.a ?? 1;
                vertex++;
              }
        } else if (s instanceof PointLineAreaSeries) {
          count = s.getSampleCount();
          positions = new Float32Array(count * 3);
          mode = s.kind === "points" ? "points" : "line";
          const data=s.getDataSet(),mapping=s.getDataMapping(),x=data.getColumn(mapping.x!),y=data.getColumn(mapping.y!),z=mapping.z&&data.schema[mapping.z]?data.getColumn(mapping.z):undefined;
          for (let i = 0; i < count; i++) {
            positions[i * 3] = sourceConstants.x!==undefined?0:normalize(x[i]!, 0);
            positions[i * 3 + 1] = sourceConstants.y!==undefined?0:normalize(y[i]!, 1);
            positions[i * 3 + 2] = sourceConstants.z!==undefined?0:normalize(z?.[i]??0, 2);
          }
          const pointAttributes=(mode==='points'||s.pointSize>0)?s.drawPacket('points'):undefined;
          pointSizes=pointAttributes?.pointSizes;const shape=s.getPointShape();pointShape=shape===0||shape==='square'?'square':shape==='sphere'?'sphere':'circle';
          if(mode==='points')colors=pointAttributes?.colors;
          else {
            if(s.pointSize>0){const color=fillColor(s.pointFill);markers={id:-s.id,revision:++this.gpuRevision,positions,colors:pointAttributes?.colors,pointSizes,pointShape,count,mode:'points',color:[color.r,color.g,color.b,color.a],thickness:0,pointSize:s.pointSize};}
            const fill=s.stroke.getFillStyle(),lut=(fill as any).getLUT?.();
            if(lut){const property=(fill as any).getLookUpProperty(),column=mapping[property]??property,values=data.schema[column]?data.getColumn(column):new Float64Array(count).fill(NaN),mapped=colorMappedLine3D(positions,values,lut);positions=mapped.positions;colors=mapped.colors;count=positions.length/3;}
          }
        } else continue;
        cached = {
          key,
          markers,
          packet: {
            id: s.id,
            revision: ++this.gpuRevision,
            positions,
            colors,
            count,
            mode,
            color: [1, 1, 1, 1],
            thickness: 1,
            pointSize: 3,
            pointSizes,
            pointShape,
          },
        };
        this.gpuPackets.set(s.id, cached);
      }
      const packet = cached.packet;
      packet.constantCoordinates=constantCoordinates;
      if(cached.markers)cached.markers.constantCoordinates=constantCoordinates;
      if (s instanceof PointLineAreaSeries) {
        const color = s.resolveRenderColor(fillColor(
          s.kind === "points" ? s.pointFill : s.stroke.getFillStyle(),
        ));
        packet.color = [color.r, color.g, color.b, color.a];
        packet.thickness = s.stroke.getThickness();
        packet.pointSize = s.pointSize;
        packet.unshaded=s.getColorShadingStyle()?.type==='simple';
        packet.worldStyleUnits = this.cameraModel==='world'&&((s.kind==='line'&&packet.thickness>0)||(s.kind==='points'&&packet.pointShape==='sphere'));
      }
      packets.push(packet);
      if (
        s instanceof PointLineAreaSeries &&
        s.kind !== "points" &&
        s.pointSize > 0 &&
        fillColor(s.pointFill).a > 0
      ) {
        if(cached.markers){cached.markers.unshaded=s.getColorShadingStyle()?.type==='simple';const strength=s.getHighlightStrength();if(strength>0){const color=s.resolveRenderColor(fillColor(s.pointFill));packets.push({...cached.markers,color:[color.r,color.g,color.b,color.a]});}else packets.push(cached.markers);}
      }
    }
    for (const id of this.gpuPackets.keys())
      if (!live.has(id)) this.gpuPackets.delete(id);
    this.gpu3d.render(packets, worldFrame?.viewport??this.plot, this.dpr, {...this.camera,boundingBox:this.boundingBox,worldFrame});
  }
  override getRenderStats() {
    return {
      ...super.getRenderStats(),
      ...(this.gpu3d ? this.gpu3d.stats : {}),
      backend: this.gpu3d
        ? "webgl2-3d"
        : (this.renderer?.backend ?? "headless"),
    };
  }
  override dispose() {
    this.cancelScheduledAnimation();this.worldZoomLastTimestamp=undefined;this.worldZoomLastStep=undefined;
    this.gpu3d?.dispose();
    this.gpuPackets?.clear();
    this.worldAxisConversions=new WeakMap();
    return super.dispose();
  }
  override getDefaultAxisZ() {
    return this.axesZ[0]!;
  }
  addAxisZ(options: any = {}) {
    const a = new Axis(this, "z", options);
    this.axesZ.push(a);
    return a;
  }
  setCameraLocation(value: any) {
    if(!value||typeof value!=='object')throw new TypeError('3D camera location is required');
    if('azimuth'in value||'elevation'in value||'zoom'in value){
      const next={...this.camera,...value};if(![next.azimuth,next.elevation,next.zoom].every(Number.isFinite)||next.zoom<=0)throw new RangeError('Legacy camera must be finite with positive zoom');
      this.camera=next;this.cameraModel='legacy';
    }else{const next=clampManualCamera3D(value);this.worldPosition=next;this.worldManualDirection=undefined;this.cameraModel='world';}
    this.invalidate();return this;
  }
  getCameraLocation():any {return this.cameraModel==='legacy'?{...this.camera}:{...this.ensureWorldFrame().position};}

  setBoundingBox(value:{x:number;y:number;z:number}){
    cameraVolumeScale({...this.camera,boundingBox:value});
    this.boundingBox={...value};this.invalidate();return this;
  }
  getBoundingBox(){return{...this.boundingBox};}
  private project(x: number, y: number, z: number) {
    if(this.cameraModel==='world'){const p=projectWorldNormalized3D({x,y,z},this.worldFrame??this.ensureWorldFrame());return p.visible?p:{...p,x:NaN,y:NaN};}
    const volume=cameraVolumeScale({...this.camera,boundingBox:this.boundingBox});x*=volume.x;y*=volume.y;z*=volume.z;
    const a = this.camera.azimuth,
      e = this.camera.elevation,
      rx = x * Math.cos(a) - z * Math.sin(a),
      rz = x * Math.sin(a) + z * Math.cos(a),
      ry = y * Math.cos(e) - rz * Math.sin(e),
      depth = y * Math.sin(e) + rz * Math.cos(e),
      r = this.plot,
      scale = Math.min(r.width, r.height) * 0.34 * this.camera.zoom;
    return {
      x: r.left + r.width / 2 + rx * scale,
      y: r.top + r.height / 2 - ry * scale,
      depth,
    };
  }
  protected override drawSpecial(ctx: CanvasRenderingContext2D) {
    const worldFrame=this.cameraModel==='world'?this.ensureWorldFrame():undefined;
    const normalize = (value: number, axis: Axis) =>
      this.axisValueToWorldFraction(axis,value) * 2 - 1;
    const project = (x: number, y: number, z: number) =>
      this.project(
        normalize(x, this.getDefaultAxisX()),
        normalize(y, this.getDefaultAxisY()),
        normalize(z, this.getDefaultAxisZ()),
      );
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.plot.left, this.plot.top, this.plot.width, this.plot.height);
    ctx.clip();
    let gridStroke:any,gridLength=1;
    const line = (a: [number, number, number], b: [number, number, number]) => {
      if(gridStroke!==undefined){
        const ink=fillColor(gridStroke.getFillStyle?.()),width=gridStroke.getThickness?.()??0;
        if(!(width>0)||ink.a<=0||gridLength<=0)return;
        ctx.strokeStyle=ink.toCSS();ctx.lineWidth=width;
        ctx.setLineDash(gridStroke.getPattern?.().map((v:number)=>v*(gridStroke.getPatternScale?.()??1))??[]);
        b=a.map((value,index)=>value+(b[index]!-value)*gridLength) as [number,number,number];
      }
      const clipped=worldFrame?clipWorldSegment3D({x:a[0],y:a[1],z:a[2]},{x:b[0],y:b[1],z:b[2]},worldFrame):undefined;
      if(worldFrame&&!clipped)return;
      const p = clipped?.[0]??this.project(...a),q = clipped?.[1]??this.project(...b);
      if(!Number.isFinite(p.x+p.y+q.x+q.y))return;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    };
    const light = fillColor(this.background).r > 0.5;
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = light ? "#cdd6df" : "#344456";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    type TextBox={left:number;top:number;right:number;bottom:number;x:number;y:number};
    const labelBoxes:TextBox[]=[];
    const labelCommands:Array<{value:string;box:TextBox;font:string;fill:string;rotation:number}>=[];
    const tickRequests:Axis3DTickRequest[]=[];
    const labelBox=(value:string,x:number,y:number,outer=false,rotation=0):TextBox=>{
      const bounds=outer?{left:0,top:32,width:this.width,height:Math.max(1,this.height-32)}:this.plot;
      const metrics=ctx.measureText(value),half=metrics.width/2,ascent=metrics.actualBoundingBoxAscent??11,descent=metrics.actualBoundingBoxDescent??3,c=Math.cos(rotation),s=Math.sin(rotation);
      const corners=[[-half,-ascent],[half,-ascent],[-half,descent],[half,descent]].map(([dx,dy])=>({x:dx!*c-dy!*s,y:dx!*s+dy!*c}));
      const minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y)),maxY=Math.max(...corners.map(p=>p.y));
      x=Math.max(bounds.left+2-minX,Math.min(bounds.left+bounds.width-2-maxX,x));y=Math.max(bounds.top+2-minY,Math.min(bounds.top+bounds.height-2-maxY,y));
      return {left:x+minX,top:y+minY,right:x+maxX,bottom:y+maxY,x,y};
    };
    const paintLabels=()=>{ctx.save();ctx.textAlign='center';ctx.textBaseline='alphabetic';for(const item of labelCommands){ctx.font=item.font;ctx.fillStyle=item.fill;if(item.rotation){ctx.save();ctx.translate(item.box.x,item.box.y);ctx.rotate(item.rotation);ctx.fillText(item.value,0,0);ctx.restore();}else ctx.fillText(item.value,item.box.x,item.box.y);}ctx.restore();};
    const axes = [
      this.getDefaultAxisX(),
      this.getDefaultAxisY(),
      this.getDefaultAxisZ(),
    ];
    const strokeStyle=(style:any)=>{const ink=fillColor(style?.getFillStyle?.(),ColorRGBA(0,0,0,0)),width=style?.getThickness?.()??0;ctx.strokeStyle=ink.toCSS();ctx.lineWidth=width;ctx.setLineDash(style?.getPattern?.()??[]);return width>0&&ink.a>0;};
    type WorldAxisEdge=[[number,number,number],[number,number,number]];
    const floorY=worldFrame&&worldFrame.position.y<0?1:-1;
    const edgeScore=(edge:WorldAxisEdge,key:'x'|'y')=>{const a=this.project(...edge[0]),b=this.project(...edge[1]);return(a[key]+b[key])/2;};
    const chooseEdge=(edges:WorldAxisEdge[],key:'x'|'y',largest:boolean)=>edges.reduce((best,next)=>(edgeScore(next,key)-edgeScore(best,key))*(largest?1:-1)>0?next:best);
    const worldEdges:WorldAxisEdge[]=worldFrame?[
      chooseEdge([-1,1].map(z=>[[-1,floorY,z],[1,floorY,z]] as WorldAxisEdge),'y',true),
      chooseEdge([-1,1].flatMap(x=>[-1,1].map(z=>[[x,-1,z],[x,1,z]] as WorldAxisEdge)),'x',false),
      chooseEdge([-1,1].map(x=>[[x,floorY,-1],[x,floorY,1]] as WorldAxisEdge),'x',true)
    ]:[];
    axes.forEach((axis, dimension) => {
      if (!axis.visible) return;
      const edgeStart=worldFrame?this.project(...worldEdges[dimension]![0]):dimension===0?this.project(-1,-1,1):dimension===1?this.project(-1,-1,1):this.project(1,-1,-1);
      const edgeEnd=worldFrame?this.project(...worldEdges[dimension]![1]):dimension===0?this.project(1,-1,1):dimension===1?this.project(-1,1,1):this.project(1,-1,1);
      const center=this.project(0,0,0),tangent={x:edgeEnd.x-edgeStart.x,y:edgeEnd.y-edgeStart.y},outward={x:(edgeStart.x+edgeEnd.x)/2-center.x,y:(edgeStart.y+edgeEnd.y)/2-center.y};
      const ticks=axis.tickLayout(Math.hypot(tangent.x,tangent.y));
      for(const level of ['minor','major'] as const){
      const tickStyle=axis.tickStrategy[level];
      const tickFont=this.resolveTextFont(tickStyle.hasLabelFontOverride()?tickStyle.getLabelFont():this.theme.font??tickStyle.getLabelFont());
      const themedGrid=level==='minor'?this.theme.minorTickGridStrokeStyle??this.theme.tickGridStrokeStyle:this.theme.tickGridStrokeStyle;
      gridStroke=tickStyle.hasGridStrokeStyleOverride()?tickStyle.getGridStrokeStyle():themedGrid??tickStyle.getGridStrokeStyle();
      gridLength=Math.max(0,Math.min(1,tickStyle.getGridStrokeLength()));
      for (const tick of ticks[level]) {
        const f = this.axisValueToWorldFraction(axis,tick.value) * 2 - 1;
        if (f < -1 || f > 1) continue;
        let marker,preferred;
        if(worldFrame){
          const edge=worldEdges[dimension]!,coordinates=[...edge[0]] as [number,number,number];coordinates[dimension]=f;marker=this.project(...coordinates);
          const backZ=-worldEdges[0]![0][2],sideX=worldEdges[1]![0][0];
          if(dimension===0){line([f,floorY,-1],[f,floorY,1]);line([f,-1,backZ],[f,1,backZ]);preferred={x:marker.x,y:marker.y+15};}
          else if(dimension===1){line([-1,f,backZ],[1,f,backZ]);line([sideX,f,-1],[sideX,f,1]);preferred={x:marker.x-18,y:marker.y+4};}
          else{line([-1,floorY,f],[1,floorY,f]);line([sideX,-1,f],[sideX,1,f]);preferred={x:marker.x+16,y:marker.y+10};}
        }else if (dimension === 0) {
          line([f, -1, -1], [f, -1, 1]);
          line([f, -1, -1], [f, 1, -1]);
          marker = this.project(f, -1, 1);
          preferred={x:marker.x,y:marker.y+15};
        } else if (dimension === 1) {
          line([-1, f, -1], [1, f, -1]);
          line([-1, f, -1], [-1, f, 1]);
          marker = this.project(-1, f, 1);
          preferred={x:marker.x-18,y:marker.y+4};
        } else {
          line([-1, -1, f], [1, -1, f]);
          line([-1, -1, f], [-1, 1, f]);
          marker = this.project(1, -1, f);
          preferred={x:marker.x+16,y:marker.y+10};
        }
        const labelInk=fillColor(resolvedTickFill(axis,level,tickStyle,this.theme));
        if(tick.label&&labelInk.a>0)tickRequests.push({axis:dimension,order:f,text:tick.label,preferred,tangent,outward,font:tickFont.toCSS(),fill:labelInk.toCSS()});
      }
      }
    });
    gridStroke=undefined;gridLength=1;ctx.setLineDash([]);
    const tickLayout=layoutAxis3DTicks(ctx,tickRequests,{left:0,top:32,width:this.width,height:Math.max(1,this.height-32)});
    for(const tick of tickLayout.labels){labelBoxes.push(tick);labelCommands.push({value:tick.text,box:tick,font:tick.font!,fill:tick.fill!,rotation:0});}
    ctx.strokeStyle = light ? "#8294a5" : "#718099";
    ctx.lineWidth = 1;
    gridStroke=this.boundingBoxStroke;
    if(this.cameraModel==='legacy'||this.boundingBoxStroke!==undefined)
    for (let dimension = 0; dimension < 3; dimension++)
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          const start = [a, b, -1],
            end = [a, b, 1];
          if (dimension === 0) {
            start.splice(0, 3, -1, a, b);
            end.splice(0, 3, 1, a, b);
          } else if (dimension === 1) {
            start.splice(0, 3, a, -1, b);
            end.splice(0, 3, a, 1, b);
          }
          line(
            start as [number, number, number],
            end as [number, number, number],
          );
        }
    gridStroke=undefined;ctx.setLineDash([]);
    axes.forEach((axis,dimension)=>{if(!axis.visible||!strokeStyle(axis.stroke))return;const edge=worldEdges[dimension]??(dimension===0?[[-1,-1,1],[1,-1,1]]:dimension===1?[[-1,-1,1],[-1,1,1]]:[[1,-1,-1],[1,-1,1]]);line(edge[0] as [number,number,number],edge[1] as [number,number,number]);});

    const titlePoints: [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ] = [
      [0, -1, 1],
      [-1, 0, 1],
      [1, -1, 0],
    ];
    if(worldFrame)worldEdges.forEach((edge,index)=>{titlePoints[index]=edge[0].map((value,dimension)=>(value+edge[1][dimension]!)/2) as [number,number,number];});
    axes.forEach((axis, i) => {
      if (!axis.visible) return;
      const title=axis.getDisplayTitle(),ink=fillColor(axis.titleFill,ColorRGBA(0,0,0,0));if(!title||ink.a<=0)return;
      const edge=worldEdges[i]??(i===0?[[-1,-1,1],[1,-1,1]]:i===1?[[-1,-1,1],[-1,1,1]]:[[1,-1,-1],[1,-1,1]]),a=this.project(...edge[0] as [number,number,number]),b=this.project(...edge[1] as [number,number,number]);
      let rotation=axis.titleRotation===undefined?Math.atan2(b.y-a.y,b.x-a.x):axis.titleRotation*Math.PI/180;
      if(axis.titleRotation===undefined){if(rotation>Math.PI/2)rotation-=Math.PI;else if(rotation< -Math.PI/2)rotation+=Math.PI;}
      ctx.font=this.resolveTextFont(axis.titleFont).toCSS();
      const p=this.project(...titlePoints[i]!),center=this.project(0,0,0),length=Math.hypot(p.x-center.x,p.y-center.y)||1,nx=(p.x-center.x)/length,ny=(p.y-center.y)/length;
      let best:TextBox|undefined,bestScore=Infinity;
      for(const distance of [34,48,64,82,104])for(const slide of [0,-25,25,-50,50,-80,80]){
        const box=labelBox(title,p.x+nx*distance-ny*slide,p.y+ny*distance+nx*slide,true,rotation);
        const overlap=labelBoxes.reduce((sum,other)=>sum+Math.max(0,Math.min(box.right+7,other.right)-Math.max(box.left-7,other.left))*Math.max(0,Math.min(box.bottom+6,other.bottom)-Math.max(box.top-6,other.top)),0);
        const score=overlap*1000+distance+Math.abs(slide)*.25;
        if(score<bestScore){bestScore=score;best=box;}
      }
      if(best){labelBoxes.push(best);labelCommands.push({value:title,box:best,font:this.resolveTextFont(axis.titleFont).toCSS(),fill:ink.toCSS(),rotation});}
    });
    if (this.gpu3d) {
      ctx.restore();
      paintLabels();
      return;
    }
    for (const s of this.series) {
      if (!s.visible || s.disposed) continue;
      if (s instanceof SurfaceGridSeries) {
        const quads: {
          points: { x: number; y: number; depth: number }[];
          depth: number;
          value: number;
        }[] = [];
        for (let row = 0; row < s.rows - 1; row++)
          for (let col = 0; col < s.columns - 1; col++) {
            const points = [
              [col, row],
              [col + 1, row],
              [col + 1, row + 1],
              [col, row + 1],
            ].map(([c, r]) =>
              project(
                s.start.x + c! * s.step.x,
                s.values[r! * s.columns + c!]!,
                s.start.z + r! * s.step.z,
              ),
            );
            if (points.some((p) => !Number.isFinite(p.x + p.y))) continue;
            quads.push({
              points,
              depth: points.reduce((n, p) => n + p.depth, 0) / 4,
              value: s.values[row * s.columns + col]!,
            });
          }
        quads.sort((a, b) => b.depth - a.depth);
        for (const q of quads) {
          const f = Math.max(
            0,
            Math.min(1, normalize(q.value, this.getDefaultAxisY()) * 0.5 + 0.5),
          );
          ctx.fillStyle = `hsl(${220 - f * 180} 65% ${35 + f * 25}%)`;
          ctx.strokeStyle = "#ffffff12";
          ctx.beginPath();
          q.points.forEach((p, i) =>
            i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
          );
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if (s instanceof PointLineAreaSeries) {
        ctx.strokeStyle = s.resolveRenderColor(fillColor(s.stroke.getFillStyle())).toCSS();
        ctx.lineWidth = s.stroke.getThickness();
        ctx.fillStyle = s.resolveRenderColor(fillColor(s.pointFill)).toCSS();
        if(worldFrame&&s.kind==='line'&&s.stroke.getThickness()>0){
          // All clipped segment quads share one Canvas fill; no per-segment draw calls.
          ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();let prior:Vec3|undefined;
          for(let i=0;i<s.getSampleCount();i++){
            const data=s.getSample(i),point={x:normalize(data.x,s.axisX??axes[0]),y:normalize(data.y,s.axisY??axes[1]),z:normalize(data.z??0,(s as any).axisZ??axes[2])};
            if(!Number.isFinite(point.x+point.y+point.z)){prior=undefined;continue;}
            if(prior){const pair=clipWorldSegment3D(prior,point,worldFrame);if(pair){const[a,b]=pair,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length>0){const nx=-dy/length,ny=dx/length,wa=worldStylePixels3D(s.stroke.getThickness(),a.depth,worldFrame)/2,wb=worldStylePixels3D(s.stroke.getThickness(),b.depth,worldFrame)/2;ctx.moveTo(a.x+nx*wa,a.y+ny*wa);ctx.lineTo(b.x+nx*wb,b.y+ny*wb);ctx.lineTo(b.x-nx*wb,b.y-ny*wb);ctx.lineTo(a.x-nx*wa,a.y-ny*wa);ctx.closePath();}}}prior=point;
          }ctx.fill();continue;
        }
        ctx.beginPath();
        let pen = false;let previous:Vec3|undefined;
        for (let i = 0; i < s.getSampleCount(); i++) {
          const data = s.getSample(i);
          if(worldFrame&&s.kind!=='points'){
            const point={x:normalize(data.x,s.axisX??axes[0]),y:normalize(data.y,s.axisY??axes[1]),z:normalize(data.z??0,(s as any).axisZ??axes[2])};
            if(previous){const pair=clipWorldSegment3D(previous,point,worldFrame);if(pair){ctx.moveTo(pair[0].x,pair[0].y);ctx.lineTo(pair[1].x,pair[1].y);}}
            previous=point;continue;
          }
          const p = project(data.x, data.y, data.z ?? 0);
          if (!Number.isFinite(p.x + p.y)) {
            pen = false;
            continue;
          }
          if (s.kind === "points") {
            const radius=worldFrame&&s.getPointShape()==='sphere'?worldStylePixels3D(s.pointSize,p.depth,worldFrame)/2:s.pointSize/2;
            ctx.moveTo(p.x + radius, p.y);
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
          } else if (pen) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
          pen = true;
        }
        if (s.kind === "points") ctx.fill();
        else ctx.stroke();
      }
    }
    ctx.restore();
    paintLabels();
  }
}
let surfaceId = 1000000;
export class SurfaceGridSeries {
  readonly id = surfaceId++;
  readonly axisX: Axis;
  readonly axisY: Axis;
  readonly axisZ: Axis;
  readonly kind = "surface";
  columns: number;
  rows: number;
  values: Float32Array;
  visible = true;
  disposed = false;
  start = { x: 0, z: 0 };
  step = { x: 1, z: 1 };
  fill: any;
  name = "";
  revision = 0;
  constructor(
    readonly chart: ChartXY,
    options: any = {},
  ) {
    this.columns = options.columns ?? 50;
    this.rows = options.rows ?? 50;
    this.start = options.start ?? this.start;
    this.step = options.step ?? this.step;
    this.values = new Float32Array(this.columns * this.rows);
    this.axisX = chart.getDefaultAxisX();
    this.axisY = chart.getDefaultAxisY();
    this.axisZ = chart.getDefaultAxisZ()!;
  }
  invalidateHeightMap(values: any) {
    if (ArrayBuffer.isView(values)) this.values.set(values as any);
    else
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.columns; c++)
          this.values[r * this.columns + c] = values[r]?.[c] ?? NaN;
    this.revision++;
    this.chart.invalidate();
    return this;
  }
  setStart(value: any) {
    this.start = value;
    this.chart.invalidate();
    return this;
  }
  setStep(value: any) {
    this.step = value;
    this.chart.invalidate();
    return this;
  }
  setFillStyle(value: any) {
    this.fill = value;
    this.chart.invalidate();
    return this;
  }
  setWireframeStyle(value: any) {
    this.wireframe = value;
    return this;
  }
  wireframe: any;
  setName(value: string) {
    this.name = value;
    return this;
  }
  getName() {
    return this.name;
  }
  setVisible(value: boolean) {
    this.visible = value;
    this.chart.invalidate();
    return this;
  }
  getVisible() {
    return this.visible;
  }
  getSampleCount() {
    return this.values.length;
  }
  bounds(dim: "x" | "y" | "z") {
    if (dim === "x")
      return {
        start: this.start.x,
        end: this.start.x + (this.columns - 1) * this.step.x,
      };
    if (dim === "z")
      return {
        start: this.start.z,
        end: this.start.z + (this.rows - 1) * this.step.z,
      };
    let min = Infinity,
      max = -Infinity;
    for (const v of this.values)
      if (Number.isFinite(v)) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    return min === Infinity ? undefined : { start: min, end: max };
  }
  dispose() {
    this.disposed = true;
    this.chart.removeSeries(this);
    return this;
  }
  isDisposed() {
    return this.disposed;
  }
}
