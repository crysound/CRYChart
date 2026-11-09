/** Subscription identity is independent of event name and callback identity. */
export type EventToken = symbol;
export type Token = EventToken;
export type EventListener = (...args: any[]) => void;

/** Small synchronous event dispatcher. Mutations during delivery are deterministic. */
export class EventHub {
  private readonly listeners = new Map<string | symbol, Map<EventToken, EventListener>>();
  private readonly names = new Map<EventToken, string | symbol>();

  on(name: string | symbol, listener: EventListener): EventToken {
    if (typeof listener !== 'function') throw new TypeError('Event listener must be a function');
    const token = Symbol(typeof name === 'string' ? name : name.description);
    let group = this.listeners.get(name);
    if (!group) this.listeners.set(name, group = new Map());
    group.set(token, listener);
    this.names.set(token, name);
    return token;
  }

  once(name: string | symbol, listener: EventListener): EventToken {
    const token = this.on(name, (...args) => { this.off(token); listener(...args); });
    return token;
  }

  off(token: EventToken): boolean;
  off(name: string | symbol, token: EventToken): boolean;
  off(nameOrToken: string | symbol, token?: EventToken): boolean {
    const identity = token ?? nameOrToken;
    if (typeof identity !== 'symbol') return false;
    const name = this.names.get(identity);
    if (name === undefined || (token !== undefined && name !== nameOrToken)) return false;
    const group = this.listeners.get(name);
    group?.delete(identity);
    this.names.delete(identity);
    if (group?.size === 0) this.listeners.delete(name);
    return true;
  }

  emit(name: string | symbol, ...args: any[]): void {
    const group = this.listeners.get(name);
    if (!group) return;
    // New listeners begin on the next emission; removed listeners are skipped.
    for (const [token, listener] of [...group]) {
      if (this.names.get(token) === name) listener(...args);
    }
  }

  clear(name?: string | symbol): void {
    if (name === undefined) { this.listeners.clear(); this.names.clear(); return; }
    const group = this.listeners.get(name);
    if (group) for (const token of group.keys()) this.names.delete(token);
    this.listeners.delete(name);
  }

  listenerCount(name?: string | symbol): number {
    return name === undefined ? this.names.size : (this.listeners.get(name)?.size ?? 0);
  }
}
