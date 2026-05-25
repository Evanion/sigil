/**
 * Test helper: a Proxy-based recording mock for `CanvasRenderingContext2D`.
 *
 * Every method call and property assignment is recorded into `__calls` for
 * assertion. `createLinearGradient` / `createRadialGradient` / `createConicGradient`
 * return mock gradient objects that capture `addColorStop` calls.
 *
 * Extracted from the inline `createMockContext` previously in
 * `renderer.test.ts`. Plan 14c's `corner-path.test.ts` and the renderer
 * integration tests share this helper.
 */

export interface MockGradient {
  readonly __type: "linear" | "radial" | "conic";
  readonly __args: readonly number[];
  readonly __stops: Array<{ offset: number; color: string }>;
  addColorStop: (offset: number, color: string) => void;
}

export interface MockCall {
  method: string;
  args: unknown[];
}

/** Create a mock 2D canvas context that records every call and property set. */
export function createMockContext(): CanvasRenderingContext2D {
  const calls: MockCall[] = [];

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target: Record<string, unknown>, prop: string): unknown {
      if (prop === "__calls") {
        return calls;
      }
      if (prop === "canvas") {
        return { width: 800, height: 600 };
      }
      if (prop === "createLinearGradient") {
        return (...args: number[]): MockGradient => {
          const stops: Array<{ offset: number; color: string }> = [];
          const gradient: MockGradient = {
            __type: "linear",
            __args: args,
            __stops: stops,
            addColorStop(offset: number, color: string) {
              stops.push({ offset, color });
            },
          };
          calls.push({ method: "createLinearGradient", args });
          return gradient;
        };
      }
      if (prop === "createRadialGradient") {
        return (...args: number[]): MockGradient => {
          const stops: Array<{ offset: number; color: string }> = [];
          const gradient: MockGradient = {
            __type: "radial",
            __args: args,
            __stops: stops,
            addColorStop(offset: number, color: string) {
              stops.push({ offset, color });
            },
          };
          calls.push({ method: "createRadialGradient", args });
          return gradient;
        };
      }
      if (prop === "createConicGradient") {
        return (...args: number[]): MockGradient => {
          const stops: Array<{ offset: number; color: string }> = [];
          const gradient: MockGradient = {
            __type: "conic",
            __args: args,
            __stops: stops,
            addColorStop(offset: number, color: string) {
              stops.push({ offset, color });
            },
          };
          calls.push({ method: "createConicGradient", args });
          return gradient;
        };
      }
      if (typeof target[prop] === "undefined") {
        target[prop] = (...args: unknown[]) => {
          calls.push({ method: prop, args });
        };
      }
      return target[prop];
    },
    set(target: Record<string, unknown>, prop: string, value: unknown): boolean {
      calls.push({ method: `set:${prop}`, args: [value] });
      target[prop] = value;
      return true;
    },
  };

  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

/** Extract recorded calls from the mock context. */
export function getCalls(ctx: CanvasRenderingContext2D): MockCall[] {
  return (ctx as unknown as { __calls: MockCall[] }).__calls;
}
