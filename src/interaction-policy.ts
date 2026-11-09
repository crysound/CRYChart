import {UnsupportedFeatureError} from './contracts.js';

export type InteractionConfiguration = boolean | Record<string, any> | undefined | null;
export type InteractionDimension = 'x' | 'y';
export type ZoomAnchorMode = 'toward-pointer' | 'centered' | 'keep-start' | 'keep-end';
export type ChartInteractionKind = 'pan' | 'zoom' | 'rectangleZoom' | 'restoreDefault';
export interface InteractionContext {axis?: InteractionDimension; axisConfig?: InteractionConfiguration;}
export interface PointerGesture {button?: number; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean;}
export interface InteractionPolicy {
  readonly enabled: boolean;
  readonly scope: 'chart' | 'axis';
  readonly axis?: InteractionDimension;
  readonly legacyShiftPan: boolean;
  /** Immutable owned configuration snapshot. No reference to the consumer input. */
  readonly config: Readonly<Record<string, any>>;
}
export interface InteractionDecisionBase {x: boolean; y: boolean; stopScroll: boolean; sensitivity: number;}
export interface DragInteractionDecision extends InteractionDecisionBase {kind: 'none' | 'pan' | 'rectangle-zoom';}
export interface WheelInteractionDecision extends InteractionDecisionBase {kind: 'none' | 'zoom'; mode: ZoomAnchorMode; factor: number;}
export interface RestoreInteractionDecision extends InteractionDecisionBase {kind: 'none' | 'restore';}

const none = {x: false, y: false, stopScroll: false, sensitivity: 0} as const;
const buttons = ['lmb', 'mmb', 'rmb'] as const;
const knownRoots = new Set(['pan', 'zoom', 'rectangleZoom', 'restoreDefault', 'axes', 'xAxis', 'yAxis', 'chartInteractions']);
const rootDisabled = () => ({pan: false, zoom: false, rectangleZoom: false, restoreDefault: false});
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const active = (value: unknown) => value !== undefined && value !== null && value !== false;

function owned(value: any, seen = new Set<object>()): any {
  if (!object(value)) return value;
  if (seen.has(value)) throw new TypeError('Interaction configuration cannot be cyclic');
  seen.add(value);
  const result = Object.create(null);
  for (const key of Object.keys(value)) result[key] = owned(value[key], seen);
  seen.delete(value);
  return result;
}
function merge(base: Record<string, any>, override: InteractionConfiguration): Record<string, any> {
  if (override === false) return rootDisabled();
  if (override === undefined || override === null || override === true) return base;
  if (!object(override)) throw new TypeError('Interaction configuration must be an object or boolean');
  for (const key of Object.keys(override)) {
    const value = override[key];
    if (value === undefined) continue;
    base[key] = object(value) && object(base[key]) ? merge(owned(base[key]), value) : owned(value);
  }
  return base;
}
function freeze(value: any): any {
  if (object(value)) {for (const key of Object.keys(value)) freeze(value[key]); Object.freeze(value);}
  return value;
}
function unsupported(path: string): never {throw new UnsupportedFeatureError(`interaction ${path}`);}

/** Supported fields are deliberately finite. A configured feature that is
 * enabled but not routed (pinch, zoom-drag, keyboard pagination, callbacks,
 * modifier overrides, cursor styling) is rejected instead of silently ignored.
 * Explicit false/null disables those features and is accepted.
 */
