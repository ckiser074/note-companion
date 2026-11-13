import React, { useState, useEffect } from "react";
import type FileOrganizer from "../../index";
import type { InboxNotificationLevel } from "../../inbox/notification-level";
import {
  AUDIO_TEMPLATE_OFF,
  listAudioTemplateNames,
} from "../../inbox/audio-template";
import { STUDY_NOTE_OFF } from "../../inbox/study-note";

interface CustomizationTabProps {
  plugin: InstanceType<typeof FileOrganizer>;
}

export const CustomizationTab: React.FC<CustomizationTabProps> = ({
  plugin,
}) => {
  const [enableAttachmentProcessing, setEnableAttachmentProcessing] = useState(
    plugin.settings.enableAttachmentProcessing
  );
  const [enablePdfTextExtraction, setEnablePdfTextExtraction] = useState(
    plugin.settings.enablePdfTextExtraction
  );
  const [enableYouTubeTranscriptFetching, setEnableYouTubeTranscriptFetching] =
    useState(plugin.settings.enableYouTubeTranscriptFetching);
  const [enableFolderRecommendation, setEnableFolderRecommendation] = useState(
    plugin.settings.enableFolderRecommendation
  );
  const [enableFileRenaming, setEnableFileRenaming] = useState(
    plugin.settings.enableFileRenaming
  );
  const [renameInstructions, setRenameInstructions] = useState(
    plugin.settings.renameInstructions
  );
  const [useSimilarTags, setUseSimilarTags] = useState(
    plugin.settings.useSimilarTags
  );
  const [useSimilarTagsInFrontmatter, setUseSimilarTagsInFrontmatter] =
    useState(plugin.settings.useSimilarTagsInFrontmatter);
  const [useVaultTitles, setUseVaultTitles] = useState(
    plugin.settings.useVaultTitles
  );
  const [customFolderInstructions, setCustomFolderInstructions] = useState(
    plugin.settings.customFolderInstructions
  );
  const [enableDocumentClassification, setEnableDocumentClassification] =
    useState(plugin.settings.enableDocumentClassification);
  const [sendRecordingsToInbox, setSendRecordingsToInbox] = useState(
    plugin.settings.sendRecordingsToInbox
  );
  const [audioDefaultTemplate, setAudioDefaultTemplate] = useState(
    plugin.settings.audioDefaultTemplate || AUDIO_TEMPLATE_OFF
  );
  const [studyNoteTemplate, setStudyNoteTemplate] = useState(
    plugin.settings.studyNoteTemplate || STUDY_NOTE_OFF
  );
  const audioTemplateNames = listAudioTemplateNames(
    plugin.app,
    plugin.settings.templatePaths
  );
  const [customTagInstructions, setCustomTagInstructions] = useState(
    plugin.settings.customTagInstructions
  );
  const [inboxNotificationLevel, setInboxNotificationLevel] =
    useState<InboxNotificationLevel>(plugin.settings.inboxNotificationLevel);

  // force set user embeddings & cloud-only modalities to false in offline local mode
  useEffect(() => {
    let changed = false;
    if (plugin.settings.useFolderEmbeddings !== false) {
      plugin.settings.useFolderEmbeddings = false;
      changed = true;
    }
    if (plugin.settings.enableImageDescription !== false) {
      plugin.settings.enableImageDescription = false;
      changed = true;
    }
    if (plugin.settings.enableAudioTranscription !== false) {
      plugin.settings.enableAudioTranscription = false;
      changed = true;
    }
    if (changed) {
      void plugin.saveSettings();
    }
  }, []);

  const handleToggleChange = async (
    value: boolean,
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    settingKey: keyof typeof plugin.settings
  ) => {
    setter(value);
    (plugin.settings[settingKey] as boolean) = value;
    await plugin.saveSettings();
  };

  const handleTextChange = async (
    value: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    settingKey: keyof typeof plugin.settings
  ) => {
    setter(value);
    (plugin.settings[settingKey] as string) = value;
    await plugin.saveSettings();
  };

  return (
    <div className="p-4 space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4 text-[--text-normal]">
          Inbox Processing
        </h3>
        <div className="bg-[--background-secondary] p-4 rounded-lg mb-4">
          <div className="text-sm text-[--text-muted]">
            These settings control how new files are automatically handled when
            they enter your vault through the inbox. PDF text-layer extraction
            runs locally via pdf.js; image OCR and audio transcription are
            disabled in local text-only mode.
          </div>
        </div>
        <div className="space-y-4">
          <ToggleSetting
            name="Process Attachments Through Inbox"
            description="When disabled, PDF and media files are moved to the bypassed folder and are not processed."
            value={enableAttachmentProcessing}
            onChange={(value) => {
              void handleToggleChange(
                value,
                setEnableAttachmentProcessing,
                "enableAttachmentProcessing"
              );
            }}
          />
          {enableAttachmentProcessing && (
            <div className="ml-4 pl-4 border-l border-[--background-modifier-border] space-y-4">
              <ToggleSetting
                name="Extract Text from PDF Files"
                description="Extracts embedded text locally with pdf.js. When disabled, PDFs are still organized with an embed link."
                value={enablePdfTextExtraction}
                onChange={(value) => {
                  void handleToggleChange(
                    value,
                    setEnablePdfTextExtraction,
                    "enablePdfTextExtraction"
                  );
                }}
              />
              <div className="py-2 opacity-60">
                <div className="font-medium text-[--text-normal]">
                  Image OCR &amp; Audio Transcription (Disabled)
                </div>
                <div className="text-sm text-[--text-muted]">
                  Unavailable in 100% offline text-only mode (Qwen3-0.6B).
                </div>
              </div>
            </div>
          )}
          <ToggleSetting
            name="Automatically Fetch YouTube Video Transcripts"
            description="When disabled, YouTube URLs in documents are left unchanged during inbox processing."
            value={enableYouTubeTranscriptFetching}
            onChange={(value) => {
              void handleToggleChange(
                value,
                setEnableYouTubeTranscriptFetching,
                "enableYouTubeTranscriptFetching"
              );
            }}
          />
          <ToggleSetting
            name="Automatically Move Files to Recommended Folders"
            description="When disabled, files stay in place after inbox processing instead of being moved to a recommended folder."
            value={enableFolderRecommendation}
            onChange={(value) => {
              void handleToggleChange(
                value,
                setEnableFolderRecommendation,
                "enableFolderRecommendation"
              );
            }}
          />
          <ToggleSetting
            name="Inbox Auto-Renaming"
            description="Automatically rename new files when they are processed through the inbox."
            value={enableFileRenaming}
            onChange={(value) => {
              void handleToggleChange(
                value,
                setEnableFileRenaming,
                "enableFileRenaming"
              );
            }}
          />
          <ToggleSetting
            name="Inbox Auto-Formatting"
            description="Automatically format new documents when they match a template category during inbox processing."
            value={enableDocumentClassification}
            onChange={(value) => {
              void handleToggleChange(
                value,
                setEnableDocumentClassification,
                "enableDocumentClassification"
              );
            }}
          />
          {plugin.settings.useInbox && (
            <ToggleSetting
              name="Send Recordings to Inbox"
              description="Save recordings from the Meetings recorder into the inbox folder."
              value={sendRecordingsToInbox}
              onChange={(value) => {
                void handleToggleChange(
                  value,
                  setSendRecordingsToInbox,
                  "sendRecordingsToInbox"
                );
              }}
            />
          )}
          <div className="setting-item p-4 bg-[--background-secondary] rounded-lg border border-[--background-modifier-border] space-y-2">
            <div className="font-medium text-[--text-normal]">
              Audio Default Template
            </div>
            <p className="text-sm text-[--text-muted]">
              Default template associated with audio notes when inbox rules apply.
            </p>
            <select
              className="w-full max-w-xs px-2 py-1.5 bg-[--background-primary] border border-[--background-modifier-border] rounded text-[--text-normal]"
              value={audioDefaultTemplate}
              onChange={(e) => {
                void handleTextChange(
                  e.target.value,
                  setAudioDefaultTemplate,
                  "audioDefaultTemplate"
                );
              }}
            >
              <option value={AUDIO_TEMPLATE_OFF}>
                Off (use auto-formatting rules)
              </option>
              {audioTemplateNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {audioDefaultTemplate !== AUDIO_TEMPLATE_OFF &&
                !audioTemplateNames.includes(audioDefaultTemplate) && (
                  <option value={audioDefaultTemplate}>
                    {audioDefaultTemplate} (missing)
                  </option>
                )}
            </select>
          </div>
          <div className="setting-item p-4 bg-[--background-secondary] rounded-lg border border-[--background-modifier-border] space-y-2">
            <div className="font-medium text-[--text-normal]">
              Study Note From Recordings
            </div>
            <p className="text-sm text-[--text-muted]">
              Optional template used when generating a linked study note.
            </p>
            <select
              className="w-full max-w-xs px-2 py-1.5 bg-[--background-primary] border border-[--background-modifier-border] rounded text-[--text-normal]"
              value={studyNoteTemplate}
              onChange={(e) => {
                void handleTextChange(
                  e.target.value,
                  setStudyNoteTemplate,
                  "studyNoteTemplate"
                );
              }}
            >
              <option value={STUDY_NOTE_OFF}>Off</option>
              {audioTemplateNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {studyNoteTemplate !== STUDY_NOTE_OFF &&
                !audioTemplateNames.includes(studyNoteTemplate) && (
                  <option value={studyNoteTemplate}>
                    {studyNoteTemplate} (missing)
                  </option>
                )}
            </select>
          </div>
          <div className="bg-[--background-secondary] p-4 rounded-lg mt-2">
            <div className="font-medium text-[--text-normal] mb-2">
              Document Type Templates
            </div>
            <div className="text-sm text-[--text-muted]">
              To enable auto-formatting, create template files in the File
              Organizer template folder. Name each file according to its
              document type (e.g., 'workout.md', 'meeting-notes.md').
            </div>
          </div>
          <ToggleSetting
            name="Inbox Similar Tags"
            description="Automatically append similar tags to new files during inbox processing."
            value={useSimilarTags}
            onChange={(value) => {
              void handleToggleChange(
                value,
                setUseSimilarTags,
                "useSimilarTags"
              );
            }}
          />
          <div className="setting-item p-4 bg-[--background-secondary] rounded-lg border border-[--background-modifier-border] space-y-2">
            <div className="font-medium text-[--text-normal]">
              Inbox Notification Level
            </div>
            <p className="text-sm text-[--text-muted]">
              Control how verbose toast notifications are while files are
              processed through the inbox.
            </p>
            <select
              className="w-full max-w-xs px-2 py-1.5 bg-[--background-primary] border border-[--background-modifier-border] rounded text-[--text-normal]"
              value={inboxNotificationLevel}
              onChange={(e) => {
                void (async (e) => {
                  const value = e.target.value as InboxNotificationLevel;
                  setInboxNotificationLevel(value);
                  plugin.settings.inboxNotificationLevel = value;
                  await plugin.saveSettings();
                })(e);
              }}
            >
              <option value="silent">Silent — no notifications</option>
              <option value="error">Errors only — processing failures</option>
              <option value="warning">
                Warnings — errors and bypassed files (default)
              </option>
              <option value="info">
                Info — warnings plus completion summary per file
              </option>
              <option value="debug">
                Debug — all notifications including step-by-step progress
              </option>
            </select>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4 text-[--text-normal]">
          General Settings
        </h3>

        <div className="mb-6">
          <h4 className="font-medium text-[--text-normal] mb-2">File Naming</h4>
          <div className="space-y-4">
            <TextAreaSetting
              name="Rename Instructions"
              description="Instructions for how files should be renamed based on their content."
              value={renameInstructions}
              onChange={(value) => {
                void handleTextChange(
                  value,
                  setRenameInstructions,
                  "renameInstructions"
                );
              }}
            />
            <ToggleSetting
              name="Use Vault Context"
              description="Improve AI-generated titles by providing examples from your vault."
              value={useVaultTitles}
              onChange={(value) => {
                void handleToggleChange(
                  value,
                  setUseVaultTitles,
                  "useVaultTitles"
                );
              }}
            />
          </div>
        </div>

        <div className="mb-6">
          <h4 className="font-medium text-[--text-normal] mb-2">Tags</h4>
          <div className="space-y-4">
            <ToggleSetting
              name="Use Frontmatter"
              description="Add similar tags in frontmatter instead of inline."
              value={useSimilarTagsInFrontmatter}
              onChange={(value) => {
                void handleToggleChange(
                  value,
                  setUseSimilarTagsInFrontmatter,
                  "useSimilarTagsInFrontmatter"
                );
              }}
            />
            <TextAreaSetting
              name="Tag Generation Instructions"
              description="Custom instructions for generating tags for your notes."
              value={customTagInstructions}
              onChange={(value) => {
                void handleTextChange(
                  value,
                  setCustomTagInstructions,
                  "customTagInstructions"
                );
              }}
            />
          </div>
        </div>

        <div className="mb-6">
          <h4 className="font-medium text-[--text-normal] mb-2">
            Folder Organization
          </h4>
          <div className="space-y-4">
            <TextAreaSetting
              name="Custom Folder Determination Instructions"
              description="Provide custom instructions for determining which folders to place your notes in."
              value={customFolderInstructions}
              onChange={(value) => {
                void handleTextChange(
                  value,
                  setCustomFolderInstructions,
                  "customFolderInstructions"
                );
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
};

interface ToggleSettingProps {
  name: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

const ToggleSetting: React.FC<ToggleSettingProps> = ({
  name,
  description,
  value,
  onChange,
}) => (
  <div className="flex items-center justify-between py-2">
    <div>
      <div className="font-medium text-[--text-normal]">{name}</div>
      <div className="text-sm text-[--text-muted]">{description}</div>
    </div>
    <div>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="form-checkbox text-[--interactive-accent]"
      />
    </div>
  </div>
);

interface TextAreaSettingProps {
  name: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const TextAreaSetting: React.FC<TextAreaSettingProps> = ({
  name,
  description,
  value,
  onChange,
  disabled,
}) => (
  <div className="py-2">
    <div className="font-medium text-[--text-normal]">{name}</div>
    <div className="text-sm text-[--text-muted] mb-1">{description}</div>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-3 py-2 text-[--text-normal] bg-[--background-primary] border border-[--background-modifier-border] rounded-lg focus:outline-none focus:border-[--interactive-accent] disabled:bg-[--background-secondary]"
      rows={4}
    />
  </div>
);
