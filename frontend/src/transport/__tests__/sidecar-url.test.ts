import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getGraphqlHttpUrl, getGraphqlWsUrl } from "../sidecar-url";

describe("sidecar-url", () => {
  let originalGlobal: unknown;

  beforeEach(() => {
    originalGlobal = (window as unknown as { __SIGIL_SIDECAR_PORT__?: number })
      .__SIGIL_SIDECAR_PORT__;
  });

  afterEach(() => {
    (window as unknown as { __SIGIL_SIDECAR_PORT__?: number }).__SIGIL_SIDECAR_PORT__ =
      originalGlobal as number | undefined;
  });

  describe("Tauri mode (sidecar port injected)", () => {
    beforeEach(() => {
      (window as unknown as { __SIGIL_SIDECAR_PORT__: number }).__SIGIL_SIDECAR_PORT__ = 51234;
    });

    it("uses 127.0.0.1 with injected port for HTTP", () => {
      expect(getGraphqlHttpUrl()).toBe("http://127.0.0.1:51234/graphql");
    });

    it("uses 127.0.0.1 with injected port for WS", () => {
      expect(getGraphqlWsUrl()).toBe("ws://127.0.0.1:51234/graphql/ws");
    });
  });

  describe("browser/dev mode (no injected port)", () => {
    beforeEach(() => {
      delete (window as unknown as { __SIGIL_SIDECAR_PORT__?: number }).__SIGIL_SIDECAR_PORT__;
    });

    it("uses window.location.origin for HTTP", () => {
      const expected = `${window.location.origin}/graphql`;
      expect(getGraphqlHttpUrl()).toBe(expected);
    });

    it("uses ws:// + window.location.host for WS over HTTP", () => {
      const expected = `ws://${window.location.host}/graphql/ws`;
      expect(getGraphqlWsUrl()).toBe(expected);
    });
  });

  it("rejects non-finite injected port (defense-in-depth)", () => {
    (window as unknown as { __SIGIL_SIDECAR_PORT__: unknown }).__SIGIL_SIDECAR_PORT__ =
      "not a number";
    expect(getGraphqlHttpUrl()).toBe(`${window.location.origin}/graphql`);
  });
});
