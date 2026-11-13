import * as React from "react";
import { TFile, WorkspaceLeaf, Notice, TAbstractFile } from "obsidian";
import FileOrganizer from "../../../index";

import { SectionHeader } from "../section-header";
import { AtomicNotes } from "./chunks";
import { RefreshButton } from "./components/refresh-button";
import { TranscriptionButton } from "./transcript";
import { EmptyState } from "./components/empty-state";
import { logMessage } from "../../../someUtils";
import { VALID_MEDIA_EXTENSIONS } from "../../../constants";
import { logger } from "../../../services/logger";
import { tw } from "../../../lib/utils";
import { isTokenLimitError } from "../../../lib/token-limit-error";

interface AssistantViewProps {
  plugin: FileOrganizer;
  leaf: WorkspaceLeaf;
  onTokenLimitError?: (error: string) => void;
}

const checkIfIsMediaFile = (file: TFile | null): boolean => {
  if (!file) return false;
  return VALID_MEDIA_EXTENSIONS.includes(file.extension);
};

type DebouncedFn = {
  (): void;
  cancel: () => void;
};

function createDebouncedFn(fn: () => void, delayMs: number): DebouncedFn {
  let timeoutId: number | null = null;

  const debounced = () => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      fn();
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

export const AssistantView: React.FC<AssistantViewProps> = ({
  plugin,
  leaf,
  onTokenLimitError,
}) => {
  const [activeFile, setActiveFile] = React.useState<TFile | null>(null);
  const [noteContent, setNoteContent] = React.useState<string>("");
  const [refreshKey, setRefreshKey] = React.useState<number>(0);
  const [error, setError] = React.useState<string | null>(null);
  const [organizing, setOrganizing] = React.useState(false);
  const [organizationError, setOrganizationError] = React.useState<
    string | null
  >(null);

  // Use refs to track the active file and path for rename detection
  const activeFilePathRef = React.useRef<string | null>(null);
  const activeFileRef = React.useRef<TFile | null>(null);
  const isRenamingRef = React.useRef<boolean>(false);

  const isMediaFile = React.useMemo(
    () => checkIfIsMediaFile(activeFile),
    [activeFile]
  );

  const isInIgnoredPatterns = React.useMemo(
    () =>
      plugin
        .getAllIgnoredFolders()
        .some(folder => activeFile?.path.startsWith(folder)),
    [activeFile, plugin]
  );

  const updateActiveFile = React.useCallback(async () => {
    // Skip if we're in the middle of a rename operation
    if (isRenamingRef.current) {
      return;
    }

    logMessage("updating active file");
    // Check if the Assistant view is visible before processing
    const isVisible =
      leaf.view.containerEl.isShown() &&
      !plugin.app.workspace.rightSplit.collapsed;
    if (!isVisible) return;

    try {
      const file = plugin.app.workspace.getActiveFile();
      if (file && !isMediaFile) {
        const content = await plugin.app.vault.read(file);
        setNoteContent(content);
      }
      setActiveFile(file);
      // Update the refs when active file changes
      activeFileRef.current = file;
      activeFilePathRef.current = file ? file.path : null;
    } catch (err) {
      logger.error("Error updating active file:", err);
      setError("Failed to load file content");
    }
  }, [plugin, leaf, isMediaFile]);

  React.useEffect(() => {
    void updateActiveFile();
    const debouncedUpdate = createDebouncedFn(() => {
      void updateActiveFile();
    }, 300);

    // Handle file rename - update activeFile if the current file was renamed
    const handleRename = (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile)) return;

      // Check if the renamed file is the currently active file
      const currentActiveFile = plugin.app.workspace.getActiveFile();
      const storedPath = activeFilePathRef.current;

      // Check multiple conditions to detect if this rename affects the active file:
      // 1. Stored ref path matches old path (most reliable)
      // 2. Workspace active file matches new path AND we have a stored path that matches old path
      // 3. Workspace active file matches new path AND stored path is null (initial load case)
      const isActiveFileRenamed =
        storedPath === oldPath || // Primary check: stored path matches old path
        (currentActiveFile &&
          currentActiveFile.path === file.path &&
          (storedPath === oldPath || !storedPath)); // Secondary check: workspace updated and we can verify

      if (isActiveFileRenamed) {
        logger.info("Detected rename of active file:", {
          oldPath,
          newPath: file.path,
          storedPath,
          currentActivePath: currentActiveFile?.path,
        });
        // This rename affects the active file - update the state immediately
        setActiveFile(file);
        activeFileRef.current = file;
        activeFilePathRef.current = file.path; // Update the ref with new path

        // Also refresh the active file to ensure we have the latest reference
        // Use a small delay to ensure Obsidian has fully processed the rename
        window.setTimeout(() => {
          void updateActiveFile();
        }, 100);
      } else {
        // Fallback: Check if workspace active file path differs from our state
        // This handles cases where the rename event fires but our stored path check fails
        const stateActiveFile = activeFileRef.current;
        if (
          currentActiveFile &&
          currentActiveFile.path === file.path &&
          stateActiveFile &&
          stateActiveFile.path !== file.path
        ) {
          logger.info(
            "Detected active file path mismatch after rename, updating:",
            {
              statePath: stateActiveFile.path,
              workspacePath: currentActiveFile.path,
              renamedPath: file.path,
            }
          );
          // Update to match workspace
          setActiveFile(file);
          activeFileRef.current = file;
          activeFilePathRef.current = file.path;
          window.setTimeout(() => {
            void updateActiveFile();
          }, 100);
        }
      }
    };

    const onWorkspaceChange = () => {
      debouncedUpdate();
    };

    // Attach event listeners
    plugin.app.workspace.on("file-open", onWorkspaceChange);
    plugin.app.workspace.on("active-leaf-change", onWorkspaceChange);
    plugin.app.vault.on("rename", handleRename);

    // Cleanup function to remove event listeners
    return () => {
      plugin.app.workspace.off("file-open", onWorkspaceChange);
      plugin.app.workspace.off("active-leaf-change", onWorkspaceChange);
      plugin.app.vault.off("rename", handleRename);
      debouncedUpdate.cancel();
    };
  }, [updateActiveFile, plugin]);

  const refreshContext = React.useCallback(() => {
    plugin.clearOrganizerSuggestionCaches();
    setRefreshKey(prevKey => prevKey + 1);
    setError(null);

    // Force reset the state variables that determine what's displayed
    setActiveFile(null);
    activeFileRef.current = null;
    activeFilePathRef.current = null;
    setNoteContent("");

    // Then update the active file with fresh checks
    window.setTimeout(() => {
      void updateActiveFile();
    }, 50); // Small delay to ensure state is cleared before updating
  }, [plugin, updateActiveFile]);

  const renderSection = React.useCallback(
    (component: React.ReactNode, errorMessage: string) => {
      try {
        return component;
      } catch (err) {
        logger.error(errorMessage, err);
        return <div className="section-error">{errorMessage}</div>;
      }
    },
    []
  );

  const handleDelete = React.useCallback(async () => {
    if (!activeFile) return;

    try {
      await plugin.app.fileManager.trashFile(activeFile);
      new Notice("File deleted successfully");
    } catch (err) {
      logger.error("Error deleting file:", err);
      setError("Failed to delete file");
    }
  }, [activeFile, plugin.app.vault]);

  const handleOrganizeNote = React.useCallback(async () => {
    if (!activeFile || organizing) return;

    setOrganizing(true);
    setOrganizationError(null);
    isRenamingRef.current = true;
    try {
      const organizedFile = await plugin.classifyAndOrganizeNote(
        activeFile,
        noteContent
      );
      const content = await plugin.app.vault.read(organizedFile);
      activeFileRef.current = organizedFile;
      activeFilePathRef.current = organizedFile.path;
      setActiveFile(organizedFile);
      setNoteContent(content);
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      logger.error("[PARA Companion] Organizer action failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setOrganizationError(message);
      if (isTokenLimitError(err)) {
        onTokenLimitError?.(message);
      }
    } finally {
      isRenamingRef.current = false;
      setOrganizing(false);
    }
  }, [activeFile, noteContent, onTokenLimitError, organizing, plugin]);


  if (error) {
    return (
      <div className={tw("flex flex-col h-full")}>
        <div
          className={tw(
            "flex gap-2 items-center px-3 py-2 border-b border-[--background-modifier-border]"
          )}
        >
          <RefreshButton onRefresh={refreshContext} />
        </div>
        <div className={tw("px-3")}>
          <EmptyState
            message={`Error: ${error}. Click refresh to try again.`}
            showRefresh={false}
            onRefresh={refreshContext}
          />
        </div>
      </div>
    );
  }

  if (!activeFile) {
    return (
      <div className={tw("flex flex-col h-full")}>
        <div
          className={tw(
            "flex gap-2 items-center px-3 py-2 border-b border-[--background-modifier-border]"
          )}
        >
          <RefreshButton onRefresh={refreshContext} />
        </div>
        <div className={tw("px-3")}>
          <EmptyState message="Open a file " />
        </div>
      </div>
    );
  }

  if (isInIgnoredPatterns) {
    return (
      <div className={tw("flex flex-col h-full")}>
        <div
          className={tw(
            "flex gap-2 items-center px-3 py-2 border-b border-[--background-modifier-border]"
          )}
        >
          <RefreshButton onRefresh={refreshContext} />
        </div>
        <div className={tw("px-3")}>
          <EmptyState message="This file is part of an ignored folder and will not be processed." />
        </div>
      </div>
    );
  }

  if (isMediaFile) {
    return (
      <div className={tw("flex flex-col h-full")}>
        <div
          className={tw(
            "flex gap-2 items-center px-3 py-2 border-b border-[--background-modifier-border]"
          )}
        >
          <RefreshButton onRefresh={refreshContext} />
        </div>
        <div className={tw("px-3")}>
          <EmptyState message="To process an image or audio file, move it to the PARA Companion Inbox folder (e.g. for image text extraction or audio transcription)." />
        </div>
      </div>
    );
  }

  if (!noteContent.trim()) {
    return (
      <div className={tw("flex flex-col h-full")}>
        <div
          className={tw(
            "flex gap-2 items-center px-3 py-2 border-b border-[--background-modifier-border]"
          )}
        >
          <RefreshButton onRefresh={refreshContext} />
        </div>
        <div className={tw("px-3")}>
          <EmptyState
            message="This file is empty. Add content, then use Organize Note to route it with PARA."
            showRefresh={false}
            onRefresh={refreshContext}
            showDelete={true}
            onDelete={() => { void handleDelete(); }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={tw("flex flex-col h-full overflow-y-auto")}>
      {/* Compact header - flush to edges */}
      <div
        className={tw(
          "flex gap-2 items-center px-3 py-2 border-b border-[--background-modifier-border] bg-[--background-primary] sticky top-0 z-10"
        )}
      >
        <RefreshButton onRefresh={refreshContext} />
        <div
          className={tw("text-xs text-[--text-normal] font-medium truncate")}
        >
          {activeFile.basename}
        </div>
      </div>

      {/* Content sections - consistent padding with other tabs */}
      <div className={tw("flex flex-col px-3")}>
        <SectionHeader text="PARA organization" icon="🗂️ " />
        <div className="p-3 border-b border-[--background-modifier-border]">
          <p className="text-sm text-[--text-muted] mt-0">
            Classify, choose a folder and title, and add tags in one local AI
            request.
          </p>
          <button
            className="mod-cta px-3 py-1.5 rounded disabled:opacity-50"
            disabled={organizing}
            onClick={() => { void handleOrganizeNote(); }}
          >
            {organizing ? "Organizing..." : "Organize Note"}
          </button>
          {organizationError && (
            <p className="text-sm text-[--text-error] mb-0">
              {organizationError}
            </p>
          )}
        </div>

        {plugin.settings.enableAtomicNotes && (
          <>
            <SectionHeader text="Atomic notes" icon="✂️ " />
            {renderSection(
              <AtomicNotes
                plugin={plugin}
                activeFile={activeFile}
                refreshKey={refreshKey}
              />,
              "Error loading atomic notes"
            )}
          </>
        )}

        {hasAudioEmbed(noteContent) && (
          <>
            <SectionHeader text="Audio Transcription" icon="🎙️ " />
            {renderSection(
              <TranscriptionButton
                plugin={plugin}
                file={activeFile}
                content={noteContent}
              />,
              "Error loading transcription button"
            )}
          </>
        )}
      </div>
    </div>
  );
};

const hasAudioEmbed = (content: string): boolean => {
  const audioRegex = /!\[\[(.*\.(mp3|wav|m4a|ogg|webm))]]/i;
  return audioRegex.test(content);
};
