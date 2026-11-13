import React from "react";
import FileOrganizer from "../../index";
import { LocalAIPanel } from "./local-ai-panel";

interface GeneralTabProps {
  plugin: FileOrganizer;
}

export const GeneralTab: React.FC<GeneralTabProps> = ({ plugin }) => {
  return (
    <div className="file-organizer-settings space-y-6">
      <LocalAIPanel plugin={plugin} />

      <div className="bg-[--background-primary-alt] p-4 rounded-lg border border-[--background-modifier-border]">
        <h3 className="text-lg font-medium mb-2 mt-0">Privacy &amp; Offline Execution</h3>
        <p className="text-sm text-[--text-muted] m-0">
          All note tagging, folder recommendations, renaming, formatting, and
          chat tool calls execute locally on your CPU inside Obsidian. Your
          notes never leave your device.
        </p>
      </div>
    </div>
  );
};
