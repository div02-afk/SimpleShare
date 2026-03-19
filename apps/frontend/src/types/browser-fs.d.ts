declare global {
  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string[]>;
  }

  interface SaveFilePickerOptions {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }

  interface FileSystemFileHandle {
    readonly kind: "file";
    readonly name: string;
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: BufferSource | Blob | string): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
  }

  interface Window {
    showSaveFilePicker?: (
      options?: SaveFilePickerOptions
    ) => Promise<FileSystemFileHandle>;
  }
}

export {};
