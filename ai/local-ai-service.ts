import { Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type FileOrganizer from "../index";
import {
  ModelDownloader,
  DEFAULT_LOCAL_MODEL_ID,
  DEFAULT_LOCAL_MODEL_FILENAME,
  DEFAULT_LOCAL_MODEL_URL,
} from "./model-downloader";
import {
  formatQwenChatML,
  parseJSONFromModelOutput,
  QWEN_STOP_TOKENS,
  stripThinkingBlocks,
} from "./chatml";
import { localAIStore, updateLocalAIState } from "./local-ai-store";
import type {
  ChatMLMessage,
  GenerateOptions,
  WorkerInMessage,
  WorkerOutMessage,
} from "./types";
import { logger } from "../services/logger";

const MODEL_CHUNK_BYTES = 16 * 1024 * 1024; // 16 MB per transferable chunk

interface PendingRequest {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
  onToken?: (delta: string, cleanFullText: string) => void;
  rawText: string;
  emittedCleanLength: number;
  tokenCount: number;
  startedAt: number;
  signal?: AbortSignal;
  abortHandler?: () => void;
  progressNotice?: Notice;
}

export class LocalAIService {
  private downloader: ModelDownloader;
  private worker: Worker | null = null;
  private workerBlobUrl: string | null = null;
  private initPromise: Promise<void> | null = null;
  private generationQueue: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, PendingRequest>();
  private loadResolvers = new Map<
    string,
    { resolve: () => void; reject: (err: unknown) => void }
  >();
  private requestCounter = 0;

  constructor(private plugin: FileOrganizer) {
    this.downloader = new ModelDownloader(
      plugin.app,
      plugin.manifest.id,
      plugin.manifest.dir
    );
    this.refreshFileStatus();
  }

  refreshFileStatus(): void {
    try {
      const fileName =
        this.plugin.settings?.localModelFileName ||
        DEFAULT_LOCAL_MODEL_FILENAME;
      const info = this.downloader.inspectModelFile(fileName);
      const current = localAIStore.getState();
      updateLocalAIState({
        modelId: this.plugin.settings?.localModelId || current.modelId,
        modelFileName: fileName,
        modelPath: info.path,
        modelExists: info.exists,
        modelSizeBytes: info.sizeBytes,
        status:
          current.status === "ready" ||
          current.status === "downloading" ||
          current.status === "loading"
            ? current.status
            : "uninitialized",
        statusMessage:
          current.status === "ready"
            ? current.statusMessage
            : info.exists
            ? "Downloaded (not loaded in memory)"
            : "Model not downloaded",
      });
    } catch (error) {
      updateLocalAIState({
        modelExists: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  listAvailableModels(): Promise<string[]> {
    return this.downloader.listModelFiles();
  }

  async selectModel(fileName: string): Promise<void> {
    if (
      path.basename(fileName) !== fileName ||
      !fileName.toLowerCase().endsWith(".gguf")
    ) {
      throw new Error("Select a GGUF model from the plugin models folder.");
    }

    const availableModels = await this.downloader.listModelFiles();
    if (!availableModels.includes(fileName)) {
      throw new Error(`The local model "${fileName}" is not available.`);
    }

    await this.unload();
    this.plugin.settings.localModelFileName = fileName;
    this.plugin.settings.localModelId =
      fileName === DEFAULT_LOCAL_MODEL_FILENAME
        ? DEFAULT_LOCAL_MODEL_ID
        : fileName;
    if (fileName === DEFAULT_LOCAL_MODEL_FILENAME) {
      this.plugin.settings.localModelUrl = DEFAULT_LOCAL_MODEL_URL;
    }
    await this.plugin.saveSettings();
    this.refreshFileStatus();
  }

  isReady(): boolean {
    return localAIStore.getState().status === "ready" && this.worker !== null;
  }

  async initialize(options?: { autoDownload?: boolean }): Promise<void> {
    if (this.isReady()) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize(options?.autoDownload ?? true).finally(
      () => {
        this.initPromise = null;
      }
    );
    return this.initPromise;
  }

  async ensureReady(): Promise<void> {
    if (this.isReady()) return;
    await this.initialize({ autoDownload: true });
  }

  private async doInitialize(autoDownload: boolean): Promise<void> {
    const fileName =
      this.plugin.settings.localModelFileName || DEFAULT_LOCAL_MODEL_FILENAME;
    const modelUrl =
      this.plugin.settings.localModelUrl || DEFAULT_LOCAL_MODEL_URL;

    try {
      let info = this.downloader.inspectModelFile(fileName);

      if (!info.exists) {
        if (fileName !== DEFAULT_LOCAL_MODEL_FILENAME) {
          throw new Error(
            `Selected model "${fileName}" is missing. Choose the default model to download it automatically.`
          );
        }
        if (!autoDownload) {
          throw new Error(
            `Local model "${fileName}" is missing. Open Settings → General → Local AI to initialize.`
          );
        }
        updateLocalAIState({
          status: "downloading",
          statusMessage: `Downloading ${fileName}...`,
          downloadProgress: {
            downloadedBytes: 0,
            totalBytes: 0,
            percent: 0,
            bytesPerSecond: 0,
          },
          loadProgress: null,
          error: null,
        });

        await this.downloader.downloadModel(modelUrl, fileName, (progress) => {
          updateLocalAIState({
            status: "downloading",
            statusMessage: `Downloading ${fileName} (${progress.percent}%)`,
            downloadProgress: progress,
          });
        });

        info = this.downloader.inspectModelFile(fileName);
        updateLocalAIState({
          modelExists: info.exists,
          modelPath: info.path,
          modelSizeBytes: info.sizeBytes,
          downloadProgress: null,
        });
      }

      const wasmPath = this.downloader.getWasmFilePath();
      if (!fs.existsSync(wasmPath)) {
        throw new Error(
          `Missing wllama WASM binary at ${wasmPath}. Reinstall or rebuild the plugin.`
        );
      }

      updateLocalAIState({
        status: "loading",
        statusMessage: "Reading WebAssembly runtime...",
        loadProgress: {
          stage: "reading-wasm",
          percent: 5,
          message: "Reading wllama.wasm from disk",
        },
        error: null,
      });

      this.ensureWorker();

      const wasmFile = await fs.promises.readFile(wasmPath);
      const wasmBuffer = wasmFile.buffer.slice(
        wasmFile.byteOffset,
        wasmFile.byteOffset + wasmFile.byteLength
      ) as ArrayBuffer;
      this.postToWorker({ type: "set-wasm", buffer: wasmBuffer }, [wasmBuffer]);

      const totalBytes = info.sizeBytes;
      const totalChunks = Math.max(1, Math.ceil(totalBytes / MODEL_CHUNK_BYTES));
      let chunkIndex = 0;

      updateLocalAIState({
        status: "loading",
        statusMessage: `Loading ${fileName} into CPU worker...`,
        loadProgress: {
          stage: "streaming-model",
          percent: 15,
          message: `Reading ${fileName} (${Math.round(totalBytes / (1024 * 1024))} MB)`,
        },
      });

      await this.streamFileChunksToWorker(
        info.path,
        totalChunks,
        (sentChunks) => {
          const pct = 15 + Math.round((sentChunks / totalChunks) * 55);
          updateLocalAIState({
            loadProgress: {
              stage: "streaming-model",
              percent: pct,
              message: `Transferring model weights (${sentChunks}/${totalChunks})`,
            },
          });
        },
        () => chunkIndex++
      );

      updateLocalAIState({
        loadProgress: {
          stage: "initializing-runtime",
          percent: 80,
          message: "Compiling WASM & warming up CPU context...",
        },
      });

      const nCtx = Math.max(1024, this.plugin.settings.localContextSize || 2048);
      const nThreads = window.crossOriginIsolated
        ? Math.max(1, this.plugin.settings.localCpuThreads || 4)
        : 1;

      await this.sendLoadCommand(nCtx, nThreads);

      updateLocalAIState({
        status: "ready",
        statusMessage: `Ready (${fileName}, CPU ${nThreads}T, ${nCtx} ctx)`,
        loadProgress: null,
        downloadProgress: null,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[LocalAI] Initialization failed:", error);
      updateLocalAIState({
        status: "error",
        statusMessage: `Error: ${message}`,
        downloadProgress: null,
        loadProgress: null,
        error: message,
      });
      throw error;
    }
  }

  private streamFileChunksToWorker(
    filePath: string,
    totalChunks: number,
    onChunkSent: (sentCount: number) => void,
    nextIndex: () => number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, {
        highWaterMark: MODEL_CHUNK_BYTES,
      });
      let sent = 0;

      stream.on("data", (chunk: Buffer) => {
        const ab = chunk.buffer.slice(
          chunk.byteOffset,
          chunk.byteOffset + chunk.byteLength
        ) as ArrayBuffer;
        const idx = nextIndex();
        this.postToWorker(
          {
            type: "model-chunk",
            buffer: ab,
            chunkIndex: idx,
            totalChunks,
          },
          [ab]
        );
        sent++;
        onChunkSent(sent);
      });

      stream.on("error", (err) => reject(err));
      stream.on("end", () => resolve());
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const workerPath = path.join(
      this.downloader.getPluginDir(),
      "ai-worker.js"
    );
    if (!fs.existsSync(workerPath)) {
      throw new Error(
        `Missing local AI worker at ${workerPath}. Rebuild or reinstall the plugin.`
      );
    }

    const workerCode = fs.readFileSync(workerPath, "utf8");
    const workerBlobUrl = URL.createObjectURL(
      new Blob([workerCode], { type: "application/javascript" })
    );
    let worker: Worker;
    try {
      worker = new window.Worker(workerBlobUrl, {
        name: "para-companion-wllama",
      });
    } catch (error) {
      URL.revokeObjectURL(workerBlobUrl);
      throw error;
    }
    this.workerBlobUrl = workerBlobUrl;

    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event) => {
      const message = event.message || "AI Web Worker crashed.";
      logger.error("[LocalAI] Worker error:", event);
      updateLocalAIState({
        status: "error",
        statusMessage: `Worker error: ${message}`,
        error: message,
      });
      this.rejectAllPending(new Error(message));
    };

    this.worker = worker;
    return worker;
  }

  private postToWorker(
    message: WorkerInMessage,
    transfer: Transferable[] = []
  ): void {
    const worker = this.ensureWorker();
    worker.postMessage(message, transfer);
  }

  private sendLoadCommand(nCtx: number, nThreads: number): Promise<void> {
    const requestId = `load_${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      this.loadResolvers.set(requestId, { resolve, reject });
      this.postToWorker({
        type: "load",
        requestId,
        nCtx,
        nThreads,
      });
    });
  }

  private handleWorkerMessage(msg: WorkerOutMessage): void {
    switch (msg.type) {
      case "loaded": {
        const entry = this.loadResolvers.get(msg.requestId);
        if (entry) {
          this.loadResolvers.delete(msg.requestId);
          entry.resolve();
        }
        break;
      }
      case "unloaded": {
        const entry = this.loadResolvers.get(msg.requestId);
        if (entry) {
          this.loadResolvers.delete(msg.requestId);
          entry.resolve();
        }
        break;
      }
      case "token": {
        const req = this.pending.get(msg.requestId);
        if (!req) break;
        req.rawText += msg.text;
        req.tokenCount = msg.count;
        const clean = stripThinkingBlocks(req.rawText);
        if (clean.length > req.emittedCleanLength) {
          const deltaClean = clean.slice(req.emittedCleanLength);
          req.emittedCleanLength = clean.length;
          req.onToken?.(deltaClean, clean);
        }
        const elapsedSeconds = Math.max(
          0.001,
          (Date.now() - req.startedAt) / 1000
        );
        const tokensPerSecond = req.tokenCount / elapsedSeconds;
        const message = `PARA Companion: Thinking... (${req.tokenCount} tokens, ${tokensPerSecond.toFixed(1)} tok/s)`;
        if (req.progressNotice) {
          req.progressNotice.setMessage(message);
        } else {
          req.progressNotice = new Notice(message, 0);
        }
        break;
      }
      case "progress": {
        const req = this.pending.get(msg.requestId);
        if (!req) break;
        if (req.progressNotice) {
          req.progressNotice.setMessage(msg.message);
        } else {
          req.progressNotice = new Notice(msg.message, 0);
        }
        break;
      }
      case "done": {
        const req = this.pending.get(msg.requestId);
        if (!req) break;
        this.cleanupPending(msg.requestId, req);
        const clean = stripThinkingBlocks(msg.fullText || req.rawText).trim();
        req.resolve(clean);
        break;
      }
      case "error": {
        if (msg.requestId && this.loadResolvers.has(msg.requestId)) {
          const entry = this.loadResolvers.get(msg.requestId)!;
          this.loadResolvers.delete(msg.requestId);
          entry.reject(new Error(msg.error));
          break;
        }
        if (msg.requestId && this.pending.has(msg.requestId)) {
          const req = this.pending.get(msg.requestId)!;
          this.cleanupPending(msg.requestId, req);
          const err = new Error(msg.error);
          if (msg.aborted) {
            err.name = "AbortError";
          }
          req.reject(err);
          break;
        }
        updateLocalAIState({
          status: "error",
          statusMessage: msg.error,
          error: msg.error,
        });
        break;
      }
    }
  }

  private cleanupPending(requestId: string, req: PendingRequest): void {
    this.pending.delete(requestId);
    if (req.signal && req.abortHandler) {
      req.signal.removeEventListener("abort", req.abortHandler);
    }
    req.progressNotice?.hide();
  }

  private rejectAllPending(err: Error): void {
    for (const [id, entry] of this.loadResolvers) {
      this.loadResolvers.delete(id);
      entry.reject(err);
    }
    for (const [id, req] of this.pending) {
      this.cleanupPending(id, req);
      req.reject(err);
    }
  }

  cancelDownload(): void {
    this.downloader.cancelDownload();
    updateLocalAIState({
      status: "uninitialized",
      statusMessage: "Download cancelled",
      downloadProgress: null,
    });
  }

  async deleteModel(): Promise<void> {
    await this.unload();
    const fileName =
      this.plugin.settings.localModelFileName || DEFAULT_LOCAL_MODEL_FILENAME;
    await this.downloader.deleteModel(fileName);
    this.refreshFileStatus();
    new Notice("Local AI model deleted from disk.", 4000);
  }

  async reload(): Promise<void> {
    await this.unload();
    await this.initialize({ autoDownload: true });
  }

  async unload(): Promise<void> {
    this.downloader.cancelDownload();
    this.rejectAllPending(new Error("Local AI unloaded"));

    if (this.worker) {
      const requestId = `unload_${++this.requestCounter}`;
      try {
        await new Promise<void>((resolve, reject) => {
          this.loadResolvers.set(requestId, { resolve, reject });
          this.postToWorker({ type: "unload", requestId });
        });
      } catch (error) {
        logger.warn("[LocalAI] Worker unload failed:", error);
      }
      this.worker.terminate();
      this.worker = null;
    }

    if (this.workerBlobUrl) {
      URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;
    }

    updateLocalAIState({
      status: "uninitialized",
      loadProgress: null,
      downloadProgress: null,
    });
    this.refreshFileStatus();
  }

  async streamGenerate(
    messages: ChatMLMessage[],
    options: GenerateOptions = {},
    onToken?: (delta: string, fullCleanText: string) => void
  ): Promise<string> {
    if (options.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    await this.ensureReady();

    const task = this.generationQueue.then(() =>
      this.executeGenerate(messages, options, onToken)
    );
    this.generationQueue = task.catch(() => {});
    return task;
  }

  async generateText(
    messages: ChatMLMessage[],
    options: GenerateOptions = {}
  ): Promise<string> {
    return this.streamGenerate(messages, options);
  }

  async generateJSON<T>(
    messages: ChatMLMessage[],
    options: GenerateOptions = {}
  ): Promise<T> {
    const raw = await this.generateText(messages, {
      temperature: 0.1,
      maxTokens: 768,
      ...options,
      suppressThinking: options.suppressThinking ?? true,
    });

    try {
      return parseJSONFromModelOutput<T>(raw);
    } catch (firstErr) {
      if (options.signal?.aborted) {
        throw firstErr;
      }
      logger.warn(
        "[LocalAI] First JSON parse attempt failed; retrying with stricter JSON reminder.",
        firstErr
      );
      const retryMessages: ChatMLMessage[] = [
        ...messages,
        { role: "assistant", content: raw.slice(0, 600) },
        {
          role: "user",
          content:
            "Your previous response was not valid JSON. Output ONLY a single valid JSON object matching the schema. Do not include markdown fences or any text before or after the JSON.",
        },
      ];
      const retryRaw = await this.generateText(retryMessages, {
        temperature: 0.05,
        maxTokens: options.maxTokens ?? 768,
        signal: options.signal,
        suppressThinking: true,
      });
      return parseJSONFromModelOutput<T>(retryRaw);
    }
  }

  private executeGenerate(
    messages: ChatMLMessage[],
    options: GenerateOptions,
    onToken?: (delta: string, fullCleanText: string) => void
  ): Promise<string> {
    if (options.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }

    const prompt = formatQwenChatML(
      messages,
      options.suppressThinking ?? true,
      options.assistantPrefill
    );
    const requestId = `gen_${++this.requestCounter}`;

    return new Promise((resolve, reject) => {
      const req: PendingRequest = {
        resolve,
        reject,
        onToken,
        rawText: "",
        emittedCleanLength: 0,
        tokenCount: 0,
        startedAt: Date.now(),
        signal: options.signal,
      };

      if (options.signal) {
        const abortHandler = () => {
          if (this.worker && this.pending.has(requestId)) {
            this.postToWorker({ type: "abort", requestId });
          }
        };
        req.abortHandler = abortHandler;
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.pending.set(requestId, req);

      this.postToWorker({
        type: "generate",
        requestId,
        prompt,
        maxTokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.1,
        topK: options.topK ?? 40,
        topP: options.topP ?? 0.9,
        stop: options.stop ?? QWEN_STOP_TOKENS,
      });
    });
  }
}
