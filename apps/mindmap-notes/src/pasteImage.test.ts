import { describe, it, expect, vi, afterEach } from "vitest";
import {
  pasteImage,
  finishImagePastes,
  hasImagePastes,
  safeEmbeddedImage,
} from "./pasteImage";
import type { ClipboardEvent } from "react";
afterEach(() => vi.unstubAllGlobals());
describe("embedded clipboard images", () => {
  it("allows raster data and refuses active or remote image sources", () => {
    expect(safeEmbeddedImage("data:image/png;base64,aGVsbG8=")).toBe(true);
    expect(safeEmbeddedImage("data:image/svg+xml;base64,aGVsbG8=")).toBe(false);
    expect(safeEmbeddedImage("https://external.test/a.png")).toBe(false);
  });
  it("keeps text paste behavior", () => {
    const e = {
      clipboardData: { items: [] },
    } as unknown as ClipboardEvent<HTMLTextAreaElement>;
    expect(pasteImage(e, () => {})).toBe(false);
  });
  it("waits for image reads and updates the input before completing editing", async () => {
    let load: () => void = () => {};
    vi.stubGlobal(
      "FileReader",
      class {
        result = "data:image/png;base64,aGVsbG8=";
        onload = () => {};
        readAsDataURL() {
          load = () => this.onload();
        }
      },
    );
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const input = {
      isConnected: true,
      value: "abcd",
      selectionStart: 1,
      selectionEnd: 3,
    };
    const change = vi.fn(),
      preventDefault = vi.fn();
    const e = {
      currentTarget: input,
      preventDefault,
      stopPropagation: () => {},
      clipboardData: {
        items: [
          { kind: "file", type: "image/png", getAsFile: () => ({ size: 5 }) },
        ],
      },
    } as unknown as ClipboardEvent<HTMLTextAreaElement>;
    expect(pasteImage(e, change)).toBe(true);
    expect(hasImagePastes()).toBe(true);
    expect(change).not.toHaveBeenCalled();
    load();
    await finishImagePastes();
    expect(hasImagePastes()).toBe(false);
    expect(input.value).toContain(
      "a\n![图片](data:image/png;base64,aGVsbG8=)\nd",
    );
    expect(change).toHaveBeenCalledWith(input.value);
    expect(preventDefault).toHaveBeenCalled();
  });
  it("does not write to a note that has already closed", async () => {
    vi.stubGlobal(
      "FileReader",
      class {
        result = "data:image/png;base64,aA==";
        onload = () => {};
        readAsDataURL() {
          queueMicrotask(() => this.onload());
        }
      },
    );
    const change = vi.fn();
    pasteImage(
      {
        currentTarget: { isConnected: false },
        preventDefault: () => {},
        stopPropagation: () => {},
        clipboardData: {
          items: [
            { kind: "file", type: "image/png", getAsFile: () => ({ size: 2 }) },
          ],
        },
      } as unknown as ClipboardEvent<HTMLTextAreaElement>,
      change,
    );
    await finishImagePastes();
    expect(change).not.toHaveBeenCalled();
  });
});
