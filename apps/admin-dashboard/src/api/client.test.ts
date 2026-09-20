import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  clearToken,
  describeApiError,
  getLeadAnalytics,
  getPostAnalytics,
  getToken,
  listConversations,
  login,
  setConversationLead,
  setUnauthorizedHandler,
} from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as Response;
}

/**
 * A minimal in-memory Storage stand-in, stubbed in for the real
 * `localStorage` global. Avoids depending on the test runtime's own
 * Web Storage implementation (jsdom's vs. Node's built-in one, which behave
 * differently across Node versions) — this only needs to satisfy the
 * get/set/removeItem calls client.ts actually makes.
 */
function createFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("token storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createFakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getToken returns null when nothing is stored", () => {
    expect(getToken()).toBeNull();
  });

  it("clearToken removes a stored token", () => {
    localStorage.setItem("admin_token", "abc");
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe("login", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createFakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores the returned token on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { token: "session-token-123" }))
    );

    await login("correct-password");

    expect(getToken()).toBe("session-token-123");
  });

  it("throws ApiError with the server message and does not store a token on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid password." }))
    );

    await expect(login("wrong-password")).rejects.toThrow("Invalid password.");
    expect(getToken()).toBeNull();
  });

  it("falls back to a generic message when the server response has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));

    await expect(login("x")).rejects.toThrow("Request failed (500)");
  });

  it("ApiError carries the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "nope" })));

    const error = await login("x").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });

  it("clears a stale token when a request comes back 401", async () => {
    localStorage.setItem("admin_token", "stale-token");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(401, { error: "Invalid or expired admin session token." }))
    );

    await expect(login("x")).rejects.toThrow();
    expect(getToken()).toBeNull();
  });

  it("sends the Authorization header from a previously stored token on subsequent requests", async () => {
    localStorage.setItem("admin_token", "existing-token");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { token: "new-token" }));
    vi.stubGlobal("fetch", fetchMock);

    await login("x");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer existing-token");
  });
});

describe("expired-session handling", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createFakeStorage());
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it("clears the token and calls the unauthorized handler when an admin request comes back 401", async () => {
    localStorage.setItem("admin_token", "expired-token");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(401, { error: "Invalid or expired admin session token." }))
    );

    await expect(listConversations()).rejects.toBeInstanceOf(ApiError);

    expect(getToken()).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not treat a wrong password on the login form as an expired session", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid password." }))
    );

    await expect(login("wrong")).rejects.toThrow("Invalid password.");

    expect(handler).not.toHaveBeenCalled();
  });

  it("doesn't call the handler for non-401 failures", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));

    await expect(listConversations()).rejects.toBeInstanceOf(ApiError);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("describeApiError", () => {
  it("uses an ApiError's own message", () => {
    expect(describeApiError(new ApiError(500, "Database exploded."))).toBe("Database exploded.");
  });

  it("explains an unreachable backend (fetch rejecting with a network error)", () => {
    expect(describeApiError(new TypeError("Failed to fetch"))).toContain(
      "Could not reach the backend"
    );
  });
});

describe("analytics/lead client functions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createFakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getPostAnalytics requests the given limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { posts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getPostAnalytics(5);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/admin/analytics/posts?limit=5");
  });

  it("getLeadAnalytics returns stats and leads from the response", async () => {
    const stats = { totalConversations: 10, totalLeads: 3, totalSales: 1 };
    const leads = [{ userId: "u1", status: "lead", markedAt: "2026-01-01T00:00:00Z" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { stats, leads })));

    const result = await getLeadAnalytics();

    expect(result).toEqual({ stats, leads });
  });

  it("setConversationLead posts the status and note", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await setConversationLead("user-1", "sale", "closed the deal");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/admin/conversations/user-1/lead");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ status: "sale", note: "closed the deal" });
  });

  it("propagates ApiError when marking a lead fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(400, { error: "status must be one of: none, lead, sale" }))
    );

    await expect(setConversationLead("user-1", "sale")).rejects.toBeInstanceOf(ApiError);
  });
});
