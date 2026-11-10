import { describe, it, beforeEach, expect } from "bun:test";
import { handleRequest, GET, POST, PUT, DELETE } from "./index.ts";

const setEnv = (keys: Record<string, string>) => {
  for (const [k, v] of Object.entries(keys)) {
    process.env[k] = v;
  }
};

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.PROXY_API_KEY;
});

function urlOf(input: Request | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function mockFetch(
  handler: (input: Request | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = handler as unknown as typeof fetch;
}

describe("handleRequest", () => {
  it("returns 500 when GEMINI_API_KEY is missing", async () => {
    setEnv({ GEMINI_API_KEY: "" });
    const res = await handleRequest(
      new Request("http://localhost/models/gemini-pro:generateContent", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Missing GEMINI_API_KEY");
  });

  it("health check returns ok with activeKeys", async () => {
    setEnv({ GEMINI_API_KEY: "key1, key2" });
    for (const path of ["/health", "/api/health"]) {
      const res = await handleRequest(new Request(`http://localhost${path}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok", activeKeys: 2 });
    }
  });

  it("returns 401 when proxy key is required and missing", async () => {
    setEnv({ GEMINI_API_KEY: "key1", PROXY_API_KEY: "secret" });
    const res = await handleRequest(
      new Request("http://localhost/models/gemini-pro:generateContent"),
    );
    expect(res.status).toBe(401);
  });

  it("forwards key via x-goog-api-key header and strips proxy headers", async () => {
    setEnv({ GEMINI_API_KEY: "key1", PROXY_API_KEY: "secret" });
    let capturedKeyHeader: string | null = null;
    let capturedAuth: string | null = null;
    mockFetch((input) => {
      const headers = input instanceof Request ? input.headers : new Headers();
      capturedKeyHeader = headers.get("x-goog-api-key");
      capturedAuth = headers.get("authorization");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await handleRequest(
      new Request("http://localhost/models/gemini-pro:generateContent", {
        method: "POST",
        headers: { "x-proxy-api-key": "secret", authorization: "Bearer token123" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(capturedKeyHeader as unknown as string).toBe("key1");
    expect(capturedAuth).toBeNull();
  });

  it("replaces existing key query param with the selected key", async () => {
    setEnv({ GEMINI_API_KEY: "key1" });
    let capturedUrl = "";
    mockFetch((input) => {
      capturedUrl = urlOf(input);
      return new Response("ok", { status: 200 });
    });

    await handleRequest(
      new Request("http://localhost/models/gemini-pro?key=old-key", {
        method: "GET",
      }),
    );
    expect(capturedUrl).toContain("key=key1");
    expect(capturedUrl).not.toContain("old-key");
  });

  it("retries on 429 and returns last 429 when all keys exhausted", async () => {
    setEnv({ GEMINI_API_KEY: "key1,key2,key3" });
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    });

    const res = await handleRequest(
      new Request("http://localhost/models/gemini-pro:generateContent"),
    );
    expect(res.status).toBe(429);
    expect(calls).toBe(3);
  });

  it("returns success on first key when not rate limited", async () => {
    setEnv({ GEMINI_API_KEY: "key1,key2" });
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return new Response("done", { status: 200 });
    });

    const res = await handleRequest(
      new Request("http://localhost/models/gemini-pro:generateContent"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("done");
    expect(calls).toBe(1);
  });

  it("normalizes /models/ path to /v1beta/models/", async () => {
    setEnv({ GEMINI_API_KEY: "key1" });
    let capturedPath = "";
    mockFetch((input) => {
      capturedPath = new URL(urlOf(input)).pathname;
      return new Response("ok", { status: 200 });
    });

    await handleRequest(new Request("http://localhost/models/gemini-pro"));
    expect(capturedPath).toBe("/v1beta/models/gemini-pro");
  });

  it("returns 500 on fetch failure", async () => {
    setEnv({ GEMINI_API_KEY: "key1" });
    mockFetch(() => {
      throw new Error("network down");
    });

    const res = await handleRequest(new Request("http://localhost/models/gemini-pro"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; details: string };
    expect(body.error).toBe("Proxy failed");
    expect(body.details).toBe("network down");
  });

  it("normalizes /api to /v1beta/", async () => {
    setEnv({ GEMINI_API_KEY: "key1" });
    let capturedPath = "";
    mockFetch((input) => {
      capturedPath = new URL(urlOf(input)).pathname;
      return new Response("ok", { status: 200 });
    });

    await handleRequest(new Request("http://localhost/api"));
    expect(capturedPath).toBe("/v1beta/");
  });

  it("normalizes other paths to /v1beta/<path>", async () => {
    setEnv({ GEMINI_API_KEY: "key1" });
    let capturedPath = "";
    mockFetch((input) => {
      capturedPath = new URL(urlOf(input)).pathname;
      return new Response("ok", { status: 200 });
    });

    await handleRequest(new Request("http://localhost/foo/bar"));
    expect(capturedPath).toBe("/v1beta/foo/bar");
  });

  it("GET, POST, PUT, DELETE delegate to handleRequest", async () => {
    setEnv({ GEMINI_API_KEY: "key1" });
    for (const fn of [GET, POST, PUT, DELETE] as const) {
      const res = await fn(new Request("http://localhost/health"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok", activeKeys: 1 });
    }
  });
});
