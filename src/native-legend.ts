import {EventHub, type EventToken} from './core/events.js';
import {FontSettings, LUT, emptyFill, type FillStyle, type FontProperties, type LineStyle, type LUTStep} from './core/styles.js';
import {LinearGradientFill, canvasGradient} from './gradients.js';
import type {Rect} from './contracts.js';

export enum LegendPosition {
  RightTop, RightCenter, RightBottom, LeftTop, LeftCenter, LeftBottom,
  TopLeft, TopCenter, TopRight, BottomLeft, BottomCenter, BottomRight,
}
export enum LegendOrientation {Horizontal, Vertical}
export interface LegendMargin {left: number; right: number; top: number; bottom: number;}
export interface LegendPoint {x: number; y: number;}
export interface LegendComponent {
  name?: string; visible?: boolean; disposed?: boolean; highlight?: number;
  getName?(): string; getTitle?(): string; getVisible?(): boolean; setVisible?(value: boolean): unknown;
  isDisposed?(): boolean; setHighlight?(value: number): unknown;
  getFillStyle?(): any; getPointFillStyle?(): any; getStrokeStyle?(): any; getPointShape?(): any;
  palette?: any;
  getSeries?(): LegendComponent[];
  on?(type: string, listener: (...args: any[]) => void): EventToken;
  off?(token: EventToken): unknown;
}
export interface LegendEntryOptions {
  show?: boolean; text?: string; highlight?: boolean;
  textFont?: Partial<FontProperties>; textFillStyle?: FillStyle;
  buttonSize?: number; buttonShape?: number | string; buttonRotation?: number;
  buttonFillStyle?: FillStyle; buttonStrokeStyle?: LineStyle; matchStyleExactly?: boolean;
  events?: Record<string, ((event: any, info: LegendEntryEventInfo) => void) | undefined>;
  lut?: LUT | null; lutLength?: number; lutThickness?: number; lutDisplayProportionalSteps?: boolean;
  lutStepValueFormatter?: (step: LUTStep, lut: LUT) => string;
}
export interface LegendEntry {component?: LegendComponent | LUT; options: LegendEntryOptions;}
export interface LegendEntryEventInfo {entry: LegendEntry; allEntries: LegendEntry[];}
export interface LegendOptions {
  addEntriesAutomatically?: boolean;
  position?: LegendPosition | {x: number; y: number; origin?: LegendPoint};
  orientation?: LegendOrientation;
  padding?: number | Partial<LegendMargin>; entryMargin?: number;
  marginInner?: number; marginOuter?: number | Partial<LegendMargin>; renderOnTop?: boolean;
  title?: string; titleFont?: Partial<FontProperties>; titleFillStyle?: FillStyle;
  visible?: boolean; backgroundVisible?: boolean; backgroundFillStyle?: FillStyle;
  backgroundStrokeStyle?: LineStyle; entries?: LegendEntryOptions; autoHideThreshold?: number;
}
export interface LegendHost {invalidate(): void; theme?: any; resolveTextFont?(font:FontSettings):FontSettings;}

/** Event target used by the public legend title/background interfaces. */
export class LegendEventTarget {
  private hub = new EventHub();
  private identities = new Map<string, Map<(...args: any[]) => void, EventToken>>();
  addEventListener(type: string, listener: (...args: any[]) => void): void {
    let group = this.identities.get(type);
    if (!group) this.identities.set(type, group = new Map());
    if (!group.has(listener)) group.set(listener, this.hub.on(type, listener));
  }
  removeEventListener(type: string, listener: (...args: any[]) => void): void {
    const group = this.identities.get(type), token = group?.get(listener);
    if (token) {this.hub.off(token); group!.delete(listener);}
    if (!group?.size) this.identities.delete(type);
  }
  on(type: string, listener: (...args: any[]) => void): EventToken {return this.hub.on(type, listener);}
  off(token: EventToken): boolean {return this.hub.off(token);}
  emit(type: string, event: any): void {this.hub.emit(type, event);}
  clear(): void {this.hub.clear(); this.identities.clear();}
  listenerCount(): number {return this.hub.listenerCount();}
}

function visibility(component: LegendEntry['component']): boolean {
  return component instanceof LUT ? true : component?.getVisible?.() ?? component?.visible ?? true;
}
export const LegendEntryClickBehaviors = Object.freeze({
  toggleIndividualVisibility(_event: any, info: LegendEntryEventInfo): void {
    const component = info.entry.component;
    if (!(component instanceof LUT)) component?.setVisible?.(!visibility(component));
  },
  focusClicked(_event: any, info: LegendEntryEventInfo): void {
    for (const entry of info.allEntries) if (!(entry.component instanceof LUT)) entry.component?.setVisible?.(entry.component === info.entry.component);
  },
  doNothing(): void {},
});

