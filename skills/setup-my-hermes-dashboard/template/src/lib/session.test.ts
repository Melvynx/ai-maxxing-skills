import { describe, expect, it } from "vitest";

import { safeRedirect } from "./session";

describe("safeRedirect", () => {
  it("keeps a page of the dashboard", () => {
    expect(safeRedirect("/team")).toBe("/team");
    expect(safeRedirect("/infra/health?x=1")).toBe("/infra/health?x=1");
  });

  it("never leaves the dashboard", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "", undefined, 42]) expect(safeRedirect(value)).toBe("/");
  });

  it("never loops back to the sign-in page or the API", () => {
    expect(safeRedirect("/login?redirect=/team")).toBe("/");
    expect(safeRedirect("/api/auth/sign-out")).toBe("/");
  });
});
