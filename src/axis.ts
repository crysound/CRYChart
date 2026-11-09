import { EventHub } from "./core/events.js";
import {
  FontSettings,
  SolidLine,
  SolidFill,
  ColorRGBA,
  emptyLine,
  emptyFill,
  type FillStyle,
  type Theme,
} from "./core/styles.js";
import {UnsupportedFeatureError, type Interval, type Mutator} from "./contracts.js";
import {PublicEventAdapter,type PublicEventListener,type ChartEventListenerOptions} from './chart-events.js';
import {numericTickPositions,logarithmicTickPositions,steppedTickPositions} from './grid-layout.js';
import {timeTickPositions} from './time-grid.js';
import {formatNumeric} from './formatting-functions.js';
import {formatTimeDefault} from './time-formatting.js';
import {DateTimeFormatting,dateTimeZoomForRange,type DateTimeFormatter,type DateTimeTickLevel} from './date-time-formatting.js';
import {calendarTickGrid,selectCalendarUnit,type CalendarUnit} from './date-time-grid.js';
import {AxisScrollAnimation} from './axis-scroll-animation.js';
import type {FormattingFunction,FormattingRange} from './formatting-functions.js';
export type {DateTimeFormatter} from './date-time-formatting.js';
export type AxisTickMeasure=(label:string,level:'great'|'major'|'minor')=>number;

export const mutate = <T>(old: T, next: Mutator<T>): T =>
  typeof next === "function" ? (next as (old: T) => T)(old) : next;
