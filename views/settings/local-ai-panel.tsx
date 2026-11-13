import React, { useEffect } from "react";
import { Notice, type Setting } from "obsidian";
import type FileOrganizer from "../../index";
import { localAIStore, useLocalAIState } from "../../ai/local-ai-store";

interface LocalAIPanelProps {
  plugin: FileOrganizer;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "";
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

export const LocalAIPanel: React.FC<LocalAIPanelProps> = ({ plugin }) => {
  const aiState = useLocalAIState();
  const [cpuThreads, setCpuThreads] = React.useState(
    plugin.settings.localCpuThreads
  );
  const [contextSize, setContextSize] = React.useState(
    plugin.settings.localContextSize
  );

  const maxThreads =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 16;

  useEffect(() => {
    plugin.localAI?.refreshFileStatus();
  }, [plugin]);

  const isBusy =
    aiState.status === "downloading" || aiState.status === "loading";

  const statusBadgeClass =
    aiState.status === "ready"
      ? "bg-[--background-modifier-success] text-[--text-success] border-[--text-success]"
      : aiState.status === "error"
      ? "bg-[--background-modifier-error] text-[--text-error] border-[--text-error]"
      : aiState.status === "downloading" || aiState.status === "loading"
      ? "bg-[--background-secondary] text-[--text-accent] border-[--interactive-accent]"
      : "bg-[--background-secondary] text-[--text-muted] border-[--background-modifier-border]";

  const progressPercent = aiState.downloadProgress
    ? aiState.downloadProgress.percent
    : aiState.loadProgress
    ? aiState.loadProgress.percent
    : 0;

  return (
    <div className="space-y-6">
      <div className="bg-[--background-primary-alt] p-4 rounded-lg border border-[--background-modifier-border] space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium mb-1 mt-0 text-[--text-normal]">
              Local AI Engine (100% Offline CPU)
            </h3>
            <p className="text-sm text-[--text-muted] m-0">
              Runs Qwen3-1.7B (Q4_K_M GGUF) inside an isolated WebAssembly CPU
              worker via <code>@wllama/wllama</code>. Zero external servers or
              API keys required.
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded text-xs font-medium border shrink-0 ${statusBadgeClass}`}
          >
            {aiState.status === "ready"
              ? "Ready"
              : aiState.status === "downloading"
              ? "Downloading"
              : aiState.status === "loading"
              ? "Loading WASM"
              : aiState.status === "error"
              ? "Error"
              : aiState.modelExists
              ? "Downloaded"
              : "Not Initialized"}
          </span>
        </div>

        <div className="p-3 bg-[--background-secondary] rounded border border-[--background-modifier-border] text-xs space-y-1">
          <div className="flex justify-between gap-2">
            <span className="text-[--text-muted]">Model:</span>
            <span className="font-mono text-[--text-normal]">
              {aiState.modelFileName}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[--text-muted]">Status:</span>
            <span className="text-[--text-normal]">{aiState.statusMessage}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[--text-muted]">Disk cache:</span>
            <span className="text-[--text-normal]">
              {aiState.modelExists
                ? formatBytes(aiState.modelSizeBytes)
                : "Not downloaded (~1.1 GB on first run)"}
            </span>
          </div>
          {aiState.modelPath && (
            <div className="flex justify-between gap-2">
              <span className="text-[--text-muted]">Local path:</span>
              <span
                className="font-mono text-[--text-muted] truncate max-w-[340px]"
                title={aiState.modelPath}
              >
                {aiState.modelPath}
              </span>
            </div>
          )}
        </div>

        {(aiState.downloadProgress || aiState.loadProgress) && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-[--text-muted]">
              <span>
                {aiState.downloadProgress
                  ? `Downloading ${formatBytes(
                      aiState.downloadProgress.downloadedBytes
                    )} / ${
                      aiState.downloadProgress.totalBytes > 0
                        ? formatBytes(aiState.downloadProgress.totalBytes)
                        : "..."
                    } ${formatSpeed(aiState.downloadProgress.bytesPerSecond)}`
                  : aiState.loadProgress?.message}
              </span>
              <span className="font-mono">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 rounded bg-[--background-modifier-border] overflow-hidden">
              <div
                className="h-full bg-[--interactive-accent] transition-all duration-150"
                style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
              />
            </div>
          </div>
        )}

        {aiState.error && (
          <div className="p-2.5 rounded text-xs text-[--text-error] bg-[--background-secondary] border border-[--text-error]">
            {aiState.error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {aiState.status === "downloading" ? (
            <button
              onClick={() => plugin.localAI.cancelDownload()}
              className="px-3 py-1.5 rounded border border-[--background-modifier-border] bg-[--background-secondary] text-[--text-normal] hover:bg-[--background-modifier-hover]"
            >
              Cancel Download
            </button>
          ) : (
            <button
              disabled={isBusy}
              onClick={() => {
                void (aiState.status === "ready"
                  ? plugin.localAI.reload()
                  : plugin.localAI.initialize({ autoDownload: true }));
              }}
              className="bg-[--interactive-accent] text-[--text-on-accent] px-4 py-1.5 rounded hover:bg-[--interactive-accent-hover] disabled:opacity-50"
            >
              {aiState.status === "ready"
                ? "Reload Local AI"
                : aiState.modelExists
                ? "Load Local AI"
                : "Download & Initialize Local AI"}
            </button>
          )}

          {aiState.status === "ready" && (
            <button
              onClick={() => {
                void plugin.localAI.unload();
              }}
              className="px-3 py-1.5 rounded border border-[--background-modifier-border] bg-[--background-secondary] text-[--text-normal] hover:bg-[--background-modifier-hover]"
            >
              Unload Model
            </button>
          )}

          {aiState.modelExists && !isBusy && (
            <button
              onClick={() => {
                void plugin.localAI
                  .deleteModel()
                  .then(() => plugin.localAI.initialize({ autoDownload: true }))
                  .catch((error) => {
                    const message =
                      error instanceof Error ? error.message : String(error);
                    new Notice(`Could not redownload local model: ${message}`, 7000);
                  });
              }}
              className="px-3 py-1.5 rounded border border-[--background-modifier-border] text-[--text-error] hover:bg-[--background-modifier-hover]"
            >
              Redownload Model
            </button>
          )}
        </div>
      </div>

      <div className="bg-[--background-primary-alt] p-4 rounded-lg border border-[--background-modifier-border] space-y-4">
        <h3 className="text-lg font-medium mb-1 mt-0 text-[--text-normal]">
          CPU &amp; Context Controls
        </h3>

        <div className="setting-item border-0 p-0">
          <div className="setting-item-info">
            <div className="setting-item-name">
              CPU Threads ({cpuThreads})
            </div>
            <div className="setting-item-description">
              Number of CPU threads allocated to the wllama WASM runtime. Reload
              the model after changing.
            </div>
          </div>
          <div className="setting-item-control flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={maxThreads}
              step={1}
              value={cpuThreads}
              onChange={(e) => {
                const value = Math.max(1, parseInt(e.target.value, 10) || 1);
                setCpuThreads(value);
                plugin.settings.localCpuThreads = value;
                void plugin.saveSettings();
              }}
            />
            <span className="font-mono text-sm w-6 text-right">
              {cpuThreads}
            </span>
          </div>
        </div>

        <div className="setting-item border-t border-[--background-modifier-border] pt-4 pb-0 px-0">
          <div className="setting-item-info">
            <div className="setting-item-name">Context Size (num_ctx)</div>
            <div className="setting-item-description">
              Token context window for local inference (default: 4096). Larger
              values use more RAM. Reload the model after changing.
            </div>
          </div>
          <div className="setting-item-control">
            <select
              className="px-2 py-1.5 bg-[--background-primary] border border-[--background-modifier-border] rounded text-[--text-normal]"
              value={String(contextSize)}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10) || 4096;
                setContextSize(value);
                plugin.settings.localContextSize = value;
                void plugin.saveSettings();
              }}
            >
              <option value="2048">2048</option>
              <option value="4096">4096 (default)</option>
              <option value="8192">8192</option>
              <option value="16384">16384</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Imperative row renderer for Obsidian 1.13+ declarative Settings UI.
 */
export function renderLocalAIStatusRow(
  plugin: FileOrganizer,
  setting: Setting
): () => void {
  const descEl = setting.descEl;
  const controlEl = setting.controlEl;

  const progressBarContainer = descEl.createDiv({
    cls: "mt-2 hidden",
  });
  const progressBarTrack = progressBarContainer.createDiv({
    cls: "w-full h-2 rounded bg-[--background-modifier-border] overflow-hidden",
  });
  const progressBarFill = progressBarTrack.createDiv({
    cls: "h-full bg-[--interactive-accent]",
  });

  const actionBtn = controlEl.createEl("button", {
    text: "Download & Initialize Local AI",
    cls: "mod-cta",
  });

  const secondaryBtn = controlEl.createEl("button", {
    text: "Delete",
    cls: "hidden ml-2",
  });

  const renderState = () => {
    const state = localAIStore.getState();
    const isBusy =
      state.status === "downloading" || state.status === "loading";

    setting.setName(`Local AI Model (${state.modelFileName})`);

    if (state.status === "downloading" && state.downloadProgress) {
      descEl.firstChild &&
        (descEl.firstChild.textContent = `${state.statusMessage} (${formatBytes(
          state.downloadProgress.downloadedBytes
        )} / ${formatBytes(state.downloadProgress.totalBytes)})`);
      progressBarContainer.removeClass("hidden");
      progressBarFill.style.width = `${state.downloadProgress.percent}%`;
      actionBtn.textContent = "Cancel Download";
      actionBtn.disabled = false;
      secondaryBtn.addClass("hidden");
    } else if (state.status === "loading" && state.loadProgress) {
      setting.setDesc(state.loadProgress.message);
      descEl.appendChild(progressBarContainer);
      progressBarContainer.removeClass("hidden");
      progressBarFill.style.width = `${state.loadProgress.percent}%`;
      actionBtn.textContent = "Loading...";
      actionBtn.disabled = true;
      secondaryBtn.addClass("hidden");
    } else {
      progressBarContainer.addClass("hidden");
      const sizeStr = state.modelExists
        ? `Cached on disk (${formatBytes(state.modelSizeBytes)}).`
        : "Not downloaded (~1.1 GB on first run).";
      setting.setDesc(
        `${state.statusMessage}. ${sizeStr}${state.error ? ` Error: ${state.error}` : ""}`
      );
      descEl.appendChild(progressBarContainer);
      actionBtn.disabled = isBusy;
      actionBtn.textContent =
        state.status === "ready"
          ? "Reload Local AI"
          : state.modelExists
          ? "Load Local AI"
          : "Download & Initialize Local AI";
      if (state.modelExists) {
        secondaryBtn.removeClass("hidden");
      } else {
        secondaryBtn.addClass("hidden");
      }
    }
  };

  actionBtn.addEventListener("click", () => {
    const state = localAIStore.getState();
    if (state.status === "downloading") {
      plugin.localAI?.cancelDownload();
    } else if (state.status === "ready") {
      void plugin.localAI?.reload();
    } else {
      void plugin.localAI?.initialize({ autoDownload: true });
    }
  });

  secondaryBtn.addEventListener("click", () => {
    void plugin.localAI
      .deleteModel()
      .then(() => plugin.localAI.initialize({ autoDownload: true }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Could not redownload local model: ${message}`, 7000);
      });
  });

  plugin.localAI?.refreshFileStatus();
  renderState();
  const unsubscribe = localAIStore.subscribe(renderState);
  return () => {
    unsubscribe();
  };
}
