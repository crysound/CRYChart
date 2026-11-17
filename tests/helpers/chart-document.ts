import type { TestContext } from "node:test";
import { recordingChartContext } from "./recording-chart-context.js";

/** DOM/Canvas boundary with owned nodes and reversible globals; no browser pixel claims. */
export function chartDocument(t: TestContext) {
  const saved = new Map<string, PropertyDescriptor | undefined>(),
    nodes: any[] = [],
    frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const install = (name: string, value: any) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  };
  const element = (tag = "div"): any => {
    const drawing = recordingChartContext(),
      listeners = new Map<string, Set<EventListener>>();
    const node: any = {
      tagName: tag.toUpperCase(),
      style: { cssText: "" },
      children: [],
      parentElement: undefined,
      clientWidth: 640,
      clientHeight: 400,
      width: 0,
      height: 0,
      hidden: false,
      setAttribute() {},
      append(...children: any[]) {
        for (const child of children) {
          child.parentElement = this;
          this.children.push(child);
        }
      },
      appendChild(child: any) {
        this.append(child);
        return child;
      },
      remove() {
        const siblings = this.parentElement?.children;
        if (siblings) {
          const index = siblings.indexOf(this);
          if (index >= 0) siblings.splice(index, 1);
        }
        this.parentElement = undefined;
      },
      getBoundingClientRect() {
        return {
          left: 10,
          top: 20,
          width: this.clientWidth,
          height: this.clientHeight,
        };
      },
      getContext(kind: string) {
        return tag === "canvas" && kind === "2d" ? drawing.ctx : null;
      },
      addEventListener(name: string, fn: EventListener) {
        let group = listeners.get(name);
        if (!group) listeners.set(name, (group = new Set()));
        group.add(fn);
      },
      removeEventListener(name: string, fn: EventListener) {
        listeners.get(name)?.delete(fn);
      },
      drawing,
      listeners,
    };
    drawing.ctx.canvas = node;
    nodes.push(node);
    return node;
  };
  const host = element(),
    body = element(),
    document: any = {
      body,
      createElement: element,
      getElementById: (id: string) => (id === "host" ? host : null),
    };
  for (const node of nodes) node.ownerDocument = document;
  install("document", document);
  install("devicePixelRatio", 2);
  install("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  install("cancelAnimationFrame", (id: number) => frames.delete(id));
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return { host, body, nodes, frames };
}
