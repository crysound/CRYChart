export type ImmutableMutator<T, R = T> = (previous: T) => R;
export type ValueOrMutator<T> = T | ImmutableMutator<T>;
export const resolveValue = <T>(value: ValueOrMutator<T>, previous: T): T =>
  typeof value === 'function' ? (value as ImmutableMutator<T>)(previous) : value;

/** Unlit material colors, independent of lighting and camera orientation. */
export class SimpleShadingStyle {
  readonly type = 'simple' as const;
  constructor() { Object.freeze(this); }
}
/** Only the implemented Simple mode is exposed; Phong parameters are not emulated. */
export type ColorShadingStyle = SimpleShadingStyle;
export const ColorShadingStyles = Object.freeze({Simple: SimpleShadingStyle});
export function assertColorShadingStyle(value: unknown): asserts value is ColorShadingStyle {
  if (!value || typeof value !== 'object' || (value as {type?: unknown}).type !== 'simple')
    throw new TypeError('Unsupported color shading style; only ColorShadingStyles.Simple is implemented');
}

const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(value) ? value : lo));
const byte = (value: number) => Math.round(clamp(value) * 255);

/** Channels are normalized here; public RGBA factories and channel setters use bytes. */
export class Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  constructor(r: number | Partial<{r: number; g: number; b: number; a: number}> = 0, g = 0, b = 0, a = 1) {
    const p = typeof r === 'number' ? {r, g, b, a} : r;
    this.r = clamp(p.r ?? 0); this.g = clamp(p.g ?? 0); this.b = clamp(p.b ?? 0); this.a = clamp(p.a ?? 1);
    Object.freeze(this);
  }
  getR(): number { return this.r * 255; }
  getG(): number { return this.g * 255; }
  getB(): number { return this.b * 255; }
  getA(): number { return this.a * 255; }
  setR(value: number): Color { return new Color(value / 255, this.g, this.b, this.a); }
  setG(value: number): Color { return new Color(this.r, value / 255, this.b, this.a); }
  setB(value: number): Color { return new Color(this.r, this.g, value / 255, this.a); }
  setA(value: number): Color { return new Color(this.r, this.g, this.b, value / 255); }
  toCSS(): string { return `rgba(${byte(this.r)}, ${byte(this.g)}, ${byte(this.b)}, ${this.a})`; }
  toRGBAString(): string { return this.toCSS(); }
  toString(): string { return this.toCSS(); }
  toUint32(): number { return ((byte(this.r) << 24) | (byte(this.g) << 16) | (byte(this.b) << 8) | byte(this.a)) >>> 0; }
  getLighter(): Color { return new Color(this.r + (1 - this.r) * .2, this.g + (1 - this.g) * .2, this.b + (1 - this.b) * .2, this.a); }
  getDarker(): Color { return new Color(this.r * .8, this.g * .8, this.b * .8, this.a); }
  getHighlight(): Color { return this.r * .2126 + this.g * .7152 + this.b * .0722 > .5 ? this.getDarker() : this.getLighter(); }
}