interface RecordEntry {component?: LegendComponent | LUT; options: LegendEntryOptions; automatic: boolean; sourceLUT?: LUT; effectiveOptions?: LegendEntryOptions;}
interface PaletteLabel {text: string; fraction: number; width: number;}
interface PaletteLayout {lut: LUT; rect: Rect; labels: PaletteLabel[]; vertical: boolean; proportional: boolean; font: FontSettings; labelMargin: number;}
export interface LegendEntryLayout {
  entry: LegendEntry; bounds: Rect; text: string; textRect: Rect; font: FontSettings;
  buttonRect?: Rect; palette?: PaletteLayout;
}
export interface LegendLayout {
  bounds: Rect; margin: LegendMargin; entries: LegendEntryLayout[];
  titleRect?: Rect; hidden: boolean;
}

const zeroMargin = (): LegendMargin => ({left: 0, right: 0, top: 0, bottom: 0});
const zeroRect = (): Rect => ({left: 0, top: 0, width: 0, height: 0});
function margin(value: number | Partial<LegendMargin> | undefined, fallback: number): LegendMargin {
  const m = typeof value === 'number' ? {left: value, right: value, top: value, bottom: value} : value ?? {};
  const finite = (n: number | undefined) => Number.isFinite(n) ? Math.max(0, n!) : fallback;
  return {left: finite(m.left), right: finite(m.right), top: finite(m.top), bottom: finite(m.bottom)};
}
const inside = (p: LegendPoint, r?: Rect): boolean => !!r && p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;
function cloneEntryOptions(options: LegendEntryOptions): LegendEntryOptions {
  return {...options, ...(options.events ? {events: {...options.events}} : {}), ...(options.textFont ? {textFont: {...options.textFont}} : {})};
}
function entryOptions(base: LegendEntryOptions = {}, override: LegendEntryOptions = {}): LegendEntryOptions {
  return {...base, ...override, textFont: {...base.textFont, ...override.textFont}, events: {...base.events, ...override.events}};
}
function cloneLegendOptions(options: LegendOptions): LegendOptions {
  return {...options,
    ...(typeof options.position === 'object' ? {position: {...options.position, origin: options.position.origin && {...options.position.origin}}} : {}),
    ...(typeof options.padding === 'object' ? {padding: {...options.padding}} : {}),
    ...(typeof options.marginOuter === 'object' ? {marginOuter: {...options.marginOuter}} : {}),
    ...(options.titleFont ? {titleFont: {...options.titleFont}} : {}),
    ...(options.entries ? {entries: cloneEntryOptions(options.entries)} : {}),
  };
}
function validStyle(style: any): boolean {return !!style && style !== emptyFill && style.kind !== 'empty' && (style.getColor?.()?.a ?? 1) !== 0;}
function componentFill(component: LegendEntry['component']): any {
  if (!component || component instanceof LUT) return undefined;
  return [component.getPointFillStyle?.(), component.getFillStyle?.(), component.getStrokeStyle?.()?.getFillStyle?.(), component.palette].find(validStyle);
}
function colorCSS(fill: any, fallback: string): string {
  return fill?.kind === 'empty' ? 'rgba(0, 0, 0, 0)' : fill?.getColor?.()?.toCSS?.() ?? fill?.color?.toCSS?.() ?? (typeof fill === 'string' ? fill : fallback);
}
function fillPaint(ctx: CanvasRenderingContext2D, fill: any, bounds: Rect, fallback: string): string | CanvasGradient {
  return fill instanceof LinearGradientFill ? canvasGradient(ctx, fill, bounds) : colorCSS(fill, fallback);
}
function finiteSize(value: number | undefined, fallback: number): number {return Number.isFinite(value) ? Math.max(0, value!) : fallback;}
function font(options?: Partial<FontProperties>, fallbackSize = 12): FontSettings {
  return new FontSettings({...options, size: Math.max(1, finiteSize(options?.size, fallbackSize))});
}

/** Canvas legend with native entry identities, live series styles and LUTs.
 * The chart owns registration, drawing and forwarding native pointer events.
 * It never owns or disposes the represented series/LUT objects.
 */
