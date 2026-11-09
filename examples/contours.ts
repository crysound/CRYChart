export interface ContourPoint { x: number; y: number; }
export interface ContourSegment { start: ContourPoint; end: ContourPoint; }

/** Independently implemented cell-edge interpolation with a center-value saddle rule. */
export function marchingSquares(rows: ArrayLike<ArrayLike<number>>, level: number, stride = 1): ContourSegment[] {
  if (!Number.isFinite(level) || !Number.isInteger(stride) || stride < 1) throw new RangeError('Contour level and stride must be finite and valid');
  const height = rows.length, width = height ? rows[0].length : 0;
  if (height < 2 || width < 2) return [];
  if (Array.from(rows).some(row => row.length !== width)) throw new RangeError('Contour grid must be rectangular');
  const result: ContourSegment[] = [];
  for (let y = 0; y < height - 1; y += stride) for (let x = 0; x < width - 1; x += stride) {
    const x1 = Math.min(x + stride, width - 1), y1 = Math.min(y + stride, height - 1);
    const values = [rows[y][x], rows[y][x1], rows[y1][x1], rows[y1][x]], vertices = [{x,y},{x:x1,y},{x:x1,y:y1},{x,y:y1}];
    if (!values.every(Number.isFinite)) continue;
    const mask = values.reduce((bits, value, index) => bits | (value >= level ? 1 << index : 0), 0);
    if (mask === 0 || mask === 15) continue;
    const edges: Array<ContourPoint | undefined> = [], crossed: number[] = [];
    for (let edge = 0; edge < 4; edge++) {
      const next = (edge + 1) % 4;
      if ((values[edge] >= level) === (values[next] >= level)) continue;
      const fraction = (level - values[edge]) / (values[next] - values[edge]);
      edges[edge] = { x: vertices[edge].x + (vertices[next].x - vertices[edge].x) * fraction, y: vertices[edge].y + (vertices[next].y - vertices[edge].y) * fraction }; crossed.push(edge);
    }
    const connect = (a: number, b: number) => { const start = edges[a], end = edges[b]; if (start && end && (start.x !== end.x || start.y !== end.y)) result.push({ start, end }); };
    if (crossed.length === 2) connect(crossed[0], crossed[1]);
    else if (crossed.length === 4) {
      const centerHigh = values.reduce((sum, value) => sum + value, 0) / 4 >= level;
      if ((mask === 5) === centerHigh) { connect(0,1); connect(2,3); }
      else { connect(0,3); connect(1,2); }
    }
  }
  return result;
}
