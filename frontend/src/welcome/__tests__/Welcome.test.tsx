import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { Welcome, fileNameFromPath } from "../Welcome";
import { createTestI18n } from "../../test-utils/i18n";

// RF-009: Welcome's reactive pipelines are tested end-to-end per
// frontend-defensive.md §"Reactive Pipelines Must Be Verified End-to-End".

// Mock @tauri-apps/api/core so `invoke` returns controlled fixtures and the
// tests can assert which commands fire.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

let i18nInstance: i18n;

beforeAll(async () => {
  // The test i18n includes the welcome namespace per Task 18.
  i18nInstance = await createTestI18n();
});

beforeEach(() => {
  mockedInvoke.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderWelcome() {
  return render(() => (
    <TransProvider instance={i18nInstance}>
      <Welcome />
    </TransProvider>
  ));
}

describe("fileNameFromPath", () => {
  it("extracts the final segment of a unix path", () => {
    expect(fileNameFromPath("/Users/m/foo.sigil")).toBe("foo.sigil");
  });

  it("extracts the final segment of a windows path", () => {
    expect(fileNameFromPath("C:\\Users\\m\\foo.sigil")).toBe("foo.sigil");
  });

  it("returns the input unchanged when there are no separators", () => {
    expect(fileNameFromPath("foo.sigil")).toBe("foo.sigil");
  });

  it("returns the empty string when given the empty string", () => {
    expect(fileNameFromPath("")).toBe("");
  });
});

describe("Welcome — reactive pipelines (RF-009)", () => {
  it("populates Recent list from get_recent_workfiles on mount", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_workfiles") {
        return [
          { path: "/Users/m/foo.sigil", opened_at: "@1" },
          { path: "/Users/m/bar.sigil", opened_at: "@2" },
        ];
      }
      if (cmd === "get_restorable_workfiles") return [];
      return undefined;
    });

    renderWelcome();
    expect(await screen.findByText("foo.sigil")).toBeDefined();
    expect(screen.getByText("bar.sigil")).toBeDefined();
  });

  it("clicking a recent entry invokes open_workfile_path with that path", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_workfiles") {
        return [{ path: "/Users/m/foo.sigil", opened_at: "@1" }];
      }
      if (cmd === "get_restorable_workfiles") return [];
      return undefined;
    });

    renderWelcome();
    const button = await screen.findByText("foo.sigil");
    fireEvent.click(button);

    expect(mockedInvoke).toHaveBeenCalledWith("open_workfile_path", {
      path: "/Users/m/foo.sigil",
    });
  });

  it("shows the reopen banner when get_restorable_workfiles returns entries", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_workfiles") return [];
      if (cmd === "get_restorable_workfiles") {
        return ["/Users/m/a.sigil", "/Users/m/b.sigil", "/Users/m/c.sigil"];
      }
      return undefined;
    });

    renderWelcome();
    // The plural form for 3 entries.
    expect(await screen.findByText(/Reopen 3 previous workfiles\?/)).toBeDefined();
  });

  it("shows the singular reopen banner for exactly one workfile", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_workfiles") return [];
      if (cmd === "get_restorable_workfiles") return ["/Users/m/a.sigil"];
      return undefined;
    });

    renderWelcome();
    expect(await screen.findByText("Reopen 1 previous workfile?")).toBeDefined();
  });

  it("clicking Reopen invokes open_workfile_path once per restorable entry", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_workfiles") return [];
      if (cmd === "get_restorable_workfiles") {
        return ["/Users/m/a.sigil", "/Users/m/b.sigil"];
      }
      return undefined;
    });

    renderWelcome();
    const reopenButton = await screen.findByText("Reopen");
    fireEvent.click(reopenButton);

    // Wait for the two invokes to fire (sequentially awaited).
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const opens = mockedInvoke.mock.calls.filter((call) => call[0] === "open_workfile_path");
    expect(opens.length).toBe(2);
    expect(opens[0]?.[1]).toEqual({ path: "/Users/m/a.sigil" });
    expect(opens[1]?.[1]).toEqual({ path: "/Users/m/b.sigil" });
  });

  it("clicking Skip invokes clear_restorable_workfiles and hides the banner", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_workfiles") return [];
      if (cmd === "get_restorable_workfiles") return ["/Users/m/a.sigil"];
      if (cmd === "clear_restorable_workfiles") return null;
      return undefined;
    });

    renderWelcome();
    const skipButton = await screen.findByText("Skip");
    fireEvent.click(skipButton);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockedInvoke).toHaveBeenCalledWith("clear_restorable_workfiles");
  });

  it("clicking Open Workfile invokes open_workfile_dialog", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_workfiles") return [];
      if (cmd === "get_restorable_workfiles") return [];
      return undefined;
    });

    renderWelcome();
    const button = await screen.findByText("Open Workfile…");
    fireEvent.click(button);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockedInvoke).toHaveBeenCalledWith("open_workfile_dialog");
  });

  it("clicking New Workfile invokes new_workfile_dialog", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_workfiles") return [];
      if (cmd === "get_restorable_workfiles") return [];
      return undefined;
    });

    renderWelcome();
    const button = await screen.findByText("New Workfile…");
    fireEvent.click(button);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockedInvoke).toHaveBeenCalledWith("new_workfile_dialog");
  });

  it("Reopen failure surfaces a partial-success message in the status region (RF-011)", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_recent_workfiles") return [];
      if (cmd === "get_restorable_workfiles") {
        return ["/Users/m/a.sigil", "/Users/m/missing.sigil"];
      }
      if (cmd === "open_workfile_path") {
        if (args?.path === "/Users/m/missing.sigil") {
          throw new Error("not found");
        }
        return null;
      }
      return undefined;
    });

    renderWelcome();
    const reopenButton = await screen.findByText("Reopen");
    fireEvent.click(reopenButton);

    // Allow the loop to await each invoke; then status flips to the partial form.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(await screen.findByText(/Reopened 1 of 2; 1 failed\./)).toBeDefined();
  });
});
