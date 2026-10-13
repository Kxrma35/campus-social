import { ApiError, NetworkError, createApiClient } from "@/core/api/client";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => { status?: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const r = respond(call);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function client(
  respond: Parameters<typeof fakeFetch>[0],
  extra: Partial<Parameters<typeof createApiClient>[0]> = {},
) {
  const f = fakeFetch(respond);
  const api = createApiClient({
    baseUrl: "https://api.test",
    getToken: () => "tok_abc",
    fetchImpl: f.impl,
    ...extra,
  });
  return { api, calls: f.calls };
}

const headersOf = (c: Call) => c.init.headers as Record<string, string>;

describe("authentication headers", () => {
  it("sends the session token on authenticated calls", async () => {
    const { api, calls } = client(() => ({ body: { items: [], nextCursor: null } }));
    await api.feed({ sort: "newest" });
    expect(headersOf(calls[0]!).authorization).toBe("Bearer tok_abc");
  });

  it("sends no token on sign-up and sign-in calls", async () => {
    const { api, calls } = client(() => ({ status: 202, body: { status: "code_sent_if_eligible" } }));
    await api.requestSignupCode("jane@usiu.ac.ke");
    await api.requestLoginCode("jane@usiu.ac.ke");
    for (const c of calls) expect(headersOf(c).authorization).toBeUndefined();
  });

  it("asks to act as the anonymous profile only when told to", async () => {
    const { api, calls } = client(() => ({ body: { items: [], nextCursor: null } }));
    await api.feed({}, "known");
    await api.feed({}, undefined);
    await api.feed({}, "anonymous");
    expect(headersOf(calls[0]!)["x-acting-as"]).toBeUndefined();
    expect(headersOf(calls[1]!)["x-acting-as"]).toBeUndefined();
    expect(headersOf(calls[2]!)["x-acting-as"]).toBe("anonymous");
  });
});

describe("requests", () => {
  it("encodes query strings and omits empty values", async () => {
    const { api, calls } = client(() => ({ body: { items: [], nextCursor: null } }));
    await api.feed({ sort: "top", cursor: "a b&c=d" });
    await api.feed({ sort: "newest", cursor: null });
    expect(calls[0]!.url).toBe("https://api.test/feed?sort=top&cursor=a%20b%26c%3Dd");
    expect(calls[1]!.url).toBe("https://api.test/feed?sort=newest");
  });

  it("encodes ids placed in a path", async () => {
    const { api, calls } = client(() => ({ body: {} }));
    await api.post("../../etc/passwd");
    expect(calls[0]!.url).toBe("https://api.test/posts/..%2F..%2Fetc%2Fpasswd");
  });

  it("sends JSON bodies with a JSON content type", async () => {
    const { api, calls } = client(() => ({ status: 201, body: {} }));
    await api.createPost({ body: "hi", photoIds: ["p1"], confirmedAnonymous: true }, "anonymous");
    expect(calls[0]!.init.method).toBe("POST");
    expect(headersOf(calls[0]!)["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      body: "hi",
      photoIds: ["p1"],
      confirmedAnonymous: true,
    });
  });

  it("uploads a photo as a raw body with its own content type", async () => {
    const { api, calls } = client(() => ({ status: 201, body: { id: "u1", width: 1, height: 1 } }));
    const blob = { size: 3 } as unknown as Blob;
    await api.uploadPhoto(blob, "image/jpeg");
    expect(headersOf(calls[0]!)["content-type"]).toBe("image/jpeg");
    expect(calls[0]!.init.body).toBe(blob);
  });

  it("returns undefined for 204", async () => {
    const { api } = client(() => ({ status: 204 }));
    await expect(api.deletePost("p1")).resolves.toBeUndefined();
  });

  it("builds an authorised request for an image component", () => {
    const { api } = client(() => ({ body: {} }));
    expect(api.photoRequest("/photos/abc")).toEqual({
      uri: "https://api.test/photos/abc",
      headers: { authorization: "Bearer tok_abc" },
    });
  });
});

describe("errors", () => {
  it("turns an API error into an ApiError with its stable code", async () => {
    const { api } = client(() => ({
      status: 409,
      body: { error: "confirmation_required", message: "Confirm that you want to post anonymously." },
    }));
    await expect(api.createPost({ body: "x" }, "anonymous")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "confirmation_required",
      message: "Confirm that you want to post anonymously.",
    });
  });

  it("keeps the invalid fields from a validation error", async () => {
    const { api } = client(() => ({
      status: 400,
      body: { error: "invalid_request", message: "Some fields are missing or invalid.", fields: ["email"] },
    }));
    const err = await api.requestSignupCode("x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.fields).toEqual(["email"]);
  });

  it("copes with a non-JSON error body", async () => {
    const f = fakeFetch(() => ({ status: 502 }));
    const impl = (async () =>
      ({ status: 502, ok: false, text: async () => "<html>Bad gateway</html>" }) as unknown as Response) as typeof fetch;
    const api = createApiClient({ baseUrl: "https://api.test", getToken: () => null, fetchImpl: impl });
    void f;
    await expect(api.me()).rejects.toMatchObject({ status: 502, code: "unknown_error" });
  });

  it("reports an unreachable server as a NetworkError", async () => {
    const { api } = client(() => new Error("offline"));
    await expect(api.me()).rejects.toBeInstanceOf(NetworkError);
  });

  it("abandons a request that takes too long", async () => {
    const impl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const api = createApiClient({
      baseUrl: "https://api.test",
      getToken: () => null,
      fetchImpl: impl,
      timeoutMs: 20,
    });
    await expect(api.me()).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("expired sessions", () => {
  it("signals when an authenticated call is refused with 401", async () => {
    const onUnauthorized = jest.fn();
    const { api } = client(() => ({ status: 401, body: { error: "unauthorized", message: "Sign in" } }), {
      onUnauthorized,
    });
    await expect(api.feed({})).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not treat a wrong sign-in code as an expired session", async () => {
    const onUnauthorized = jest.fn();
    const { api } = client(() => ({ status: 401, body: { error: "unauthorized", message: "x" } }), {
      onUnauthorized,
      getToken: () => null,
    });
    await expect(api.verifyLogin("a@b.cd", "000000")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
