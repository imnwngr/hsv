export function allowedMapsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "google.com",
        "www.google.com",
        "maps.google.com",
        "maps.app.goo.gl",
        "goo.gl",
      ].includes(url.hostname) &&
      (url.hostname !== "goo.gl" || url.pathname.startsWith("/maps"))
      ? url
      : null;
  } catch {
    return null;
  }
}
export function coordinatesFromMaps(value: string) {
  const url = allowedMapsUrl(value);
  if (!url) return null;
  // /@lat,lng is the camera centre, not a verified place location.
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname + url.search);
  } catch {
    return null;
  }
  const place = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const query = (
    url.searchParams.get("query") ??
    url.searchParams.get("q") ??
    ""
  ).match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  const match = place ?? query;
  if (!match) return null;
  const latitude = Number(match[1]),
    longitude = Number(match[2]);
  return Math.abs(latitude) <= 85 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}
