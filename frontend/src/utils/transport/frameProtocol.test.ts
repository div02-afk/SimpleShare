import { describe, expect, it } from "vitest";
import {
  createCompleteFrame,
  createDataFrame,
  parseFrame,
} from "./frameProtocol";

describe("frameProtocol", () => {
  it("round-trips raw data frames", async () => {
    const payload = new TextEncoder().encode("hello world");
    const frame = createDataFrame(7, payload, "raw");
    const parsed = await parseFrame(frame);

    expect(parsed.type).toBe("data");
    if (parsed.type === "data") {
      expect(parsed.index).toBe(7);
      expect(parsed.encoding).toBe("raw");
      expect(parsed.wireByteLength).toBe(payload.byteLength);
      expect(parsed.originalByteLength).toBe(payload.byteLength);
      expect(Array.from(parsed.data)).toEqual(Array.from(payload));
    }
  });

  it("round-trips deflated data frames", async () => {
    const payload = new Uint8Array([120, 156, 203, 72, 205, 201, 201, 7, 0]);
    const frame = createDataFrame(3, payload, "deflate", 11);
    const parsed = await parseFrame(frame);

    expect(parsed.type).toBe("data");
    if (parsed.type === "data") {
      expect(parsed.index).toBe(3);
      expect(parsed.encoding).toBe("deflate");
      expect(parsed.wireByteLength).toBe(payload.byteLength);
      expect(parsed.originalByteLength).toBe(11);
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
    const view = new Uint8Array(createDataFrame(1, payload, "raw"));
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

  it("rejects frames with inconsistent payload lengths", async () => {
    const payload = new Uint8Array(createDataFrame(1, new Uint8Array([1, 2, 3]), "raw"));
    payload[6] = 4;

    await expect(parseFrame(payload)).rejects.toThrow(
      "Data frame payload length does not match the frame header."
    );
  });

  it("rejects raw frames with mismatched original length metadata", async () => {
    const payload = new Uint8Array(createDataFrame(1, new Uint8Array([1, 2, 3]), "raw"));
    payload[10] = 4;

    await expect(parseFrame(payload)).rejects.toThrow(
      "Raw data frame length metadata is inconsistent."
    );
  });
});
