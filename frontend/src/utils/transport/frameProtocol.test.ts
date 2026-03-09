import { describe, expect, it } from "vitest";
import {
  createCompleteFrame,
  createDataFrame,
  parseFrame,
} from "./frameProtocol";

describe("frameProtocol", () => {
  it("round-trips data frames", async () => {
    const payload = new TextEncoder().encode("hello world");
    const frame = createDataFrame(7, payload.buffer);
    const parsed = await parseFrame(frame);

    expect(parsed.type).toBe("data");
    if (parsed.type === "data") {
      expect(parsed.index).toBe(7);
      expect(parsed.byteLength).toBe(payload.byteLength);
      expect(Array.from(parsed.data)).toEqual(Array.from(payload));
    }
  });

  it("round-trips completion frames", async () => {
    const frame = createCompleteFrame(42);
    const parsed = await parseFrame(frame);

    expect(parsed).toEqual({
      type: "complete",
      totalChunks: 42,
    });
  });

  it("normalizes typed array inputs", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const view = new Uint8Array(createDataFrame(1, payload.buffer));
    const parsed = await parseFrame(view);

    expect(parsed.type).toBe("data");
    if (parsed.type === "data") {
      expect(Array.from(parsed.data)).toEqual([1, 2, 3, 4]);
    }
  });

  it("rejects invalid frame types", async () => {
    const invalid = new Uint8Array([99, 0, 0, 0, 0]).buffer;

    await expect(parseFrame(invalid)).rejects.toThrow("Unknown frame type");
  });
});