function validateRule(value: any, kind: ChartInteractionKind, path: string, branch = false): void {
  if (!active(value)) return;
  if (!object(value)) throw new TypeError(`${path} must be an object or false`);
  const fields = new Set(['x', 'y', 'stopScroll', 'sensitivity']);
  if (kind === 'zoom') fields.add('mode');
  if (kind === 'restoreDefault') fields.add('doubleClick');
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (fields.has(key)) {
      if (entry === undefined) continue;
      if (key === 'sensitivity') {if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) throw new RangeError(`${path}.sensitivity must be a finite nonnegative number`);}
      else if (key === 'mode') {if (!['toward-pointer', 'centered', 'keep-start', 'keep-end'].includes(entry)) unsupported(`${path}.mode=${String(entry)}`);}
      else if (typeof entry !== 'boolean') throw new TypeError(`${path}.${key} must be boolean`);
      continue;
    }
    if (!branch && (key === 'lmb' || key === 'rmb')) {
      if (kind === 'zoom' && active(entry)) unsupported(`${path}.${key}`);
      validateRule(entry, kind, `${path}.${key}`, true); continue;
    }
    if ((key === 'drag' && (kind === 'pan' || kind === 'rectangleZoom')) || (key === 'wheel' && kind === 'zoom')) {
      validateRule(entry, kind, `${path}.${key}`, true); continue;
    }
    if (active(entry)) unsupported(`${path}.${key}`);
  }
}
function validateConfig(config: Record<string, any>): void {
  for (const key of Object.keys(config)) {
    const value = config[key];
    if (!knownRoots.has(key)) {if (active(value)) unsupported(key); continue;}
    if (key === 'axes' || key === 'xAxis' || key === 'yAxis') {
      if (object(value)) validateConfig(value); else if (active(value)) throw new TypeError(`${key} must be an object or false`);
    } else if (key === 'chartInteractions') {
      if (object(value)) {
        for (const member of Object.keys(value)) if (!['pan','zoom','rectangleZoom','restoreDefault','paginate','restorePrevious'].includes(member) && active(value[member])) unsupported(`chartInteractions.${member}`);
      } else if (active(value)) throw new TypeError('chartInteractions must be an object or false');
    } else validateRule(value, key as ChartInteractionKind, key);
  }
}

/** Axis-lane settings are separate from chart-area interactions. A global axes
 * override is refined by the directional override and finally the axis itself.
 * Explicit chart false/undefined disables chart routes. Empty/default configuration
 * preserves CRY's existing left rectangle, right/Shift pan, wheel zoom and fit.
 */
export function resolveInteractionPolicy(chartConfig: InteractionConfiguration, context: InteractionContext = {}): InteractionPolicy {
  const root = merge(Object.create(null), chartConfig);
  validateConfig(root);
  let config = root;
  if (context.axis) {
    config = merge(merge(merge(Object.create(null), root.axes), root[context.axis === 'x' ? 'xAxis' : 'yAxis']), context.axisConfig);
    validateConfig(config);
  }
  // Chart construction supplies {} for built-in defaults. The public setter's
  // explicit undefined means disabled; it must not fall back to those defaults.
  // An omitted local-axis override still inherits the chart's lane settings.
  const localDisabled = !!context.axis && 'axisConfig' in context &&
    (context.axisConfig === false || context.axisConfig === undefined);
  const enabled = chartConfig !== false && chartConfig !== undefined && !localDisabled;
  return Object.freeze({enabled, scope: context.axis ? 'axis' : 'chart', axis: context.axis,
    legacyShiftPan: config.pan === undefined && config.rectangleZoom === undefined, config: freeze(config)});
}

interface Selection {enabled: boolean; explicit: boolean; settings: Record<string, any>;}
const settingKeys = ['x','y','stopScroll','sensitivity','mode','doubleClick'];
function settingsOf(value: any): Record<string, any> {
  const result: Record<string, any> = {};
  if (object(value)) for (const key of settingKeys) if (value[key] !== undefined) result[key] = value[key];
  return result;
}
function select(config: Record<string, any>, kind: ChartInteractionKind, source: 'drag' | 'wheel' | undefined, button: string | undefined, defaultEnabled: boolean): Selection {
  const group = config[kind];
  if (group === false || group === null) return {enabled: false, explicit: true, settings: {}};
  let settings = settingsOf(group), enabled = defaultEnabled, explicit = false;
  if (source && group?.[source] !== undefined) {
    const specific = group[source]; explicit = true; enabled = object(specific); settings = {...settings, ...settingsOf(specific)};
  }
  if (button && group?.[button] !== undefined) {
    const override = group[button]; explicit = true;
    if (!object(override)) return {enabled: false, explicit, settings};
    enabled = !(source && group?.[source] === false); settings = {...settings, ...settingsOf(override)};
    if (source && override[source] !== undefined) {enabled = object(override[source]); settings = {...settings, ...settingsOf(override[source])};}
  }
  return {enabled, explicit, settings};
}
function dimensions(policy: InteractionPolicy, settings: Record<string, any>, defaultStop = true): InteractionDecisionBase {
  return {x: policy.axis !== 'y' && settings.x !== false, y: policy.axis !== 'x' && settings.y !== false,
    stopScroll: settings.stopScroll ?? defaultStop, sensitivity: settings.sensitivity ?? 1};
}
function effective(policy: InteractionPolicy, selected: Selection, defaultStop = true): InteractionDecisionBase | undefined {
  if (!policy.enabled || !selected.enabled) return undefined;
  const result = dimensions(policy, selected.settings, defaultStop);
  return (result.x || result.y) && result.sensitivity > 0 ? result : undefined;
}

