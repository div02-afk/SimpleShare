import type { CompleteFrameMessage, DataFrameMessage, TransferFrameMessage } from "./types";

const FRAME_TYPE_DATA = 1;
const FRAME_TYPE_COMPLETE = 2;
const DATA_FRAME_HEADER_BYTES = 9;
const COMPLETE_FRAME_BYTES = 5;

export function createDataFrame(index: number, payloadBuffer: ArrayBuffer): ArrayBuffer {
  const payloadBytes = new Uint8Array(payloadBuffer);
  const frame = new ArrayBuffer(DATA_FRAME_HEADER_BYTES + payloadBytes.byteLength);
  const view = new DataView(frame);

  view.setUint8(0, FRAME_TYPE_DATA);
  view.setUint32(1, index, true);
  view.setUint32(5, payloadBytes.byteLength, true);
  new Uint8Array(frame, DATA_FRAME_HEADER_BYTES).set(payloadBytes);

  return frame;
}

export function createCompleteFrame(totalChunks: number): ArrayBuffer {
  const frame = new ArrayBuffer(COMPLETE_FRAME_BYTES);
  const view = new DataView(frame);

  view.setUint8(0, FRAME_TYPE_COMPLETE);
  view.setUint32(1, totalChunks, true);

  return frame;
}

export function normalizeBinaryFrame(
  frame: Blob | ArrayBuffer | ArrayBufferView
): Promise<ArrayBuffer> | ArrayBuffer {
  if (frame instanceof Blob) {
    return frame.arrayBuffer();
  }

  if (frame instanceof ArrayBuffer) {
    return frame;
  }

  if (ArrayBuffer.isView(frame)) {
    return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength).slice()
      .buffer;
  }

  throw new Error("Unsupported frame type");
}

export async function parseFrame(
  frame: Blob | ArrayBuffer | ArrayBufferView
): Promise<TransferFrameMessage> {
  const normalized = await normalizeBinaryFrame(frame);
  const view = new DataView(normalized);
  const type = view.getUint8(0);

  if (type === FRAME_TYPE_DATA) {
    const index = view.getUint32(1, true);
    const byteLength = view.getUint32(5, true);
    const payload = new Uint8Array(normalized, DATA_FRAME_HEADER_BYTES, byteLength);
    const message: DataFrameMessage = {
      type: "data",
      index,
      byteLength,
      data: payload,
    };
    return message;
  }

  if (type === FRAME_TYPE_COMPLETE) {
    const message: CompleteFrameMessage = {
      type: "complete",
      totalChunks: view.getUint32(1, true),
    };
    return message;
  }

  throw new Error(`Unknown frame type: ${type}`);
}
