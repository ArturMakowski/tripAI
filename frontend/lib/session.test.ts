import { describe, expect, it } from "vitest";
import { SESSION_HEADER, rememberSession, sessionHeaders } from "./session";

describe("server-issued session", () => {
  it("remembers the token from a response and sends it back", () => {
    expect(sessionHeaders()).toEqual({});
    rememberSession(new Response("{}", { headers: { [SESSION_HEADER]: "s_abc.sig" } }));
    expect(sessionHeaders()).toEqual({ [SESSION_HEADER]: "s_abc.sig" });
    rememberSession(new Response("{}")); // responses without the header keep the token
    expect(sessionHeaders()).toEqual({ [SESSION_HEADER]: "s_abc.sig" });
  });
});