export class NativeLegend {
  readonly title = new LegendEventTarget();
  readonly background = new LegendEventTarget();
  private records: RecordEntry[] = [];
  private registered = new Map<LegendComponent, LegendEntryOptions | null>();
  private subscriptions = new Map<LegendComponent, EventToken>();
  private options: LegendOptions;
  private disposed = false;
  private layout?: LegendLayout;
  private hovered?: RecordEntry;
  private hoverHighlight?: number;
  private hoverPart?: 'title' | 'background';
  private area?: Rect;
  private positionExplicit: boolean;

  constructor(private readonly host: LegendHost, options: LegendOptions = {}) {
    this.positionExplicit = options.position !== undefined;
    this.options = {
      addEntriesAutomatically: true, position: LegendPosition.BottomCenter,
      entryMargin: 5, marginInner: 7, marginOuter: zeroMargin(), visible: true,
      renderOnTop: false, backgroundVisible: false, autoHideThreshold: .5,
      ...cloneLegendOptions(options),
    };
  }
  private changed(): void {this.layout = undefined; this.host.invalidate();}
  private subscribe(component: LegendComponent): void {
    if (!this.subscriptions.has(component) && component.on && component.off) {
      const token = component.on('dispose', () => this.removeSeries(component));
      this.subscriptions.set(component, token);
    }
  }
  private unsubscribe(component: LegendComponent): void {
    const token = this.subscriptions.get(component);
    if (token) component.off?.(token);
    this.subscriptions.delete(component);
  }
  private prune(): void {
    for (const component of new Set([...this.registered.keys(), ...this.records.map(record => record.component).filter((c): c is LegendComponent => !!c && !(c instanceof LUT))])) {
      if (component.isDisposed?.() || component.disposed) this.removeSeries(component);
    }
  }
  private view(record: RecordEntry): LegendEntry {
    return {component: record.component, options: record.effectiveOptions ??= entryOptions(this.options.entries, record.options)};
  }
  private addRecord(component: LegendEntry['component'], options: LegendEntryOptions, automatic: boolean): void {
    const existing = component && this.records.find(record => record.component === component);
    if (existing) {existing.options = entryOptions(existing.options, options); existing.effectiveOptions = undefined; existing.automatic &&= automatic;}
    else this.records.push({component, options: cloneEntryOptions(options), automatic});
    if (component && !(component instanceof LUT)) this.subscribe(component);
  }
  add(component?: LegendComponent | LUT, options: LegendEntryOptions = {}): this {
    if (this.disposed) return this;
    if (component instanceof LUT) {
      const existing = this.records.find(record => record.sourceLUT === component);
      if (existing) {existing.options = entryOptions(existing.options, options); existing.effectiveOptions = undefined;}
      // Public entry identity is an opaque removal handle, distinct from the LUT.
      // No vendor implementation fields or private key names are reproduced.
      else this.records.push({component: Object.freeze({}), options: cloneEntryOptions(options), sourceLUT: component, automatic: false});
      if (!this.positionExplicit) this.options.position = LegendPosition.RightCenter;
    } else if (component?.getSeries) {
      for (const series of component.getSeries()) this.addRecord(series, options, false);
    } else this.addRecord(component, options, false);
    this.changed(); return this;
  }
  /** Called once for each newly attached chart series. Null explicitly opts out. */
  registerSeries(series: LegendComponent, options: LegendEntryOptions | null = {}): this {
    if (this.disposed || series.isDisposed?.() || series.disposed) return this;
    this.registered.set(series, options === null ? null : cloneEntryOptions(options));
    this.subscribe(series);
    if (options === null) this.records = this.records.filter(record => record.component !== series || !record.automatic);
    if (this.options.addEntriesAutomatically && options !== null) this.addRecord(series, options, true);
    this.changed(); return this;
  }
  remove(component: LegendComponent | LUT): this {
    const removed = this.records.filter(record => record.component === component);
    if (!removed.length) return this;
    this.records = this.records.filter(record => record.component !== component);
    try {if (removed.includes(this.hovered!)) this.leaveHover(undefined);} finally {
      if (!(component instanceof LUT) && !this.registered.has(component)) this.unsubscribe(component);
      this.changed();
    }
    return this;
  }
  removeSeries(series: LegendComponent): this {
    this.registered.delete(series);
    try {this.remove(series);} finally {this.unsubscribe(series);}
    return this;
  }
  clear(): this {
    this.records = [];
    try {this.leaveHover(undefined);} finally {
      for (const component of this.subscriptions.keys()) if (!this.registered.has(component)) this.unsubscribe(component);
      this.changed();
    }
    return this;
  }
  setOptions(options: LegendOptions): this {
    if (this.disposed) return this;
    if (options.position !== undefined) this.positionExplicit = true;
    this.options = {...this.options, ...cloneLegendOptions(options), ...(options.entries ? {entries: entryOptions(this.options.entries, options.entries)} : {})};
    // Automatic mode applies to future registrations; existing entries retain identity.
    if (options.entries) for (const record of this.records) record.effectiveOptions = undefined;
    if (options.visible === false) this.leaveHover(undefined);
    this.changed(); return this;
  }
  getOptions(): LegendOptions {return cloneLegendOptions(this.options);}
  setEntryOptions(component: LegendComponent | LUT, options: Partial<LegendEntryOptions>): this {
    const record = this.records.find(entry => entry.component === component || entry.sourceLUT === component);
    if (record && !this.disposed) {record.options = entryOptions(record.options, options); record.effectiveOptions = undefined; this.changed();}
    return this;
  }
  getEntryOptions(component: LegendComponent | LUT): LegendEntryOptions | undefined {
    this.prune(); const record = this.records.find(entry => entry.component === component || entry.sourceLUT === component);
    return record ? this.view(record).options : undefined;
  }
  getEntries(): LegendEntry[] {this.prune(); return this.records.map(record => this.view(record));}
  setVisible(visible: boolean): this {return this.setOptions({visible});}
  getVisible(): boolean {return !this.disposed && this.options.visible !== false;}
  isDisposed(): boolean {return this.disposed;}

