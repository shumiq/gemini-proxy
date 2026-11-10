// api/index.ts
export const config = {
  runtime: "edge",
};

const TARGET_HOST = "generativelanguage.googleapis.com";

function getHeader(req: Request, name: string): string | null {
  return req.headers.get(name);
}

export async function handleRequest(req: Request): Promise<Response> {
  const envKeys = process.env.GEMINI_API_KEY || "";
  const GEMINI_KEYS = envKeys
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);

  if (GEMINI_KEYS.length === 0) {
    return new Response(
      JSON.stringify({ error: "Server Configuration Error: Missing GEMINI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const PROXY_API_KEY = process.env.PROXY_API_KEY || "";

  const host = getHeader(req, "host") || "localhost";
  const rawUrl = req.url || "/";
  const requestUrl = rawUrl.startsWith("http") ? rawUrl : `https://${host}${rawUrl}`;
  const url = new URL(requestUrl);

  // 1. Health Check
  if (url.pathname === "/health" || url.pathname === "/api/health") {
    return new Response(JSON.stringify({ status: "ok", activeKeys: GEMINI_KEYS.length }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Auth Verification
  if (PROXY_API_KEY) {
    const clientKey =
      getHeader(req, "x-proxy-api-key") ||
      getHeader(req, "x-api-key") ||
      getHeader(req, "authorization")?.replace("Bearer ", "");

    if (!clientKey || clientKey !== PROXY_API_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid proxy key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 3. Normalize Path (Remove /api prefix and ensure /v1beta prefix)
  let targetPath = url.pathname.replace(/^\/api/, "");
  if (!targetPath.startsWith("/v1beta")) {
    if (targetPath.startsWith("/models/")) {
      targetPath = `/v1beta${targetPath}`;
    } else if (!targetPath.startsWith("/")) {
      targetPath = `/v1beta/${targetPath}`;
    } else {
      targetPath = `/v1beta${targetPath}`;
    }
  }

  // 4. Copy headers and strip proxy-specific auth headers
  const headers = new Headers();
  req.headers.forEach((v: string, k: string) => headers.set(k, v));

  headers.delete("host");
  headers.delete("x-proxy-api-key");
  headers.delete("x-api-key");
  headers.delete("authorization");

  // 5. Start from a random key, then fall through the rest on rate limit
  const startIndex = Math.floor(Math.random() * GEMINI_KEYS.length);

  try {
    // Read body as text to safely prevent stream-hanging in Edge environments
    let body: string | undefined = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.text();
    }

    for (let attempt = 0; ; attempt++) {
      const key = GEMINI_KEYS[(startIndex + attempt) % GEMINI_KEYS.length] ?? "";
      const attemptUrl = new URL(url);
      const attemptHeaders = new Headers(headers);
      if (attemptUrl.searchParams.has("key")) {
        attemptUrl.searchParams.set("key", key);
      } else {
        attemptHeaders.set("x-goog-api-key", key);
      }

      const search = attemptUrl.searchParams.toString();
      const targetUrl = `https://${TARGET_HOST}${targetPath}${search ? "?" + search : ""}`;

      const response = await fetch(
        new Request(targetUrl, { method: req.method, headers: attemptHeaders, body }),
      );

      // Retry with the next key on 429; return the 429 once every key is exhausted
      if (response.status !== 429 || attempt === GEMINI_KEYS.length - 1) {
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      await response.body?.cancel();
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Proxy failed", details: err?.message || "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function GET(req: Request) {
  return handleRequest(req);
}

export async function POST(req: Request) {
  return handleRequest(req);
}

export async function PUT(req: Request) {
  return handleRequest(req);
}

export async function DELETE(req: Request) {
  return handleRequest(req);
}
