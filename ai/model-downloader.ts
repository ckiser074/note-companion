import { FileSystemAdapter, Notice, type App } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import type { IncomingMessage, ClientRequest } from "http";
import type { DownloadProgress } from "./types";

export const DEFAULT_LOCAL_MODEL_ID = "unsloth/Qwen3-1.7B-GGUF";
export const DEFAULT_LOCAL_MODEL_FILENAME = "Qwen3-1.7B-Q4_K_M.gguf";
export const DEFAULT_LOCAL_MODEL_URL =
  "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf";

const MAX_REDIRECTS = 6;

export interface LocalModelFileInfo {
  exists: boolean;
  path: string;
  sizeBytes: number;
}

export class ModelDownloader {
  private activeRequest: ClientRequest | null = null;
  private activeResponse: IncomingMessage | null = null;
  private activeStream: fs.WriteStream | null = null;
  private cancelled = false;

  constructor(
    private app: App,
    private pluginId: string
  ) {}

  getPluginDir(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error(
        "Local AI inference requires Obsidian Desktop with local filesystem access."
      );
    }
    return path.join(
      adapter.getBasePath(),
      this.app.vault.configDir,
      "plugins",
      this.pluginId
    );
  }

  getModelsDir(): string {
    return path.join(this.getPluginDir(), "models");
  }

  getModelFilePath(fileName = DEFAULT_LOCAL_MODEL_FILENAME): string {
    return path.join(this.getModelsDir(), fileName);
  }

  getWasmFilePath(): string {
    return path.join(this.getPluginDir(), "wasm", "wllama.wasm");
  }

  inspectModelFile(fileName = DEFAULT_LOCAL_MODEL_FILENAME): LocalModelFileInfo {
    const modelPath = this.getModelFilePath(fileName);
    try {
      if (fs.existsSync(modelPath)) {
        const stat = fs.statSync(modelPath);
        if (stat.isFile() && stat.size > 0) {
          return { exists: true, path: modelPath, sizeBytes: stat.size };
        }
      }
    } catch {
      // Ignore stat errors and report absent
    }
    return { exists: false, path: modelPath, sizeBytes: 0 };
  }

  cancelDownload(): void {
    this.cancelled = true;
    try {
      this.activeRequest?.destroy(new Error("Download cancelled by user"));
    } catch {
      // ignore
    }
    try {
      this.activeResponse?.destroy();
    } catch {
      // ignore
    }
    try {
      this.activeStream?.destroy();
    } catch {
      // ignore
    }
    this.activeRequest = null;
    this.activeResponse = null;
    this.activeStream = null;
  }

  async deleteModel(fileName = DEFAULT_LOCAL_MODEL_FILENAME): Promise<void> {
    const target = this.getModelFilePath(fileName);
    const partPath = `${target}.part`;
    for (const p of [partPath, target]) {
      if (fs.existsSync(p)) {
        await fs.promises.unlink(p);
      }
    }
  }

  async downloadModel(
    url: string,
    fileName = DEFAULT_LOCAL_MODEL_FILENAME,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    this.cancelled = false;
    const modelsDir = this.getModelsDir();
    await fs.promises.mkdir(modelsDir, { recursive: true });

    const destPath = this.getModelFilePath(fileName);
    const existing = this.inspectModelFile(fileName);
    if (existing.exists) {
      return destPath;
    }

    const partPath = `${destPath}.part`;
    if (fs.existsSync(partPath)) {
      await fs.promises.unlink(partPath);
    }

    new Notice(
      `Downloading ${fileName} (~1.1 GB) for offline AI. You can track progress in Settings.`,
      6000
    );

    try {
      await this.streamDownloadWithRedirects(url, partPath, 0, onProgress);
      await fs.promises.rename(partPath, destPath);
      new Notice(`Local AI model ready: ${fileName}`, 5000);
      return destPath;
    } catch (error) {
      try {
        if (fs.existsSync(partPath)) {
          await fs.promises.unlink(partPath);
        }
      } catch {
        // ignore cleanup failure
      }
      if (this.cancelled) {
        new Notice("Local AI model download cancelled.", 4000);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Failed to download local AI model: ${message}`, 7000);
      }
      throw error;
    } finally {
      this.activeRequest = null;
      this.activeResponse = null;
      this.activeStream = null;
    }
  }

  private streamDownloadWithRedirects(
    targetUrl: string,
    partPath: string,
    redirectCount: number,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.cancelled) {
        reject(new Error("Download cancelled by user"));
        return;
      }
      if (redirectCount > MAX_REDIRECTS) {
        reject(new Error("Too many HTTP redirects while downloading model."));
        return;
      }

      const parsedUrl = new URL(targetUrl);
      const client = parsedUrl.protocol === "http:" ? http : https;

      const req = client.get(
        parsedUrl,
        {
          headers: {
            "User-Agent": "Obsidian-PARA-Companion-LocalAI/1.0",
          },
        },
        (res) => {
          this.activeResponse = res;
          const status = res.statusCode ?? 0;

          if (
            (status === 301 ||
              status === 302 ||
              status === 303 ||
              status === 307 ||
              status === 308) &&
            res.headers.location
          ) {
            res.resume();
            const nextUrl = new URL(res.headers.location, parsedUrl).toString();
            this.streamDownloadWithRedirects(
              nextUrl,
              partPath,
              redirectCount + 1,
              onProgress
            )
              .then(resolve)
              .catch(reject);
            return;
          }

          if (status < 200 || status >= 300) {
            res.resume();
            reject(
              new Error(`Model download failed with HTTP status ${status}.`)
            );
            return;
          }

          const totalBytes = parseInt(
            String(res.headers["content-length"] ?? "0"),
            10
          );
          let downloadedBytes = 0;
          const startTime = Date.now();
          let lastEmit = 0;

          const fileStream = fs.createWriteStream(partPath);
          this.activeStream = fileStream;

          const cleanupOnError = (err: Error) => {
            res.destroy();
            fileStream.destroy();
            reject(err);
          };

          res.on("data", (chunk: Buffer) => {
            if (this.cancelled) {
              cleanupOnError(new Error("Download cancelled by user"));
              return;
            }
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (now - lastEmit >= 120 || downloadedBytes === totalBytes) {
              lastEmit = now;
              const elapsedSec = Math.max(0.1, (now - startTime) / 1000);
              const percent =
                totalBytes > 0
                  ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                  : 0;
              onProgress?.({
                downloadedBytes,
                totalBytes,
                percent,
                bytesPerSecond: Math.round(downloadedBytes / elapsedSec),
              });
            }
          });

          res.on("error", (err) => cleanupOnError(err));
          fileStream.on("error", (err) => cleanupOnError(err));
          fileStream.on("finish", () => {
            onProgress?.({
              downloadedBytes,
              totalBytes: totalBytes || downloadedBytes,
              percent: 100,
              bytesPerSecond: 0,
            });
            resolve();
          });

          res.pipe(fileStream);
        }
      );

      this.activeRequest = req;
      req.on("error", (err) => {
        if (this.cancelled) {
          reject(new Error("Download cancelled by user"));
        } else {
          reject(err);
        }
      });
    });
  }
}
