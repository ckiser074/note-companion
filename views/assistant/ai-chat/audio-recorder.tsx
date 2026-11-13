import React from "react";
import { Notice } from "obsidian";
import { Button } from "./button";
import { MicIcon } from "lucide-react";
import { cn } from "../../../lib/utils";

interface AudioRecorderProps {
  onTranscriptionComplete?: (text: string) => void;
  debug?: boolean;
}

const OFFLINE_VOICE_MSG =
  "Voice transcription is disabled in 100% offline text-only mode (Qwen3-0.6B).";

export const AudioRecorder: React.FC<AudioRecorderProps> = () => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    new Notice(OFFLINE_VOICE_MSG, 5000);
  };

  return (
    <div className="flex flex-col gap-4">
      <Button
        onClick={handleClick}
        className={cn(
          "bg-transparent opacity-40 cursor-not-allowed shadow-none"
        )}
        title={OFFLINE_VOICE_MSG}
        type="button"
      >
        <MicIcon className="w-4 h-4" />
      </Button>
    </div>
  );
};