  private entryLayout(ctx: CanvasRenderingContext2D, record: RecordEntry, index: number, vertical: boolean): LegendEntryLayout {
    const entry = this.view(record), settings = entry.options, component = entry.component;
    const baseFont = font({...this.host.theme?.uiTextFont, ...settings.textFont}),entryFont=this.host.resolveTextFont?.(baseFont)??baseFont, lineHeight = entryFont.size + 6;
    const represented = !(component instanceof LUT) && !record.sourceLUT ? component : undefined;
    const fill = componentFill(component);
    const lut = settings.lut === null ? undefined : settings.lut ?? record.sourceLUT ?? (component instanceof LUT ? component : fill?.getLUT?.() ?? fill?.getPalette?.() ?? fill?.lut);
    const text = settings.text ?? (represented?.getName?.() || represented?.name || lut?.getTitle?.() || `Series ${index + 1}`);
    // A bare LUT has no synthetic series name or series visibility button.
    const label = settings.text ?? ((record.sourceLUT || component instanceof LUT || !component) && lut ? lut.getTitle() : text);
    ctx.font = entryFont.toCSS();
    const buttonSize = represented ? finiteSize(settings.buttonSize, 12) : 0;
    const rowHeight = label || represented ? Math.max(lineHeight, buttonSize) : 0;
    const textLeft = buttonSize > 0 ? buttonSize + 7 : 0;
    let width = textLeft + ctx.measureText(label).width, height = rowHeight;
    const result: LegendEntryLayout = {entry, bounds: zeroRect(), text: label, font: entryFont,
      textRect: {left: textLeft, top: 0, width: ctx.measureText(label).width, height: rowHeight}};
    if (buttonSize) result.buttonRect = {left: 0, top: (rowHeight - buttonSize) / 2, width: buttonSize, height: buttonSize};
    if (lut instanceof LUT) {
      const steps = lut.getSteps().filter(step => Number.isFinite(step.value)), first = steps[0]?.value ?? 0, last = steps.at(-1)?.value ?? first;
      const proportional = settings.lutDisplayProportionalSteps !== false;
      const labels = steps.map((step, i) => {
        const text = String(settings.lutStepValueFormatter?.(step, lut) ?? step.label ?? `${step.value}${lut.getUnits() ? ` ${lut.getUnits()}` : ''}`);
        return {text, fraction: proportional && last !== first ? (step.value - first) / (last - first) : steps.length > 1 ? i / (steps.length - 1) : .5, width: ctx.measureText(text).width};
      });
      const theme = this.host.theme;
      const length = finiteSize(settings.lutLength, finiteSize(vertical ? theme?.legendLUTLengthVertical : theme?.legendLUTLengthHorizontal, 160));
      const thickness = finiteSize(settings.lutThickness, finiteSize(vertical ? theme?.legendLUTThicknessVertical : theme?.legendLUTThicknessHorizontal, 12)), gap = rowHeight ? 5 : 0;
      const labelMargin = finiteSize(theme?.legendLUTLabelMargin, vertical ? 6 : 4);
      const labelWidth = Math.max(0, ...labels.map(item => item.width));
      const leftGutter = vertical ? 0 : (labels[0]?.width ?? 0) / 2;
      const rightGutter = vertical ? 0 : (labels.at(-1)?.width ?? 0) / 2;
      const rect = vertical
        ? {left: 0, top: rowHeight + gap + lineHeight / 2, width: thickness, height: length}
        : {left: leftGutter, top: rowHeight + gap, width: length, height: thickness};
      result.palette = {lut, rect, labels, vertical, proportional, font: entryFont, labelMargin};
      width = Math.max(width, vertical ? thickness + labelMargin + labelWidth : leftGutter + length + rightGutter);
      height += gap + (vertical ? length + lineHeight : thickness + lineHeight + labelMargin);
    }
    result.bounds.width = Math.max(1, width); result.bounds.height = Math.max(1, height);
    return result;
  }

