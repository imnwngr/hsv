const hosts = new Set([
  "google.com",
  "www.google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
]);
export function safeMapsRedirect(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !hosts.has(url.hostname) ||
    (url.hostname === "goo.gl" && !url.pathname.startsWith("/maps"))
  )
    throw Error("Unsupported Maps URL");
  return url;
}
export function placeCoordinates(url: URL) {
  const encoded = decodeURIComponent(url.pathname + url.search);
  const place = encoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const explicit = (
    url.searchParams.get("q") ??
    url.searchParams.get("query") ??
    ""
  ).match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  const match = place ?? explicit;
  if (!match) return null;
  const latitude = Number(match[1]),
    longitude = Number(match[2]);
  return Math.abs(latitude) <= 85 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}
export async function resolveMapsLocation(
  input: string,
  request: typeof fetch = fetch,
) {
  if (input.length > 4000) throw Error("URL too long");
  let url = safeMapsRedirect(input);
  const visited = new Set<string>();
  const signal = AbortSignal.timeout(5000);
  for (let i = 0; i < 5; i++) {
    const coordinates = placeCoordinates(url);
    if (coordinates) return coordinates;
    if (visited.has(url.href)) throw Error("Redirect loop");
    visited.add(url.href);
    const response = await request(url, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { Accept: "text/html" },
    });
    // Never consume arbitrary HTML, forward cookies, or follow redirects automatically.
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location)
      return null;
    url = safeMapsRedirect(new URL(location, url).href);
  }
  throw Error("Too many redirects");
}