export interface AxisUnitsBehavior {displayInCursor?:boolean;displayOnAxis?:boolean;}
export type AxisTitlePosition = 'start' | 'center' | 'end' | 'center-chart';
export type AxisScrollMargins = boolean | {start:number;end:number};
export class TickStyle {
  font = new FontSettings({ size: 12 });
  fill: any = new SolidFill({ color: ColorRGBA(150, 164, 185) });
  grid: any = emptyLine;
  tick: any = emptyLine;
  formatter: ((value: number, ...rest: any[]) => string) | undefined;
  length = 4;
  private gridLength = 1;
  private gridExplicit = false;
  private labelFillExplicit = false;
  private labelFontExplicit = false;
  constructor(labelFont?: FontSettings) {
    if (labelFont) this.font = labelFont;
  }
  setLabelFont(value: any) {
    this.font = mutate(this.font, value);
    this.labelFontExplicit = true;
    return this;
  }
  getLabelFont() {
    return this.font;
  }
  hasLabelFontOverride() { return this.labelFontExplicit; }
  setLabelFillStyle(value: any) {
    this.fill = mutate(this.fill, value);
    this.labelFillExplicit = true;
    return this;
  }
  getLabelFillStyle() {
    return this.fill;
  }
  hasLabelFillStyleOverride() { return this.labelFillExplicit; }
  setGridStrokeStyle(value: any) {
    this.grid = mutate(this.grid, value);
    this.gridExplicit = true;
    return this;
  }
  getGridStrokeStyle() {
    return this.grid;
  }
  setGridStrokeLength(value:number) { if(!Number.isFinite(value))throw new RangeError('Grid stroke length must be finite');this.gridLength=value;return this; }
  getGridStrokeLength() { return this.gridLength; }
  /** Distinguishes an explicitly hidden grid from the legacy chart default. */
  hasGridStrokeStyleOverride() { return this.gridExplicit; }
  clone(): TickStyle { return Object.assign(new TickStyle(), this); }
  setTickStyle(value: any) {
    this.tick = mutate(this.tick, value);
    return this;
  }
  getTickStyle() { return this.tick; }
  setTickLength(value: number) {
    this.length = value;
    return this;
  }
  getTickLength() { return this.length; }
  setLabelFormatter(value: any) {
    this.formatter = value;
    return this;
  }
  setLabelRotation(_value: number) {
    return this;
  }
  setLabelAlignment(_value: any) {
    return this;
  }
  setTickPadding(_value: number) {
    return this;
  }
}
export class NumericTickStrategy {
  major: TickStyle;
  minor: TickStyle;
  kind = "numeric";
  visible = true;
  formatting: any;
  private majorFormatting: any;
  private minorFormatting: any;
  cursorFormatting: ((value:number)=>string)|undefined;
  extremeFormatting: any;
  private formattingOffset: number|undefined;
  customMajor: any;
  customMinor: any;
  dateOrigin = 0;
  extreme: TickStyle | undefined;
  constructor(protected readonly invalidate:()=>void=()=>{}, labelFont?: FontSettings,theme?:Record<string,any>) {
    this.major = new TickStyle(labelFont);
    this.minor = new TickStyle(labelFont);
    const light=(theme?.backgroundFillStyle?.getColor?.()?.getR?.()??0)>127;
    this.major.grid = theme?.tickGridStrokeStyle??new SolidLine({thickness:1,fillStyle:new SolidFill({color:light?ColorRGBA(150,150,150,170):ColorRGBA(200,200,200,50)})});
    this.minor.grid = theme?.tickGridStrokeStyle??new SolidLine({thickness:1,fillStyle:new SolidFill({color:light?ColorRGBA(150,150,150,100):ColorRGBA(200,200,200,20)})});
    this.major.tick = new SolidLine({thickness:1,fillStyle:new SolidFill({color:light?ColorRGBA(150,150,150):ColorRGBA(220,220,220)})});
    this.minor.tick = new SolidLine({thickness:1,fillStyle:new SolidFill({color:light?ColorRGBA(150,150,150,150):ColorRGBA(200,200,200,150)})});
    this.major.length = 7;
    this.major.fill = theme?.tickLabelFillStyle??new SolidFill({color:light?ColorRGBA(33,43,49):ColorRGBA(255,255,220)});
    this.minor.fill = emptyFill;
  }
  setTickStyle(value:any) {
    const apply=(old:TickStyle)=>typeof value==='function'?value(old):value instanceof TickStyle?value.clone():value;
    if(this.major)this.major=apply(this.major);
    if(this.minor)this.minor=apply(this.minor);
    if(this.extreme)this.extreme=apply(this.extreme);
    this.invalidate();
    return this;
  }
  setExtremeTickStyle(value:any) { this.extreme=mutate(this.extreme,value);this.invalidate();return this; }
  getExtremeTickStyle() { return this.extreme; }
  setMajorTickStyle(value: any) {
    this.major = mutate(this.major, value);
    this.invalidate();
    return this;
  }
  getMajorTickStyle() {
    return this.major;
  }
  setMinorTickStyle(value: any) {
    this.minor = mutate(this.minor, value);
    this.invalidate();
    return this;
  }
  getMinorTickStyle() {
    return this.minor;
  }
  setFormattingFunction(fn: any) {
    if(fn!==undefined&&typeof fn!=='function')throw new TypeError('Formatting function must be a function or undefined');
    this.formatting = fn;
    this.majorFormatting=fn;this.minorFormatting=fn;this.extremeFormatting=fn;this.cursorFormatting=fn;
    this.invalidate();
    return this;
  }
  /** Convenience extension for labels; setFormattingFunction configures formatting. */
  setNumericPrecision(value: number) {
    if(!Number.isInteger(value)||value<0||value>100)throw new RangeError('Numeric precision must be an integer from 0 to 100');
    return this.setFormattingFunction((number:number)=>number.toFixed(value));
  }
  setMajorFormattingFunction(fn: any) {
    this.majorFormatting = fn;
    this.invalidate();
    return this;
  }
  getMajorFormattingFunction() { return this.majorFormatting; }
  setMinorFormattingFunction(fn: any) {
    this.minorFormatting = fn;
    this.invalidate();
    return this;
  }
  getMinorFormattingFunction() { return this.minorFormatting; }
  setExtremeFormattingFunction(fn:any) { this.extremeFormatting=fn;this.invalidate();return this; }
  getExtremeFormattingFunction() { return this.extremeFormatting; }
  setFormattingOffset(value:number|undefined) { if(value!==undefined&&!Number.isFinite(value))throw new RangeError('Formatting offset must be finite or undefined');if(this.formattingOffset===value)return this;this.formattingOffset=value;this.invalidate();return this; }
  getFormattingOffset() { return this.formattingOffset; }
  setTickPlacement(config: any) {
    if(config!==undefined&&typeof config!=='function'&&(typeof config!=='object'||config===null))throw new TypeError('Custom tick placement must be a function, placement object, or undefined');
    this.customPlacement=config;
    this.customMajor = typeof config==='function'?config:config?.major;
    this.customMinor = typeof config==='function'?()=>[]:config?.minor;
    this.invalidate();
    return this;
  }
  private customPlacement:any;
  getCustomTickPlacement() { return this.customPlacement; }
  setCustomTickPlacement(config: any) {
    return this.setTickPlacement(config);
  }
  setMajorTickPlacement(value: any) {
    this.customMajor = value;
    return this;
  }
  setMinorTickPlacement(value: any) {
    this.customMinor = value;
    return this;
  }
  setCursorFormatter(fn: any) {
    if(fn!==undefined&&typeof fn!=='function')throw new TypeError('Cursor formatter must be a function');
    this.cursorFormatting = fn;
    this.invalidate();
    return this;
  }
  getCursorFormatter() { return this.cursorFormatting; }
  setDateOrigin(value: Date | number) {
    this.dateOrigin = +value;
    return this;
  }
  setTimeOrigin(value: Date | number | undefined) {
    return this.setDateOrigin(value ?? 0);
  }
  setGreatTickStyle(value: any) {
    return this.setMajorTickStyle(value);
  }
  setMaxTickCount(value: number) {
    this.maxTickCount = value;
    return this;
  }
  maxTickCount = 8;
}
interface TimeTickDefaultContext {font?:FontSettings;fill?:FillStyle;minorEnabled:boolean;}
export class TimeTickStrategy extends NumericTickStrategy {
  override kind = "time";
  private readonly defaultMajorFont:FontSettings;
  private readonly legacyMinorFont:FontSettings;
  private readonly defaultMinorFill:FillStyle;
  constructor(invalidate:()=>void=()=>{},labelFont?:FontSettings,theme?:Record<string,any>,private readonly defaultContext?:()=>TimeTickDefaultContext){
    super(invalidate,labelFont,theme);
    this.defaultMajorFont=labelFont??new FontSettings({size:14,family:'Segoe UI, -apple-system, Verdana, Helvetica'});
    this.legacyMinorFont=this.minor.getLabelFont();
    this.defaultMinorFill=this.major.getLabelFillStyle();
    // 默认种子不等于用户显式覆盖；renderer仍可采用后续主题字体。
    this.major.font=this.defaultMajorFont;
  }
  usesBoundedMinor(){return this.defaultContext?.().minorEnabled??false;}
  resolveDefaultMinorFont(themeFont?:FontSettings){
    const context=this.defaultContext?.();
    return context?.minorEnabled?(themeFont??context.font??this.defaultMajorFont).setSize(10):themeFont??context?.font??this.legacyMinorFont;
  }
  refreshDefaults(){
    const context=this.defaultContext?.(),font=context?.font??this.defaultMajorFont;
    if(!this.major.hasLabelFontOverride())this.major.font=font;
    if(!this.minor.hasLabelFontOverride())this.minor.font=font.setSize(10);
    if(!this.minor.hasLabelFillStyleOverride())this.minor.fill=context?.minorEnabled?(context.fill??this.defaultMinorFill):emptyFill;
    return this;
  }
  override getMajorTickStyle(){this.refreshDefaults();return super.getMajorTickStyle();}
  override getMinorTickStyle(){this.refreshDefaults();return super.getMinorTickStyle();}
  override setMajorTickStyle(value:any){this.refreshDefaults();super.setMajorTickStyle(value);return this.refreshDefaults();}
  override setMinorTickStyle(value:any){this.refreshDefaults();super.setMinorTickStyle(value);return this.refreshDefaults();}
  override setTickStyle(value:any){this.refreshDefaults();super.setTickStyle(value);return this.refreshDefaults();}
  override setTickPlacement(value:any){super.setTickPlacement(value);return this.refreshDefaults();}
  override setMajorTickPlacement(value:any){super.setMajorTickPlacement(value);return this.refreshDefaults();}
  override setMinorTickPlacement(value:any){super.setMinorTickPlacement(value);return this.refreshDefaults();}
}
export class DateTimeTickStrategy extends NumericTickStrategy {
  override kind = "datetime";
  great:TickStyle;
  private readonly dateFormatting=new DateTimeFormatting(()=>this.invalidate());
  constructor(invalidate:()=>void=()=>{},labelFont?:FontSettings,theme?:Record<string,any>){
    super(invalidate,labelFont,theme);
    const mainFont=labelFont??new FontSettings({size:14,family:'Segoe UI, -apple-system, Verdana, Helvetica'});
    this.major.setLabelFont(mainFont);
    this.minor.setLabelFont(mainFont.setSize(10));
    this.minor.fill=this.major.fill;
    this.great=new TickStyle(new FontSettings({size:14,family:'Arial'}));
    this.great.setLabelFont(this.great.getLabelFont());
    this.great.fill=emptyFill;this.great.grid=emptyLine;this.great.tick=emptyLine;this.great.length=7;
  }
  override setGreatTickStyle(value:any){this.great=mutate(this.great,value);this.invalidate();return this;}
  getGreatTickStyle(){return this.great;}
  override setTickStyle(value:any){super.setTickStyle(value);this.great=typeof value==='function'?value(this.great):value instanceof TickStyle?value.clone():value;this.invalidate();return this;}
  setUTC(value:boolean){this.dateFormatting.setUTC(value);return this;}
  getUTC(){return this.dateFormatting.getUTC();}
  setLocale(value:string|undefined){this.dateFormatting.setLocale(value);return this;}
  getLocale(){return this.dateFormatting.getLocale();}
  override setDateOrigin(value:Date|number|undefined){
    this.dateFormatting.setDateOrigin(value);this.dateOrigin=this.dateFormatting.getOriginTimestamp();return this;
  }
  getDateOrigin(){return this.dateFormatting.getDateOrigin();}
  setFormatting(great:DateTimeFormatter|undefined,major:DateTimeFormatter|undefined,minor?:DateTimeFormatter){
    this.dateFormatting.setFormatting(great,major,minor);return this;
  }
  setFormattingDecade(major:DateTimeFormatter|undefined,minor:DateTimeFormatter|undefined){this.dateFormatting.setZoomFormatting('decade',undefined,major,minor);return this;}
  setFormattingYear(major:DateTimeFormatter|undefined,minor:DateTimeFormatter|undefined){this.dateFormatting.setZoomFormatting('year',undefined,major,minor);return this;}
  setFormattingMonth(great:DateTimeFormatter|undefined,major:DateTimeFormatter|undefined,minor:DateTimeFormatter|undefined){this.dateFormatting.setZoomFormatting('month',great,major,minor);return this;}
  setFormattingWeek(great:DateTimeFormatter|undefined,major:DateTimeFormatter|undefined,minor:DateTimeFormatter|undefined){this.dateFormatting.setZoomFormatting('week',great,major,minor);return this;}
  setFormattingDay(great:DateTimeFormatter|undefined,major:DateTimeFormatter|undefined,minor:DateTimeFormatter|undefined){this.dateFormatting.setZoomFormatting('day',great,major,minor);return this;}
  setFormattingHour(great:DateTimeFormatter|undefined,major:DateTimeFormatter|undefined,minor:DateTimeFormatter|undefined){this.dateFormatting.setZoomFormatting('hour',great,major,minor);return this;}
  setFormattingMinute(great:DateTimeFormatter|undefined,major:DateTimeFormatter|undefined,minor:DateTimeFormatter|undefined){this.dateFormatting.setZoomFormatting('minute',great,major,minor);return this;}
  setFormattingSecond(great:DateTimeFormatter|undefined,major:DateTimeFormatter|undefined,minor?:DateTimeFormatter){this.dateFormatting.setZoomFormatting('second',great,major,minor);return this;}
  setFormattingMilliSecond(great:DateTimeFormatter|undefined,major:DateTimeFormatter|undefined){this.dateFormatting.setZoomFormatting('millisecond',great,major);return this;}
  hasDateTimeFormatting(){return this.dateFormatting.hasCustomFormatting();}
  formatDateTimeTick(value:number,range:FormattingRange,level:DateTimeTickLevel,zoom:CalendarUnit=dateTimeZoomForRange(range)){return this.dateFormatting.formatTick(value,range,level,zoom);}
  formatDateTimeCursor(value:number,range:FormattingRange){return this.dateFormatting.formatCursor(value,range,this.cursorFormatting as FormattingFunction|undefined);}
}

