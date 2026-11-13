import { TFile } from "obsidian";
import FileOrganizer from "../../../index";
import { RecordingMetadata, MeetingMetadataManager } from "./meeting-metadata";

export interface TranscribeResult {
  success: boolean;
  transcript?: string;
  error?: string;
}

const OFFLINE_TRANSCRIPTION_DISABLED =
  "Audio transcription is disabled in 100% offline text-only mode (Qwen3-1.7B). Use an existing transcript file (.txt) or ScreenPipe transcripts.";

export class TranscribeHandler {
  static async transcribeRecording(
    _plugin: FileOrganizer,
    _recording: RecordingMetadata,
    _metadataManager?: MeetingMetadataManager
  ): Promise<TranscribeResult> {
    return {
      success: false,
      error: OFFLINE_TRANSCRIPTION_DISABLED,
    };
  }

  static async checkQuota(
    _plugin: FileOrganizer,
    _file: TFile
  ): Promise<{ allowed: boolean; error?: string }> {
    return {
      allowed: false,
      error: OFFLINE_TRANSCRIPTION_DISABLED,
    };
  }

  static async getAudioDuration(file: TFile): Promise<number> {
    // Estimate duration from file size
    // At 32kbps: ~0.23MB per minute
    const fileSizeInMB = file.stat.size / (1024 * 1024);
    return Math.ceil(fileSizeInMB / 0.23);
  }
}

