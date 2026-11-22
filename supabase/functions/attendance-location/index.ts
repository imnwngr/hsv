// Deployment is a separate, approval-gated operation; this source is not active in production.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { resolveMapsLocation } from "./resolve.ts";
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  const localOrigin = Deno.env.get("HSV_LOCAL_ORIGIN");
  const sandbox = Deno.env.get("BOOKCLUB_ROLE_MODE") === "sandbox";
  const expectedOrigin =
    sandbox &&
    localOrigin &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(localOrigin)
      ? localOrigin
      : "https://imnwngr.github.io";
  const allowed = origin === expectedOrigin;
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...(allowed
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          Vary: "Origin",
        }
      : {}),
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (!allowed) return reply({ error: "Forbidden" }, 403);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST")
    return reply({ error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer "))
      return reply({ error: "Unauthorized" }, 401);
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      },
    );
    const user = await client.auth.getUser();
    if (user.error || !user.data.user)
      return reply({ error: "Unauthorized" }, 401);
    const access = await client.rpc("can_edit_content");
    if (access.error || access.data !== true)
      return reply({ error: "Forbidden" }, 403);
    const body = await request.text();
    if (body.length > 5000) return reply({ error: "Invalid request" }, 400);
    const { url } = JSON.parse(body);
    if (typeof url !== "string")
      return reply({ error: "Invalid request" }, 400);
    const result = await resolveMapsLocation(url);
    return reply(result ?? { latitude: null, longitude: null });
  } catch {
    return reply({ error: "Không xác định được địa điểm từ liên kết." }, 400);
  }
});
