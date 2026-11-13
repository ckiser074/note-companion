import "./plugin-styles.css";

// esbuild shims for node globals used at build time
interface ProcessEnv {
  NODE_ENV?: string;
}
declare const process: { env: ProcessEnv };

import {
  Plugin,
  Notice,
  Modal,
  TFolder,
  TFile,
  normalizePath,
  loadPdfJs,
  arrayBufferToBase64,
  LinkCache,
} from "obsidian";
import { logMessage, sanitizeTag } from "./someUtils";
import { FileOrganizerSettingTab } from "./views/settings/view";
import {
  AssistantViewWrapper,
  ORGANIZER_VIEW_TYPE,
} from "./views/assistant/view";
import {
  DashboardView,
  DASHBOARD_VIEW_TYPE,
} from "./views/assistant/dashboard/view";
import { compressImageForVision, isWebP } from "./lib/compress-image";

import { FileOrganizerSettings, DEFAULT_SETTINGS } from "./settings";

import { extractSelectionToNewNote } from "./commands/extract-selection-to-note";
import { registerEventHandlers } from "./handlers/eventHandlers";
import { shouldAutoOpenOnboarding } from "./onboarding-gate";
import {
  initializeOrganizer,
  initializeFileOrganizationCommands,
} from "./handlers/commandHandlers";
import {
  ensureFolderExists,
  checkAndCreateFolders,
  checkAndCreateTemplates,
  restoreDefaultTemplates,
  DEFAULT_TEMPLATE_NAMES,
} from "./fileUtils";

import {
  VALID_IMAGE_EXTENSIONS,
  VALID_AUDIO_EXTENSIONS,
  VALID_MEDIA_EXTENSIONS,
} from "./constants";
import { initializeInboxQueue, Inbox } from "./inbox";
import { migrateInboxNotificationLevel } from "./inbox/notification-level";
import { migrateUseInbox } from "./inbox/use-inbox-migration";
import { migrateImageOcrSettings } from "./inbox/migrate-image-instructions";
import { logger } from "./services/logger";
import { backupFooter, inlineTagAppendix } from "./lib/note-footer";
import { layoutPdfTextItems } from "./lib/pdf-text-layout";
import { addTextSelectionContext } from "./views/assistant/ai-chat/use-context-items";
import {
  buildSuggestionCacheKey,
  clearSuggestionCaches,
  getCachedFolderSuggestions,
  getCachedTagSuggestions,
  setCachedFolderSuggestions,
  setCachedTagSuggestions,
} from "./lib/suggestion-cache";
import {
  capTagsForAI,
  prioritizeFoldersForAI,
} from "./lib/organizer-limits";
import { ProcessingStatusBar } from "./components/processing-status-bar";
import { LocalAIService } from "./ai/local-ai-service";
import {
  buildClassifyMessages,
  buildConceptsMessages,
  buildFoldersMessages,
  buildFormatMessages,
  buildNameMessages,
  buildTagsMessages,
} from "./ai/chatml";
import {
  getParaCategoryForPath,
  getParaStatusTag,
  DEFAULT_PARA_ROOTS,
  normalizeVaultPath,
  normalizeVaultTag,
  PARA_CATEGORIES,
  type ParaCategory,
  type ParaRoots,
} from "./lib/para";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";

type TagCounts = {
  [key: string]: number;
};

export interface FolderSuggestion {
  isNewFolder: boolean;
  score: number;
  folder: string;
  reason: string;
  paraCategory?: ParaCategory;
}

type ConceptChunk = { name: string; chunk: string };
type ConceptsResponse = { concepts: ConceptChunk[] };
type ClassifyResponse = { documentType?: string };
type TagSuggestion = {
  score: number;
  tag: string;
  reason: string;
  isNew: boolean;
};
type FoldersResponse = { folders: FolderSuggestion[] };
type TagsResponse = {
  paraCategory?: ParaCategory;
  tags: TagSuggestion[];
};
type TitleSuggestion = { score: number; title: string; reason: string };
type TitlesResponse = { titles: TitleSuggestion[] };

type PdfTextContent = { items: unknown[] };
type PdfPage = {
  getTextContent: () => Promise<PdfTextContent>;
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNum: number) => Promise<PdfPage>;
};
type PdfJsLib = {
  getDocument: (opts: { data: Uint8Array }) => { promise: Promise<PdfDocument> };
};

export interface FileMetadata {
  instructions: {
    shouldClassify: boolean;
    shouldAppendAlias: boolean;
    shouldAppendSimilarTags: boolean;
  };
  classification?: string;
  originalText: string;
  originalPath: string | undefined;
  originalName: string;
  aiFormattedText: string;
  newName: string;
  newPath: string;
  markAsProcessed: boolean;
  shouldCreateMarkdownContainer: boolean;
  aliases: string[];
  similarTags: string[];
}

export default class FileOrganizer extends Plugin {
  public inbox: Inbox;
  public localAI: LocalAIService;
  settings: FileOrganizerSettings;
  private statusBarItem: HTMLElement | null = null;
  private statusBarRoot: Root | null = null;
  private vaultTagsCache: string[] | null = null;
  private vaultTagsCacheListenerRegistered = false;
  private userFoldersCache: string[] | null = null;
  private userFoldersCacheListenerRegistered = false;

  async loadSettings() {
    const loaded = (await this.loadData()) as
      | Partial<FileOrganizerSettings>
      | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    const migratedLevel = migrateInboxNotificationLevel(loaded);
    if (migratedLevel) {
      this.settings.inboxNotificationLevel = migratedLevel;
    }

    const useInboxMigration = migrateUseInbox(this.settings);
    if (useInboxMigration) {
      this.settings.useInbox = useInboxMigration.useInbox;
      this.settings.useInboxMigrated = useInboxMigration.useInboxMigrated;
    }

    if (migrateImageOcrSettings(this.settings)) {
      await this.saveSettings();
    }
  }

  shouldCreateMarkdownContainer(file: TFile): boolean {
    return (
      VALID_MEDIA_EXTENSIONS.includes(file.extension) ||
      file.extension === "pdf"
    );
  }

  async identifyConceptsAndFetchChunks(content: string) {
    try {
      const response = await this.localAI.generateJSON<ConceptsResponse>(
        buildConceptsMessages(content),
        { temperature: 0.1, maxTokens: 1024 }
      );
      return Array.isArray(response.concepts) ? response.concepts : [];
    } catch (error) {
      logger.error("Error in identifyConceptsAndFetchChunks:", error);
      new Notice("An error occurred while processing the document.", 6000);
      throw error;
    }
  }

