import { describe, expect, it } from "vitest";
import { formatBytes, parseByteSize } from "../../src/filesystem/size";

describe("byte sizes", () => {
  it("parses binary units", () => {
    expect(parseByteSize("500kb")).toBe(512_000);
    expect(parseByteSize("2 MB")).toBe(2 * 1024 * 1024);
    expect(parseByteSize("42")).toBe(42);
  });

  it("rejects malformed sizes", () => {
    expect(() => parseByteSize("nope")).toThrow("Invalid byte size");
  });

  it("formats readable sizes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});
