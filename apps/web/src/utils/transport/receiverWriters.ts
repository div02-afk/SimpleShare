import type { TransferMetadata, WriteMode } from "../../types/transfer";
import type { TransferWriter } from "./types";

function getOriginalExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(lastDotIndex).toLowerCase();
}

function ensureExtension(fileName: string, originalExtension: string): string {
  if (!fileName || !originalExtension) {
    return fileName;
  }

  if (fileName.toLowerCase().endsWith(originalExtension)) {
    return fileName;
  }

  return `${fileName}${originalExtension}`;
}

export function supportsDirectFileWrite(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showSaveFilePicker === "function"
  );
}

function createSavePickerOptions(metadata: TransferMetadata): SaveFilePickerOptions {
  const originalExtension = getOriginalExtension(metadata.name);

  if (!originalExtension) {
    return {
      suggestedName: metadata.name,
    };
  }

  return {
    suggestedName: metadata.name,
    types: [
      {
        description: metadata.type || "Transferred file",
        accept: {
          [metadata.type || "application/octet-stream"]: [originalExtension],
        },
      },
    ],
  };
}

export class StreamFileWriter implements TransferWriter {
  readonly writeMode: WriteMode = "stream";

  private writableStream: FileSystemWritableFileStream | null = null;

  async prepare(metadata: TransferMetadata): Promise<string | null> {
    if (!supportsDirectFileWrite()) {
      throw new Error("The current browser does not support direct file writes.");
    }

    const handle = await window.showSaveFilePicker?.(createSavePickerOptions(metadata));
    if (!handle) {
      throw new Error("Unable to create a file handle.");
    }

    const originalExtension = getOriginalExtension(metadata.name);
    const resolvedFileName = ensureExtension(handle.name, originalExtension);

    if (resolvedFileName !== handle.name) {
      throw new Error(
        `Please keep the original ${originalExtension} extension when choosing the file name.`
      );
    }

    this.writableStream = await handle.createWritable();
    return resolvedFileName;
  }

  async writeChunk(chunk: Uint8Array): Promise<void> {
    if (!this.writableStream) {
      throw new Error("Writable stream is not available.");
    }

    await this.writableStream.write(new Uint8Array(chunk));
  }

  async finalize(): Promise<number> {
    if (!this.writableStream) {
      return 0;
    }

    await this.writableStream.close();
    this.writableStream = null;
    return 0;
  }

  async abort(): Promise<void> {
    if (!this.writableStream) {
      return;
    }

    await this.writableStream.abort();
    this.writableStream = null;
  }
}

export class BlobFallbackWriter implements TransferWriter {
  readonly writeMode: WriteMode = "blob-fallback";

  private readonly chunks: Uint8Array[] = [];

  async prepare(metadata: TransferMetadata): Promise<string | null> {
    return metadata.name;
  }

  async writeChunk(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk);
  }

  async finalize(
    metadata: TransferMetadata,
    resolvedFileName: string | null
  ): Promise<number> {
    const blob = new Blob(this.chunks.map((chunk) => new Uint8Array(chunk)), {
      type: metadata.type || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = resolvedFileName || metadata.name || "download.bin";
    link.click();
    URL.revokeObjectURL(url);

    const bytesWritten = this.chunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0
    );
    this.chunks.length = 0;
    return bytesWritten;
  }

  async abort(): Promise<void> {
    this.chunks.length = 0;
  }
}
