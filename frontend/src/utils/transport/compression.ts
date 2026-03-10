import { deflate, inflate } from "fflate";
import type { CompressionMode } from "../../types/transfer";

const COMPRESSED_EXTENSIONS = new Set([
  ".7z",
  ".aac",
  ".apk",
  ".avif",
  ".bz2",
  ".docx",
  ".epub",
  ".gif",
  ".gz",
  ".heic",
  ".heif",
  ".ipa",
  ".jar",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".odt",
  ".ogg",
  ".ogv",
  ".pdf",
  ".png",
  ".pptx",
  ".rar",
  ".tgz",
  ".war",
  ".webm",
  ".webp",
  ".xlsx",
  ".xz",
  ".zip",
]);

const COMPRESSED_MIME_PREFIXES = [
  "audio/",
  "image/",
  "video/",
];

const COMPRESSED_MIME_TYPES = new Set([
  "application/gzip",
  "application/java-archive",
  "application/pdf",
  "application/vnd.android.package-archive",
  "application/vnd.apple.installer+xml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "application/x-7z-compressed",
  "application/x-bzip",
  "application/x-bzip2",
  "application/x-rar-compressed",
  "application/x-xz",
]);

export const DEFAULT_COMPRESSION_MODE: CompressionMode = "adaptive-deflate-v1";
export const COMPRESSION_PROBE_CHUNK_LIMIT = 8;
export const MIN_CHUNK_BYTES_SAVED = 1024;
export const MIN_CHUNK_SAVINGS_RATIO = 0.08;
export const MIN_PROBE_SAVINGS_RATIO = 0.05;
const DEFAULT_DEFLATE_LEVEL = 1;

export interface CompressionAdapter {
  isSupported(): boolean;
  deflate(chunk: Uint8Array): Promise<Uint8Array>;
  inflate(chunk: Uint8Array, originalByteLength: number): Promise<Uint8Array>;
}

export interface CompressionProbeState {
  attemptedChunks: number;
  totalOriginalBytes: number;
  totalCompressedBytes: number;
  disabledForRemainder: boolean;
}

export interface CompressionResult {
  useCompressed: boolean;
  shouldDisableFutureCompression: boolean;
}

export function createCompressionProbeState(): CompressionProbeState {
  return {
    attemptedChunks: 0,
    totalOriginalBytes: 0,
    totalCompressedBytes: 0,
    disabledForRemainder: false,
  };
}

export class FflateCompressionAdapter implements CompressionAdapter {
  isSupported(): boolean {
    return typeof Uint8Array !== "undefined";
  }

  deflate(chunk: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      deflate(chunk, { level: DEFAULT_DEFLATE_LEVEL }, (error, output) => {
        if (error) {
          reject(new Error(error.message || "Unable to compress the transfer chunk."));
          return;
        }

        resolve(output);
      });
    });
  }

  inflate(chunk: Uint8Array, originalByteLength: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      inflate(chunk, { size: originalByteLength }, (error, output) => {
        if (error) {
          reject(new Error(error.message || "Unable to decompress the transfer chunk."));
          return;
        }

        if (output.byteLength !== originalByteLength) {
          reject(new Error("Inflated chunk length did not match the expected size."));
          return;
        }

        resolve(output);
      });
    });
  }
}

export function resolveCompressionMode(
  requestedMode?: CompressionMode,
  acceptedMode?: CompressionMode
): CompressionMode {
  if (requestedMode === DEFAULT_COMPRESSION_MODE && acceptedMode === DEFAULT_COMPRESSION_MODE) {
    return DEFAULT_COMPRESSION_MODE;
  }

  return "none";
}

export function isCompressionEligibleFile(name: string, mimeType: string): boolean {
  const normalizedType = mimeType.toLowerCase();
  if (
    COMPRESSED_MIME_TYPES.has(normalizedType) ||
    COMPRESSED_MIME_PREFIXES.some((prefix) => normalizedType.startsWith(prefix))
  ) {
    return false;
  }

  const extensionIndex = name.lastIndexOf(".");
  const extension =
    extensionIndex >= 0 ? name.slice(extensionIndex).toLowerCase() : "";

  return !COMPRESSED_EXTENSIONS.has(extension);
}

export function shouldUseCompressedChunk(
  state: CompressionProbeState,
  originalByteLength: number,
  compressedByteLength: number
): CompressionResult {
  const bytesSaved = originalByteLength - compressedByteLength;
  const savingsRatio =
    originalByteLength === 0 ? 0 : bytesSaved / originalByteLength;

  state.attemptedChunks += 1;
  state.totalOriginalBytes += originalByteLength;
  state.totalCompressedBytes += compressedByteLength;

  const useCompressed =
    bytesSaved >= MIN_CHUNK_BYTES_SAVED && savingsRatio >= MIN_CHUNK_SAVINGS_RATIO;

  let shouldDisableFutureCompression = false;
  if (state.attemptedChunks >= COMPRESSION_PROBE_CHUNK_LIMIT) {
    const averageSavingsRatio =
      state.totalOriginalBytes === 0
        ? 0
        : (state.totalOriginalBytes - state.totalCompressedBytes) /
          state.totalOriginalBytes;
    shouldDisableFutureCompression = averageSavingsRatio < MIN_PROBE_SAVINGS_RATIO;
    state.disabledForRemainder = shouldDisableFutureCompression;
  }

  return {
    useCompressed,
    shouldDisableFutureCompression,
  };
}
