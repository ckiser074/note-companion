import * as React from "react";
import { TFile, Notice } from "obsidian";
import FileOrganizer from "../../../index";

interface TranscriptionButtonProps {
  plugin: FileOrganizer;
  file: TFile;
  content: string;
}

const OFFLINE_AUDIO_DISABLED_MSG =
  "Audio transcription is disabled in 100% offline text-only mode (Qwen3-1.7B).";

export const TranscriptionButton: React.FC<TranscriptionButtonProps> = () => {
  const handleTranscribe = () => {
    new Notice(OFFLINE_AUDIO_DISABLED_MSG, 5000);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        className="flex items-center gap-2 bg-[--interactive-accent] text-[--text-on-accent] px-4 py-2 opacity-50 cursor-not-allowed"
        onClick={handleTranscribe}
        disabled={true}
        title={OFFLINE_AUDIO_DISABLED_MSG}
      >
        Transcribe Audio (Disabled Offline)
      </button>
      <div className="text-xs text-[--text-muted] px-1">
        {OFFLINE_AUDIO_DISABLED_MSG}
      </div>
    </div>
  );
};

