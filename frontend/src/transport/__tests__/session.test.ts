import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSessionId,
  getServerPort,
  getGraphqlHttpUrl,
  getGraphqlWsUrl,
  setSessionGlobals,
} from "../session";

describe("session helper", () => {
  let originalSession: unknown;
  let originalPort: unknown;

  beforeEach(() => {
    originalSession = (window as unknown as Record<string, unknown>).__SIGIL_SESSION_ID__;
    originalPort = (window as unknown as Record<string, unknown>).__SIGIL_SERVER_PORT__;
  });

  afterEach(() => {
    (window as unknown as Record<string, unknown>).__SIGIL_SESSION_ID__ = originalSession;
    (window as unknown as Record<string, unknown>).__SIGIL_SERVER_PORT__ = originalPort;
  });

  it("reads a valid sessionId", () => {
    setSessionGlobals("abc-123", 4680);
    expect(getSessionId()).toBe("abc-123");
  });

  it("returns null when sessionId is missing", () => {
    delete (window as unknown as Record<string, unknown>).__SIGIL_SESSION_ID__;
    expect(getSessionId()).toBeNull();
  });

  it("returns null when sessionId is an empty string", () => {
    (window as unknown as Record<string, unknown>).__SIGIL_SESSION_ID__ = "";
    expect(getSessionId()).toBeNull();
  });

  it("returns null when sessionId has the wrong type", () => {
    (window as unknown as Record<string, unknown>).__SIGIL_SESSION_ID__ = 42;
    expect(getSessionId()).toBeNull();
  });

  it("accepts a port in range (1..=65535)", () => {
    setSessionGlobals("abc", 4680);
    expect(getServerPort()).toBe(4680);
  });

  it("rejects port 0", () => {
    setSessionGlobals("abc", 0);
    expect(getServerPort()).toBeNull();
  });

  it("rejects port 65536", () => {
    setSessionGlobals("abc", 65536);
    expect(getServerPort()).toBeNull();
  });

  it("rejects negative ports", () => {
    setSessionGlobals("abc", -1);
    expect(getServerPort()).toBeNull();
  });

  it("rejects NaN and Infinity ports (Number.isFinite guard)", () => {
    setSessionGlobals("abc", NaN);
    expect(getServerPort()).toBeNull();
    setSessionGlobals("abc", Infinity);
    expect(getServerPort()).toBeNull();
    setSessionGlobals("abc", -Infinity);
    expect(getServerPort()).toBeNull();
  });

  it("rejects non-number port types", () => {
    (window as unknown as Record<string, unknown>).__SIGIL_SERVER_PORT__ = "4680";
    expect(getServerPort()).toBeNull();
  });

  it("uses 127.0.0.1:<port> for Tauri-mode URLs", () => {
    setSessionGlobals("abc", 4680);
    expect(getGraphqlHttpUrl()).toBe("http://127.0.0.1:4680/graphql");
    expect(getGraphqlWsUrl()).toBe("ws://127.0.0.1:4680/graphql/ws");
  });

  it("falls back to window.location for browser mode (no port)", () => {
    delete (window as unknown as Record<string, unknown>).__SIGIL_SERVER_PORT__;
    expect(getGraphqlHttpUrl()).toBe(`${window.location.origin}/graphql`);
    expect(getGraphqlWsUrl()).toMatch(/^wss?:\/\/[^/]+\/graphql\/ws$/);
  });

  it("falls back to window.location when port is invalid (e.g., NaN)", () => {
    setSessionGlobals("abc", NaN);
    expect(getGraphqlHttpUrl()).toBe(`${window.location.origin}/graphql`);
  });

  it("setSessionGlobals writes both fields", () => {
    setSessionGlobals("new-session", 5500);
    expect(getSessionId()).toBe("new-session");
    expect(getServerPort()).toBe(5500);
  });
});
