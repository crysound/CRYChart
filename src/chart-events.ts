import {EventHub, type EventToken} from './core/events.js';

/** Public callback-style subscriptions, independent of the token-style on/off API. */
export interface ChartEventListenerOptions {once?: boolean;}
export type PublicEventListener = (event: any, info?: any) => unknown;
export interface ResizeEvent {width: number; height: number; engineWidth: number; engineHeight: number;}
export interface AxisIntervalChangedEvent {start: number; end: number;}
export interface PublicEventAdapterOptions {
  kind: 'chart' | 'axis' | 'annotation';
  /** CSS-pixel sizes. Engine size can differ when a chart shares a dashboard. */
  getSize?: () => {width: number; height: number; engineWidth?: number; engineHeight?: number};
}
export interface DOMEventRoutingOptions {
  /** The owner must perform actual hit testing, e.g. a particular axis lane. */
  accept?: (event: Event) => boolean;
  info?: (event: Event) => unknown;
  options?: AddEventListenerOptions;
}
type DOMTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
interface Subscription {listener: PublicEventListener; once: boolean;}
interface Group {subscriptions: Map<PublicEventListener, Subscription>; token: EventToken;}

const interactionEvents = new Set([
  'click', 'contextmenu', 'dblclick', 'drag', 'dragend', 'dragenter', 'dragleave', 'dragover', 'dragstart', 'drop',
  'gotpointercapture', 'lostpointercapture', 'pointercancel', 'pointerdown', 'pointerenter', 'pointerleave',
  'pointermove', 'pointerout', 'pointerover', 'pointerup', 'touchcancel', 'touchend', 'touchmove', 'touchstart', 'wheel',
  // Kept for the existing CRY token API; public pointer events retain their native names.
  'mousedown', 'mousemove', 'mouseup', 'mouseenter', 'mouseleave',
]);

/** Bridges existing internal emissions without replacing or clearing their listeners.
 * Owners call dispose in a finally block after their public dispose emission.
 * Interaction callbacks receive the original DOM event, never a copied coordinate object.
 */
export class PublicEventAdapter {
  private readonly groups = new Map<string, Group>();
  private readonly domCleanups = new Set<() => void>();
  private disposed = false;

  constructor(private readonly events: EventHub, private readonly options: PublicEventAdapterOptions) {}

  addEventListener(type: string, listener: PublicEventListener, options: ChartEventListenerOptions = {}): void {
    if (typeof listener !== 'function') throw new TypeError('Event listener must be a function');
    if (this.disposed) return;
    if (typeof type !== 'string' || !type) throw new TypeError('Event type must be a non-empty string');
    const once = options.once === true;
    let group = this.groups.get(type);
    if (!group) {
      const source = this.options.kind === 'chart' && type === 'resize' ? 'layoutchange' : type;
      const token = this.events.on(source, (event: any, info?: any) => this.dispatch(type, this.normalize(type, event), info));
      group = {subscriptions: new Map(), token};
      this.groups.set(type, group);
    }
    // A repeated callback registration is idempotent, independently for each type.
    if (!group.subscriptions.has(listener)) group.subscriptions.set(listener, {listener, once});
  }

  removeEventListener(type: string, listener: PublicEventListener): void {
    const group = this.groups.get(type);
    if (!group || !group.subscriptions.delete(listener)) return;
    if (!group.subscriptions.size) {
      this.events.off(group.token);
      this.groups.delete(type);
    }
  }

  /** Route an already hit-tested native event. Do not also emit the same event on
   * the owner hub: that would intentionally represent a second event dispatch. */
  emitInteraction(type: string, event: Event, info?: unknown): void {
    if (!interactionEvents.has(type)) throw new RangeError(`Not an interaction event: ${type}`);
    this.dispatch(type, event, info);
  }

  /** Optional binding for owners without an existing DOM route. Root Chart uses
   * its own hit testing instead. Returned unbind is idempotent. */
  bindDOM(target: DOMTarget, types: readonly string[], routing: DOMEventRoutingOptions = {}): () => void {
    if (this.disposed) return () => {};
    const names = [...new Set(types)];
    for (const type of names) if (!interactionEvents.has(type)) throw new RangeError(`Not an interaction event: ${type}`);
    const bound: Array<{type: string; listener: EventListener}> = [];
    let active = true;
    const unbind = () => {
      if (!active) return;
      active = false;
      const failures: unknown[] = [];
      for (const {type, listener} of bound) try {target.removeEventListener(type, listener, routing.options);} catch (error) {failures.push(error);}
      bound.length = 0;
      this.domCleanups.delete(unbind);
      if (failures.length) throw new AggregateError(failures, 'Some DOM listeners failed to detach');
    };
    try {
      for (const type of names) {
        const listener: EventListener = event => {
          if (!this.disposed && (!routing.accept || routing.accept(event))) this.emitInteraction(type, event, routing.info?.(event));
        };
        target.addEventListener(type, listener, routing.options);
        bound.push({type, listener});
      }
    } catch (error) {
      try {unbind();} catch (cleanupError) {throw new AggregateError([error, cleanupError], 'DOM binding and rollback failed');}
      throw error;
    }
    this.domCleanups.add(unbind);
    return unbind;
  }