export function ColorRGBA(r: number, g: number, b: number, a = 255): Color { return new Color(r / 255, g / 255, b / 255, a / 255); }
export function ColorRGB(r: number, g: number, b: number): Color { return ColorRGBA(r, g, b); }
export function ColorHEX(value: string): Color {
  let hex = value.trim().replace(/^#/, '');
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
  if (!/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(hex)) throw new TypeError(`Invalid hexadecimal color: ${value}`);
  return ColorRGBA(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255);
}
export function ColorHSV(h: number, s = 1, v = 1): Color {
  const hue = (((h % 360) + 360) % 360) / 60, sat = clamp(s), val = clamp(v);
  const chroma = val * sat, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = val - chroma;
  const p = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return new Color(p[0]! + m, p[1]! + m, p[2]! + m);
}

export interface FillStyle { readonly kind: string; getColor?(): Color; }
export class SolidFill implements FillStyle {
  readonly kind = 'solid';
  readonly color: Color;
  constructor(options: {color?: Color} = {}) { this.color = options.color ?? ColorRGBA(255, 255, 255); Object.freeze(this); }
  getColor(): Color { return this.color; }
  setColor(value: ValueOrMutator<Color>): SolidFill { return new SolidFill({color: resolveValue(value, this.color)}); }
  setR(value: number): SolidFill { return this.setColor(this.color.setR(value)); }
  setG(value: number): SolidFill { return this.setColor(this.color.setG(value)); }
  setB(value: number): SolidFill { return this.setColor(this.color.setB(value)); }
  setA(value: number): SolidFill { return this.setColor(this.color.setA(value)); }
}
export class EmptyFill implements FillStyle { readonly kind = 'empty'; }
export const emptyFill = Object.freeze(new EmptyFill());
export const transparentFill = new SolidFill({color: ColorRGBA(255, 255, 255, 0)});
export interface LineStyle { readonly kind: string; getFillStyle(): FillStyle; getThickness(): number; }
export interface LineOptions { fillStyle?: FillStyle; thickness?: number; }
export class SolidLine implements LineStyle {
  readonly kind: string = 'solid';
  readonly fillStyle: FillStyle;
  readonly thickness: number;
  constructor(options: LineOptions = {}) { this.fillStyle = options.fillStyle ?? new SolidFill(); this.thickness = options.thickness ?? 1; if (new.target === SolidLine) Object.freeze(this); }
  protected copy(options: LineOptions): this { return new SolidLine(options) as this; }
  getFillStyle(): FillStyle { return this.fillStyle; }
  setFillStyle(value: ValueOrMutator<FillStyle>): this { return this.copy({fillStyle: resolveValue(value, this.fillStyle), thickness: this.thickness}); }
  getThickness(): number { return this.thickness; }
  setThickness(value: ValueOrMutator<number>): this { return this.copy({fillStyle: this.fillStyle, thickness: resolveValue(value, this.thickness)}); }
}
export const StipplePatterns = Object.freeze({Dotted: [1, 3], DottedDense: [1, 1], Dashed: [6, 3], DashedEqual: [4, 4], DashedLoose: [6, 6], DashDotted: [6, 3, 1, 3]});
export class DashedLine extends SolidLine {
  override readonly kind = 'dashed';
  readonly pattern: readonly number[];
  readonly patternScale: number;
  constructor(options: LineOptions & {pattern?: readonly number[]; patternScale?: number} = {}) {
    super(options); this.pattern = Object.freeze([...(options.pattern ?? StipplePatterns.Dashed)]); this.patternScale = options.patternScale ?? 1; Object.freeze(this);
  }
  protected override copy(options: LineOptions): this { return new DashedLine({...options, pattern: this.pattern, patternScale: this.patternScale}) as this; }
  getPattern(): number[] { return [...this.pattern]; }
  setPattern(pattern: readonly number[]): DashedLine { return new DashedLine({...this, pattern}); }
  getPatternScale(): number { return this.patternScale; }
  setPatternScale(patternScale: number): DashedLine { return new DashedLine({...this, patternScale}); }
}
export const emptyLine = new SolidLine({fillStyle: emptyFill, thickness: 0});
export function isSolidFill(style: unknown): style is SolidFill {
  if (!style || typeof style !== 'object') return false;
  const value = style as Partial<SolidFill>;
  return value.kind === 'solid' && typeof value.getColor === 'function' && typeof value.setColor === 'function';
}
export function isSolidLine(style: unknown): style is SolidLine {
  if (!style || typeof style !== 'object') return false;
  const value = style as Partial<SolidLine>;
  return value.kind === 'solid' && typeof value.getFillStyle === 'function' && typeof value.setFillStyle === 'function'
    && typeof value.getThickness === 'function' && typeof value.setThickness === 'function';
}

export interface FontProperties { size: number; family: string; weight: string | number; style: string; variant: string; }
export class FontSettings implements FontProperties {
  readonly size: number; readonly family: string; readonly weight: string | number; readonly style: string; readonly variant: string;
  constructor(options: Partial<FontProperties> = {}) {
    this.size = options.size ?? 12; this.family = options.family ?? 'sans-serif'; this.weight = options.weight ?? 'normal'; this.style = options.style ?? 'normal'; this.variant = options.variant ?? 'normal'; Object.freeze(this);
  }
  setSize(size: ValueOrMutator<number>): FontSettings { return new FontSettings({...this, size: resolveValue(size, this.size)}); }
  getSize(): number { return this.size; }
  setFamily(family: ValueOrMutator<string>): FontSettings { return new FontSettings({...this, family: resolveValue(family, this.family)}); }
  getFamily(): string { return this.family; }
  setWeight(weight: ValueOrMutator<string | number>): FontSettings { return new FontSettings({...this, weight: resolveValue(weight, this.weight)}); }
  getWeight(): string | number { return this.weight; }
  setStyle(style: ValueOrMutator<string>): FontSettings { return new FontSettings({...this, style: resolveValue(style, this.style)}); }
  getStyle(): string { return this.style; }
  setVariant(variant: ValueOrMutator<string>): FontSettings { return new FontSettings({...this, variant: resolveValue(variant, this.variant)}); }
  getVariant(): string { return this.variant; }
  toCSS(): string { return `${this.style} ${this.variant} ${this.weight} ${this.size}px ${this.family}`; }
}

export interface LUTStep { value: number; color: Color; label?: string; }
export interface LUTOptions { steps?: readonly LUTStep[]; interpolate?: boolean; fallbackColor?: Color; percentageValues?: boolean; title?: string; units?: string; }
export class LUT {
  private readonly options: Required<LUTOptions>;
  constructor(options: LUTOptions = {}) {
    const steps = [...(options.steps ?? [])].map(step => Object.freeze({...step})).sort((a, b) => a.value - b.value);
    this.options = Object.freeze({steps: Object.freeze(steps), interpolate: options.interpolate ?? true, fallbackColor: options.fallbackColor ?? ColorRGBA(0, 0, 0, 0), percentageValues: options.percentageValues ?? false, title: options.title ?? '', units: options.units ?? ''});
    Object.freeze(this);
  }
  private copy(options: LUTOptions): this { return new LUT({...this.options, ...options}) as this; }
  setSteps(steps: readonly LUTStep[]): this { return this.copy({steps}); }
  getSteps(): LUTStep[] { return this.options.steps.map(step => ({...step})); }
  setTitle(title: string): this { return this.copy({title}); }
  getTitle(): string { return this.options.title; }
  setUnits(units: string): this { return this.copy({units}); }
  getUnits(): string { return this.options.units; }
  setInterpolation(interpolate: boolean): this { return this.copy({interpolate}); }
  getInterpolation(): boolean { return this.options.interpolate; }
  setFallbackColor(fallbackColor: Color): this { return this.copy({fallbackColor}); }
  getFallbackColor(): Color { return this.options.fallbackColor; }
  setPercentageValues(percentageValues: boolean): this { return this.copy({percentageValues}); }
  getPercentageValues(): boolean { return this.options.percentageValues; }
  getColor(value: number): Color {
    const steps = this.options.steps;
    if (!Number.isFinite(value) || steps.length === 0) return this.options.fallbackColor;
    if (value < steps[0]!.value) return steps[0]!.color;
    let lo = 0, hi = steps.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (steps[mid]!.value <= value) lo = mid + 1; else hi = mid; }
    const left = steps[Math.max(0, lo - 1)]!, right = steps[lo];
    if (!right || !this.options.interpolate || right.value === left.value) return left.color;
    const t = (value - left.value) / (right.value - left.value), a = left.color, b = right.color;
    return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
  }
  getColors(values: number): Color;
  getColors(values: number[]): Color[];
  getColors(values: number[][]): Color[][];
  getColors(values: number | number[] | number[][]): Color | Color[] | Color[][] {
    if (typeof values === 'number') return this.getColor(values);
    return values.map(value => Array.isArray(value) ? value.map(x => this.getColor(x)) : this.getColor(value)) as Color[] | Color[][];
  }
}
export class PalettedFill<T extends string = string> implements FillStyle {
  readonly kind = 'palette'; readonly lut: LUT; readonly lookUpProperty: T;
  constructor(options: {lut?: LUT; lookUpProperty?: T} = {}) { this.lut = options.lut ?? new LUT(); this.lookUpProperty = options.lookUpProperty ?? 'value' as T; Object.freeze(this); }
  getPalette(): LUT { return this.lut; }
  getLUT(): LUT { return this.lut; }
  setLUT(lut: LUT): PalettedFill<T> { return new PalettedFill({lut, lookUpProperty: this.lookUpProperty}); }
  getLookUpProperty(): T { return this.lookUpProperty; }
  setLookUpProperty<P extends string>(value: P | ((previous: T) => P)): PalettedFill<P> { return new PalettedFill({lut: this.lut, lookUpProperty: typeof value === 'function' ? value(this.lookUpProperty) : value}); }
}
export function regularColorSteps(min: number, max: number, colors: readonly Color[], options: {formatLabels?: (value: number) => string; alpha?: number} = {}): LUTStep[] {
  return colors.map((color, index) => { const value = min + (max - min) * index / Math.max(1, colors.length - 1); return {value, color: options.alpha === undefined ? color : color.setA(options.alpha), ...(options.formatLabels ? {label: options.formatLabels(value)} : {})}; });
}

