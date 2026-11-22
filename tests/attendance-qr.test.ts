// @vitest-environment node
import { it, expect } from "vitest";
import {
  encodeQr,
  qrBase,
  qrDataPositions,
} from "../src/features/attendance/qr";
import {
  decodeMatrix,
  decodeQrImage,
} from "../src/features/attendance/decodeQr";
const text = "HSV1:" + "0123456789abcdef".repeat(4);
it("round trips fixed QR data with Reed Solomon correction up to ten damaged bytes", () => {
  for (const count of [0, 1, 5, 10]) {
    const matrix = encodeQr(text),
      positions = qrDataPositions(qrBase().reserved);
    for (let i = 0; i < count; i++) {
      const [x, y] = positions[i * 8];
      matrix[y][x] = !matrix[y][x];
    }
    expect(decodeMatrix(matrix)).toBe(text);
  }
});
it("decodes camera pixels with quiet zone at different scales and rotations", () => {
  const matrix = encodeQr(text);
  for (const scale of [3, 5, 9])
    for (const rotation of [0, 1, 2, 3]) {
      const size = 41 * scale,
        data = new Uint8ClampedArray(size * size * 4).fill(255);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          let a = Math.floor(x / scale) - 4,
            b = Math.floor(y / scale) - 4;
          for (let k = 0; k < rotation; k++) [a, b] = [b, 32 - a];
          const v = matrix[b]?.[a] ? 15 : 230;
          data[(y * size + x) * 4] = v;
          data[(y * size + x) * 4 + 1] = v;
          data[(y * size + x) * 4 + 2] = v;
        }
      expect(
        decodeQrImage({ width: size, height: size, data }),
        `${scale}/${rotation}`,
      ).toBe(text);
    }
});
it("rejects invalid payloads and blank video frames", () => {
  expect(() => encodeQr("not a token")).toThrow();
  expect(
    decodeQrImage({
      width: 100,
      height: 100,
      data: new Uint8ClampedArray(40000).fill(255),
    }),
  ).toBe(null);
});