  /** CSS coordinates; reserve returned margin before computing the chart plot. */
  getLayout(ctx: CanvasRenderingContext2D, area: Rect): LegendLayout {
    this.area = {...area};
    const empty = (): LegendLayout => ({bounds: zeroRect(), margin: zeroMargin(), entries: [], hidden: true});
    if (!this.getVisible() || !(area.width > 0 && area.height > 0)) return this.layout = empty();
    this.prune();
    const position = this.options.position ?? LegendPosition.BottomCenter;
    const vertical = this.options.orientation === LegendOrientation.Vertical || (this.options.orientation === undefined && (typeof position === 'object' || position < LegendPosition.TopLeft));
    const padding = margin(this.options.padding, finiteSize(this.host.theme?.legendPadding, 8)), outside = margin(this.options.marginOuter, 0);
    const entryGap = finiteSize(this.options.entryMargin, 5), inner = finiteSize(this.options.marginInner, 7);
    const entries: LegendEntryLayout[] = [];
    ctx.save();
    try {
    for (let i = 0; i < this.records.length; i++) if (this.view(this.records[i]).options.show !== false) entries.push(this.entryLayout(ctx, this.records[i], i, vertical));
    const baseTitleFont = font({...this.host.theme?.legendTitleFont, ...this.options.titleFont}, 13),titleFont=this.host.resolveTextFont?.(baseTitleFont)??baseTitleFont, titleHeight = this.options.title ? titleFont.size + 10 : 0;
    ctx.font = titleFont.toCSS();
    let contentWidth = this.options.title ? ctx.measureText(this.options.title).width : 0, contentHeight = 0;
    // Horizontal legends wrap complete entries; LUT strips are never cut apart.
    const maxRowWidth = Math.max(1, area.width - padding.left - padding.right - outside.left - outside.right);
    let rowX = 0, rowY = titleHeight, rowHeight = 0;
    for (const entry of entries) {
      if (vertical) {
        entry.bounds.left = 0; entry.bounds.top = rowY; rowY += entry.bounds.height + entryGap;
        contentWidth = Math.max(contentWidth, entry.bounds.width);
      } else {
        if (rowX > 0 && rowX + entry.bounds.width > maxRowWidth) {rowY += rowHeight + entryGap; rowX = 0; rowHeight = 0;}
        entry.bounds.left = rowX; entry.bounds.top = rowY;
        rowX += entry.bounds.width + entryGap; rowHeight = Math.max(rowHeight, entry.bounds.height);
        contentWidth = Math.max(contentWidth, rowX - entryGap);
      }
    }
    contentHeight = vertical ? Math.max(titleHeight, rowY - (entries.length ? entryGap : 0)) : rowY + rowHeight;
    if (!entries.length && !this.options.title) return this.layout = empty();
    const width = contentWidth + padding.left + padding.right, height = contentHeight + padding.top + padding.bottom;
    const threshold = finiteSize(this.options.autoHideThreshold, .5);
    if (width > area.width || height > area.height || width * height > area.width * area.height * threshold) return this.layout = empty();
    let left: number, top: number;
    const reserved = zeroMargin();
    if (typeof position === 'object') {
      const origin = position.origin ?? {x: 0, y: 0};
      left = area.left + position.x - width * origin.x;
      top = area.top + area.height - position.y - height * (1 - origin.y);
    } else {
      const right = position <= LegendPosition.RightBottom, leftSide = position >= LegendPosition.LeftTop && position <= LegendPosition.LeftBottom;
      const upper = position >= LegendPosition.TopLeft && position <= LegendPosition.TopRight;
      if (right || leftSide) {
        left = right ? area.left + area.width - outside.right - width : area.left + outside.left;
        const row = right ? position : position - LegendPosition.LeftTop;
        top = row === 0 ? area.top + outside.top : row === 2 ? area.top + area.height - outside.bottom - height : area.top + (area.height - height) / 2;
        reserved[right ? 'right' : 'left'] = width + inner + (right ? outside.right : outside.left);
      } else {
        const column = upper ? position - LegendPosition.TopLeft : position - LegendPosition.BottomLeft;
        left = column === 0 ? area.left + outside.left : column === 2 ? area.left + area.width - outside.right - width : area.left + (area.width - width) / 2;
        top = upper ? area.top + outside.top : area.top + area.height - outside.bottom - height;
        reserved[upper ? 'top' : 'bottom'] = height + inner + (upper ? outside.top : outside.bottom);
      }
    }
    const bounds = {left, top, width, height};
    for (const entry of entries) {
      entry.bounds.left += left + padding.left; entry.bounds.top += top + padding.top;
      for (const box of [entry.textRect, entry.buttonRect, entry.palette?.rect]) if (box) {box.left += entry.bounds.left; box.top += entry.bounds.top;}
    }
    return this.layout = {bounds, margin: this.options.renderOnTop ? zeroMargin() : reserved, entries, hidden: false,
      ...(titleHeight ? {titleRect: {left: left + padding.left, top: top + padding.top, width: contentWidth, height: titleHeight}} : {})};
    } finally {ctx.restore();}
  }