export const AxisTickStrategies = Object.freeze({Empty: 'Empty', Numeric: 'Numeric', DateTime: 'DateTime', Time: 'Time'});
export interface ScrollStrategy { kind: string; [key: string]: unknown; }
export interface ScrollStrategyFactory { (options?: Record<string, unknown>): ScrollStrategy; readonly kind: string; }
function scrollStrategy(kind: string): ScrollStrategyFactory {
  return Object.freeze(Object.assign((options: Record<string, unknown> = {}) => Object.freeze({...options, kind}), {kind}));
}
export const AxisScrollStrategies = Object.freeze({fitting: scrollStrategy('fitting'), expansion: scrollStrategy('expansion'), progressive: scrollStrategy('progressive'), regressive: scrollStrategy('regressive'), scrolling: scrollStrategy('scrolling')});
export const PointShape = Object.freeze({Square:0,Circle:1,Triangle:2,Cross:3,Diamond:4,Plus:5,Minus:6,Arrow:7,Star:8});
export class TriangulatedPoints3D {
  readonly fillStyle: FillStyle; readonly size: number; readonly shape: string;
  constructor(options: {fillStyle?: FillStyle; size?: number; shape?: string} = {}) { this.fillStyle = options.fillStyle ?? new SolidFill(); this.size = options.size ?? 5; this.shape = options.shape ?? 'sphere'; }
  setFillStyle(value: ValueOrMutator<FillStyle>): TriangulatedPoints3D { return new TriangulatedPoints3D({...this, fillStyle: resolveValue(value, this.fillStyle)}); }
  getFillStyle(): FillStyle { return this.fillStyle; }
  setSize(value: ValueOrMutator<number>): TriangulatedPoints3D { return new TriangulatedPoints3D({...this, size: resolveValue(value, this.size)}); }
  getSize(): number { return this.size; }
  setShape(shape: string): TriangulatedPoints3D { return new TriangulatedPoints3D({...this, shape}); }
  getShape(): string { return this.shape; }
}
export class PixelatedPoints3D extends TriangulatedPoints3D {}
export const PointStyle3D = Object.freeze({Triangulated: TriangulatedPoints3D, Pixelated: PixelatedPoints3D});

