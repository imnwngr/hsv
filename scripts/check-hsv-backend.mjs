const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw Error("Supabase public configuration missing");
const endpoint = new URL(url);
if (
  endpoint.hostname !== "trdofhdspbkwgernwybp.supabase.co" ||
  endpoint.protocol !== "https:"
)
  throw Error("Unexpected production project");
const r = await globalThis.fetch(
  new URL("/rest/v1/rpc/hsv_v3_capabilities", endpoint),
  {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: "{}",
    signal: globalThis.AbortSignal.timeout(15000),
  },
);
if (!r.ok) throw Error(`Backend capability unavailable: HTTP ${r.status}`);
const body = await r.json();
if (
  body.version !== 3 ||
  body.theme_version !== 1 ||
  body.editor_add_operations !== true ||
  !body.event_types?.includes("invitation") ||
  !body.event_types?.includes("congratulation")
)
  throw Error("Backend is not ready for HSV 3.0.0");
console.log(
  "PASS expected project exposes HSV 3.0.0 schema capabilities. This read-only check does not verify SMTP, RLS, backups or deployed Edge behavior.",
);
const attendance = await globalThis.fetch(
  new URL("/rest/v1/rpc/attendance_capabilities", endpoint),
  {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: "{}",
    signal: globalThis.AbortSignal.timeout(15000),
  },
);
if (!attendance.ok || (await attendance.json()).version !== 1)
  throw Error(
    "Attendance backend is not approved/applied. Do not deploy this frontend until the reviewed schema is available.",
  );
console.log(
  "PASS attendance schema capability v1. This does not verify live camera/GPS or the optional Maps link resolver.",
);
