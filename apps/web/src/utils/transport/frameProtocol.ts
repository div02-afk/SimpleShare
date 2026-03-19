import type {
  ChunkEncoding,
  CompleteFrameMessage,
  DataFrameMessage,
  TransferFrameMessage,
} from "./types";

const FRAME_TYPE_DATA = 1;
const FRAME_TYPE_COMPLETE = 2;
const CHUNK_ENCODING_RAW = 0;
const CHUNK_ENCODING_DEFLATE = 1;
const DATA_FRAME_HEADER_BYTES = 14;
const COMPLETE_FRAME_BYTES = 5;

function getChunkEncodingId(encoding: ChunkEncoding): number {
  if (encoding === "raw") {
    return CHUNK_ENCODING_RAW;
  }

  return CHUNK_ENCODING_DEFLATE;
}

function getChunkEncodingFromId(encodingId: number): ChunkEncoding {
  if (encodingId === CHUNK_ENCODING_RAW) {
    return "raw";
  }

  if (encodingId === CHUNK_ENCODING_DEFLATE) {
    return "deflate";
  }

  throw new Error(`Unknown chunk encoding: ${encodingId}`);
}

export function getDataFrameByteLength(payloadByteLength: number): number {
  return DATA_FRAME_HEADER_BYTES + payloadByteLength;
}

export function createDataFrame(
  index: number,
  payloadBytes: Uint8Array,
  encoding: ChunkEncoding,
  originalByteLength = payloadBytes.byteLength
): ArrayBuffer {
  const frame = new ArrayBuffer(getDataFrameByteLength(payloadBytes.byteLength));
  const view = new DataView(frame);

  view.setUint8(0, FRAME_TYPE_DATA);
  view.setUint32(1, index, true);
  view.setUint8(5, getChunkEncodingId(encoding));
  view.setUint32(6, payloadBytes.byteLength, true);
  view.setUint32(10, originalByteLength, true);
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
  if (normalized.byteLength < 1) {
    throw new Error("Transfer frame is empty.");
  }

  const view = new DataView(normalized);
  const type = view.getUint8(0);

  if (type === FRAME_TYPE_DATA) {
    if (normalized.byteLength < DATA_FRAME_HEADER_BYTES) {
      throw new Error("Data frame header is incomplete.");
    }

    const index = view.getUint32(1, true);
    const encoding = getChunkEncodingFromId(view.getUint8(5));
    const wireByteLength = view.getUint32(6, true);
    const originalByteLength = view.getUint32(10, true);
    const expectedFrameByteLength = getDataFrameByteLength(wireByteLength);

    if (normalized.byteLength !== expectedFrameByteLength) {
      throw new Error("Data frame payload length does not match the frame header.");
    }

    if (encoding === "raw" && originalByteLength !== wireByteLength) {
      throw new Error("Raw data frame length metadata is inconsistent.");
    }

    const payload = new Uint8Array(normalized, DATA_FRAME_HEADER_BYTES, wireByteLength);
    const message: DataFrameMessage = {
      type: "data",
      index,
      encoding,
      wireByteLength,
      originalByteLength,
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