export class UIBuilder {
  readonly kind: string; readonly type: string; readonly options: Readonly<Record<string, unknown>>;
  constructor(kind: string, options: Record<string, unknown> = {}) { this.kind = kind; this.type = kind; this.options = Object.freeze({...options}); Object.freeze(this); }
  setFont(font: ValueOrMutator<FontSettings>): UIBuilder { return new UIBuilder(this.kind, {...this.options, font: resolveValue(font, this.options.font as FontSettings ?? new FontSettings())}); }
  setTextFillStyle(style: FillStyle): UIBuilder { return new UIBuilder(this.kind, {...this.options, textFillStyle: style}); }
  setBackground(style: FillStyle): UIBuilder { return new UIBuilder(this.kind, {...this.options, background: style}); }
}
export const UIElementBuilders = Object.freeze({TextBox: new UIBuilder('TextBox'), CheckBox: new UIBuilder('CheckBox'), ButtonBox: new UIBuilder('ButtonBox'), PointableTextBox: new UIBuilder('PointableTextBox'), AxisTickMajor: new UIBuilder('AxisTickMajor'), AxisTickMinor: new UIBuilder('AxisTickMinor'), LUTRange: new UIBuilder('LUTRange')});
export const UILayoutBuilders = Object.freeze({Column: new UIBuilder('Column'), Row: new UIBuilder('Row')});
export const UIOrigins = Object.freeze({LeftBottom: {x: 0, y: 0}, CenterBottom: {x: .5, y: 0}, RightBottom: {x: 1, y: 0}, LeftCenter: {x: 0, y: .5}, Center: {x: .5, y: .5}, RightCenter: {x: 1, y: .5}, LeftTop: {x: 0, y: 1}, CenterTop: {x: .5, y: 1}, RightTop: {x: 1, y: 1}});

