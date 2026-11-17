import assert from "node:assert/strict";

/** Canvas command boundary for functional geometry/text checks, not a pixel oracle. */
export function recordingChartContext() {
  const calls: Array<{
    name: string;
    args: any[];
    fill: any;
    stroke: any;
    font: any;
    alpha: number;
    shadowBlur: number;
    lineWidth: number;
  }> = [];
  const state: any = {
    font: "12px sans-serif",
    fillStyle: "black",
    strokeStyle: "black",
    lineWidth: 1,
    globalAlpha: 1,
  };
  const saved: any[] = [];
  const target: any = { canvas: { width: 640, height: 400 } };
  const record = (name: string, args: any[]) => {
    for (const value of args)
      if (typeof value === "number")
        assert.ok(Number.isFinite(value), `${name} received ${value}`);
    calls.push({
      name,
      args,
      fill: state.fillStyle,
      stroke: state.strokeStyle,
      font: state.font,
      alpha: state.globalAlpha,
      shadowBlur: state.shadowBlur ?? 0,
      lineWidth: state.lineWidth,
    });
  };
  for (const name of [
    "beginPath",
    "closePath",
    "rect",
    "roundRect",
    "clip",
    "arc",
    "ellipse",
    "moveTo",
    "lineTo",
    "bezierCurveTo",
    "quadraticCurveTo",
    "fill",
    "stroke",
    "fillRect",
    "strokeRect",
    "clearRect",
    "translate",
    "rotate",
    "scale",
    "setTransform",
    "resetTransform",
    "setLineDash",
    "fillText",
    "strokeText",
    "drawImage",
    "putImageData",
  ])
    target[name] = (...args: any[]) => record(name, args);
  target.save = () => saved.push({ ...state });
  target.restore = () => {
    assert.ok(saved.length, "balanced Canvas save/restore");
    Object.assign(state, saved.pop());
  };
  target.measureText = (text: any) => ({ width: String(text).length * 6 });
  target.createLinearGradient = (...args: any[]) => {
    record("gradient", args);
    return { addColorStop: (...stop: any[]) => record("colorStop", stop) };
  };
  target.createImageData = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  });
  const ctx = new Proxy(target, {
    get: (obj, key) => (key in obj ? obj[key] : state[key]),
    set: (_obj, key, value) => {
      state[key] = value;
      return true;
    },
  }) as CanvasRenderingContext2D;
  return {
    ctx,
    calls,
    of: (name: string) => calls.filter((call) => call.name === name),
    text: () =>
      calls
        .filter((call) => call.name === "fillText")
        .map((call) => String(call.args[0])),
    depth: () => saved.length,
  };
}
