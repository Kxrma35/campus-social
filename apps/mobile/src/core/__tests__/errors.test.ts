import { ApiError, NetworkError } from "@/core/api/client";
import { describeError, isCode } from "@/core/lib/errors";

describe("describeError", () => {
  it("explains an offline server", () => {
    expect(describeError(new NetworkError())).toMatch(/can't reach the server/i);
  });

  it("maps known codes to plain language, never the raw code", () => {
    for (const code of [
      "invalid_code",
      "code_expired",
      "must_be_18",
      "read_only",
      "anonymous_locked",
      "anonymous_unavailable",
      "rate_limited",
      "image_too_large",
    ]) {
      const msg = describeError(new ApiError(400, code, "x"));
      expect(msg).not.toContain("_");
      expect(msg.length).toBeGreaterThan(10);
    }
  });

  it("does not leak a server error body", () => {
    const msg = describeError(new ApiError(500, "internal_error", "stack trace here"));
    expect(msg).not.toMatch(/stack/i);
    expect(msg).toMatch(/our side/i);
  });

  it("falls back to a generic message for anything else", () => {
    expect(describeError(new Error("boom"))).toBe("Something went wrong. Please try again.");
    expect(describeError("weird")).toBe("Something went wrong. Please try again.");
  });

  it("recognises a specific code", () => {
    expect(isCode(new ApiError(409, "confirmation_required", "x"), "confirmation_required")).toBe(true);
    expect(isCode(new Error("x"), "confirmation_required")).toBe(false);
  });
});
