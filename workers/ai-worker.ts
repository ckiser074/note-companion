import { Wllama, CacheManager, WllamaAbortError } from "@wllama/wllama";
import type { WorkerInMessage, WorkerOutMessage } from "../ai/types";

const noopCacheBackend = {
  isSupported: () => true,
  read: async () => null,
  write: async () => {},
  getSize: async () => -1,
  list: async () => [],
  delete: async () => {},
};

let wasmBuffer: ArrayBuffer | null = null;
let wasmBlobUrl: string | null = null;
let modelChunks: ArrayBuffer[] = [];
let expectedChunks = 0;
let wllama: Wllama | null = null;
let activeAbortController: AbortController | null = null;
let activeRequestId: string | null = null;

function post(message: WorkerOutMessage): void {
  self.postMessage(message);
}

async function handleLoad(
  requestId: string,
  nCtx: number,
  nThreads: number
): Promise<void> {
  if (!wasmBuffer) {
    throw new Error("WASM binary was not transferred to the AI worker.");
  }
  if (modelChunks.length === 0) {
    throw new Error("GGUF model data was not transferred to the AI worker.");
  }
  if (expectedChunks > 0 && modelChunks.length !== expectedChunks) {
    throw new Error(
      `Incomplete model transfer: received ${modelChunks.length} of ${expectedChunks} chunks.`
    );
  }

  if (wllama) {
    await wllama.exit();
    wllama = null;
  }

  if (wasmBlobUrl) {
    URL.revokeObjectURL(wasmBlobUrl);
    wasmBlobUrl = null;
  }

  wasmBlobUrl = URL.createObjectURL(
    new Blob([wasmBuffer], { type: "application/wasm" })
  );
  // Release transferred raw buffers once turned into Blobs
  wasmBuffer = null;

  const modelBlob = new Blob(modelChunks, {
    type: "application/octet-stream",
  });
  modelChunks = [];
  expectedChunks = 0;

  const instance = new Wllama(
    { default: wasmBlobUrl },
    {
      suppressNativeLog: true,
      allowOffline: true,
      skipVersionCheck: true,
      cacheManager: new CacheManager([noopCacheBackend as never]),
    }
  );
  // Ensure @wllama/wllama never attempts CDN compat fetches
  instance.setCompat(null);

  await instance.loadModel([modelBlob], {
    n_ctx: nCtx,
    n_threads: nThreads,
    n_gpu_layers: 0,
    warmup: true,
  });

  wllama = instance;

  post({
    type: "loaded",
    requestId,
    nCtx,
    nThreads: instance.getNumThreads(),
    multithread: instance.isMultithread(),
  });
}

async function handleGenerate(msg: {
  requestId: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  stop: string[];
}): Promise<void> {
  if (!wllama || !wllama.isModelLoaded()) {
    throw new Error("Local AI model is not loaded.");
  }

  const controller = new AbortController();
  activeAbortController = controller;
  activeRequestId = msg.requestId;

  let fullText = "";

  try {
    const stream = await wllama.createCompletion({
      prompt: msg.prompt,
      max_tokens: msg.maxTokens,
      temperature: msg.temperature,
      top_p: msg.topP,
      stop: msg.stop,
      stream: true,
      abortSignal: controller.signal,
    });

    for await (const chunk of stream) {
      if (controller.signal.aborted) {
        throw new WllamaAbortError();
      }
      const delta = chunk.choices?.[0]?.text ?? "";
      if (delta) {
        fullText += delta;
        post({
          type: "token",
          requestId: msg.requestId,
          delta,
        });
      }
    }

    post({
      type: "done",
      requestId: msg.requestId,
      fullText,
    });
  } catch (err) {
    if (
      controller.signal.aborted ||
      err instanceof WllamaAbortError ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      post({
        type: "error",
        requestId: msg.requestId,
        error: "Generation aborted",
        aborted: true,
      });
      return;
    }
    throw err;
  } finally {
    if (activeRequestId === msg.requestId) {
      activeAbortController = null;
      activeRequestId = null;
    }
  }
}

async function handleUnload(requestId: string): Promise<void> {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    activeRequestId = null;
  }
  if (wllama) {
    await wllama.exit();
    wllama = null;
  }
  if (wasmBlobUrl) {
    URL.revokeObjectURL(wasmBlobUrl);
    wasmBlobUrl = null;
  }
  wasmBuffer = null;
  modelChunks = [];
  expectedChunks = 0;

  post({
    type: "unloaded",
    requestId,
  });
}

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "set-wasm": {
        wasmBuffer = msg.buffer;
        modelChunks = [];
        expectedChunks = 0;
        break;
      }
      case "model-chunk": {
        expectedChunks = msg.totalChunks;
        modelChunks[msg.chunkIndex] = msg.buffer;
        break;
      }
      case "load": {
        await handleLoad(msg.requestId, msg.nCtx, msg.nThreads);
        break;
      }
      case "generate": {
        await handleGenerate(msg);
        break;
      }
      case "abort": {
        if (activeRequestId === msg.requestId && activeAbortController) {
          activeAbortController.abort();
        }
        break;
      }
      case "unload": {
        await handleUnload(msg.requestId);
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const requestId = "requestId" in msg ? msg.requestId : undefined;
    post({
      type: "error",
      requestId,
      error: message,
    });
  }
};