export class Annotation {
  readonly events = new EventHub();
  private readonly publicEvents=new PublicEventAdapter(this.events,{kind:'annotation'});
  addEventListener(type:string,listener:PublicEventListener,options?:ChartEventListenerOptions){this.publicEvents.addEventListener(type,listener,options);}
  removeEventListener(type:string,listener:PublicEventListener){this.publicEvents.removeEventListener(type,listener);}
  emitPublicInteraction(type:string,event:Event,info?:unknown){this.publicEvents.emitInteraction(type,event,info);}
  value = 0;
  start = 0;
  end = 1;
  text = "";
  visible = true;
  disposed = false;
  stroke: any = new SolidLine({
    fillStyle: new SolidFill({ color: ColorRGBA(255, 180, 70) }),
    thickness: 1,
  });
  fill: any = new SolidFill({ color: ColorRGBA(255, 180, 70, 40) });
  mouseInteractions = true;
  draggable = false;
  private annotationInteraction:any;
  private interactionRevision=0;
  private manualHighlight=0;
  private hoverHighlight=true;
  private pointed=false;
  setUserInteractions(value:any){
    if(value!==undefined&&value!==false&&(value===null||typeof value!=='object'||Array.isArray(value)))throw new TypeError('Annotation interactions require an object, false or undefined');
    this.annotationInteraction=value;
    this.draggable=value!==undefined&&value!==false&&(value.move?.drag===true||value.scale?.drag===true);
    this.interactionsChanged();return this;
  }
  getUserInteractions(){return this.annotationInteraction;}
  getDragCapabilities(){return{move:this.draggable&&this.annotationInteraction!==false&&this.annotationInteraction?.move!==false&&this.annotationInteraction?.move?.drag!==false,scale:this.draggable&&this.annotationInteraction?.scale?.drag===true};}
  /** Internal invalidation also prevents a cancelled drag from restarting if
   * pointer events are re-enabled before the next pointer event arrives. */
  getInteractionRevision(){return this.interactionRevision;}
  private interactionsChanged(){
    this.interactionRevision++;
    try{this.events.emit('annotationinteractionchange',this);}finally{this.onChange();}
  }
  setHighlight(value:boolean|number){
    const strength=typeof value==='boolean'?(value?1:0):value;
    if(typeof strength!=='number'||!Number.isFinite(strength)||strength<0||strength>1)throw new RangeError('Annotation highlight must be a boolean or a number from zero to one');
    this.manualHighlight=strength;this.onChange();return this;
  }
  getHighlight(){return this.manualHighlight;}
  setHighlightOnHover(value:boolean){
    if(typeof value!=='boolean')throw new UnsupportedFeatureError('annotation non-boolean hover highlight modes');
    this.hoverHighlight=value;this.onChange();return this;
  }
  getHighlightOnHover(){return this.hoverHighlight;}
  /** Static highlighting is implemented. Animated pulsing is deliberately not
   * advertised as a working setter. */
  setAnimationHighlight(value:boolean){if(value)throw new UnsupportedFeatureError('annotation highlight animation');return this;}
  getAnimationHighlight(){return false;}
  getPointed(){return this.pointed;}
  setPointed(value:boolean){
    const pointed=Boolean(value)&&this.mouseInteractions&&this.visible&&!this.disposed;
    if(pointed!==this.pointed){this.pointed=pointed;this.onChange();}
    return this;
  }
  getHighlightStrength(){return Math.max(this.manualHighlight,this.hoverHighlight&&this.pointed?1:0);}
  name = "";
  textFormatter: any;
  onChange: () => void;
  constructor(
    readonly axis: Axis,
    readonly kind: "line" | "band" | "tick",
    onChange: () => void,
    readonly onTop=true,
  ) {
    this.onChange = onChange;
  }
  setValue(value: number) {
    if (!Number.isFinite(value))
      throw new RangeError("Annotation value must be finite");
    this.value = value;
    try{this.events.emit("valuechange", { value, constantLine: this });}finally{this.onChange();}
    return this;
  }
  getValue() {
    return this.value;
  }
  setPosition(value: number) {
    return this.setValue(value);
  }
  getPosition() {
    return this.value;
  }
  setStart(value: number) {
    return this.setBounds({start:value});
  }
  getStart() {
    return this.start;
  }
  setEnd(value: number) {
    return this.setBounds({end:value});
  }
  getEnd() {
    return this.end;
  }
  setBounds(bounds: any) {
    if(('start'in bounds&&!Number.isFinite(bounds.start))||('end'in bounds&&!Number.isFinite(bounds.end)))throw new RangeError('Annotation bounds must be finite');
    if ("start" in bounds) this.start = bounds.start;
    if ("end" in bounds) this.end = bounds.end;
    try{this.events.emit('valuechange',{start:this.start,end:this.end,band:this});}finally{this.onChange();}
    return this;
  }
  getBounds() {
    return { start: this.start, end: this.end };
  }
  setValueStart(value: number) {
    return this.setStart(value);
  }
  setValueEnd(value: number) {
    return this.setEnd(value);
  }
  getValueStart(){return this.start;}
  getValueEnd(){return this.end;}
  setStrokeStyle(value: any) {
    this.stroke = mutate(this.stroke, value);
    this.onChange();
    return this;
  }
  getStrokeStyle() {
    return this.stroke;
  }
  setFillStyle(value: any) {
    this.fill = mutate(this.fill, value);
    this.onChange();
    return this;
  }
  getFillStyle() {
    return this.fill;
  }
  setVisible(value: boolean) {
    this.visible = value;
    if(!value){this.pointed=false;this.interactionsChanged();}else this.onChange();
    return this;
  }
  getVisible() {
    return this.visible;
  }
  setMouseInteractions(value: boolean) {
    return this.setPointerEvents(value);
  }
  setPointerEvents(value:boolean){
    this.mouseInteractions=Boolean(value);
    if(!value)this.pointed=false;
    this.interactionsChanged();
    return this;
  }
  getPointerEvents(){return this.mouseInteractions;}
  setMouseInteractionsEnabled(value: boolean) {
    return this.setMouseInteractions(value);
  }
  setDraggingMode(value: any) {
    return this.setDraggable(Boolean(value));
  }
  setDraggable(value: boolean) {
    this.draggable = Boolean(value);
    if(value)this.annotationInteraction=undefined;
    this.interactionsChanged();
    return this;
  }
  setName(value: string) {
    this.name = value;
    return this;
  }
  setText(value: string) {
    this.text = value;
    this.onChange();
    return this;
  }
  setTextFormatter(value: any) {
    this.textFormatter = value;
    return this;
  }
  setEffect(_value: any) {
    return this;
  }
  setLabelTextFormatter(value: any) {
    return this.setTextFormatter(value);
  }
  setMarker(value: any) {
    return mutate(this, value);
  }
  setTextFillStyle(_value: any) {
    return this;
  }
  setTextFont(_value: any) {
    return this;
  }
  setTextRotation(_value: any) {
    return this;
  }
  on(type: string, fn: any) {
    return this.events.on(type, fn);
  }
  off(typeOrToken: any, token?: any) {
    return this.events.off(typeOrToken, token);
  }
  onValueChange(fn: any) {
    return this.on("valuechange", (event: any) => fn(this, event.value));
  }
  offValueChange(token: any) {
    return this.off("valuechange", token);
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;
      this.pointed=false;
      const failures:unknown[]=[],cleanup=(action:()=>unknown)=>{try{action();}catch(error){failures.push(error);}};
      cleanup(()=>this.interactionsChanged());
      cleanup(()=>this.events.emit('dispose',this));cleanup(()=>this.publicEvents.dispose());this.events.clear();
      const index=this.axis.annotations.indexOf(this);if(index>=0)this.axis.annotations.splice(index,1);
      cleanup(()=>this.onChange());if(failures.length)throw new AggregateError(failures,'Annotation disposal completed with consumer errors');
    }
    return this;
  }
  isDisposed() {
    return this.disposed;
  }
}

