// HSV projection uses QR version 4, level L, byte mode, mask 0 (80 data + 20 RS codewords).
// Keeping the format fixed allows a small camera fallback without a service or a runtime dependency.
export const QR_SIZE = 33;
export function gfMultiply(x: number, y: number) {
  let result = 0;
  for (; y; y >>>= 1) {
    if (y & 1) result ^= x;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  return result;
}
export function qrBase() {
  const size = QR_SIZE;
  const grid = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );
  const reserved = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );
  const set = (x: number, y: number, black: boolean) => {
    if (x >= 0 && y >= 0 && x < size && y < size) {
      grid[y][x] = black;
      reserved[y][x] = true;
    }
  };
  for (const [cx, cy] of [
    [3, 3],
    [29, 3],
    [3, 29],
  ])
    for (let y = -4; y <= 4; y++)
      for (let x = -4; x <= 4; x++) {
        const d = Math.max(Math.abs(x), Math.abs(y));
        set(cx + x, cy + y, d !== 2 && d !== 4);
      }
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  for (let y = -2; y <= 2; y++)
    for (let x = -2; x <= 2; x++)
      set(26 + x, 26 + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
  // L/mask0 format bits after BCH and XOR 0x5412.
  const format = 0x77c4;
  for (let i = 0; i <= 5; i++) set(8, i, !!((format >>> i) & 1));
  set(8, 7, !!((format >>> 6) & 1));
  set(8, 8, !!((format >>> 7) & 1));
  set(7, 8, !!((format >>> 8) & 1));
  for (let i = 9; i < 15; i++) set(14 - i, 8, !!((format >>> i) & 1));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, !!((format >>> i) & 1));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, !!((format >>> i) & 1));
  set(8, size - 8, true);
  return { grid, reserved };
}
export function qrDataPositions(reserved: boolean[][]) {
  const points: [number, number][] = [];
  let up = true;
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < QR_SIZE; i++)
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset,
          y = up ? QR_SIZE - 1 - i : i;
        if (!reserved[y][x]) points.push([x, y]);
      }
    up = !up;
  }
  return points;
}
export function encodeQr(text: string) {
  if (!/^HSV1:[0-9a-f]{64}$/.test(text)) throw Error("Invalid HSV QR payload");
  const bytes = new TextEncoder().encode(text),
    bits: number[] = [];
  const append = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(4, 4);
  append(bytes.length, 8);
  for (const b of bytes) append(b, 8);
  append(0, 4);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  for (let pad = 0; data.length < 80; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  let generator = [1],
    root = 1;
  for (let i = 0; i < 20; i++) {
    const next = Array<number>(generator.length + 1).fill(0);
    generator.forEach((v, j) => {
      next[j] ^= v;
      next[j + 1] ^= gfMultiply(v, root);
    });
    generator = next;
    root = gfMultiply(root, 2);
  }
  const remainder = Array<number>(20).fill(0);
  for (const b of data) {
    const factor = b ^ remainder.shift()!;
    remainder.push(0);
    for (let i = 0; i < 20; i++)
      remainder[i] ^= gfMultiply(generator[i + 1], factor);
  }
  const code = [...data, ...remainder];
  const { grid, reserved } = qrBase();
  qrDataPositions(reserved).forEach(([x, y], index) => {
    const bit =
      index < code.length * 8
        ? !!((code[index >>> 3] >>> (7 - (index % 8))) & 1)
        : false;
    grid[y][x] = bit !== ((x + y) % 2 === 0);
  });
  return grid;
}
