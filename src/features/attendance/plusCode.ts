const alphabet = "23456789CFGHJMPQRVWX";
type Point = { latitude: number; longitude: number };

export function parsePlusCode(input: string) {
  const match = input
    .trim()
    .match(
      /^([23456789CFGHJMPQRVWX0]*\+[23456789CFGHJMPQRVWX]*)(?:\s+(.+))?$/i,
    );
  if (!match) return null;
  const code = match[1].toUpperCase(),
    separator = code.indexOf("+");
  const suffix = code.length - separator - 1;
  if (separator > 8 || separator % 2 || suffix === 1 || suffix > 7) return null;
  const padding = code.indexOf("0");
  if (
    padding !== -1 &&
    (separator !== 8 ||
      suffix !== 0 ||
      padding < 2 ||
      padding % 2 ||
      !/^0+$/.test(code.slice(padding, 8)))
  )
    return null;
  if (!code.replace(/[+0]/g, "")) return null;
  if (
    separator === 8 &&
    (alphabet.indexOf(code[0]) >= 9 || alphabet.indexOf(code[1]) >= 18)
  )
    return null;
  return { code, locality: match[2]?.trim() ?? "", short: separator < 8 };
}

function decodeFull(code: string): Point {
  const digits = code.replace(/[+0]/g, "");
  let latitude = -90,
    longitude = -180,
    step = 20;
  let height = step,
    width = step;
  for (let i = 0; i < Math.min(digits.length, 10); i += 2) {
    latitude += alphabet.indexOf(digits[i]) * step;
    longitude += alphabet.indexOf(digits[i + 1]) * step;
    height = width = step;
    step /= 20;
  }
  for (const digit of digits.slice(10)) {
    height /= 5;
    width /= 4;
    const index = alphabet.indexOf(digit);
    latitude += Math.floor(index / 4) * height;
    longitude += (index % 4) * width;
  }
  return { latitude: latitude + height / 2, longitude: longitude + width / 2 };
}

// Open Location Code: recover the nearest matching cell only with an explicit reference.
export function pointFromPlusCode(
  input: string,
  reference?: Point,
): Point | null {
  const parsed = parsePlusCode(input);
  if (!parsed) return null;
  let point: Point;
  if (!parsed.short) point = decodeFull(parsed.code);
  else {
    if (
      !reference ||
      !Number.isFinite(reference.latitude) ||
      !Number.isFinite(reference.longitude) ||
      Math.abs(reference.latitude) > 90 ||
      Math.abs(reference.longitude) > 180
    )
      return null;
    const missing = 8 - parsed.code.indexOf("+");
    let lat = Math.min(90 - 1e-10, reference.latitude) + 90;
    let lng = (((reference.longitude + 180) % 360) + 360) % 360;
    let prefix = "",
      step = 20;
    for (let i = 0; i < missing; i += 2) {
      const a = Math.floor(lat / step),
        b = Math.floor(lng / step);
      prefix += alphabet[a] + alphabet[b];
      lat -= a * step;
      lng -= b * step;
      step /= 20;
    }
    point = decodeFull(prefix + parsed.code);
    const resolution = 20 ** (2 - missing / 2);
    if (
      reference.latitude - point.latitude > resolution / 2 &&
      point.latitude + resolution <= 90
    )
      point.latitude += resolution;
    else if (
      point.latitude - reference.latitude > resolution / 2 &&
      point.latitude - resolution >= -90
    )
      point.latitude -= resolution;
    if (reference.longitude - point.longitude > resolution / 2)
      point.longitude += resolution;
    else if (point.longitude - reference.longitude > resolution / 2)
      point.longitude -= resolution;
    point.longitude = ((((point.longitude + 180) % 360) + 360) % 360) - 180;
  }
  return {
    latitude: Number(point.latitude.toFixed(12)),
    longitude: Number(point.longitude.toFixed(12)),
  };
}