export interface AxisHost {
  /** Internal XY bound-column policy; unsupported hosts keep their prior default. */
  getAxisDefaultFitStop?(axis:Axis):boolean|undefined;
  requestAxisScrollAnimation?(axis:Axis):void;
  cancelAxisScrollAnimation?(axis:Axis):void;
  /** Internal capability: the bounded intervalMax contract is currently XY-only. */
  supportsAxisIntervalMaxRestrictions?(): boolean;
  /** Optional 3D internal converter publication; ordinary XY/Polar hosts omit it. */
  onAxisIntervalRequested?(axis:Axis,requested:Interval):boolean;
  invalidate(): void;
  boundsFor(axis: Axis,considerVisibleRangeOnly?:boolean): Interval | undefined;
  /** Internal policy for an unconfigured, nondegenerate linear fit only. */
  getAxisDefaultFitMargins?(axis: Axis): {start:number;end:number} | undefined;
  getAxisInitialInterval?(axis:Axis):Interval|undefined;
  readonly plot?: {width:number;height:number};
  getAxisPixelLength?(axis:Axis):number;
  /** Custom placement is measured before axis label lanes consume the content. */
  getAxisCustomTickPlacementPixelLength?(axis:Axis):number|undefined;
  getAxisAutoScrollMargins?(axis:Axis):{start:number;end:number};
  /** Optional constant style geometry for automatic XY fitting only. */
  getAxisDefaultGeometryMargins?(axis:Axis):{start:number;end:number}|undefined;
  validateAxisInteractions?(axis:Axis,value:any):void;
  readonly theme?: Partial<Theme>;
  /** Internal seed for style mutators; drawing still resolves explicit overrides. */
  getAxisTickFont?(): FontSettings | undefined;
}
export class Axis {
  readonly events = new EventHub();
  private readonly publicEvents=new PublicEventAdapter(this.events,{kind:'axis'});
  addEventListener(type:string,listener:PublicEventListener,options?:ChartEventListenerOptions){this.publicEvents.addEventListener(type,listener,options);}
  removeEventListener(type:string,listener:PublicEventListener){this.publicEvents.removeEventListener(type,listener);}
  emitPublicInteraction(type:string,event:Event,info?:unknown){this.publicEvents.emitInteraction(type,event,info);}
  readonly annotations: Annotation[] = [];
  readonly direction: "x" | "y" | "z";
  readonly chart: AxisHost;
  type: string;
  opposite: boolean;
  interval: Interval = { start: 0, end: 1 };
  defaultInterval: any = { start: 0, end: 1 };
  private hasDefaultInterval=false;
  stopped = false;
  disposed = false;
  visible = true;
  title = "";
  unit:string|undefined;
  private unitsBehavior={displayInCursor:true,displayOnAxis:true};
  tickStrategy: NumericTickStrategy;
  private tickStrategyType: 'Empty'|'Numeric'|'DateTime'|'Time' = 'Numeric';
  scrollStrategy: any = "fitting";
  titleFont = new FontSettings({ size: 12 });
  titleFill: any = new SolidFill({ color: ColorRGBA(190, 200, 215) });
  stroke: any = emptyLine;
  highlight = 0;
  highlightOnHover = true;
  private pointerHover = false;
  interaction: any = {};
  inverted = false;
  intervalRestriction: any = undefined;
  margins = { start: 0.05, end: 0.05 };
  private fitMarginsConfigured = false;
  iParallel = 0;
  iStack = 0;
  private screenRange: Interval = {start:0,end:1};
  private length: number|{relative:number}|{pixels:number} = {relative:1};
  parallelLane = 0;
  titleRotation: number|undefined;
  private marginAfterTicks=0;
  private titlePosition:AxisTitlePosition='center';
  private scrollMargins:AxisScrollMargins=true;
  private scrollMarginsConfigured=false;
  private explicitlySetInterval=false;
  private settingAutomaticInterval=false;
  private pendingFitStop: boolean | undefined;
  private defaultGeometryMargins:{start:number;end:number}|undefined;
  private defaultGeometryRendering:{start:number;end:number;rawStart:number;rawEnd:number;length:number;marginStart:number;marginEnd:number}|undefined;
  private animationZoomDuration=0;
  private animationScroll=false;
  private scrollAnimation:AxisScrollAnimation|undefined;
  constructor(chart: AxisHost, direction: "x" | "y" | "z", options: any = {}) {
    this.chart = chart;
    this.direction = direction;
    const theme=chart.theme;
    this.titleFont=theme?.[`${direction}AxisTitleFont`]??theme?.axisTitleFont??this.titleFont;
    this.titleFill=theme?.[`${direction}AxisTitleFillStyle`]??theme?.axisTitleFillStyle??this.titleFill;
    this.tickStrategy = new NumericTickStrategy(()=>this.chart.invalidate(), this.initialTickFont(),this.chart.theme);
    this.type = options.type || "linear";
    this.opposite = !!options.opposite;
    this.iParallel = options.iParallel ?? 0;
    this.iStack = options.iStack ?? 0;
    if (this.type === "logarithmic") this.interval = { start: 1, end: 10 };
    const initial=chart.getAxisInitialInterval?.(this);
    if(initial){this.interval={...initial};this.defaultInterval={...initial};}
  }
  setInterval(config: any, end?: number) {
    if (typeof config === "number") config = { start: config, end };
    let start = config.start ?? this.interval.start,
      finish = config.end ?? this.interval.end;
    if (!Number.isFinite(start) || !Number.isFinite(finish) || start === finish)
      throw new RangeError(
        "Axis interval requires two distinct finite endpoints",
      );
    if (this.type === "logarithmic" && (start <= 0 || finish <= 0))
      throw new RangeError("Logarithmic interval must be positive");
    const intervalMax=this.supportedIntervalMax();
    if(intervalMax!==undefined&&Math.abs(finish-start)>intervalMax){
      const span=finish-start,center=Number.isFinite(span)?start+span/2:start/2+finish/2;
      const half=(finish>start?intervalMax:-intervalMax)/2;
      start=center-half;finish=center+half;
      if(!Number.isFinite(start)||!Number.isFinite(finish)||start===finish)
        throw new RangeError('Restricted axis interval requires two distinct finite endpoints');
    }
    const conversionChanged=this.chart.onAxisIntervalRequested?.(this,{start,end:finish})??false;
    const defaultGeometryChanged=!this.settingAutomaticInterval&&this.defaultGeometryMargins!==undefined;
    if(!this.settingAutomaticInterval){this.pendingFitStop=undefined;this.explicitlySetInterval=true;this.defaultGeometryMargins=undefined;this.defaultGeometryRendering=undefined;this.cancelScrollAnimation();}
    const changed =
      start !== this.interval.start || finish !== this.interval.end;
    this.interval = { start, end: finish };
    if(this.tickStrategy instanceof TimeTickStrategy)this.tickStrategy.refreshDefaults();
    this.stopped = config.stopAxisAfter ?? true;
    if (changed) {
      this.events.emit("intervalchange", { axis: this, start, end: finish });
      this.chart.invalidate();
    }else if(conversionChanged||defaultGeometryChanged)this.chart.invalidate();
    return this;
  }
  /** Only the finite positive constant object maximum used by Preview is enforced.
   * Other restriction fields and callback enforcement retain their existing behavior. */
  private supportedIntervalMax(): number | undefined {
    if(this.type!=='linear'||this.chart.supportsAxisIntervalMaxRestrictions?.()!==true)return undefined;
    const value=this.intervalRestriction;
    if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
    const maximum=value.intervalMax;
    return typeof maximum==='number'&&Number.isFinite(maximum)&&maximum>0?maximum:undefined;
  }
  /** Internal XY wheel policy: constrain scale before constructing anchored endpoints. */
  limitIntervalZoomFactor(factor:number): number {
    const maximum=this.supportedIntervalMax(),span=Math.abs(this.interval.end-this.interval.start);
    return maximum!==undefined&&Number.isFinite(span)&&span>0&&Number.isFinite(factor)&&factor>0
      ?Math.min(factor,maximum/span):factor;
  }
  getInterval() {
    return { ...this.interval };
  }
  /** Internal draw domain. Automatic style regions do not alter the public data interval. */
  getRenderInterval():Interval {
    const value=this.renderingInterval();return{start:value.start,end:value.end};
  }
  private refreshDefaultGeometryMargins(bounds?:Interval,keepPreviousFit=false){
    const eligible=this.type==='linear'&&!this.explicitlySetInterval&&!this.hasDefaultInterval&&!this.scrollMarginsConfigured&&!this.fitMarginsConfigured&&this.margins.start===.05&&this.margins.end===.05&&
      (bounds?bounds.start!==bounds.end:keepPreviousFit&&this.defaultGeometryMargins!==undefined);
    const requested=eligible?this.chart.getAxisDefaultGeometryMargins?.(this):undefined;
    this.defaultGeometryMargins=requested&&Number.isFinite(requested.start)&&Number.isFinite(requested.end)?{start:Math.max(0,requested.start),end:Math.max(0,requested.end)}:undefined;
    if(!this.defaultGeometryMargins)this.defaultGeometryRendering=undefined;
  }
  private renderingInterval():Interval{
    const margin=this.defaultGeometryMargins;
    if(!margin||this.type!=='linear'||this.explicitlySetInterval||this.hasDefaultInterval||this.scrollMarginsConfigured||this.fitMarginsConfigured||this.margins.start!==.05||this.margins.end!==.05)return this.interval;
    const length=this.getPixelLength(),start=this.interval.start,end=this.interval.end;
    const old=this.defaultGeometryRendering;
    if(old&&old.rawStart===start&&old.rawEnd===end&&old.length===length&&old.marginStart===margin.start&&old.marginEnd===margin.end)return old;
    const total=margin.start+margin.end,scale=total>length*.98?length*.98/total:1;
    const a=margin.start*scale,b=margin.end*scale,span=(end-start)/(1-(a+b)/length);
    const lo=start-span*a/length,hi=end+span*b/length;
    if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo===hi)return this.interval;
    const rendering={start:lo,end:hi,rawStart:start,rawEnd:end,length,marginStart:margin.start,marginEnd:margin.end};
    this.defaultGeometryRendering=rendering;return rendering;
  }
  private defaultConfiguration(){
    const bounds=this.chart.boundsFor(this);
    return typeof this.defaultInterval==='function'?this.defaultInterval({curStart:this.interval.start,curEnd:this.interval.end,dataMin:bounds?.start,dataMax:bounds?.end}):this.defaultInterval;
  }
  setDefaultInterval(value:any){this.pendingFitStop=undefined;this.defaultInterval=value;this.hasDefaultInterval=true;const interval=this.defaultConfiguration();if(interval)this.setInterval(interval);return this}
  getDefaultInterval(){return this.hasDefaultInterval?this.defaultInterval:undefined}
  private automaticInterval(interval:Interval & {stopAxisAfter?:boolean}) {
    this.settingAutomaticInterval=true;
    try{return this.setInterval(interval);}finally{this.settingAutomaticInterval=false;}
  }
  private scheduleAutomaticInterval(interval:Interval){
    if(!this.animationScroll||!this.visible||!this.chart.requestAxisScrollAnimation)return this.automaticInterval({...interval,stopAxisAfter:false});
    if(interval.start===this.interval.start&&interval.end===this.interval.end){this.cancelScrollAnimation();return this;}
    this.scrollAnimation??=new AxisScrollAnimation();
    this.scrollAnimation.request(interval);this.chart.requestAxisScrollAnimation(this);return this;
  }
  /** Internal frame hook: explicit caller updates always supersede animation. */
  advanceScrollAnimation(timestamp:number){
    if(this.disposed||this.stopped||!this.visible||!this.animationScroll||!this.chart.boundsFor(this)){this.cancelScrollAnimation();return;}
    const next=this.scrollAnimation?.advance(this.interval,timestamp,this.getPixelLength(),this.type==='logarithmic');
    if(next)this.automaticInterval({...next,stopAxisAfter:false});
    if(!this.scrollAnimation?.pending()||this.stopped||next&&(next.start!==this.interval.start||next.end!==this.interval.end))this.cancelScrollAnimation();
  }
  cancelScrollAnimation(){this.scrollAnimation?.cancel();this.chart.cancelAxisScrollAnimation?.(this);}
  getPixelLength() {
    const supplied=this.chart.getAxisPixelLength?.(this);
    if(supplied!==undefined&&Number.isFinite(supplied)&&supplied>0)return supplied;
    const length=this.chart.plot?(this.direction==='x'?this.chart.plot.width:this.chart.plot.height):500;
    return Math.max(1,length*Math.abs(this.screenRange.end-this.screenRange.start));
  }
  private pixelScrollMargins() {
    if(!this.scrollMarginsConfigured||this.explicitlySetInterval||this.hasDefaultInterval)return {start:0,end:0};
    const config=this.scrollMargins;
    const values=config===false?{start:0,end:0}:config===true?(this.chart.getAxisAutoScrollMargins?.(this)??{start:0,end:0}):config;
    const start=Math.max(0,Number.isFinite(values.start)?values.start:0),end=Math.max(0,Number.isFinite(values.end)?values.end:0),limit=this.getPixelLength()*.98;
    const factor=start+end>limit?limit/(start+end):1;
    return {start:start*factor,end:end*factor};
  }
  private fittedBounds(bounds:Interval):Interval {
    this.refreshDefaultGeometryMargins(bounds);
    let {start,end}=bounds;
    if(start===end&&this.type==='linear'&&!this.scrollMarginsConfigured&&!this.fitMarginsConfigured&&
      this.margins.start===.05&&this.margins.end===.05&&this.chart.getAxisInitialInterval?.(this)){
      // Native XY singleton fitting uses one unit on either side, without
      // padding that synthetic interval again by the ordinary data margins.
      const lo=start-1,hi=end+1;
      if(Number.isFinite(lo)&&Number.isFinite(hi)&&lo<start&&hi>end)return{start:lo,end:hi};
    }
    if(this.scrollMarginsConfigured){
      if(this.type==='logarithmic'){
        start=Math.max(start,Number.MIN_VALUE);end=Math.max(end,start);
        if(start===end){start/=Math.sqrt(10);end*=Math.sqrt(10);}
        const lo=Math.log10(Math.max(start,Number.MIN_VALUE)),hi=Math.log10(end),margin=this.pixelScrollMargins(),length=this.getPixelLength(),span=(hi-lo)/(1-(margin.start+margin.end)/length);
        return {start:10**(lo-span*margin.start/length),end:10**(hi+span*margin.end/length)};
      }
      if(start===end){const padding=Math.abs(start)*.05||1;start-=padding;end+=padding;}
      const margin=this.pixelScrollMargins(),length=this.getPixelLength(),span=(end-start)/(1-(margin.start+margin.end)/length);
      return {start:start-span*margin.start/length,end:end+span*margin.end/length};
    }
    if(start===end){const e=Math.abs(start)*.05||1;start-=e;end+=e}
    if(this.type==='logarithmic'){start=Math.max(start,Number.MIN_VALUE);end=Math.max(end,start*10)}else{
      // A world 3D converter already reserves style-sized geometry margins.
      // Preserve explicit margins, direct non-default values and the legacy
      // equal-value fallback; XY/Polar hosts do not supply this policy.
      const useDefaultPolicy=bounds.start!==bounds.end&&!this.fitMarginsConfigured&&this.margins.start===0.05&&this.margins.end===0.05;
      const margins=(useDefaultPolicy?this.chart.getAxisDefaultFitMargins?.(this):undefined)??this.margins;
      const span=end-start;start-=span*margins.start;end+=span*margins.end;
    }
    return {start,end};
  }
  fit(_animate=false,stopAxisAfter?:boolean){
    this.pendingFitStop=undefined;
    const requestedStop=stopAxisAfter??this.chart.getAxisDefaultFitStop?.(this)??false;
    if(this.hasDefaultInterval){const d=this.defaultConfiguration();if(d)this.setInterval({...d,stopAxisAfter:requestedStop});return this}
    const bounds=this.fittingBounds();
    if(bounds){this.explicitlySetInterval=false;this.automaticInterval({...this.fittedBounds(bounds),stopAxisAfter:requestedStop});}
    else {this.pendingFitStop=stopAxisAfter??false;this.setStopped(requestedStop);this.refreshDefaultGeometryMargins();}
    return this;
  }
  /** Internal frame scheduling capability, not an additional native Axis API. */
  hasPendingFit(){return this.pendingFitStop!==undefined;}
  private fittingBounds(){
    const strategy=this.scrollStrategy;
    return this.chart.boundsFor(this,strategy?.kind==='fitting'&&strategy.considerVisibleRangeOnly===true);
  }
  updateAuto(){
    // An explicit empty fit still stops immediately, but its requested fit can
    // only use actual bounds once data exists. Consume it once, preserving an
    // explicit final stop while omitted/false resumes following. No data is retained.
    if(this.pendingFitStop!==undefined){
      const bounds=this.fittingBounds();
      if(bounds){
        const stopAxisAfter=this.pendingFitStop;this.pendingFitStop=undefined;
        this.explicitlySetInterval=false;
        this.automaticInterval({...this.fittedBounds(bounds),stopAxisAfter});
        return this;
      }
    }
    if(this.stopped||this.scrollStrategy==null||this.scrollStrategy===false){if(this.defaultGeometryMargins)this.refreshDefaultGeometryMargins(undefined,true);return this;}
    const bounds=this.fittingBounds();if(!bounds){this.refreshDefaultGeometryMargins();return this;}
    const name=String(typeof this.scrollStrategy==='string'?this.scrollStrategy:this.scrollStrategy.kind??this.scrollStrategy.name??'fitting').toLowerCase();
    if(name==='progressive'||name==='scrolling'||name==='regressive')this.refreshDefaultGeometryMargins(bounds);
    const {start,end}=this.interval,span=end-start;
    const margins=this.pixelScrollMargins(),length=this.getPixelLength();
    if(name==='progressive'||name==='scrolling'){
      const edge=this.type==='logarithmic'?bounds.end*10**(Math.log10(end/start)*margins.end/length):bounds.end+span*margins.end/length;
      if(edge>end)this.scheduleAutomaticInterval({start:this.type==='logarithmic'?edge/(end/start):edge-span,end:edge});
    }
    else if(name==='regressive'){
      const edge=this.type==='logarithmic'?bounds.start/10**(Math.log10(end/start)*margins.start/length):bounds.start-span*margins.start/length;
      if(edge<start)this.scheduleAutomaticInterval({start:edge,end:this.type==='logarithmic'?edge*(end/start):edge+span});
    }
    else {const fitted=this.fittedBounds(bounds);if(name==='expansion'){fitted.start=Math.min(start,fitted.start);fitted.end=Math.max(end,fitted.end)}this.scheduleAutomaticInterval(fitted)}
    return this;
  }
  setStopped(value: boolean) {
    this.stopped = value;
    if(value)this.cancelScrollAnimation();
    this.chart.invalidate();
    return this;
  }
  getStopped() {
    return this.stopped;
  }
  setAutoFit(value: boolean) {
    if(value&&this.scrollStrategy==null)this.scrollStrategy="fitting";
    return this.setStopped(!value);
  }
  getAutoFit() {
    return !this.stopped&&this.scrollStrategy!=null;
  }
  setScrollStrategy(value: any) {
    this.cancelScrollAnimation();
    this.scrollStrategy = value;
    this.stopped = false;
    this.chart.invalidate();
    return this;
  }
  getScrollStrategy() {
    return this.scrollStrategy;
  }
  private initialTickFont() { return this.chart.getAxisTickFont?.() ?? this.chart.theme?.font; }
  setTickStrategy(value: any, configure?: (strategy: any) => any) {
    const name =
      typeof value === "string"
        ? value
        : (value?.kind ?? value?.name ?? "numeric");
    let strategy: NumericTickStrategy;
    const kind=name.toLowerCase();
    // Canonical public strategy values reconfigure their existing strategy.
    // Lowercase legacy extension names keep their historical reset behavior.
    if(['Numeric','Time','DateTime'].includes(name)&&this.tickStrategy.kind===kind&&this.tickStrategy.visible)strategy=this.tickStrategy;
    else if (name.toLowerCase().includes("datetime"))
      strategy = new DateTimeTickStrategy(()=>this.chart.invalidate(), this.initialTickFont(),this.chart.theme);
    else if (name.toLowerCase().includes("time"))
      strategy = new TimeTickStrategy(()=>this.chart.invalidate(), this.initialTickFont(),this.chart.theme,()=>({
        font:this.initialTickFont(),fill:this.chart.theme?.tickLabelFillStyle,
        minorEnabled:this.type!=='logarithmic'&&!strategy.customMajor&&!strategy.customMinor&&Math.abs(this.interval.end-this.interval.start)>=15000&&Math.abs(this.interval.end-this.interval.start)<3600000,
      }));
    else strategy = new NumericTickStrategy(()=>this.chart.invalidate(), this.initialTickFont(),this.chart.theme);
    strategy.visible = !name.toLowerCase().includes("empty");
    this.tickStrategy = configure?.(strategy) ?? strategy;
    if(this.tickStrategy instanceof TimeTickStrategy)this.tickStrategy.refreshDefaults();
    this.tickStrategyType = kind.includes('empty') ? 'Empty' : kind.includes('datetime') ? 'DateTime' : kind.includes('time') ? 'Time' : 'Numeric';
    this.chart.invalidate();
    return this;
  }
  getTickStrategy() {
    return this.tickStrategyType;
  }
  setTitle(value: string) {
    this.title = value;
    this.chart.invalidate();
    return this;
  }
  getTitle() {
    return this.title;
  }
  setTitlePosition(position:AxisTitlePosition|undefined) {
    const next=position??'center';
    if(!['start','center','end','center-chart'].includes(next))throw new RangeError('Axis title position must be start, center, end, or center-chart');
    this.titlePosition=next;this.chart.invalidate();return this;
  }
  getTitlePosition() { return this.titlePosition; }
  setMarginAfterTicks(value:number) {
    if(!Number.isFinite(value)||value<0)throw new RangeError('Axis margin after ticks must be a nonnegative pixel distance');
    this.marginAfterTicks=value;this.chart.invalidate();return this;
  }
  getMarginAfterTicks() { return this.marginAfterTicks; }
  setScrollMargins(value:number|boolean|undefined|{start:number;end:number}) {
    let next:AxisScrollMargins;
    if(value===undefined||typeof value==='boolean')next=value??true;
    else{
      const pair=typeof value==='number'?{start:value,end:value}:value;
      if(!Number.isFinite(pair?.start)||!Number.isFinite(pair?.end)||pair.start<0||pair.end<0)throw new RangeError('Axis scroll margins require finite nonnegative pixel distances');
      next={start:pair.start,end:pair.end};
    }
    this.scrollMargins=next;this.scrollMarginsConfigured=true;this.chart.invalidate();return this;
  }
  getScrollMargins():AxisScrollMargins { return typeof this.scrollMargins==='boolean'?this.scrollMargins:{...this.scrollMargins}; }
  /** Undefined restores immediate automatic scrolling; true enables a bounded
   * time-based response. Source samples and explicit intervals stay unchanged. */
  setAnimationScroll(enabled: boolean | undefined) {
    if (enabled !== undefined && typeof enabled !== 'boolean')
      throw new TypeError('Scroll animation flag must be boolean or undefined');
    this.animationScroll=enabled===true;
    if(!this.animationScroll)this.cancelScrollAnimation();
    this.chart.invalidate();return this;
  }
  /** Animated easing is deliberately rejected until frame interpolation is implemented. */
  setAnimationZoom(easing:((position:number)=>number)|boolean|undefined,duration?:number) {
    if(easing!==undefined&&easing!==false)throw new Error('Animated axis zoom is not implemented; use setAnimationZoom(undefined) for immediate updates');
    if(duration!==undefined&&(!Number.isFinite(duration)||duration<0))throw new RangeError('Zoom duration must be a nonnegative number');
    this.animationZoomDuration=duration??0;return this;
  }
  getAnimationZoom():undefined { return undefined; }
  getAnimationZoomDuration() { return this.animationZoomDuration; }
  setUnits(value: string|undefined,behavior:AxisUnitsBehavior={}) {
    this.unit = value;
    this.unitsBehavior={displayInCursor:behavior.displayInCursor??true,displayOnAxis:behavior.displayOnAxis??true};
    this.chart.invalidate();
    return this;
  }
  getUnits() {
    return this.unit;
  }
  getDisplayTitle(){return this.title+(this.unit&&this.unitsBehavior.displayOnAxis?` (${this.unit})`:'');}
  formatValue(value:number):string{
    const offset=this.tickStrategy.getFormattingOffset(),shifted=offset===undefined?value:value+offset,custom=this.tickStrategy.cursorFormatting;
    if(this.tickStrategy instanceof DateTimeTickStrategy)return this.tickStrategy.formatDateTimeCursor(shifted,this.interval);
    if(custom)return String((custom as any)(shifted,{...this.interval},undefined,undefined));
    return this.defaultValueFormat(shifted);
  }
  formatCursorValue(value:number):string{
    const strategy=this.tickStrategy,offset=strategy.getFormattingOffset();
    const text=strategy.kind==='time'&&!strategy.cursorFormatting?formatTimeDefault(offset===undefined?value:value+offset,this.interval,strategy.dateOrigin):this.defaultCursorValueFormat(value);
    return text+(this.unit&&this.unitsBehavior.displayInCursor?` ${this.unit}`:'');
  }
  protected defaultCursorValueFormat(value:number):string{return this.formatValue(value);}
  private defaultValueFormat(value:number):string{
    if(!Number.isFinite(value))return String(value);
    if(this.tickStrategy instanceof DateTimeTickStrategy)return this.tickStrategy.formatDateTimeCursor(value,this.interval);
    if(this.tickStrategy.kind==='time')return formatTimeDefault(value,this.interval,this.tickStrategy.dateOrigin);
    return formatNumeric(value,this.interval);
  }
  setTitleFont(value: any) {
    this.titleFont = mutate(this.titleFont, value);
    this.chart.invalidate();
    return this;
  }
  getTitleFont() {
    return this.titleFont;
  }
  setTitleFillStyle(value: any) {
    this.titleFill = mutate(this.titleFill, value);
    this.titleFillExplicit=true;
    this.chart.invalidate();
    return this;
  }
  getTitleFillStyle(){return this.titleFill;}
  private titleFillExplicit=false;
  hasTitleFillStyleOverride(){return this.titleFillExplicit;}
  setStrokeStyle(value: any) {
    this.stroke = mutate(this.stroke, value);
    return this;
  }
  setVisible(value: boolean) {
    this.visible = value;
    if(!value){this.pointerHover=false;this.cancelScrollAnimation();}
    this.chart.invalidate();
    return this;
  }
  getVisible() {
    return this.visible;
  }
  setInverted(value: boolean) {
    this.inverted = value;
    this.chart.invalidate();
    return this;
  }
  getInverted() {
    return this.inverted;
  }
  setMargins(value: any) {
    this.fitMarginsConfigured = true;
    if (typeof value === "number") this.margins = { start: value, end: value };
    else this.margins = { ...this.margins, ...value };
    return this;
  }
  setIntervalRestrictions(value: any) {
    this.intervalRestriction = value;
    return this;
  }
  /** Read the configured restriction value; callbacks observe the current axis
   * and series bounds. This getter does not itself apply interval constraints. */
  getIntervalRestrictions(): {startMin?:number;startMax?:number;endMin?:number;endMax?:number;intervalMin?:number;intervalMax?:number} | undefined {
    const value = this.intervalRestriction;
    if (typeof value !== 'function') return value;
    const bounds = this.chart.boundsFor(this);
    return value({curStart:this.interval.start,curEnd:this.interval.end,dataMin:bounds?.start,dataMax:bounds?.end});
  }
  setUserInteractions(value: any) {
    this.chart.validateAxisInteractions?.(this,value);
    this.interaction = value;
    return this;
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
  setHighlight(value: number) {
    if(this.highlight!==value){this.highlight = value;this.chart.invalidate();}
    return this;
  }
  getHighlight() {
    return this.highlight;
  }
  setHighlightOnHover(value: boolean) {
    if(this.highlightOnHover!==value){this.highlightOnHover = value;this.chart.invalidate();}
    return this;
  }
  getHighlightOnHover() {
    return this.highlightOnHover;
  }
  /** @internal Pointer presence is independent of the public/export settings. */
  setPointerHover(active:boolean):void {
    active=active&&this.visible&&!this.disposed;
    if(this.pointerHover!==active){this.pointerHover=active;this.chart.invalidate();}
  }
  /** @internal The public getHighlight() continues to return only manual state. */
  getEffectiveHighlight():number {
    if(this.disposed||!this.visible)return 0;
    const manual=Number.isFinite(this.highlight)?Math.max(0,Math.min(1,this.highlight)):0;
    return Math.max(manual,this.highlightOnHover&&this.pointerHover?1:0);
  }
  setAnimationDuration(_value: number) {
    return this;
  }
  setThickness(_value: number) {
    return this;
  }
  setLength(value: number|{relative:number}|{pixels:number}) {
    const size=typeof value==='number'?value:'pixels'in value?value.pixels:value.relative;
    if(!Number.isFinite(size)||size<=0)throw new RangeError('Axis length must be positive');
    this.length=typeof value==='number'?{relative:value}:{...value};this.chart.invalidate();
    return this;
  }
  getLength(){return typeof this.length==='number'?this.length:{...this.length};}
  /** Layout-only range in the common plotting surface, independent of axis inversion. */
  setScreenRange(range:Interval,lane=0){this.screenRange={...range};this.parallelLane=lane;}
  getScreenRange(){return{...this.screenRange};}
  valueToScreenFraction(value:number){const r=this.screenRange;return r.start+this.valueToFraction(value)*(r.end-r.start);}
  screenFractionToValue(value:number){const r=this.screenRange;return this.fractionToValue((value-r.start)/(r.end-r.start));}
  setPadding(_value: any) {
    return this;
  }
  setTitleRotation(value: number) {
    if(!Number.isFinite(value))throw new RangeError('Axis title rotation must be finite');
    this.titleRotation=value;this.chart.invalidate();
    return this;
  }
  getTitleRotation(){return this.titleRotation??(this.direction==='y'?-90:0);}
  setNumericPrecision(value: number) {
    this.tickStrategy.setNumericPrecision(value);
    return this;
  }
  addConstantLine(options?:boolean|{onTop?:boolean}) {
    const a = new Annotation(this, "line", () => this.chart.invalidate(),typeof options==='boolean'?options:options?.onTop??true);
    this.annotations.push(a);
    return a;
  }
  addBand(options?:boolean|{onTop?:boolean}) {
    const a = new Annotation(this, "band", () => this.chart.invalidate(),typeof options==='boolean'?options:options?.onTop??true);
    this.annotations.push(a);
    return a;
  }
  addCustomTick(_builder?: any) {
    const a = new Annotation(this, "tick", () => this.chart.invalidate());
    this.annotations.push(a);
    return a;
  }
  on(type: string, fn: any) {
    return this.events.on(type, fn);
  }
  off(typeOrToken: any, token?: any) {
    return this.events.off(typeOrToken, token);
  }
  onIntervalChange(fn: any) {
    return this.on("intervalchange", (e: any) => fn(this, e.start, e.end));
  }
  offIntervalChange(token: any) {
    return this.off("intervalchange", token);
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;
      this.pendingFitStop=undefined;
      this.pointerHover=false;
      this.cancelScrollAnimation();
      const failures:unknown[]=[],cleanup=(action:()=>unknown)=>{try{action();}catch(error){failures.push(error);}};
      for(const annotation of [...this.annotations])cleanup(()=>annotation.dispose());this.annotations.length=0;
      cleanup(()=>this.events.emit('dispose',this));cleanup(()=>this.publicEvents.dispose());this.events.clear();this.chart.invalidate();
      if(failures.length)throw new AggregateError(failures,'Axis disposal completed with consumer errors');
    }
    return this;
  }
  isDisposed() {
    return this.disposed;
  }
  valueToFraction(value: number) {
    const convert = (n: number) =>
      this.type === "logarithmic" ? Math.log10(n) : n;
    const interval=this.renderingInterval();
    const s = convert(interval.start),
      e = convert(interval.end);
    const f = (convert(value) - s) / (e - s);
    return this.inverted ? 1 - f : f;
  }
  fractionToValue(f: number) {
    if (this.inverted) f = 1 - f;
    const { start, end } = this.renderingInterval();
    return this.type === "logarithmic"
      ? 10 ** (Math.log10(start) + f * (Math.log10(end) - Math.log10(start)))
      : start + f * (end - start);
  }
  tickLayout(axisSizePixels=this.getPixelLength(),intervalCount?:number,measure?:AxisTickMeasure): {major:{value:number;label:string}[];minor:{value:number;label:string}[];great?:{value:number;label:string;anchor:number}[]} {
    if (!this.tickStrategy.visible) return {major:[],minor:[]};
    if(this.tickStrategy instanceof TimeTickStrategy)this.tickStrategy.refreshDefaults();
    const { start, end } = this.interval;
    const low = Math.min(start, end), high = Math.max(start, end);
    const dateStrategy=this.tickStrategy instanceof DateTimeTickStrategy?this.tickStrategy:undefined;
    const selectedZoom=dateStrategy?selectCalendarUnit(this.interval,dateStrategy.getUTC(),dateStrategy.dateOrigin):undefined;
    const boundedTimeMinor=this.type!=='logarithmic'&&this.tickStrategy.kind==='time'&&!this.tickStrategy.customMajor&&!this.tickStrategy.customMinor&&high-low>=15000&&high-low<3600000;
    // 一次布局内尺寸测量与输出共用格式结果，保留用户回调的原始值和返回文本。
    const timeFormatCache=boundedTimeMinor?new Map<string,string>():undefined;
    const resolveFormat = (v: number,level:'great'|'major'|'minor',zoom=selectedZoom) => {
      const custom = (level==='major'?this.tickStrategy.getMajorFormattingFunction():level==='minor'?this.tickStrategy.getMinorFormattingFunction():undefined)??(level==='great'?dateStrategy?.great.formatter:this.tickStrategy[level].formatter);
      const offset=this.tickStrategy.getFormattingOffset(),shifted=offset===undefined?v:v+offset;
      if(this.tickStrategy instanceof DateTimeTickStrategy){
        if(custom)return String(custom(shifted+this.tickStrategy.dateOrigin,{...this.interval},this.tickStrategy.getLocale(),undefined));
        return this.tickStrategy.formatDateTimeTick(shifted,this.interval,level,zoom);
      }
      if (custom) return String(custom(shifted,{...this.interval},undefined,undefined));
      return level==='minor'&&!boundedTimeMinor?'':this.defaultValueFormat(shifted);
    };
    const format=(value:number,level:'great'|'major'|'minor',zoom=selectedZoom)=>{
      if(!timeFormatCache)return resolveFormat(value,level,zoom);
      const key=level+'\0'+value,cached=timeFormatCache.get(key);if(cached!==undefined)return cached;
      const text=resolveFormat(value,level,zoom);timeFormatCache.set(key,text);return text;
    };
    if(dateStrategy&&!dateStrategy.customMajor&&!dateStrategy.customMinor){
      const grid=calendarTickGrid({interval:this.interval,axisSizePixels,utc:dateStrategy.getUTC(),origin:dateStrategy.dateOrigin,
        format:(value,level,zoom)=>format(value,level,zoom),
        measure:measure??((label,level)=>label.length*dateStrategy[level].getLabelFont().getSize()*.6),
        // A single text-size-based separation policy applies to every calendar
        // range and locale. The measured glyph widths remain the main bound.
        gapPixels:Math.max(dateStrategy.major.getLabelFont().getSize(),dateStrategy.minor.getLabelFont().getSize())+2,
        minorGapPixels:2*dateStrategy.minor.getLabelFont().getSize(),
      });
      return{major:grid.major.map(({value,label})=>({value,label})),minor:grid.minor.map(({value,label})=>({value,label})),great:grid.great.map(({value,label,anchor})=>({value,label,anchor}))};
    }
    const automatic=this.type==='logarithmic'?logarithmicTickPositions(start,end):this.tickStrategy.kind==='time'&&!this.tickStrategy.customMajor&&!this.tickStrategy.customMinor?timeTickPositions(start,end,axisSizePixels,intervalCount):numericTickPositions(start,end,axisSizePixels,intervalCount);
    if(boundedTimeMinor){
      const base=high-low<90000?1000:high-low<600000?5000:60000,majorSet=new Set(automatic.major);
      const minorCandidates=steppedTickPositions(low,high,base).filter(value=>!majorSet.has(value));
      const width=(values:number[],level:'major'|'minor')=>Math.max(0,...values.map(value=>{const text=format(value,level);return measure?.(text,level)??text.length*this.tickStrategy[level].getLabelFont().getSize()*.6;}));
      const minorFill=this.tickStrategy.minor.getLabelFillStyle(),minorTextVisible=minorFill?.kind!=='empty'&&(minorFill?.getColor?.()?.a??1)>0;
      // 隐藏标签时不需要文本间距筛选；公开Time观察保留完整基础子格。
      automatic.minor=minorTextVisible?timeTickPositions(start,end,axisSizePixels,intervalCount,{majorLabelWidth:width(automatic.major,'major'),minorLabelWidth:width(minorCandidates,'minor')}).minor:minorCandidates;
    }
    const collect=(level:'major'|'minor')=>{
      const placement=level==='major'?this.tickStrategy.customMajor:this.tickStrategy.customMinor;
      const customPixels=placement?this.chart.getAxisCustomTickPlacementPixelLength?.(this):undefined;
      const values=placement?placement({interval:{start,end},axisSizePixels:customPixels??axisSizePixels}):automatic[level];
      if(!Array.isArray(values))return[];
      return values.slice(0,1000).flatMap((tick:any)=>{
        const value=typeof tick==='number'?tick:tick?.position;
        return Number.isFinite(value)&&value>=low&&value<=high?[{value,label:tick?.label??format(value,level)}]:[];
      });
    };
    return {major:collect('major'),minor:collect('minor')};
  }
  ticks(count = 7): { value: number; label: string }[] { return this.tickLayout(this.getPixelLength(),count).major; }
}
export interface PolarAxisHost extends AxisHost {
  setAngleOrigin(value:number):unknown;getAngleOrigin():number;
  setClockwise(value:boolean):unknown;getClockwise():boolean;
}
/** Polar angles remain degrees in data; the public tick callback receives radians. */
export class PolarAxisRadial extends Axis {
  private tickFormattingFunction:(radians:number)=>string=(radians)=>`${Math.round(radians*180/Math.PI)}°`;
  constructor(readonly polarChart:PolarAxisHost,options:any={}){super(polarChart,'x',options);}
  protected override defaultCursorValueFormat(value:number):string{
    const strategy=this.tickStrategy;
    if(strategy.cursorFormatting||strategy.kind!=='numeric')return super.defaultCursorValueFormat(value);
    const offset=strategy.getFormattingOffset(),degrees=offset===undefined?value:value+offset;
    // Polar cursor positions are degrees. Their precision is independent of
    // the Cartesian interval inherited by this compatibility axis object.
    return Number.isFinite(degrees)?degrees.toFixed(0):String(degrees);
  }
  setNorth(degrees:number){if(!Number.isFinite(degrees))throw new RangeError('North angle must be finite');this.polarChart.setAngleOrigin(90-(this.polarChart.getClockwise()?-degrees:degrees));return this;}
  getNorth(_unused?:number){const angle=(90-this.polarChart.getAngleOrigin())*(this.polarChart.getClockwise()?-1:1);return angle===0?0:angle;}
  setClockwise(value:boolean){const north=this.getNorth();this.polarChart.setClockwise(value);return this.setNorth(north);}
  getClockwise(){return this.polarChart.getClockwise();}
  setTickStyle(value:Mutator<TickStyle>){this.tickStrategy.setMajorTickStyle(value);return this;}
  getTickStyle(){return this.tickStrategy.getMajorTickStyle();}
  setTickFormattingFunction(value:(radians:number)=>string){if(typeof value!=='function')throw new TypeError('Polar tick formatter must be a function');this.tickFormattingFunction=value;this.chart.invalidate();return this;}
  getTickFormattingFunction(){return this.tickFormattingFunction;}
}
export type ConstantLine = Annotation;
export type Band = Annotation;
export type AxisXYUserInteractions = Record<string, any>;
export type ChartXYUserInteractions = Record<string, any>;
export type CustomTickPlacementLogic = (...args: any[]) => any;
export type CustomTickPlacementResult = { position: number; label?: string };
