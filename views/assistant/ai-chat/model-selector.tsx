import React, { useEffect } from "react";
import { usePlugin } from "../provider";
import { useLocalAIState } from "../../../ai/local-ai-store";

interface ModelSelectorProps {
  selectedModel?: string;
  onModelSelect?: (model: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = () => {
  const plugin = usePlugin();
  const aiState = useLocalAIState();

  useEffect(() => {
    plugin.localAI?.refreshFileStatus();
  }, [plugin]);

  const isBusy =
    aiState.status === "downloading" || aiState.status === "loading";

  const statusText =
    aiState.status === "ready"
      ? "Ready"
      : aiState.status === "downloading"
      ? `Downloading ${aiState.downloadProgress?.percent ?? 0}%`
      : aiState.status === "loading"
      ? `Loading ${aiState.loadProgress?.percent ?? 0}%`
      : aiState.status === "error"
      ? "Error"
      : aiState.modelExists
      ? "Cached"
      : "Not Initialized";

  const dotClass =
    aiState.status === "ready"
      ? "bg-[--text-success]"
      : aiState.status === "error"
      ? "bg-[--text-error]"
      : isBusy
      ? "bg-[--interactive-accent] animate-pulse"
      : "bg-[--text-muted]";

  return (
    <div className="flex items-center gap-2 text-xs text-[--text-muted]">
      <span className="inline-flex items-center gap-1.5" title={aiState.statusMessage}>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span>Qwen3-1.7B (Local CPU)</span>
        <span className="opacity-75">· {statusText}</span>
      </span>
      {aiState.status !== "ready" && !isBusy && (
        <button
          type="button"
          onClick={() => {
            void plugin.localAI?.initialize({ autoDownload: true });
          }}
          className="px-1.5 py-0.5 text-[11px] rounded border border-[--background-modifier-border] hover:bg-[--background-modifier-hover] text-[--text-normal]"
        >
          Initialize
        </button>
      )}
    </div>
  );
};

