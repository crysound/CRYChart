import test from "node:test";
import assert from "node:assert/strict";
import { CssTextFonts } from "../src/css-text-fonts.js";
import { FontSettings } from "../src/core/styles.js";

class Style {
  [index: number]: string;
  font = "";
  private properties = new Map<string, string>();
  get length() {
    return this.properties.size;
  }
  set cssText(value: string) {
    for (let i = 0; i < this.length; i++) delete this[i];
    this.properties = new Map(
      value
        .split(";")
        .filter((item) => item.includes(":"))
        .map((item) => {
          const at = item.indexOf(":");
          return [item.slice(0, at).trim(), item.slice(at + 1).trim()];
        }),
    );
    [...this.properties.keys()].forEach((key, i) => {
      this[i] = key;
    });
  }
  getPropertyValue(key: string) {
    return (this.properties.get(key) ?? "").replace(/\s*!important$/, "");
  }
  getPropertyPriority(key: string) {
    return this.properties.get(key)?.endsWith("!important") ? "important" : "";
  }
}

function fixture(
  options: {
    observer?: boolean;
    computed?: boolean;
    fontEvents?: boolean;
  } = {},
) {
  let invalidations = 0,
    reads = 0,
    disconnects = 0;
  const observed: any[] = [],
    listeners = new Map<string, () => void>();
  let mutation: (records: any[]) => void = () => {};
  const computed = {
    fontSize: "18px",
    fontFamily: "Resolved Font",
    fontWeight: "700",
    fontStyle: "italic",
    fontVariant: "small-caps",
  };
  const document: any = {
    createElement() {
      return {
        ownerDocument: document,
        style: new Style(),
        setAttribute() {},
        removed: false,
        remove() {
          this.removed = true;
        },
      };
    },
    documentElement: {},
    body: {},
    defaultView: {
      ...(options.observer === false
        ? {}
        : {
            MutationObserver: class {
              constructor(callback: typeof mutation) {
                mutation = callback;
              }
              observe(...args: any[]) {
                observed.push(args);
              }
              disconnect() {
                disconnects++;
              }
            },
          }),
      ...(options.computed === false
        ? {}
        : {
            getComputedStyle() {
              reads++;
              return computed;
            },
          }),
    },
    ...(options.fontEvents === false
      ? {}
      : {
          fonts: {
            addEventListener(name: string, callback: () => void) {
              listeners.set(name, callback);
            },
            removeEventListener(name: string, callback: () => void) {
              assert.equal(listeners.get(name), callback);
              listeners.delete(name);
            },
          },
        }),
  };
  if (options.computed === false) document.defaultView = undefined;
  const root: any = {
    ownerDocument: document,
    parentElement: {},
    style: new Style(),
    children: [] as any[],
    append(node: any) {
      this.children.push(node);
    },
  };
  const fonts = new CssTextFonts(root, () => {
    invalidations++;
  });
  return {
    root,
    fonts,
    computed,
    observed,
    listeners,
    mutate: (records: any[]) => mutation(records),
    state: () => ({ invalidations, reads, disconnects }),
  };
}

test("CSS font resolution caches semantic font keys and leaves caller FontSettings unchanged", () => {
  const f = fixture(),
    original = new FontSettings({ size: 12, family: "Source Font" }),
    css = original.toCSS();
  const resolved = f.fonts.resolve(original);
  assert.equal(resolved.size, 18);
  assert.equal(resolved.family, "Resolved Font");
  assert.equal(resolved.weight, "700");
  assert.equal(resolved.style, "italic");
  assert.equal(resolved.variant, "small-caps");
  assert.equal(original.toCSS(), css);
  assert.equal(
    f.fonts.resolve(new FontSettings({ size: 12, family: "Source Font" })),
    resolved,
  );
  assert.equal(f.state().reads, 1);
  assert.equal(f.root.children[0].style.font, css);
  assert.equal(f.observed.length, 4);
  f.fonts.dispose();
});

test("font changes invalidate cached measurements while renderer background and cursor changes do not", () => {
  const f = fixture(),
    font = new FontSettings({ size: 12 }),
    first = f.fonts.resolve(font);
  for (const [oldValue, value] of [
    ["background:red;cursor:crosshair", "background:blue;cursor:pointer"],
    ["background-color:red", "background-image:none"],
  ]) {
    f.root.style.cssText = value!;
    f.mutate([{ target: f.root, attributeName: "style", oldValue }]);
    assert.equal(f.fonts.resolve(font), first);
  }
  for (const [oldValue, value] of [
    ["font-size:12px", "font-size:18px"],
    ["font-size:18px", "font-size:18px !important"],
    ["", "--chart-font:serif"],
    ["font-family:serif", ""],
  ]) {
    const previous = f.fonts.resolve(font);
    f.root.style.cssText = value!;
    f.mutate([{ target: f.root, attributeName: "style", oldValue }]);
    assert.notEqual(f.fonts.resolve(font), previous);
  }
  assert.equal(f.state().invalidations, 4);
  f.fonts.dispose();
});

test("ancestor classes, root classes and loaded web fonts refresh the resolved font cache", () => {
  const f = fixture(),
    font = new FontSettings();
  let previous = f.fonts.resolve(font);
  for (const record of [
    { target: f.root.parentElement, attributeName: "class" },
    { target: f.root, attributeName: "class" },
  ]) {
    f.mutate([record]);
    const next = f.fonts.resolve(font);
    assert.notEqual(next, previous);
    previous = next;
  }
  f.computed.fontSize = "24px";
  f.listeners.get("loadingdone")!();
  assert.equal(f.fonts.resolve(font).size, 24);
  assert.equal(f.state().invalidations, 3);
  f.fonts.dispose();
});

test("missing or invalid computed CSS fields fall back to the public source font", () => {
  const font = new FontSettings({
    size: 13,
    family: "Fallback",
    weight: "600",
    style: "oblique",
    variant: "normal",
  });
  for (const size of ["NaN", "0px", "-3px"]) {
    const f = fixture();
    Object.assign(f.computed, {
      fontSize: size,
      fontFamily: "",
      fontWeight: "",
      fontStyle: "",
      fontVariant: "",
    });
    assert.equal(f.fonts.resolve(font).toCSS(), font.toCSS());
    f.fonts.dispose();
  }
  const f = fixture({ observer: false, computed: false, fontEvents: false });
  assert.equal(f.fonts.resolve(font), font);
  assert.equal(f.observed.length, 0);
  f.fonts.dispose();
});

test("disposing font resolution removes subscriptions and ignores callbacks already queued by the browser", () => {
  const f = fixture(),
    font = new FontSettings(),
    refresh = f.listeners.get("loadingdone")!;
  f.fonts.resolve(font);
  f.fonts.dispose();
  f.fonts.dispose();
  refresh();
  f.mutate([{ target: f.root, attributeName: "class" }]);
  assert.equal(f.state().disconnects, 1);
  assert.equal(f.state().invalidations, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.root.children[0].removed, true);
  assert.equal(f.fonts.resolve(font), font);
  assert.equal(f.state().reads, 1);
});