export type Palette<T> = (index: number) => T;
export type ThemePropertyWithCallbackOption<T> = T | Palette<T>;
export interface Theme {
  name: string; backgroundFillStyle: FillStyle; panelBackgroundFillStyle: FillStyle;
  chartTitleFillStyle: FillStyle; axisTitleFillStyle: FillStyle; axisStrokeStyle: SolidLine; dataColors: readonly Color[];
  chartXYBackgroundFillStyle?: FillStyle;
  chartXYTitleFillStyle?: FillStyle; chartXYTitleFont?: FontSettings;
  xAxisTitleFillStyle?: FillStyle; yAxisTitleFillStyle?: FillStyle; zAxisTitleFillStyle?: FillStyle;
  xAxisTitleFont?: FontSettings; yAxisTitleFont?: FontSettings; zAxisTitleFont?: FontSettings;
  lineSeries3DStrokeStyle?: ThemePropertyWithCallbackOption<LineStyle>;
  pointSeries3DPointStyle?: ThemePropertyWithCallbackOption<TriangulatedPoints3D>;
  pointSeriesFillStyle?: ThemePropertyWithCallbackOption<FillStyle>;
  pointSeriesStrokeStyle?: ThemePropertyWithCallbackOption<LineStyle>;
  heatmapGridSeriesFillStyle?: ThemePropertyWithCallbackOption<FillStyle>;
  heatmapGridSeriesWireframeStyle?: ThemePropertyWithCallbackOption<LineStyle>;
  heatmapScrollingGridSeriesWireframeStyle?: ThemePropertyWithCallbackOption<LineStyle>;
  heatmapScrollingGridSeriesFillStyle?: ThemePropertyWithCallbackOption<FillStyle>;
  polarHeatmapSeriesFillStyle?: ThemePropertyWithCallbackOption<FillStyle>;
  [key: string]: any;
}
const palette = ['#20b8f0', '#f5b942', '#e879a2', '#43c6a2', '#9a85ed', '#f18b53'].map(ColorHEX);
// 热图专用填充使用 11 色循环。
// 仅用于热图专用默认填充，保留通用 dataColors、LUT 和 NaN 语义。
const heatmapDarkGoldColors = ["#ffff5b", "#ffcd5b", "#ff9b5b", "#ffc4bc", "#ff94b8", "#db94c6", "#ebc4e0", "#a994c6", "#94e2c6", "#94ffb0", "#b4ffa5"];
const heatmapLightColors = ["#1cb58c", "#ff8400", "#f02727", "#5679fb", "#02b5d5", "#0dd49e", "#16a703", "#ea67e8", "#3eb7b3", "#8c5d03", "#9b9eba"];
function heatmapFillPalette(colors: readonly string[]): Palette<FillStyle> {
  const fills = colors.map(color => new SolidFill({color: ColorHEX(color)}));
  return index => fills[index % fills.length]!;
}
function makeTheme(name: string, background: string, foreground: string, heatmapColors?: readonly string[]): Theme {
  const bg = new SolidFill({color: ColorHEX(background)}), fg = new SolidFill({color: ColorHEX(foreground)});
  const heatmapFill = heatmapColors ? heatmapFillPalette(heatmapColors) : undefined;
  // Only the publicly observed darkGold/light XY defaults are initialized.
  const heatmapWireframe = heatmapFill ? new SolidLine({thickness: 1, fillStyle: new SolidFill({color: name === 'light' ? ColorRGBA(168,186,199,50) : ColorRGBA(50,50,50,50)})}) : undefined;
  return Object.freeze({name, backgroundFillStyle: bg, panelBackgroundFillStyle: bg, chartTitleFillStyle: fg, axisTitleFillStyle: fg, axisStrokeStyle: new SolidLine({fillStyle: fg}), dataColors: Object.freeze([...palette]), textColor: fg.color, backgroundColor: bg.color,
    ...(heatmapFill ? {pointSeriesFillStyle: heatmapFill, pointSeriesStrokeStyle: new SolidLine({thickness: 1, fillStyle: new SolidFill({color: name === 'light' ? ColorRGBA(0,0,0) : ColorRGBA(255,255,255)})}), heatmapGridSeriesFillStyle: heatmapFill, heatmapScrollingGridSeriesFillStyle: heatmapFill, polarHeatmapSeriesFillStyle: heatmapFill, heatmapGridSeriesWireframeStyle: heatmapWireframe, heatmapScrollingGridSeriesWireframeStyle: heatmapWireframe} : {})});
}
export const Themes = Object.freeze({darkGold: makeTheme('darkGold', '#101923', '#e7edf4', heatmapDarkGoldColors), dark: makeTheme('dark', '#101923', '#e7edf4', heatmapDarkGoldColors), light: makeTheme('light', '#ffffff', '#243447', heatmapLightColors), lightNature: makeTheme('lightNature', '#f5faf5', '#293f35'), turquoiseHexagon: makeTheme('turquoiseHexagon', '#102b31', '#d4f8f3'), cyberSpace: makeTheme('cyberSpace', '#17152c', '#ebe6ff')});
export function disableThemeEffects<T extends Record<string, any>>(theme: T): T { return {...theme, effects: false, effectsDisabled: true}; }
export function disableTextShadows<T extends Record<string, any>>(theme: T): T { return {...theme, textShadows: false, textShadowsDisabled: true}; }
export const htmlTextRenderer = Object.freeze({kind: 'html', type: 'html-text-renderer', createElement(text: string, documentRef: Document = document): HTMLElement { const element = documentRef.createElement('span'); element.textContent = text; return element; }});
