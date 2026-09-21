import { describe, expect, it } from "vitest";
import { main } from "../../src/cli";

describe("CLI entrypoint", () => {
  it("returns success for version", async () => {
    await expect(main(["node", "image-slim", "--version"])).resolves.toBe(0);
  });

  it("returns the documented invalid-option exit code", async () => {
    await expect(
      main(["node", "image-slim", "--format", "invalid"]),
    ).resolves.toBe(2);
  });
});
