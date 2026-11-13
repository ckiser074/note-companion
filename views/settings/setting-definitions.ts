import type { Setting } from "obsidian";
import type FileOrganizer from "../../index";
import { renderChatStepsRow } from "./chat-steps-row";
import { renderLocalAIStatusRow } from "./local-ai-panel";
import {
  AUDIO_TEMPLATE_OFF,
  listAudioTemplateNames,
} from "../../inbox/audio-template";
import { STUDY_NOTE_OFF } from "../../inbox/study-note";

type SettingControl = {
  type: string;
  key: string;
  [option: string]: unknown;
};

export type ParaCompanionSettingDefinition = {
  name?: string;
  desc?: string;
  aliases?: string[];
  control?: SettingControl;
  render?: (setting: Setting) => void | (() => void);
  covers?: string[];
  visible?: () => boolean;
  type?: "group" | "page" | "list";
  heading?: string;
  items?: ParaCompanionSettingDefinition[];
};

export function getParaCompanionSettingDefinitions(
  plugin: FileOrganizer
): ParaCompanionSettingDefinition[] {
  const settings = plugin.settings;
  const maxThreads =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 16;

  const audioTemplateOptions: Record<string, string> = {
    [AUDIO_TEMPLATE_OFF]: "Off (use auto-formatting rules)",
  };
  for (const name of listAudioTemplateNames(
    plugin.app,
    settings.templatePaths
  )) {
    audioTemplateOptions[name] = name;
  }
  if (
    settings.audioDefaultTemplate &&
    !(settings.audioDefaultTemplate in audioTemplateOptions)
  ) {
    audioTemplateOptions[settings.audioDefaultTemplate] =
      `${settings.audioDefaultTemplate} (missing)`;
  }

  const studyNoteOptions: Record<string, string> = { [STUDY_NOTE_OFF]: "Off" };
  for (const name of listAudioTemplateNames(
    plugin.app,
    settings.templatePaths
  )) {
    studyNoteOptions[name] = name;
  }
  if (
    settings.studyNoteTemplate &&
    !(settings.studyNoteTemplate in studyNoteOptions)
  ) {
    studyNoteOptions[settings.studyNoteTemplate] =
      `${settings.studyNoteTemplate} (missing)`;
  }

  return [
    {
      type: "page",
      name: "General",
      desc: "Local AI model status, CPU threads, and context size.",
      items: [
        {
          type: "group",
          heading: "Local AI Engine",
          items: [
            {
              name: "Local AI Model",
              desc: "Manage Qwen3-0.6B GGUF weights and offline CPU inference.",
              aliases: ["model", "wllama", "download", "local ai"],
              render: (setting) => renderLocalAIStatusRow(plugin, setting),
            },
            {
              name: "CPU threads",
              desc: "Number of CPU threads allocated to local inference. Reload model after changing.",
              aliases: ["threads", "cpu"],
              control: {
                type: "slider",
                key: "localCpuThreads",
                min: 1,
                max: maxThreads,
                step: 1,
              },
            },
            {
              name: "Context size (num_ctx)",
              desc: "Context window tokens for local inference (default 2048). Reload model after changing.",
              aliases: ["context", "num_ctx"],
              control: {
                type: "dropdown",
                key: "localContextSize",
                defaultValue: "2048",
                options: {
                  "2048": "2048 (default)",
                  "4096": "4096",
                  "8192": "8192",
                  "16384": "16384",
                },
              },
            },
          ],
        },
      ],
    },
    {
      type: "page",
      name: "PARA Organization",
      desc: "Configure the four PARA folder roots and automatic folder creation.",
      items: [
        {
          name: "Projects root folder",
          control: { type: "text", key: "paraProjectsRoot" },
        },
        {
          name: "Areas root folder",
          control: { type: "text", key: "paraAreasRoot" },
        },
        {
          name: "Resources root folder",
          control: { type: "text", key: "paraResourcesRoot" },
        },
        {
          name: "Archives root folder",
          control: { type: "text", key: "paraArchivesRoot" },
        },
        {
          name: "Create PARA root folders automatically",
          control: { type: "toggle", key: "autoCreateParaFolders" },
        },
      ],
    },
    {
      type: "page",
      name: "Organization Preferences",
      desc: "Inbox processing, tagging, renaming, and formatting.",
      items: [
        {
          type: "group",
          heading: "Inbox processing",
          items: [
            {
              name: "Use inbox",
              desc: 'Automatically process files dropped into or created in the inbox folder. Turn off to only process files when you run "Process inbox now".',
              control: { type: "toggle", key: "useInbox" },
            },
            {
              name: "Process attachments through inbox",
              control: { type: "toggle", key: "enableAttachmentProcessing" },
            },
            {
              name: "Extract text from PDF files",
              desc: "Extracts text locally using pdf.js.",
              visible: () => settings.enableAttachmentProcessing,
              control: { type: "toggle", key: "enablePdfTextExtraction" },
            },
            {
              name: "Automatically fetch YouTube transcripts",
              control: {
                type: "toggle",
                key: "enableYouTubeTranscriptFetching",
              },
            },
            {
              name: "Automatically move files to recommended folders",
              control: { type: "toggle", key: "enableFolderRecommendation" },
            },
            {
              name: "Inbox auto-renaming",
              control: { type: "toggle", key: "enableFileRenaming" },
            },
            {
              name: "Inbox auto-formatting",
              control: { type: "toggle", key: "enableDocumentClassification" },
            },
            {
              name: "Send recordings to inbox",
              desc: "Save recordings from the Meetings recorder into the inbox folder.",
              visible: () => settings.useInbox,
              control: { type: "toggle", key: "sendRecordingsToInbox" },
            },
            {
              name: "Audio default template",
              desc: "Default template applied to audio files when inbox rules match.",
              control: {
                type: "dropdown",
                key: "audioDefaultTemplate",
                defaultValue: AUDIO_TEMPLATE_OFF,
                options: audioTemplateOptions,
              },
            },
            {
              name: "Study note from recordings",
              desc: "Optional template used to create a linked study note.",
              control: {
                type: "dropdown",
                key: "studyNoteTemplate",
                defaultValue: STUDY_NOTE_OFF,
                options: studyNoteOptions,
              },
            },
            {
              name: "Inbox similar tags",
              control: { type: "toggle", key: "useSimilarTags" },
            },
            {
              name: "Inbox notification level",
              control: {
                type: "dropdown",
                key: "inboxNotificationLevel",
                defaultValue: "warning",
                options: {
                  silent: "Silent",
                  error: "Errors only",
                  warning: "Warnings",
                  info: "Info",
                  debug: "Debug",
                },
              },
            },
          ],
        },
        {
          type: "group",
          heading: "Tags and titles",
          items: [
            {
              name: "Use similar tags in frontmatter",
              control: { type: "toggle", key: "useSimilarTagsInFrontmatter" },
            },
            {
              name: "Use vault titles",
              control: { type: "toggle", key: "useVaultTitles" },
            },
            {
              name: "Custom tag instructions",
              control: {
                type: "textarea",
                key: "customTagInstructions",
                rows: 3,
              },
            },
            {
              name: "Rename instructions",
              control: {
                type: "textarea",
                key: "renameInstructions",
                rows: 3,
              },
            },
            {
              name: "Custom folder instructions",
              control: {
                type: "textarea",
                key: "customFolderInstructions",
                rows: 3,
              },
            },
          ],
        },
      ],
    },
    {
      type: "page",
      name: "Vault Access",
      desc: "Inbox, output folders, templates, and ignored paths.",
      items: [
        {
          name: "Inbox folder",
          aliases: ["path to watch", "watch folder"],
          control: { type: "folder", key: "pathToWatch" },
        },
        {
          name: "Default destination folder",
          control: { type: "folder", key: "defaultDestinationPath" },
        },
        {
          name: "Attachments folder",
          control: { type: "folder", key: "attachmentsPath" },
        },
        {
          name: "Log folder",
          control: { type: "folder", key: "logFolderPath" },
        },
        {
          name: "Backup folder",
          control: { type: "folder", key: "backupFolderPath" },
        },
        {
          name: "Template folder",
          control: { type: "folder", key: "templatePaths" },
        },
        {
          name: "Bypassed files folder",
          control: { type: "folder", key: "bypassedFilePath" },
        },
        {
          name: "Error files folder",
          control: { type: "folder", key: "errorFilePath" },
        },
        {
          name: "Recordings folder",
          control: { type: "folder", key: "recordingsFolderPath" },
        },
      ],
    },
    {
      type: "page",
      name: "Experiment",
      desc: "Experimental features and chat limits.",
      items: [
        {
          name: "Enable atomic notes",
          control: { type: "toggle", key: "enableAtomicNotes" },
        },
        {
          name: "Enable title suggestions",
          control: { type: "toggle", key: "enableTitleSuggestions" },
        },
        {
          name: "Chat tool rounds",
          desc: "How much the assistant can do per message before replying.",
          aliases: ["max steps", "chat steps"],
          covers: ["chatMaxStepsPreference"],
          render: (setting) => renderChatStepsRow(plugin, setting),
        },
        {
          name: "Enable ScreenPipe integration",
          control: { type: "toggle", key: "enableScreenpipe" },
        },
        {
          name: "ScreenPipe time range (hours)",
          visible: () => settings.enableScreenpipe,
          control: {
            type: "number",
            key: "screenpipeTimeRange",
            min: 1,
            max: 24,
          },
        },
        {
          name: "ScreenPipe query limit",
          visible: () => settings.enableScreenpipe,
          control: {
            type: "number",
            key: "queryScreenpipeLimit",
            min: 1,
            max: 100,
          },
        },
      ],
    },
    {
      type: "page",
      name: "Advanced",
      desc: "Logging, debug mode, and local inference limits.",
      items: [
        {
          name: "Create backup before formatting",
          control: { type: "toggle", key: "enableBackupCreation" },
        },
        {
          name: "PARA Companion file logs",
          control: { type: "toggle", key: "useLogs" },
        },
        {
          name: "Debug mode",
          control: { type: "toggle", key: "debugMode" },
        },
        {
          name: "Content cutoff characters",
          control: {
            type: "number",
            key: "contentCutoffChars",
            min: 100,
            max: 100000,
          },
        },
        {
          name: "Max formatting tokens",
          control: {
            type: "number",
            key: "maxFormattingTokens",
            min: 1000,
            max: 500000,
          },
        },
        {
          name: "PDF page limit",
          control: {
            type: "number",
            key: "pdfPageLimit",
            min: 1,
            max: 100,
          },
        },
      ],
    },
  ];
}
