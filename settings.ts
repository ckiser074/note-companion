import type { InboxNotificationLevel } from "./inbox/notification-level";
import {
  DEFAULT_LOCAL_MODEL_FILENAME,
  DEFAULT_LOCAL_MODEL_ID,
  DEFAULT_LOCAL_MODEL_URL,
} from "./ai/model-downloader";
import { DEFAULT_PARA_ROOTS } from "./lib/para";

function getDefaultCpuThreads(): number {
  const hw =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(1, Math.floor(hw / 2));
}

export class FileOrganizerSettings {
  // Local embedded WASM inference settings
  localModelId = DEFAULT_LOCAL_MODEL_ID;
  localModelFileName = DEFAULT_LOCAL_MODEL_FILENAME;
  localModelUrl = DEFAULT_LOCAL_MODEL_URL;
  localCpuThreads = getDefaultCpuThreads();
  localContextSize = 2048;
  paraProjectsRoot = DEFAULT_PARA_ROOTS.project;
  paraAreasRoot = DEFAULT_PARA_ROOTS.area;
  paraResourcesRoot = DEFAULT_PARA_ROOTS.resource;
  paraArchivesRoot = DEFAULT_PARA_ROOTS.archive;
  autoCreateParaFolders = true;

  useLogs = true;
  defaultDestinationPath = "_NoteCompanion/Processed";
  referencePath = "_NoteCompanion/References";
  attachmentsPath = "_NoteCompanion/Processed/Attachments";
  pathToWatch = "_NoteCompanion/Inbox";
  logFolderPath = "_NoteCompanion/Logs";
  backupFolderPath = "_NoteCompanion/Backups";
  templatePaths = "_NoteCompanion/Templates";
  bypassedFilePath = "_NoteCompanion/Bypassed";
  errorFilePath = "_NoteCompanion/Errors";
  recordingsFolderPath = "Recordings";

  // inbox settings
  useSimilarTags = true;
  enableDocumentClassification = false;
  /** Template applied to inbox audio instead of AI classification ("none" = off). */
  audioDefaultTemplate = "none";
  /** Save recorder output into the inbox. */
  sendRecordingsToInbox = false;
  /** Template used to also create a study note (e.g. flash_cards) ("none" = off). */
  studyNoteTemplate = "none";
  enableFileRenaming = true;
  enableAttachmentProcessing = true;
  /** Cloud-only vision OCR is disabled in 100% offline text-only mode. */
  enableImageDescription = false;
  /** Cloud-only audio transcription is disabled in 100% offline text-only mode. */
  enableAudioTranscription = false;
  enablePdfTextExtraction = true;
  enableYouTubeTranscriptFetching = true;
  enableFolderRecommendation = true;
  enableBackupCreation = true;

  renameInstructions =
    "If document has a human readable name, use it. Otherwise, create a concise, descriptive name for the document based on its key content. Prioritize clarity and searchability, using specific terms that will make the document easy to find later. Avoid generic words and focus on unique, identifying elements.";
  useSimilarTagsInFrontmatter = true;
  enableAtomicNotes = false;
  ignoreFolders = [""];
  stagingFolder = ".notecompanion/staging";

  useFolderEmbeddings = false;
  useVaultTitles = true;
  customFolderInstructions = "";
  tagScoreThreshold = 70;
  formatBehavior: "override" | "newFile" | "append" = "override";
  useInbox = true;
  /** @internal One-time migration flag; see loadSettings() in index.ts. */
  useInboxMigrated = false;
  imageInstructions =
    "For handwriting and whiteboards, preserve line breaks and list structure.";
  debugMode = false;
  enableTitleSuggestions = false;
  chatMaxStepsPreference: "auto" | 3 | 5 = "auto";
  // use for sampling of the recommend functions
  contentCutoffChars = 1000;
  // use to prevent formatting of big file
  maxFormattingTokens = 100 * 1000;

  maxChatTokens = 100 * 1000;
  customTagInstructions =
    "Generate tags that capture the main topics, themes, and type of content in the document. Focus on specific, meaningful tags that will help with organization and retrieval.";
  hasRunOnboarding = false;
  /** Set once the onboarding wizard has been auto-opened, so it is never forced on the user twice. */
  hasShownOnboarding = false;
  pdfPageLimit = 10; // default to 10 pages
  /** @deprecated Use inboxNotificationLevel. Kept for settings migration only. */
  enableProcessingNotifications = true;
  inboxNotificationLevel: InboxNotificationLevel = "warning";
  enableScreenpipe = false; // Enable ScreenPipe integration for screen activity search (localhost:3030)
  screenpipeTimeRange = 4; // Default time range in hours for ScreenPipe searches (1-24)
  queryScreenpipeLimit = 10; // Default query limit for ScreenPipe searches (1-100)
}

export const DEFAULT_SETTINGS = new FileOrganizerSettings();

export function migrateLocalModelSettings(
  settings: FileOrganizerSettings,
  loaded: Partial<FileOrganizerSettings> | null
): boolean {
  const legacyFileName = "Qwen3-1.7B-Q4_K_M.gguf";
  const legacyModelId = "unsloth/Qwen3-1.7B-GGUF";
  const legacyModelUrl =
    "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf";
  const hasLegacyDefault =
    loaded?.localModelFileName === legacyFileName ||
    (!loaded?.localModelFileName &&
      (loaded?.localModelId === legacyModelId ||
        loaded?.localModelUrl === legacyModelUrl));

  if (!hasLegacyDefault) return false;

  settings.localModelId = DEFAULT_LOCAL_MODEL_ID;
  settings.localModelFileName = DEFAULT_LOCAL_MODEL_FILENAME;
  settings.localModelUrl = DEFAULT_LOCAL_MODEL_URL;
  return true;
}