  listenerCount(type?: string): number {
    if (type !== undefined) return this.groups.get(type)?.subscriptions.size ?? 0;
    let count = 0;
    for (const group of this.groups.values()) count += group.subscriptions.size;
    return count;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    for (const cleanup of [...this.domCleanups]) try {cleanup();} catch (error) {failures.push(error);}
    this.domCleanups.clear();
    for (const group of this.groups.values()) {
      this.events.off(group.token);
      group.subscriptions.clear();
    }
    this.groups.clear();
    if (failures.length) throw new AggregateError(failures, 'Some public event bindings failed to detach');
  }

  private normalize(type: string, event: any): any {
    if (interactionEvents.has(type)) return event && typeof event === 'object' && 'event' in event ? event.event : event;
    if (type === 'resize' && this.options.kind === 'chart') {
      const size = this.options.getSize?.();
      const width = event?.width ?? size?.width ?? 0, height = event?.height ?? size?.height ?? 0;
      return {width, height, engineWidth: event?.engineWidth ?? size?.engineWidth ?? width, engineHeight: event?.engineHeight ?? size?.engineHeight ?? height} satisfies ResizeEvent;
    }
    if (type === 'intervalchange' && this.options.kind === 'axis') return {start: event.start, end: event.end} satisfies AxisIntervalChangedEvent;
    return event;
  }

  private dispatch(type: string, event: any, info?: any): void {
    if (this.disposed) return;
    const group = this.groups.get(type);
    if (!group) return;
    const failures: unknown[] = [];
    for (const subscription of [...group.subscriptions.values()]) {
      // A removed/replaced callback does not fire in the current delivery.
      if (this.disposed || this.groups.get(type) !== group || group.subscriptions.get(subscription.listener) !== subscription) continue;
      if (subscription.once) this.removeEventListener(type, subscription.listener);
      try {subscription.listener(event, info);} catch (error) {failures.push(error);}
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Public event listeners failed');
  }
}

/** Axis side identifiers used by the public getAxes filter. */
export enum AxisPosition {Top = 0, Bottom = 1, Left = 2, Right = 3}
export interface AxisLookupEntry {
  direction: 'x' | 'y' | 'z'; opposite?: boolean; iStack?: number; disposed?: boolean;
}
export interface AxisLookupHost<T extends AxisLookupEntry> {axesX: readonly T[]; axesY: readonly T[]; axesZ?: readonly T[];}
export function getChartAxes<X extends AxisLookupEntry, Y extends AxisLookupEntry, Z extends AxisLookupEntry = never>(
  host: {axesX: readonly X[]; axesY: readonly Y[]; axesZ?: readonly Z[]}, ...positions: AxisPosition[]
): Array<X | Y | Z> {
  for (const position of positions) if (![AxisPosition.Top, AxisPosition.Bottom, AxisPosition.Left, AxisPosition.Right].includes(position)) throw new RangeError('Unknown axis position');
  const included = new Set(positions), unique = new Set<X | Y | Z>();
  for (const axis of [...host.axesX, ...host.axesY, ...(host.axesZ ?? [])]) {
    if (axis.disposed) continue;
    const side = axis.direction === 'x' ? (axis.opposite ? AxisPosition.Top : AxisPosition.Bottom)
      : axis.direction === 'y' ? (axis.opposite ? AxisPosition.Right : AxisPosition.Left) : undefined;
    if (!included.size || side !== undefined && included.has(side)) unique.add(axis);
  }
  return [...unique].sort((a, b) => (a.iStack ?? 0) - (b.iStack ?? 0));
}

/** Public sizes are CSS pixels, not the DPR-scaled backing buffer dimensions. */
export function getChartSizePixels(host: {width: number; height: number}): {x: number; y: number} {
  return {x: host.width, y: host.height};
}
