import { describe, expect, it } from "vitest";

import { viewerFrom } from "./viewer";

describe("viewerFrom", () => {
  it("treats a request from the server itself as the owner", () => {
    expect(viewerFrom(undefined, undefined)).toEqual({ email: null, role: "admin" });
  });

  it("reads the gate's user and role", () => {
    expect(viewerFrom("Ada@Example.com", "admin")).toEqual({ email: "ada@example.com", role: "admin" });
    expect(viewerFrom("bob@example.com", "member")).toEqual({ email: "bob@example.com", role: "member" });
  });

  it("keeps a saved IP as admin without an email", () => {
    expect(viewerFrom("", "admin")).toEqual({ email: null, role: "admin" });
  });

  it("never upgrades an unknown role", () => {
    expect(viewerFrom("eve@example.com", "owner")).toEqual({ email: "eve@example.com", role: "member" });
  });
});