export function getDragInteraction(policy: InteractionPolicy, event: PointerGesture): DragInteractionDecision {
  if (!policy.enabled) return {kind: 'none', ...none};
  const button = buttons[event.button ?? 0];
  if (button !== 'lmb' && button !== 'rmb') return {kind: 'none', ...none};
  if (policy.legacyShiftPan && event.shiftKey) return {kind: 'pan', ...dimensions(policy, {})};
  const pan = select(policy.config, 'pan', 'drag', button, button === 'rmb');
  const rectangle = select(policy.config, 'rectangleZoom', 'drag', button, button === 'lmb');
  const panResult = effective(policy, pan), rectangleResult = effective(policy, rectangle);
  if (panResult && rectangleResult && pan.explicit && rectangle.explicit) unsupported('simultaneous pan and rectangle zoom on the same button');
  if (panResult && (!rectangleResult || pan.explicit)) return {kind: 'pan', ...panResult};
  if (rectangleResult) return {kind: 'rectangle-zoom', ...rectangleResult};
  if (panResult) return {kind: 'pan', ...panResult};
  return {kind: 'none', ...none};
}

export function getWheelInteraction(policy: InteractionPolicy, event: {deltaY: number; deltaMode?: number}, pagePixels = 800): WheelInteractionDecision {
  const selection = select(policy.config, 'zoom', 'wheel', undefined, true), rule = effective(policy, selection);
  const mode: ZoomAnchorMode = selection.settings.mode ?? 'toward-pointer';
  if (!rule || !Number.isFinite(event.deltaY) || event.deltaY === 0) return {kind: 'none', ...none, mode, factor: 1};
  const deltaMode = event.deltaMode ?? 0;
  if (![0,1,2].includes(deltaMode)) throw new RangeError('Unsupported wheel delta mode');
  if (deltaMode === 2 && (!Number.isFinite(pagePixels) || pagePixels <= 0)) throw new RangeError('Wheel page size must be positive');
  // Public XY wheel behavior is one directional step per event, independent
  // of physical delta magnitude or browser delta units. This also avoids a
  // device-pixel-ratio change multiplying the requested zoom response.
  const factor = 1 + Math.sign(event.deltaY) * .2 * rule.sensitivity;
  // A very large inward sensitivity can request a zero/reversed interval.
  // Keep the valid existing interval instead of reversing or collapsing it.
  if (!Number.isFinite(factor) || factor <= 0) return {kind: 'none', ...none, mode, factor: 1};
  return {kind: 'zoom', ...rule, mode, factor};
}

/** Pointer fraction is in axis DATA order (after inversion and pane mapping). */
export function wheelAnchorFraction(mode: ZoomAnchorMode, pointerFraction: number): number {
  if (mode === 'keep-start') return 0;
  if (mode === 'keep-end') return 1;
  if (mode === 'centered') return 0.5;
  if (mode !== 'toward-pointer') throw new RangeError('Unsupported zoom anchor mode');
  if (!Number.isFinite(pointerFraction)) throw new RangeError('Pointer fraction must be finite');
  return Math.max(0, Math.min(1, pointerFraction));
}

export function getDoubleClickInteraction(policy: InteractionPolicy, event: PointerGesture = {}): RestoreInteractionDecision {
  const button = buttons[event.button ?? 0];
  if (button !== 'lmb' && button !== 'rmb') return {kind: 'none', ...none};
  const selection = select(policy.config, 'restoreDefault', undefined, button, true);
  if (selection.settings.doubleClick === false) return {kind: 'none', ...none};
  const result = effective(policy, selection, false);
  return result ? {kind: 'restore', ...result} : {kind: 'none', ...none};
}

/** Axis pan/zoom settings only apply to its lane; the distinct public opt-out
 * controls whether a chart-area gesture may affect that axis. */
export function axisAcceptsChartInteraction(axisConfig: InteractionConfiguration, kind: ChartInteractionKind): boolean {
  if (axisConfig === false) return false;
  if (!object(axisConfig)) return true;
  const flags = axisConfig.chartInteractions;
  return flags !== false && (!object(flags) || flags[kind] !== false);
}
