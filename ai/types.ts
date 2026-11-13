export type LocalAIStatus =
  | "uninitialized"
  | "downloading"
  | "loading"
  | "ready"
  | "error";

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  bytesPerSecond: number;
}

export interface ModelLoadProgress {
  stage: "reading-wasm" | "streaming-model" | "initializing-runtime" | "warmup";
  percent: number;
  message: string;
}

export interface LocalAIState {
  status: LocalAIStatus;
  statusMessage: string;
  modelId: string;
  modelFileName: string;
  modelPath: string;
  modelExists: boolean;
  modelSizeBytes: number;
  downloadProgress: DownloadProgress | null;
  loadProgress: ModelLoadProgress | null;
  error: string | null;
}

export interface ChatMLMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  stop?: string[];
  suppressThinking?: boolean;
  assistantPrefill?: string;
  signal?: AbortSignal;
}

export type WorkerInMessage =
  | {
      type: "set-wasm";
      buffer: ArrayBuffer;
    }
  | {
      type: "model-chunk";
      buffer: ArrayBuffer;
      chunkIndex: number;
      totalChunks: number;
    }
  | {
      type: "load";
      requestId: string;
      nCtx: number;
      nThreads: number;
    }
  | {
      type: "generate";
      requestId: string;
      prompt: string;
      maxTokens: number;
      temperature: number;
      topK: number;
      topP: number;
      stop: string[];
    }
  | {
      type: "abort";
      requestId: string;
    }
  | {
      type: "unload";
      requestId: string;
    };

export type WorkerOutMessage =
  | {
      type: "loaded";
      requestId: string;
      nCtx: number;
      nThreads: number;
      multithread: boolean;
    }
  | {
      type: "token";
      requestId: string;
      count: number;
      text: string;
    }
  | {
      type: "progress";
      requestId: string;
      message: string;
    }
  | {
      type: "done";
      requestId: string;
      fullText: string;
    }
  | {
      type: "unloaded";
      requestId: string;
    }
  | {
      type: "error";
      requestId?: string;
      error: string;
      aborted?: boolean;
    };