  async formatContentV2(
    content: string,
    formattingInstruction: string
  ): Promise<string> {
    try {
      const formattedContent = await this.localAI.generateText(
        buildFormatMessages(content, formattingInstruction),
        { temperature: 0.1, maxTokens: 1536 }
      );
      return formattedContent;
    } catch (error) {
      logger.error("Error formatting content:", error);
      new Notice("An error occurred while formatting the content.", 6000);
      return "";
    }
  }

  async appendBackupLinkToCurrentFile(currentFile: TFile, backupFile: TFile) {
    // Remove .md extension from path for Obsidian wikilink
    const backupPath = backupFile.path.replace(/\.md$/, "");
    const backupLink = backupFooter(backupPath);

    await this.app.vault.append(currentFile, backupLink);
  }

  async appendFormattedLinkToBackupFile(
    backupFile: TFile,
    formattedFile: TFile
  ) {
    // Remove .md extension from path for Obsidian wikilink
    const formattedPath = formattedFile.path.replace(/\.md$/, "");
    const formattedLink = `\n\n---\n[[${formattedPath} | Link to formatted file]]`;

    await this.app.vault.append(backupFile, formattedLink);
  }

  async getFormatInstruction(classification: string): Promise<string> {
    // get the template file from the classification
    const templateFile = this.app.vault.getAbstractFileByPath(
      `${this.settings.templatePaths}/${classification}`
    );
    if (!templateFile || !(templateFile instanceof TFile)) {
      logger.error("Template file not found or is not a valid file.");
      return "";
    }
    return await this.app.vault.read(templateFile);
  }
  async streamFormatInSplitView({
    file,
    formattingInstruction,
    content,
  }: {
    file: TFile;
    formattingInstruction: string;
    content: string;
  }): Promise<TFile | null> {
    try {
      new Notice("Formatting content in split view...", 3000);

      // Create a new file for the formatted content
      const newFileName = `${file.basename}-formatted-${Date.now()}.md`;
      const newFilePath = `${file.parent?.path}/${newFileName}`;
      const newFile = await this.app.vault.create(newFilePath, "");

      // Open the new file in a split view
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(newFile);

      let formattedContent = "";
      const updateCallback = (partialContent: string) => {
        formattedContent = partialContent;
        void this.app.vault.modify(newFile, formattedContent);
      };

      await this.formatStream(
        content,
        formattingInstruction,
        updateCallback
      );

      new Notice("Content formatted in split view successfully", 3000);
      return newFile;
    } catch (error) {
      logger.error("Error formatting content in split view:", error);
      new Notice(
        "An error occurred while formatting the content in split view.",
        6000
      );
      return null;
    }
  }

