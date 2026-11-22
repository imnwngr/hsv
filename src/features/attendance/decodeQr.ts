import { gfMultiply, qrBase, qrDataPositions, QR_SIZE } from "./qr";
type Point = { x: number; y: number; size: number; hits: number };
function power(exponent: number) {
  let x = 1;
  for (let i = 0; i < ((exponent % 255) + 255) % 255; i++) x = gfMultiply(x, 2);
  return x;
}
function divide(a: number, b: number) {
  if (!b) throw Error("zero divisor");
  let inverse = 1;
  for (let i = 0; i < 254; i++) inverse = gfMultiply(inverse, b);
  return gfMultiply(a, inverse);
}
function evaluate(coefficients: number[], x: number) {
  let v = 0;
  for (let i = coefficients.length - 1; i >= 0; i--)
    v = gfMultiply(v, x) ^ coefficients[i];
  return v;
}
export function correctCodewords(input: number[]) {
  const data = [...input];
  const syndromes = Array.from({ length: 20 }, (_, i) =>
    data.reduce((v, b) => gfMultiply(v, power(i)) ^ b, 0),
  );
  if (syndromes.every((s) => s === 0)) return data;
  const locator = [1];
  let previous = [1],
    length = 0,
    distance = 1,
    last = 1;
  for (let n = 0; n < 20; n++) {
    let delta = syndromes[n];
    for (let i = 1; i <= length; i++)
      delta ^= gfMultiply(locator[i] ?? 0, syndromes[n - i]);
    if (!delta) {
      distance++;
      continue;
    }
    const old = [...locator],
      ratio = divide(delta, last);
    while (locator.length < previous.length + distance) locator.push(0);
    previous.forEach((v, i) => (locator[i + distance] ^= gfMultiply(ratio, v)));
    if (2 * length <= n) {
      length = n + 1 - length;
      previous = old;
      last = delta;
      distance = 1;
    } else distance++;
  }
  if (length > 10) return null;
  const positions: number[] = [];
  for (let i = 0; i < data.length; i++)
    if (evaluate(locator, power(-(data.length - 1 - i))) === 0)
      positions.push(i);
  if (positions.length !== length) return null;
  // Solve the syndrome equations for error magnitudes over GF(256).
  const equations = positions.map((_, row) => [
    ...positions.map((p) => power(row * (data.length - 1 - p))),
    syndromes[row],
  ]);
  for (let col = 0; col < length; col++) {
    const pivot = equations.findIndex(
      (row, index) => index >= col && row[col] !== 0,
    );
    if (pivot < 0) return null;
    [equations[col], equations[pivot]] = [equations[pivot], equations[col]];
    const factor = equations[col][col];
    equations[col] = equations[col].map((x) => divide(x, factor));
    for (let row = 0; row < length; row++)
      if (row !== col) {
        const f = equations[row][col];
        equations[row] = equations[row].map(
          (x, j) => x ^ gfMultiply(f, equations[col][j]),
        );
      }
  }
  positions.forEach((p, i) => (data[p] ^= equations[i][length]));
  if (
    Array.from({ length: 20 }, (_, i) =>
      data.reduce((v, b) => gfMultiply(v, power(i)) ^ b, 0),
    ).some(Boolean)
  )
    return null;
  return data;
}
export function decodeMatrix(grid: boolean[][]) {
  if (grid.length !== QR_SIZE || grid.some((r) => r.length !== QR_SIZE))
    return null;
  const bytes = Array<number>(100).fill(0);
  qrDataPositions(qrBase().reserved)
    .slice(0, 800)
    .forEach(([x, y], i) => {
      if (grid[y][x] !== ((x + y) % 2 === 0))
        bytes[i >>> 3] |= 1 << (7 - (i % 8));
    });
  const corrected = correctCodewords(bytes);
  if (!corrected || corrected[0] >>> 4 !== 4) return null;
  const length = (corrected[0] & 15) * 16 + (corrected[1] >>> 4);
  if (length !== 69) return null;
  let value = "";
  for (let i = 0; i < length; i++)
    value += String.fromCharCode(
      (corrected[i + 1] & 15) * 16 + (corrected[i + 2] >>> 4),
    );
  return /^HSV1:[0-9a-f]{64}$/.test(value) ? value : null;
}
function ratio(runs: number[]) {
  const unit = runs.reduce((a, b) => a + b, 0) / 7;
  return (
    unit >= 1 &&
    runs.every(
      (v, i) =>
        Math.abs(v - unit * (i === 2 ? 3 : 1)) < unit * (i === 2 ? 1.5 : 0.8),
    )
  );
}
function homography(source: number[][], destination: number[][]) {
  const rows: number[][] = [];
  source.forEach(([x, y], i) => {
    const [u, v] = destination[i];
    rows.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  });
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++)
      if (Math.abs(rows[r][c]) > Math.abs(rows[p][c])) p = r;
    if (Math.abs(rows[p][c]) < 1e-9) return null;
    [rows[p], rows[c]] = [rows[c], rows[p]];
    const f = rows[c][c];
    rows[c] = rows[c].map((v) => v / f);
    for (let r = 0; r < 8; r++)
      if (r !== c) {
        const d = rows[r][c];
        rows[r] = rows[r].map((v, i) => v - d * rows[c][i]);
      }
  }
  const h = rows.map((r) => r[8]);
  return (x: number, y: number) => {
    const d = h[6] * x + h[7] * y + 1;
    return {
      x: (h[0] * x + h[1] * y + h[2]) / d,
      y: (h[3] * x + h[4] * y + h[5]) / d,
    };
  };
}
export function decodeQrImage(
  image: ImageData | { width: number; height: number; data: Uint8ClampedArray },
) {
  const { width, height, data } = image;
  const gray = new Uint8Array(width * height),
    histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.round(
      (data[i * 4] + 2 * data[i * 4 + 1] + data[i * 4 + 2]) / 4,
    );
    gray[i] = v;
    histogram[v]++;
  }
  let sum = 0;
  histogram.forEach((n, v) => (sum += n * v));
  let count = 0,
    partial = 0,
    threshold = 128,
    best = 0;
  for (let v = 0; v < 255; v++) {
    count += histogram[v];
    partial += histogram[v] * v;
    if (!count || count === gray.length) continue;
    const variance =
      count *
      (gray.length - count) *
      (partial / count - (sum - partial) / (gray.length - count)) ** 2;
    if (variance > best) {
      best = variance;
      threshold = v;
    }
  }
  const black = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    gray[Math.round(y) * width + Math.round(x)] <= threshold;
  const points: Point[] = [];
  for (let y = 0; y < height; y += 2) {
    const runs: number[] = [],
      starts: number[] = [];
    let color = false,
      start = 0;
    for (let x = 0; x <= width; x++) {
      const current = x < width && black(x, y);
      if (current === color && x < width) continue;
      runs.push(x - start);
      starts.push(start);
      start = x;
      color = current;
    }
    for (let i = 0; i + 4 < runs.length; i++) {
      if (!black(starts[i], y) || !ratio(runs.slice(i, i + 5))) continue;
      const cx = starts[i + 2] + runs[i + 2] / 2;
      const vertical = [0, 0, 0, 0, 0];
      let top = y,
        bottom = y;
      while (top >= 0 && black(cx, top)) {
        vertical[2]++;
        top--;
      }
      while (bottom + 1 < height && black(cx, bottom + 1)) {
        vertical[2]++;
        bottom++;
      }
      const cy = (top + bottom + 1) / 2;
      for (let j = 1; j >= 0; j--) {
        while (
          top >= 0 &&
          black(cx, top) === (j === 0) &&
          vertical[j] < runs.reduce((a, b) => a + b, 0)
        ) {
          vertical[j]++;
          top--;
        }
      }
      bottom++;
      for (let j = 3; j <= 4; j++) {
        while (
          bottom < height &&
          black(cx, bottom) === (j === 4) &&
          vertical[j] < width
        ) {
          vertical[j]++;
          bottom++;
        }
      }
      if (!ratio(vertical)) continue;
      const size = vertical.reduce((a, b) => a + b, 0) / 7;
      const found = points.find(
        (p) => Math.hypot(p.x - cx, p.y - cy) < size * 2,
      );
      if (found) {
        found.x = (found.x * found.hits + cx) / (found.hits + 1);
        found.y = (found.y * found.hits + cy) / (found.hits + 1);
        found.hits++;
      } else points.push({ x: cx, y: cy, size, hits: 1 });
    }
  }
  const candidates = points.sort((a, b) => b.hits - a.hits).slice(0, 8);
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++)
      for (let k = j + 1; k < candidates.length; k++) {
        const triple = [candidates[i], candidates[j], candidates[k]];
        const squared = (a: Point, b: Point) =>
          (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        const opposite = triple.map((_, index) =>
          squared(triple[(index + 1) % 3], triple[(index + 2) % 3]),
        );
        const topIndex = opposite.indexOf(Math.max(...opposite));
        const tl = triple[topIndex];
        let tr = triple[(topIndex + 1) % 3],
          bl = triple[(topIndex + 2) % 3];
        if ((tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x) < 0)
          [tr, bl] = [bl, tr];
        const ux = (tr.x - tl.x) / 26,
          uy = (tr.y - tl.y) / 26,
          vx = (bl.x - tl.x) / 26,
          vy = (bl.y - tl.y) / 26;
        if (
          Math.abs(
            (ux * vx + uy * vy) / Math.hypot(ux, uy) / Math.hypot(vx, vy),
          ) > 0.6
        )
          continue;
        const affine = (x: number, y: number) => ({
          x: tl.x + (x - 3) * ux + (y - 3) * vx,
          y: tl.y + (x - 3) * uy + (y - 3) * vy,
        });
        const sample = (
          transform: (x: number, y: number) => { x: number; y: number },
        ) =>
          Array.from({ length: QR_SIZE }, (_, y) =>
            Array.from({ length: QR_SIZE }, (_, x) => {
              const p = transform(x, y);
              return black(p.x, p.y);
            }),
          );
        const plain = decodeMatrix(sample(affine));
        if (plain) return plain;
        // Locate the alignment target near the predicted bottom-right, then rectify perspective.
        const expected = affine(26, 26);
        const unit = (Math.hypot(ux, uy) + Math.hypot(vx, vy)) / 2;
        let alignment: { x: number; y: number } | null = null,
          score = -Infinity;
        for (let dy = -unit * 5; dy <= unit * 5; dy += Math.max(1, unit / 2))
          for (
            let dx = -unit * 5;
            dx <= unit * 5;
            dx += Math.max(1, unit / 2)
          ) {
            const center = { x: expected.x + dx, y: expected.y + dy };
            if (!black(center.x, center.y)) continue;
            let matches = 0;
            for (let y = -2; y <= 2; y++)
              for (let x = -2; x <= 2; x++)
                if (
                  black(
                    center.x + x * ux + y * vx,
                    center.y + x * uy + y * vy,
                  ) ===
                  (Math.max(Math.abs(x), Math.abs(y)) !== 1)
                )
                  matches++;
            const rank = matches - Math.hypot(dx, dy) / (unit * 20);
            if (matches >= 23 && rank > score) {
              score = rank;
              alignment = center;
            }
          }
        if (alignment) {
          const transform = homography(
            [
              [3, 3],
              [29, 3],
              [3, 29],
              [26, 26],
            ],
            [
              [tl.x, tl.y],
              [tr.x, tr.y],
              [bl.x, bl.y],
              [alignment.x, alignment.y],
            ],
          );
          if (transform) {
            const result = decodeMatrix(sample(transform));
            if (result) return result;
          }
        }
      }
  return null;
}
