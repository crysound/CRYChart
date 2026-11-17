export function recordingPathContext() {
  let path: unknown[][] = [];
  const fills: { path: unknown[][]; style: unknown }[] = [];
  const strokes: { path: unknown[][]; style: unknown }[] = [];
  const gradients: { endpoints: number[]; stops: unknown[][] }[] = [];
  const saved: {
    fillStyle: unknown;
    strokeStyle: unknown;
    lineWidth: number;
  }[] = [];
  const target = {
    fillStyle: undefined as unknown,
    strokeStyle: undefined as unknown,
    lineWidth: 1,
    save() {
      saved.push({
        fillStyle: this.fillStyle,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
      });
    },
    restore() {
      assertSaved();
      Object.assign(this, saved.pop());
    },
    beginPath() {
      path = [];
    },
    clip() {},
    setLineDash() {},
    rect(...values: number[]) {
      path.push(["rect", ...values]);
    },
    moveTo(...values: number[]) {
      path.push(["move", ...values]);
    },
    lineTo(...values: number[]) {
      path.push(["line", ...values]);
    },
    closePath() {
      path.push(["close"]);
    },
    fill() {
      fills.push({ path: structuredClone(path), style: this.fillStyle });
    },
    stroke() {
      strokes.push({ path: structuredClone(path), style: this.strokeStyle });
    },
    createLinearGradient(...endpoints: number[]) {
      const value = { endpoints, stops: [] as unknown[][] };
      gradients.push(value);
      return {
        addColorStop(...stop: unknown[]) {
          value.stops.push(stop);
        },
      };
    },
  };
  function assertSaved() {
    if (!saved.length) throw new Error("Unbalanced Canvas restore");
  }
  return {
    ctx: target as unknown as CanvasRenderingContext2D,
    fills,
    strokes,
    gradients,
    depth: () => saved.length,
  };
}