  /**
   * Cleans up tags in formatted content by removing extra # symbols
   * Fixes cases where AI generates tags with # that then appear as ## in Obsidian
   * Also removes # from tags in frontmatter (frontmatter tags should not have #)
   * Also fixes YouTube embeds to use thumbnail image URLs instead of watch URLs
   */
  cleanupTagsInContent(content: string): string {
    // Fix YouTube embeds to use Obsidian's embed syntax
    // Convert [![YouTube Video](https://www.youtube.com/watch?v=VIDEO_ID)](https://www.youtube.com/watch?v=VIDEO_ID)
    // Or [![YouTube Video](https://img.youtube.com/vi/VIDEO_ID/...)](https://www.youtube.com/watch?v=VIDEO_ID)
    // To: ![](https://www.youtube.com/watch?v=VIDEO_ID) (Obsidian embed format)
    content = content.replace(
      /\[!\[([^\]]*)\]\(https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)\)\]\(https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)\)/g,
      (
        _match: string,
        _altText: string,
        videoId1: string,
        videoId2: string
      ) => {
        // Use the first video ID (they should be the same, but handle both)
        const videoId = videoId1 || videoId2;
        return `![](https://www.youtube.com/watch?v=${videoId})`;
      }
    );
    // Also convert thumbnail image links to embeds
    content = content.replace(
      /\[!\[([^\]]*)\]\(https:\/\/img\.youtube\.com\/vi\/([a-zA-Z0-9_-]+)\/[^)]+\)\]\(https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)\)/g,
      (
        _match: string,
        _altText: string,
        videoId1: string,
        videoId2: string
      ) => {
        const videoId = videoId1 || videoId2;
        return `![](https://www.youtube.com/watch?v=${videoId})`;
      }
    );
    // First, handle frontmatter tags
    const frontmatterRegex = /^---\n([\s\S]*?)\n---(\n|$)/;
    const frontmatterMatch = content.match(frontmatterRegex);

    if (frontmatterMatch) {
      let frontmatterContent = frontmatterMatch[1];
      const closingNewline = frontmatterMatch[2] || "\n";

      // Clean up tags in frontmatter YAML
      // Match tags: ["#tag1", "#tag2"] or tags: ["tag1", "#tag2"] patterns
      // Also handles multiline arrays
      frontmatterContent = frontmatterContent.replace(
        /tags:\s*\[([\s\S]*?)\]/g,
        (_match, tagsContent: string) => {
          // Extract all tags (handles both single-line and multiline arrays)
          const tagMatches =
            tagsContent.match(/["']([^"']*)["']/g) ?? [];
          const cleanedTags = tagMatches.map((tagMatch: string) => {
            // Remove quotes and # symbols
            let cleaned = tagMatch
              .replace(/^["']|["']$/g, "")
              .replace(/^#+/, "");

            // Sanitize tag name: replace spaces with underscores (Obsidian requirement)
            // This handles tags like "social media" -> "social_media"
            cleaned = cleaned.replace(/\s+/g, "_");

            // Remove any leading or trailing underscores
            cleaned = cleaned.replace(/^_+|_+$/g, "");

            return `"${cleaned}"`;
          });

          // Preserve original formatting (single-line vs multiline)
          const isMultiline = tagsContent.includes("\n");
          if (isMultiline) {
            return `tags: [\n${cleanedTags
              .map((tag: string) => `  ${tag}`)
              .join(",\n")}\n]`;
          } else {
            return `tags: [${cleanedTags.join(", ")}]`;
          }
        }
      );

      // Replace the frontmatter section with cleaned version
      content = content.replace(
        frontmatterRegex,
        `---\n${frontmatterContent}\n---${closingNewline}`
      );
    }

    // Then, clean up inline tags in the content body
    const lines = content.split("\n");
    let inFrontmatter = false;
    const cleanedLines = lines.map(line => {
      // Track frontmatter boundaries
      if (line.trim() === "---") {
        inFrontmatter = !inFrontmatter;
        return line;
      }

      // Skip processing inside frontmatter (already handled above)
      if (inFrontmatter) {
        return line;
      }

      // Skip markdown headers (lines starting with #)
      if (/^#{1,6}\s/.test(line)) {
        return line;
      }

      // Skip code blocks
      if (line.trim().startsWith("```")) {
        return line;
      }

      // Replace ##tag with #tag (multiple # before a tag word)
      // This handles cases where AI adds # to tags that already get # from Obsidian
      return line.replace(/(\s|^)(#{2,})([a-zA-Z0-9_-]+)/g, "$1#$3");
    });

    return cleanedLines.join("\n");
  }

  async streamFormatInCurrentNote({
    file,
    formattingInstruction,
    content,
  }: {
    file: TFile;
    formattingInstruction: string;
    content: string;
  }): Promise<void> {
    try {
      new Notice("Formatting content...", 3000);

      let formattedContent = "";
      const updateCallback = (partialContent: string) => {
        formattedContent = this.cleanupTagsInContent(partialContent);
        void this.app.vault.modify(file, formattedContent);
      };

      if (this.settings.enableBackupCreation) {
        const backupFile = await this.backupTheFileAndAddReferenceToCurrentFile(
          file
        );
        await this.formatStream(
          content,
          formattingInstruction,
          updateCallback
        );
        void this.appendBackupLinkToCurrentFile(file, backupFile);
        await this.appendFormattedLinkToBackupFile(backupFile, file);
      } else {
        await this.formatStream(
          content,
          formattingInstruction,
          updateCallback
        );
      }

      new Notice("Content formatted successfully", 3000);
    } catch (error) {
      logger.error("Error formatting content:", error);
      new Notice("An error occurred while formatting the content.", 6000);
      throw error;
    }
  }

  async streamFormatAppendInCurrentNote({
    file,
    formattingInstruction,
    content,
  }: {
    file: TFile;
    formattingInstruction: string;
    content: string;
  }): Promise<void> {
    try {
      new Notice("Appending formatted content...", 3000);

      let formattedContent = "";
      const updateCallback = (partialContent: string) => {
        formattedContent = partialContent;
      };

      await this.formatStream(
        content,
        formattingInstruction,
        updateCallback
      );

      await this.app.vault.append(file, "\n\n" + formattedContent);

      new Notice("Content appended successfully", 3000);
    } catch (error) {
      logger.error("Error appending content:", error);
      new Notice("An error occurred while appending content.", 6000);
    }
  }

  async streamFormatInCurrentNoteLineByLine({
    file,
    formattingInstruction,
    content,
    chunkMode = "line",
  }: {
    file: TFile;
    formattingInstruction: string;
    content: string;
    chunkMode?: "line" | "partial";
  }): Promise<void> {
    try {
      new Notice("Formatting content line by line...", 3000);

      let formattedContent = "";
      let lastLineCount = 0;

      const updateCallback = (chunk: string) => {
        if (chunkMode === "line") {
          const lines = chunk.split("\n");
          const newLines = lines.slice(lastLineCount);
          if (newLines.length > 0) {
            formattedContent = lines.join("\n");
            lastLineCount = lines.length;
            void this.app.vault.modify(file, formattedContent);
          }
        } else {
          formattedContent = chunk;
          void this.app.vault.modify(file, formattedContent);
        }
      };

      if (this.settings.enableBackupCreation) {
        const backupFile = await this.backupTheFileAndAddReferenceToCurrentFile(
          file
        );
        await this.formatStream(
          content,
          formattingInstruction,
          updateCallback
        );
        await this.appendBackupLinkToCurrentFile(file, backupFile);
        await this.appendFormattedLinkToBackupFile(backupFile, file);
      } else {
        await this.formatStream(
          content,
          formattingInstruction,
          updateCallback
        );
      }

      new Notice("Line-by-line update done!", 3000);
    } catch (error) {
      logger.error("Error formatting content line by line:", error);
      new Notice("An error occurred while formatting the content.", 6000);
      throw error; // Re-throw to allow component to handle error state
    }
  }

  async createFileInInbox(title: string, content: string): Promise<void> {
    const fileName = `${title}.md`;
    const filePath = `${this.settings.pathToWatch}/${fileName}`;
    await this.app.vault.create(filePath, content);
  }

  async extractTextFromPDF(file: TFile): Promise<string> {
    const raw = await this.app.vault.readBinary(file);
    if (!raw || raw.byteLength === 0) {
      return "";
    }
    const pdfBytes = new Uint8Array(raw).slice();

    try {
      const pdfjsLib = (await loadPdfJs()) as PdfJsLib;
      const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const pageTexts: string[] = [];

      const pageLimit = Math.min(doc.numPages, this.settings.pdfPageLimit);
      for (let pageNum = 1; pageNum <= pageLimit; pageNum++) {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        pageTexts.push(layoutPdfTextItems(textContent.items));
      }
      return pageTexts.join("\n\n").trim();
    } catch (error) {
      logger.error(`Error extracting text from PDF locally: ${error}`);
      return "";
    }
  }

  async getCurrentFileLinks(file: TFile): Promise<LinkCache[]> {
    await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.links || [];
  }

  async formatStream(
    content: string,
    formattingInstruction: string,
    updateCallback: (partialContent: string) => void
  ): Promise<string> {
    let lastEmit = 0;
    const formattedContent = await this.localAI.streamGenerate(
      buildFormatMessages(content, formattingInstruction),
      { temperature: 0.1, maxTokens: 1536 },
      (_delta, cleanFullText) => {
        const now = Date.now();
        if (now - lastEmit >= 120) {
          lastEmit = now;
          updateCallback(cleanFullText);
        }
      }
    );
    updateCallback(formattedContent);
    return formattedContent;
  }

  async generateTranscriptFromAudio(
    _file: TFile
  ): Promise<AsyncIterableIterator<string>> {
    const msg =
      "Audio transcription is disabled in 100% offline text-only mode (Qwen3-1.7B).";
    new Notice(msg, 5000);
    throw new Error(msg);
  }

  async classifyContentV2(
    content: string,
    classifications: string[],
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    if (!classifications.length) {
      return "";
    }
    const cutoff = this.settings.contentCutoffChars;
    const trimmedContent = content.slice(0, cutoff);

    try {
      const response = await this.localAI.generateJSON<ClassifyResponse>(
        buildClassifyMessages(trimmedContent, classifications),
        { temperature: 0.1, maxTokens: 128, signal: options?.signal }
      );
      const picked = (response.documentType ?? "").trim();
      return classifications.includes(picked) ? picked : "";
    } catch (error) {
      logger.error("Error classifying content with local AI:", error);
      throw error;
    }
  }

  async getTextFromFile(file: TFile): Promise<string> {
    switch (true) {
      case file.extension === "md":
        return await this.app.vault.read(file);
      case file.extension === "pdf": {
        const pdfContent = await this.extractTextFromPDF(file);
        return pdfContent;
      }
      case VALID_IMAGE_EXTENSIONS.includes(file.extension):
        return await this.generateImageAnnotation(file);
      case VALID_AUDIO_EXTENSIONS.includes(file.extension): {
        // Change this part to consume the iterator
        const transcriptIterator = await this.generateTranscriptFromAudio(file);
        let transcriptText = "";
        for await (const chunk of transcriptIterator) {
          transcriptText += chunk;
        }
        return transcriptText;
      }
      default:
        throw new Error(`Unsupported file type: ${file.extension}`);
    }
  }

  // adds an attachment to a file using the ![[attachment]] syntax
  async appendAttachment(markdownFile: TFile, attachmentFile: TFile) {
    await this.app.vault.append(
      markdownFile,
      `\n\n![[${attachmentFile.path}]]`
    );
  }
  async appendToFrontMatter(file: TFile, key: string, value: string) {
    await this.app.fileManager.processFrontMatter(
      file,
      (frontmatter: Record<string, unknown>) => {
        if (!(key in frontmatter)) {
          frontmatter[key] = [value];
        } else if (!Array.isArray(frontmatter[key])) {
          frontmatter[key] = [frontmatter[key], value];
        } else {
          (frontmatter[key] as string[]).push(value);
        }
      }
    );
  }

  async checkAndCreateFolders() {
    await checkAndCreateFolders(this.app, this.settings);
  }

  async checkAndCreateTemplates() {
    await checkAndCreateTemplates(this.app, this.settings);
  }

  async restoreTemplates() {
    try {
      await restoreDefaultTemplates(this.app, this.settings);
      new Notice("Default templates restored successfully", 3000);
      logger.info("Default templates restored");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(`Failed to restore templates: ${errorMessage}`, 5000);
      logger.error("Failed to restore templates:", error);
      throw error;
    }
  }

  async ensureFolderExists(folderPath: string) {
    await ensureFolderExists(this.app, folderPath);
  }

  async moveFile(
    file: TFile,
    humanReadableFileName: string,
    destinationFolder = ""
  ): Promise<TFile> {
    const fileExtension = file.extension;
    let targetPath = `${destinationFolder}/${humanReadableFileName}.${fileExtension}`;
    const normalizedTargetPath = normalizePath(targetPath);

    if (await this.app.vault.adapter.exists(normalizedTargetPath)) {
      const timestamp = Date.now();
      const uniqueFileName = `${humanReadableFileName}_${timestamp}`;
      targetPath = `${destinationFolder}/${uniqueFileName}.${fileExtension}`;
    }

    const normalizedFinalPath = normalizePath(targetPath);
    await ensureFolderExists(this.app, destinationFolder);
    await this.app.fileManager.renameFile(file, normalizedFinalPath);

    const movedFile = this.app.vault.getAbstractFileByPath(normalizedFinalPath);
    if (!(movedFile instanceof TFile)) {
      throw new Error(`Failed to move file to ${normalizedFinalPath}`);
    }
    return movedFile;
  }
  // rn used to provide aichat contex
  getAllUserMarkdownFiles(): TFile[] {
    const settingsPaths = [
      this.settings.pathToWatch,
      this.settings.defaultDestinationPath,
      this.settings.attachmentsPath,
      this.settings.backupFolderPath,
    ];
    const allFiles = this.app.vault.getMarkdownFiles();
    // remove any file path that is part of the settingsPath
    const allFilesFiltered = allFiles.filter(
      file => !settingsPaths.some(path => file.path.includes(path))
    );

    return allFilesFiltered;
  }
  getAllIgnoredFolders(): string[] {
    const ignoredFolders = [
      ...this.settings.ignoreFolders,
      this.settings.defaultDestinationPath,
      this.settings.attachmentsPath,
      this.settings.backupFolderPath,
      this.settings.templatePaths,
      this.settings.pathToWatch,
      this.settings.errorFilePath,
      "_NoteCompanion",
      "/",
    ];
    logMessage("ignoredFolders", ignoredFolders);
    // remove empty strings
    return ignoredFolders.filter(folder => folder !== "");
  }
  // this is a list of all the folders that file organizer to use for organization
  getAllUserFolders(): string[] {
    if (this.userFoldersCache) {
      return this.userFoldersCache;
    }

    const allFolders = this.app.vault.getAllFolders();
    const allFoldersPaths = allFolders.map(folder => folder.path);
    const ignoredFolders = this.getAllIgnoredFolders();

    // If ignoreFolders includes "*", return empty array as all folders are ignored
    if (this.settings.ignoreFolders.includes("*")) {
      this.userFoldersCache = [];
      return this.userFoldersCache;
    }

    this.userFoldersCache = allFoldersPaths.filter(folder => {
      // Check if the folder is not in the ignored folders list
      return (
        !ignoredFolders.includes(folder) &&
        !ignoredFolders.some(ignoredFolder =>
          folder.startsWith(ignoredFolder + "/")
        )
      );
    });

    if (!this.userFoldersCacheListenerRegistered) {
      this.userFoldersCacheListenerRegistered = true;
      const invalidateUserFoldersCache = () => {
        this.userFoldersCache = null;
      };
      this.registerEvent(this.app.vault.on("create", invalidateUserFoldersCache));
      this.registerEvent(this.app.vault.on("delete", invalidateUserFoldersCache));
      this.registerEvent(this.app.vault.on("rename", invalidateUserFoldersCache));
    }

    return this.userFoldersCache;
  }

  async compressImage(fileContent: ArrayBuffer): Promise<ArrayBuffer> {
    return compressImageForVision(fileContent);
  }

  isWebP(fileContent: ArrayBuffer | Uint8Array): boolean {
    return isWebP(fileContent);
  }

  async generateImageAnnotation(_file: TFile): Promise<string> {
    const msg =
      "Image OCR is disabled in 100% offline text-only mode (Qwen3-1.7B).";
    new Notice(msg, 5000);
    throw new Error(msg);
  }

  async getBacklog() {
    const pathToWatch = this.settings.pathToWatch;
    if (!pathToWatch) return [];
    const allFiles = this.app.vault.getFiles();
    const pendingFiles = allFiles.filter(
      (file) =>
        file.path === pathToWatch || file.path.startsWith(pathToWatch + "/")
    );
    return pendingFiles;
  }
  async processBacklog() {
    const pendingFiles = await this.getBacklog();
    logMessage("Enqueuing files from backlog V3");
    Inbox.getInstance().enqueueFiles(pendingFiles);
    if (pendingFiles.length > 0) {
      new Notice(
        `PARA Companion: Processing ${pendingFiles.length} file(s) from inbox`
      );
    }
    return;
  }

  async getAllVaultTags(): Promise<string[]> {
    if (this.vaultTagsCache) {
      return this.vaultTagsCache;
    }

    const tagCounts: TagCounts = {};
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.tags) {
        continue;
      }
      for (const tagRef of cache.tags) {
        tagCounts[tagRef.tag] = (tagCounts[tagRef.tag] ?? 0) + 1;
      }
    }

    // If no tags are found, return an empty array
    if (Object.keys(tagCounts).length === 0) {
      logMessage("No tags found");
      return [];
    }

    // Sort tags by their occurrence count in descending order
    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

    const tagList = sortedTags.map(tag => tag[0]);
    this.vaultTagsCache = tagList;

    if (!this.vaultTagsCacheListenerRegistered) {
      this.vaultTagsCacheListenerRegistered = true;
      this.registerEvent(
        this.app.metadataCache.on("changed", () => {
          this.vaultTagsCache = null;
        })
      );
    }

    return tagList;
  }

  clearOrganizerSuggestionCaches(): void {
    clearSuggestionCaches();
    this.vaultTagsCache = null;
    this.userFoldersCache = null;
  }

  async recommendTags(
    content: string,
    filePath: string,
    existingTags: string[],
    options?: { forceRefresh?: boolean; signal?: AbortSignal }
  ): Promise<
    Array<{ score: number; tag: string; reason: string; isNew: boolean }>
  > {
    const cutoff = this.settings.contentCutoffChars;
    const currentCategory = getParaCategoryForPath(
      filePath,
      this.getParaRoots()
    );
    const cacheKey = `${buildSuggestionCacheKey(
      filePath,
      content,
      cutoff
    )}:${currentCategory ?? "unfiled"}`;

    if (!options?.forceRefresh) {
      const cached = getCachedTagSuggestions(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const trimmedContent = content.slice(0, cutoff);
    const tagsForAI = capTagsForAI(existingTags);

    try {
      const response = await this.localAI.generateJSON<TagsResponse>(
        buildTagsMessages(
          trimmedContent,
          filePath,
          tagsForAI,
          this.settings.customTagInstructions,
          3,
          currentCategory
        ),
        { temperature: 0.1, maxTokens: 512, signal: options?.signal }
      );

      const paraCategory =
        response.paraCategory &&
        PARA_CATEGORIES.includes(response.paraCategory)
          ? response.paraCategory
          : currentCategory ?? "resource";
      const paraTag = `#${getParaStatusTag(paraCategory)}`;
      const rawTags = Array.isArray(response.tags) ? response.tags : [];
      const sortedTags: TagSuggestion[] = rawTags
        .filter((t) => t && typeof t.tag === "string" && t.tag.trim().length > 0)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .flatMap((tag) => {
          const normalizedTag = normalizeVaultTag(tag.tag);
          if (!normalizedTag) return [];
          return [{
            score: typeof tag.score === "number" ? tag.score : 80,
            isNew: Boolean(tag.isNew),
            tag: `#${normalizedTag}`,
            reason: tag.reason || "Relevant to content theme",
          }];
        });

      const normalizedExistingTags = new Set(
        existingTags.map(normalizeVaultTag)
      );
      const resultTags = sortedTags
        .filter((tag) => !tag.tag.startsWith("#para/"))
        .slice(0, Math.max(0, 3 - 1));
      resultTags.push({
        score: 100,
        tag: paraTag,
        reason: `PARA ${paraCategory} classification`,
        isNew: !normalizedExistingTags.has(paraTag.slice(1)),
      });

      setCachedTagSuggestions(cacheKey, resultTags);
      return resultTags;
    } catch (error) {
      logger.error("Error recommending tags with local AI:", error);
      throw error;
    }
  }

  getParaRoots(): ParaRoots {
    return {
      project:
        normalizeVaultPath(this.settings.paraProjectsRoot) ||
        DEFAULT_PARA_ROOTS.project,
      area:
        normalizeVaultPath(this.settings.paraAreasRoot) ||
        DEFAULT_PARA_ROOTS.area,
      resource:
        normalizeVaultPath(this.settings.paraResourcesRoot) ||
        DEFAULT_PARA_ROOTS.resource,
      archive:
        normalizeVaultPath(this.settings.paraArchivesRoot) ||
        DEFAULT_PARA_ROOTS.archive,
    };
  }

  async recommendFolders(
    content: string,
    fileName: string,
    options?: { forceRefresh?: boolean; signal?: AbortSignal }
  ): Promise<FolderSuggestion[]> {
    const customInstructions = this.settings.customFolderInstructions;
    const cutoff = this.settings.contentCutoffChars;
    const roots = this.getParaRoots();
    const cacheKey = `${buildSuggestionCacheKey(
      fileName,
      content,
      cutoff
    )}:${JSON.stringify(roots)}`;

    if (!options?.forceRefresh) {
      const cached = getCachedFolderSuggestions(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const trimmedContent = content.slice(0, cutoff);
    const paraRoots = Object.values(roots).map(normalizeVaultPath);
    const allFolders = this.getAllUserFolders();
    const paraFolders = [
      ...paraRoots,
      ...allFolders.filter((folder) =>
        paraRoots.some((root) => folder.startsWith(`${root}/`))
      ),
    ];
    const folders = prioritizeFoldersForAI(
      [...new Set(paraFolders)],
      fileName
    );
    const existingFolders = new Set(
      this.app.vault.getAllFolders().map((folder) => folder.path)
    );

    try {
      const response = await this.localAI.generateJSON<FoldersResponse>(
        buildFoldersMessages(
          trimmedContent,
          fileName,
          folders,
          customInstructions,
          3,
          roots
        ),
        { temperature: 0.1, maxTokens: 512, signal: options?.signal }
      );

      const rawFolders = Array.isArray(response.folders)
        ? response.folders
        : [];
      const sortedFolders: FolderSuggestion[] = rawFolders
        .filter(
          (f) => f && typeof f.folder === "string" && f.folder.trim().length > 0
        )
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .map((folder) => {
          const candidate = normalizeVaultPath(folder.folder);
          const candidateCategory = getParaCategoryForPath(candidate, roots);
          const paraCategory = PARA_CATEGORIES.includes(folder.paraCategory)
            ? folder.paraCategory
            : candidateCategory ?? "resource";
          const root = normalizeVaultPath(roots[paraCategory]);
          const destination =
            candidateCategory === paraCategory
              ? candidate
              : candidate &&
                !getParaCategoryForPath(candidate, roots) &&
                !candidate.includes("/")
              ? `${root}/${candidate}`
              : root;
          return {
            score: typeof folder.score === "number" ? folder.score : 80,
            isNewFolder: !existingFolders.has(destination),
            paraCategory,
            folder: destination,
            reason: folder.reason || `PARA ${paraCategory} destination`,
          };
        })
        .filter((folder) => folder.folder.length > 0);

      setCachedFolderSuggestions(cacheKey, sortedFolders);
      return sortedFolders;
    } catch (error) {
      logger.error("Error recommending folders with local AI:", error);
      throw error;
    }
  }

  async appendTag(file: TFile, tag: string) {
    // Ensure the tag starts with a hash symbol
    const tagName = normalizeVaultTag(sanitizeTag(tag));
    if (!tagName) return;
    const formattedTag = `#${tagName}`;

    // Get the file content and metadata
    const fileContent = await this.app.vault.read(file);
    const metadata = this.app.metadataCache.getFileCache(file);

    // Check if tag exists in frontmatter
    const rawFrontmatterTags: unknown = metadata?.frontmatter?.tags;
    const frontmatterTags = Array.isArray(rawFrontmatterTags)
      ? rawFrontmatterTags
      : typeof rawFrontmatterTags === "string"
      ? [rawFrontmatterTags]
      : [];
    const hasFrontmatterTag = frontmatterTags.some(
      (value): value is string =>
        typeof value === "string" && normalizeVaultTag(value) === tagName
    );

    // Check if tag exists in content (for inline tags)
    const hasInlineTag = fileContent.includes(formattedTag);

    // If tag already exists, skip adding it
    const isParaTag = tagName.startsWith("para/");
    if (hasFrontmatterTag || (hasInlineTag && !isParaTag)) {
      return;
    }

    // Append similar tags
    if (
      this.settings.useSimilarTagsInFrontmatter ||
      isParaTag
    ) {
      await this.appendToFrontMatter(
        file,
        "tags",
        tagName
      );
      return;
    }

    // The first tag in a note with no '#' gets a blank line before it
    await this.app.vault.append(file, inlineTagAppendix(fileContent, formattedTag));
  }

  async ensureAssistantView(): Promise<AssistantViewWrapper | null> {
    const { workspace } = this.app;

    // Reuse an existing leaf, or create one in the right sidebar
    let leaf = workspace.getLeavesOfType(ORGANIZER_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({
        type: ORGANIZER_VIEW_TYPE,
        active: true,
      });
    }

    // A leaf restored from the saved workspace can still be a deferred view
    // without our methods (such as activateTab) until it is loaded.
    await leaf.loadIfDeferred();

    const view = leaf.view as AssistantViewWrapper;
    if (!view || typeof view.activateTab !== "function") return null;

    // Reveal and focus the leaf
    void workspace.revealLeaf(leaf);

    return view;
  }

  async onload() {
    this.inbox = Inbox.initialize(this);
    await this.initializePlugin();
    this.localAI = new LocalAIService(this);
    logger.configure(this.settings.debugMode);

    await this.saveSettings();
    await ensureFolderExists(this.app, this.settings.logFolderPath);

    initializeInboxQueue(this);

    // Initialize different features
    initializeOrganizer(this);
    initializeFileOrganizationCommands(this);

    this.app.workspace.onLayoutReady(() => {
      registerEventHandlers(this);
      void this.maybeShowOnboarding();
      void this.localAI.initialize().catch((error) => {
        logger.error("First-run local AI initialization failed:", error);
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Local AI initialization failed: ${message}`, 7000);
      });
    });
    if (this.settings.useInbox) {
      void this.processBacklog();
    }

    this.addCommand({
      id: "open-organizer-tab",
      name: "Open organizer tab",
      callback: async () => {
        const view = await this.ensureAssistantView();
        view?.activateTab("organizer");
      },
    });

    this.addCommand({
      id: "open-inbox-tab",
      name: "Open inbox tab",
      callback: async () => {
        const view = await this.ensureAssistantView();
        view?.activateTab("inbox");
      },
    });

    this.addCommand({
      id: "process-inbox-now",
      name: "Process inbox now",
      callback: async () => {
        await this.processBacklog();
      },
    });

    this.addCommand({
      id: "open-chat-tab",
      name: "Open chat tab",
      callback: async () => {
        const view = await this.ensureAssistantView();
        view?.activateTab("chat");
      },
    });
    this.addCommand({
      id: "open-meetings-tab",
      name: "Open meetings tab",
      callback: async () => {
        const view = await this.ensureAssistantView();
        view?.activateTab("meetings");
      },
    });

    this.addCommand({
      id: "restore-default-templates",
      name: "Restore default templates",
      callback: async () => {
        const confirmed = await new Promise<boolean>(resolve => {
          class RestoreTemplatesModal extends Modal {
            onOpen() {
              const { contentEl } = this;
              contentEl.empty();
              contentEl.createEl("h2", { text: "Restore default templates" });
              contentEl.createEl("p", {
                text: "This will restore the following templates to their original plugin versions:",
              });
              const list = contentEl.createEl("ul");
              for (const templateName of DEFAULT_TEMPLATE_NAMES) {
                list.createEl("li", { text: templateName });
              }
              contentEl.createEl("p", {
                text: "Your custom templates will not be affected.",
                attr: { style: "margin-top: 1em; font-weight: bold;" },
              });
              const buttonContainer = contentEl.createDiv({
                attr: { style: "display: flex; gap: 10px; margin-top: 1em;" },
              });
              buttonContainer
                .createEl("button", { text: "Cancel" })
                .addEventListener("click", () => {
                  resolve(false);
                  this.close();
                });
              buttonContainer
                .createEl("button", {
                  text: "Restore",
                  attr: { style: "background: var(--interactive-accent);" },
                })
                .addEventListener("click", () => {
                  resolve(true);
                  this.close();
                });
            }
          }
          const modal = new RestoreTemplatesModal(this.app);
          modal.open();
        });

        if (confirmed) {
          await this.restoreTemplates();
        }
      },
    });

    this.addCommand({
      id: "view-meetings-metadata",
      name: "View meetings metadata (debug)",
      callback: async () => {
        const { MeetingMetadataManager } = await import(
          "./views/assistant/meetings/meeting-metadata"
        );
        const manager = new MeetingMetadataManager(this);
        const metadata = await manager.loadMetadata();
        console.debug("Meetings Metadata:", JSON.stringify(metadata, null, 2));
        new Notice(
          "Meetings metadata logged to console. Check Developer Tools (Ctrl+Shift+I)"
        );
      },
    });
    this.addCommand({
      id: "add-selection-to-chat",
      name: "Add selection to chat",
      editorCallback: async editor => {
        const selection = editor.getSelection();
        if (selection) {
          const activeFile = this.app.workspace.getActiveFile();
          const view = await this.ensureAssistantView();

          // Add the selection to context
          addTextSelectionContext({
            content: selection,
            sourceFile: activeFile?.path,
          });

          // Open chat tab
          view?.activateTab("chat");
        } else {
          new Notice("No text selected");
        }
      },
    });

    this.addCommand({
      id: "extract-selection-to-new-note",
      name: "Extract selection to new note",
      editorCallback: async () => {
        const result = await extractSelectionToNewNote(this.app);
        if (result.ok === false) {
          new Notice(result.error, 4000);
          return;
        }
        const name = result.newFilePath.split("/").pop() ?? result.newFilePath;
        new Notice(`Extracted to ${name}`, 3500);
      },
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!editor.getSelection()?.trim()) return;
        const active = this.app.workspace.getActiveFile();
        if (!active || active.extension !== "md") return;
        menu.addItem(item => {
          item
            .setTitle("Extract selection to new note")
            .setIcon("file-plus")
            .onClick(() => {
              void (async () => {
              const result = await extractSelectionToNewNote(this.app);
              if (result.ok === false) {
                new Notice(result.error, 4000);
                return;
              }
              const name =
                result.newFilePath.split("/").pop() ?? result.newFilePath;
              new Notice(`Extracted to ${name}`, 3500);
              })();
            });
        });
      })
    );

    this.addCommand({
      id: "test-screenpipe",
      name: "Test screenpipe connection",
      callback: async () => {
        const {
          ScreenpipeClient,
          DEFAULT_SCREENPIPE_API_URL,
        } = await import("./services/screenpipe-client");
        const client = new ScreenpipeClient();

        const isAvailable = await client.isAvailable();
        if (!isAvailable) {
          new Notice(
            "❌ ScreenPipe not available on " + DEFAULT_SCREENPIPE_API_URL,
            5000
          );
          return;
        }

        new Notice("✅ Screenpipe connected!", 2000);

        try {
          const results = await client.search({ limit: 5 });
          new Notice(`✅ Found ${results.length} results`, 3000);
          console.debug("ScreenPipe test results:", results);
        } catch (error) {
          new Notice(
            "❌ Search failed: " + (error instanceof Error ? error.message : "Unknown error"),
            5000
          );
        }
      },
    });

    // Add command to test ScreenPipe search
    this.addCommand({
      id: "test-screenpipe-search",
      name: "Test screenpipe search (recent activity)",
      callback: async () => {
        if (!this.settings.enableScreenpipe) {
          new Notice("❌ Screenpipe is disabled. Enable it in settings > experiments > integrations", 5000);
          return;
        }

        const {
          ScreenpipeClient,
          DEFAULT_SCREENPIPE_API_URL,
        } = await import("./services/screenpipe-client");
        const client = new ScreenpipeClient();

        const isAvailable = await client.isAvailable();
        if (!isAvailable) {
          new Notice(
            "❌ ScreenPipe not available on " + DEFAULT_SCREENPIPE_API_URL,
            5000
          );
          return;
        }

        new Notice("🔍 Searching recent activity...", 2000);

        try {
          // Search for last 30 minutes of activity
          const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          const results = await client.search({
            limit: 10,
            start_time: thirtyMinutesAgo,
            content_type: "all",
          });
          
          if (results.length === 0) {
            new Notice("ℹ️ no recent activity found in last 30 minutes", 3000);
          } else {
            const apps = [
              ...new Set(
                results.map(
                  (r) => r.content?.app_name ?? "Unknown"
                )
              ),
            ];
            new Notice(
              `✅ Found ${results.length} result${results.length > 1 ? 's' : ''} from ${apps.length} app${apps.length > 1 ? 's' : ''}: ${apps.join(", ")}`,
              5000
            );
            console.debug("ScreenPipe search results:", results);
          }
        } catch (error) {
          new Notice(
            "❌ Search failed: " + (error instanceof Error ? error.message : "Unknown error"),
            5000
          );
        }
      },
    });

    // Register the dashboard view
    this.registerView(
      DASHBOARD_VIEW_TYPE,
      leaf => new DashboardView(leaf, this)
    );

    // Re-run the first-run setup wizard (kept under the old command id so hotkeys still work)
    this.addCommand({
      id: "open-fo2k-dashboard",
      name: "Run setup wizard",
      callback: async () => {
        this.settings.hasRunOnboarding = false;
        await this.saveSettings();
        await this.activateDashboard();
      },
    });

    // Add processing status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarRoot = createRoot(this.statusBarItem);
    this.statusBarRoot.render(
      React.createElement(ProcessingStatusBar, { plugin: this })
    );
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  async initializePlugin() {
    await this.loadSettings();
    await this.checkAndCreateFolders();
    await this.checkAndCreateTemplates();
    this.addSettingTab(new FileOrganizerSettingTab(this.app, this));
  }

  /**
   * Checks if a transcript already exists in the note for the given audio file.
   * Looks for the heading pattern: ## Transcript for [filename]
   *
   * @param fileContent - The content of the note file
   * @param audioFileName - The name of the audio file (with or without extension)
   * @returns true if transcript exists, false otherwise
   */
  hasExistingTranscript(fileContent: string, audioFileName: string): boolean {
    // Normalize the filename - remove extension if present for matching
    const nameWithoutExt = audioFileName.replace(
      /\.(mp3|wav|m4a|ogg|webm)$/i,
      ""
    );
    const nameWithExt = audioFileName;

    // Escape special regex characters in filenames
    const escapeRegex = (str: string) =>
      str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Check for both patterns: with and without extension
    // Use regex to match the full header line, not just a substring
    // The 'm' flag makes ^ and $ match line boundaries
    const pattern1 = new RegExp(
      `^## Transcript for ${escapeRegex(nameWithExt)}$`,
      "m"
    );
    const pattern2 = new RegExp(
      `^## Transcript for ${escapeRegex(nameWithoutExt)}$`,
      "m"
    );

    return pattern1.test(fileContent) || pattern2.test(fileContent);
  }

  async appendTranscriptToActiveFile(
    parentFile: TFile,
    audioFileName: string,
    transcriptIterator: AsyncIterableIterator<string>
  ) {
    // Check if transcript already exists before appending
    const fileContent = await this.app.vault.read(parentFile);
    if (this.hasExistingTranscript(fileContent, audioFileName)) {
      new Notice(
        `Transcript already exists for ${audioFileName}. Skipping transcription.`,
        5000
      );
      return;
    }

    const transcriptHeader = `\n\n## Transcript for ${audioFileName}\n\n`;
    await this.app.vault.append(parentFile, transcriptHeader);

    let totalAppended = 0;
    let chunkCount = 0;

    for await (const chunk of transcriptIterator) {
      const chunkLength = chunk.length;
      console.debug(
        `[Plugin] Appending transcript chunk ${++chunkCount}: ${chunkLength} characters`
      );
      await this.app.vault.append(parentFile, chunk);
      totalAppended += chunkLength;
    }

    console.debug(
      `[Plugin] Total transcript appended: ${totalAppended} characters in ${chunkCount} chunk(s)`
    );

    // Verify by reading back the file
    const updatedFileContent = await this.app.vault.read(parentFile);
    const transcriptStart = updatedFileContent.indexOf(transcriptHeader);
    if (transcriptStart !== -1) {
      const appendedTranscript = updatedFileContent.substring(
        transcriptStart + transcriptHeader.length
      );
      console.debug(
        `[Plugin] Verified: File contains ${appendedTranscript.length} characters of transcript`
      );
      if (appendedTranscript.length !== totalAppended) {
        console.warn(
          `[Plugin] WARNING: Mismatch! Appended ${totalAppended} but file contains ${appendedTranscript.length}`
        );
      }
    }

    new Notice(
      `Transcription completed for ${audioFileName} (${totalAppended} characters)`,
      5000
    );
  }

  async generateUniqueBackupFileName(originalFile: TFile): Promise<string> {
    const timestamp = window.moment().format("YYYYMMDD_HHmmss");
    const baseFileName = `${originalFile.basename}_backup_${timestamp}`;
    let fileName = `${baseFileName}.${originalFile.extension}`;
    let counter = 1;

    while (
      await this.app.vault.adapter.exists(
        normalizePath(`${this.settings.backupFolderPath}/${fileName}`)
      )
    ) {
      fileName = `${baseFileName}_${counter}.${originalFile.extension}`;
      counter++;
    }

    return fileName;
  }

  async backupTheFileAndAddReferenceToCurrentFile(file: TFile): Promise<TFile> {
    const backupFileName = await this.generateUniqueBackupFileName(file);
    const backupFilePath = normalizePath(
      `${this.settings.backupFolderPath}/${backupFileName}`
    );

    // Create a backup of the file
    const backupFile = await this.app.vault.copy(file, backupFilePath);

    return backupFile;
  }

  async getTemplateInstructions(templateName: string): Promise<string> {
    // Ensure template folder exists before accessing it
    const normalizedPath = normalizePath(this.settings.templatePaths);
    await ensureFolderExists(this.app, normalizedPath);

    // Ensure templates are created
    await this.checkAndCreateTemplates();

    // Small delay to ensure folder is fully created
    await new Promise(resolve => window.setTimeout(resolve, 100));

    const templateFolder = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!templateFolder || !(templateFolder instanceof TFolder)) {
      logger.error(
        `Template folder not found or is not a valid folder. Path: ${normalizedPath}`
      );
      return "";
    }
    // only look at files first
    const templateFile = templateFolder.children.find(
      file => file instanceof TFile && file.basename === templateName
    );
    if (!templateFile || !(templateFile instanceof TFile)) {
      logger.error("Template file not found or is not a valid file.");
      return "";
    }
    return await this.app.vault.read(templateFile);
  }
  // create a getTemplatesV2 that returns a list of template names only
  // and doesn't reuse getTemplates()
  async getTemplateNames(): Promise<string[]> {
    // Ensure template folder exists before accessing it
    const normalizedPath = normalizePath(this.settings.templatePaths);
    await ensureFolderExists(this.app, normalizedPath);

    // Ensure templates are created
    await this.checkAndCreateTemplates();

    // Small delay to ensure folder is fully created
    await new Promise(resolve => window.setTimeout(resolve, 100));

    // get all file names in the template folder
    const templateFolder = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!templateFolder || !(templateFolder instanceof TFolder)) {
      logger.error(
        `Template folder not found or is not a valid folder. Path: ${normalizedPath}`
      );
      return [];
    }
    const templateFiles = templateFolder.children.filter(
      file => file instanceof TFile
    );
    return templateFiles.map(file => file.basename);
  }

  async recommendName(
    content: string,
    fileName: string,
    options?: { signal?: AbortSignal }
  ): Promise<TitleSuggestion[]> {
    const cutoff = this.settings.contentCutoffChars;
    const trimmedContent = content.slice(0, cutoff);
    const customInstructions = this.settings.renameInstructions;

    try {
      const response = await this.localAI.generateJSON<TitlesResponse>(
        buildNameMessages(trimmedContent, fileName, customInstructions),
        { temperature: 0.1, maxTokens: 384, signal: options?.signal }
      );
      const titles = Array.isArray(response.titles) ? response.titles : [];
      return titles
        .filter((t) => t && typeof t.title === "string" && t.title.trim())
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .map((t) => ({
          score: typeof t.score === "number" ? t.score : 85,
          title: t.title.trim(),
          reason: t.reason || "Descriptive title",
        }));
    } catch (error) {
      logger.error("Error recommending name with local AI:", error);
      throw error;
    }
  }

  onunload() {
    void this.localAI?.unload();
    if (this.statusBarRoot) {
      this.statusBarRoot.unmount();
      this.statusBarRoot = null;
    }
  }

  private async maybeShowOnboarding(): Promise<void> {
    if (!shouldAutoOpenOnboarding(this.settings)) {
      return;
    }
    this.settings.hasShownOnboarding = true;
    await this.saveSettings();
    await this.activateDashboard();
  }

  closeDashboard(): void {
    this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW_TYPE);
  }

  async activateDashboard(): Promise<DashboardView | null> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({
          type: DASHBOARD_VIEW_TYPE,
          active: true,
        });
      } else {
        return null;
      }
    }

    void workspace.revealLeaf(leaf);
    return leaf.view as DashboardView;
  }

  public async checkAndCreateRequiredFolders(): Promise<void> {
    try {
      const folderPaths = [
        this.settings.pathToWatch,
        this.settings.defaultDestinationPath,
        this.settings.referencePath,
        this.settings.attachmentsPath,
        this.settings.logFolderPath,
        this.settings.backupFolderPath,
        this.settings.templatePaths,
        this.settings.bypassedFilePath,
        this.settings.errorFilePath,
      ];

      for (const folderPath of folderPaths) {
        await ensureFolderExists(this.app, folderPath);
      }

      new Notice("All required folders have been created successfully!", 3000);
    } catch (error) {
      console.error("Failed to create required folders:", error);
      new Notice(
        "There was an error creating the required folders. Please check console for details.",
        5000
      );
    }
  }
}