  private textFill(): string {return colorCSS(this.host.theme?.uiTextFillStyle ?? this.host.theme?.axisTitleFillStyle ?? this.host.theme?.chartTitleFillStyle, '#e7edf4');}
  private drawPalette(ctx: CanvasRenderingContext2D, palette: PaletteLayout, options: LegendEntryOptions): void {
    const {lut, rect: r, vertical, proportional, labels} = palette;
    const steps = lut.getSteps().filter(step => Number.isFinite(step.value));
    const low = steps[0]?.value ?? 0, high = steps.at(-1)?.value ?? low;
    const fraction = (i: number) => proportional && high !== low ? (steps[i].value - low) / (high - low) : steps.length > 1 ? i / (steps.length - 1) : 0;
    if (steps.length === 1) {ctx.fillStyle = steps[0].color.toCSS(); ctx.fillRect(r.left, r.top, r.width, r.height);}
    else if (steps.length > 1 && lut.getInterpolation()) {
      const gradient = vertical ? ctx.createLinearGradient(r.left, r.top + r.height, r.left, r.top) : ctx.createLinearGradient(r.left, r.top, r.left + r.width, r.top);
      for (let i = 0; i < steps.length; i++) gradient.addColorStop(Math.max(0, Math.min(1, fraction(i))), steps[i].color.toCSS());
      ctx.fillStyle = gradient; ctx.fillRect(r.left, r.top, r.width, r.height);
    } else if (steps.length > 1) {
      for (let i = 0; i < steps.length - 1; i++) {
        const from = fraction(i), to = fraction(i + 1);
        ctx.fillStyle = steps[i].color.toCSS();
        if (vertical) ctx.fillRect(r.left, r.top + (1 - to) * r.height, r.width, (to - from) * r.height);
        else ctx.fillRect(r.left + from * r.width, r.top, (to - from) * r.width, r.height);
      }
    }
    ctx.font = palette.font.toCSS(); ctx.fillStyle = colorCSS(options.textFillStyle, this.textFill());
    // Keep endpoint labels, and add intermediate labels only where they fit.
    const accepted: Array<{start: number; end: number}> = [];
    const order = labels.length > 1 ? [0, labels.length - 1, ...labels.slice(1, -1).map((_, i) => i + 1)] : [0];
    for (const index of order) {
      const label = labels[index]; if (!label) continue;
      const center = (vertical ? 1 - label.fraction : label.fraction) * (vertical ? r.height : r.width);
      const half = (vertical ? palette.font.size + 4 : label.width + 6) / 2, start = center - half, end = center + half;
      if (accepted.some(a => start < a.end && end > a.start)) continue;
      accepted.push({start, end});
      ctx.textAlign = vertical ? 'left' : 'center'; ctx.textBaseline = vertical ? 'middle' : 'top';
      ctx.fillText(label.text, vertical ? r.left + r.width + palette.labelMargin : r.left + center, vertical ? r.top + center : r.top + r.height + palette.labelMargin);
    }
  }
  private drawButton(ctx: CanvasRenderingContext2D, entry: LegendEntryLayout): void {
    const r = entry.buttonRect!;
    const settings = entry.entry.options, component = entry.entry.component;
    let fill = settings.buttonFillStyle ?? componentFill(component);
    const lut = fill?.getLUT?.() ?? fill?.getPalette?.();
    if (lut instanceof LUT) {const steps = lut.getSteps(); fill = {getColor: () => lut.getColor((steps[0]?.value ?? 0) + ((steps.at(-1)?.value ?? 0) - (steps[0]?.value ?? 0)) / 2)};}
    ctx.fillStyle = fillPaint(ctx, fill, r, '#38bdf8');
    const color = fill?.getColor?.();
    if (!settings.matchStyleExactly && !(fill instanceof LinearGradientFill) && color?.getLighter && color?.getDarker) {
      const gradient = ctx.createLinearGradient(r.left, r.top, r.left, r.top + r.height);
      gradient.addColorStop(0, color.getLighter().toCSS()); gradient.addColorStop(1, color.getDarker().toCSS()); ctx.fillStyle = gradient;
    }
    ctx.save(); ctx.translate(r.left + r.width / 2, r.top + r.height / 2); ctx.rotate((settings.buttonRotation ?? 0) * Math.PI / 180);
    const shape = settings.buttonShape ?? (!(component instanceof LUT) ? component?.getPointShape?.() : undefined) ?? 0;
    ctx.beginPath();
    if (shape === 1 || shape === 'circle') ctx.arc(0, 0, r.width / 2, 0, Math.PI * 2);
    else if (shape === 2 || shape === 'triangle') {ctx.moveTo(0, -r.height / 2); ctx.lineTo(r.width / 2, r.height / 2); ctx.lineTo(-r.width / 2, r.height / 2); ctx.closePath();}
    else if (shape === 4 || shape === 'diamond') {ctx.moveTo(0, -r.height / 2); ctx.lineTo(r.width / 2, 0); ctx.lineTo(0, r.height / 2); ctx.lineTo(-r.width / 2, 0); ctx.closePath();}
    else if (shape === 3 || shape === 5 || shape === 'cross' || shape === 'plus') {
      if (shape === 3 || shape === 'cross') ctx.rotate(Math.PI / 4);
      const arm = r.width / 6; ctx.rect(-arm, -r.height / 2, arm * 2, r.height); ctx.rect(-r.width / 2, -arm, r.width, arm * 2);
    }
    else if (shape === 6 || shape === 'minus') ctx.rect(-r.width / 2, -r.height / 6, r.width, r.height / 3);
    else if (shape === 7 || shape === 'arrow') {ctx.moveTo(0, -r.height / 2); ctx.lineTo(r.width / 2, 0); ctx.lineTo(r.width / 6, 0); ctx.lineTo(r.width / 6, r.height / 2); ctx.lineTo(-r.width / 6, r.height / 2); ctx.lineTo(-r.width / 6, 0); ctx.lineTo(-r.width / 2, 0); ctx.closePath();}
    else if (shape === 8 || shape === 'star') {
      for (let i = 0; i < 10; i++) {const angle = i * Math.PI / 5 - Math.PI / 2, radius = r.width * (i % 2 ? .22 : .5), x = Math.cos(angle) * radius, y = Math.sin(angle) * radius; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);} ctx.closePath();
    }
    else ctx.rect(-r.width / 2, -r.height / 2, r.width, r.height);
    ctx.fill();
    const stroke = settings.buttonStrokeStyle;
    if (stroke && stroke.getThickness() > 0) {ctx.lineWidth = stroke.getThickness(); ctx.strokeStyle = colorCSS(stroke.getFillStyle(), '#8a9aad'); ctx.stroke();}
    ctx.restore();
  }
  draw(ctx: CanvasRenderingContext2D, area: Rect): void {
    const layout = this.getLayout(ctx, area); if (layout.hidden) return;
    ctx.save(); ctx.beginPath(); ctx.rect(area.left, area.top, area.width, area.height); ctx.clip();
    if (this.options.backgroundVisible) {
      ctx.fillStyle = fillPaint(ctx, this.options.backgroundFillStyle ?? this.host.theme?.backgroundFillStyle, layout.bounds, 'rgba(18,29,42,.9)');
      ctx.fillRect(layout.bounds.left, layout.bounds.top, layout.bounds.width, layout.bounds.height);
      const stroke = this.options.backgroundStrokeStyle;
      if (stroke && stroke.getThickness() > 0) {ctx.strokeStyle = colorCSS(stroke.getFillStyle(), '#8a9aad'); ctx.lineWidth = stroke.getThickness(); ctx.strokeRect(layout.bounds.left, layout.bounds.top, layout.bounds.width, layout.bounds.height);}
    }
    if (layout.titleRect) {
      const baseTitleFont=font({...this.host.theme?.legendTitleFont, ...this.options.titleFont}, 13);ctx.font = (this.host.resolveTextFont?.(baseTitleFont)??baseTitleFont).toCSS(); ctx.fillStyle = colorCSS(this.options.titleFillStyle ?? this.host.theme?.legendTitleFillStyle, this.textFill()); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(this.options.title ?? '', layout.titleRect.left, layout.titleRect.top + 2);
    }
    for (const entry of layout.entries) {
      ctx.save(); if (!visibility(entry.entry.component)) ctx.globalAlpha *= .38;
      if (entry.buttonRect) this.drawButton(ctx, entry);
      ctx.font = entry.font.toCSS(); ctx.fillStyle = colorCSS(entry.entry.options.textFillStyle, this.textFill()); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (entry.text) ctx.fillText(entry.text, entry.textRect.left, entry.textRect.top + entry.textRect.height / 2);
      if (entry.palette) this.drawPalette(ctx, entry.palette, entry.entry.options);
      ctx.restore();
    }
    ctx.restore();
  }
  hitTest(point: LegendPoint): boolean {return this.getVisible() && !!this.layout && !this.layout.hidden && inside(point, this.area) && inside(point, this.layout.bounds);}
  private dispatch(record: RecordEntry, type: string, event: any): void {
    // Do not re-enter pruning while dispatching the departure of a disposed series.
    const info = {entry: this.view(record), allEntries: this.records.map(entry => this.view(entry))};
    const callback = info.entry.options.events?.[type];
    if (callback) callback(event, info);
    else if (type === 'click') LegendEntryClickBehaviors.toggleIndividualVisibility(event, info);
  }
  private leaveHover(event: any): void {
    if (this.hovered) {
      const record = this.hovered; this.hovered = undefined;
      const component = record.component;
      if (!(component instanceof LUT) && this.hoverHighlight !== undefined && !component?.disposed && !component?.isDisposed?.()) component?.setHighlight?.(this.hoverHighlight);
      this.hoverHighlight = undefined; this.dispatch(record, 'pointerleave', event);
    }
    if (this.hoverPart) {this[this.hoverPart].emit('pointerleave', event); this.hoverPart = undefined;}
  }
  /** Forward CSS pixel point and the original DOM event; click toggles exactly once. */
  handlePointer(type: string, point: LegendPoint, event: any = {type, ...point}): boolean {
    if (type === 'pointerleave' || !this.hitTest(point)) {this.leaveHover(event); return false;}
    const layoutEntry = this.layout!.entries.find(entry => inside(point, entry.bounds));
    const record = layoutEntry ? this.records.find(item => item.component === layoutEntry.entry.component && (item.component !== undefined || this.view(item).options.text === layoutEntry.entry.options.text)) : undefined;
    const part = inside(point, this.layout!.titleRect) ? 'title' : 'background';
    if (type === 'pointermove' || type === 'pointerenter') {
      if (this.hovered !== record || this.hoverPart !== (record ? undefined : part)) {
        this.leaveHover(event); this.hovered = record;
        if (record) {
          const component = record.component;
          if (this.view(record).options.highlight !== false && !(component instanceof LUT) && component?.setHighlight) {
            this.hoverHighlight = component.highlight ?? 0; component.setHighlight(1);
          }
          this.dispatch(record, 'pointerenter', event);
        } else {this.hoverPart = part; this[part].emit('pointerenter', event);}
      }
    }
    if (type !== 'pointerenter') {
      if (record) this.dispatch(record, type, event);
      else this[part].emit(type, event);
    }
    if (type === 'click') this.changed();
    return true;
  }
  dispose(): this {
    if (this.disposed) return this;
    this.disposed = true;
    try {this.leaveHover(undefined);} finally {
      for (const component of this.subscriptions.keys()) this.unsubscribe(component);
      this.records = []; this.registered.clear(); this.layout = undefined; this.area = undefined;
      this.title.clear(); this.background.clear(); this.host.invalidate();
    }
    return this;
  }
}
export {NativeLegend as Legend};
