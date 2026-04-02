import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { ToastRegion, showToast } from "./Toast";

describe("Toast", () => {
  afterEach(() => {
    cleanup();
    // Clean up any portal-rendered toast elements from document.body
    document
      .querySelectorAll(".sigil-toast-region")
      .forEach((el) => el.closest("[data-kb-toast-region]")?.remove());
  });

  describe("ToastRegion", () => {
    it("should render the toast list container in the document", () => {
      render(() => <ToastRegion />);
      const list = document.querySelector(".sigil-toast-region");
      expect(list).toBeTruthy();
    });

    it("should render as an ordered list element for accessibility", () => {
      render(() => <ToastRegion />);
      const list = document.querySelector(".sigil-toast-region");
      expect(list?.tagName.toLowerCase()).toBe("ol");
    });

    it("should include the toast region landmark role", () => {
      render(() => <ToastRegion />);
      const region = document.querySelector("[role='region']");
      expect(region).toBeTruthy();
    });
  });

  describe("showToast", () => {
    it("should be a callable function", () => {
      expect(typeof showToast).toBe("function");
    });

    it("should accept ToastData with only a title", () => {
      expect(() => showToast({ title: "Test toast" })).not.toThrow();
    });

    it("should accept ToastData with all fields", () => {
      expect(() =>
        showToast({
          title: "Test toast",
          description: "A description",
          variant: "success",
        }),
      ).not.toThrow();
    });

    it("should accept each variant without throwing", () => {
      const variants = ["info", "success", "error", "warning"] as const;
      for (const variant of variants) {
        expect(() =>
          showToast({ title: `${variant} toast`, variant }),
        ).not.toThrow();
      }
    });
  });
});
