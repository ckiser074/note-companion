import React, { useRef, useState } from "react";
import { TFile, Editor } from "obsidian";
import { logger } from "../../../../services/logger";
import { usePlugin } from "../../provider";
import { buildModifyMessages } from "../../../../ai/chatml";
import { ToolHandlerProps } from "./types";

interface ModifyTextArgs {
  content: string;
  path?: string;
  instructions: string;
}

interface DiffLine {
  value: string;
  added?: boolean;
  removed?: boolean;
}

interface LocalModifyResult {
  content: string;
  explanation?: string;
}

function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;

  // Guard huge inputs against O(m*n) memory; fall back to block replace diff
  if (m * n > 250_000) {
    return [
      ...a.map((value) => ({ value, removed: true })),
      ...b.map((value) => ({ value, added: true })),
    ];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      result.push({ value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ value: a[i], removed: true });
      i++;
    } else {
      result.push({ value: b[j], added: true });
      j++;
    }
  }
  while (i < m) {
    result.push({ value: a[i], removed: true });
    i++;
  }
  while (j < n) {
    result.push({ value: b[j], added: true });
    j++;
  }
  return result;
}

export function ModifyTextHandler({
  toolInvocation,
  handleAddResult,
  app,
}: ToolHandlerProps) {
  const hasFetchedRef = useRef(false);
  const [modifySuccess, setModifySuccess] = useState<boolean | null>(null);
  const [diff, setDiff] = useState<DiffLine[]>([]);
  const [explanation, setExplanation] = useState<string>("");
  const [isApplying, setIsApplying] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<{
    content: string;
    targetFile: TFile;
    editor?: Editor;
  } | null>(null);
  const plugin = usePlugin();

  React.useEffect(() => {
    const fetchModifications = async () => {
      if (!hasFetchedRef.current && !("result" in toolInvocation)) {
        hasFetchedRef.current = true;
        const { content, path, instructions } =
          toolInvocation.args as unknown as ModifyTextArgs;
        try {
          let targetFile: TFile;
          let originalContent: string;

          if (path) {
            const abstractFile = app.vault.getAbstractFileByPath(path);
            if (!(abstractFile instanceof TFile)) {
              throw new Error(`File not found at path: ${path}`);
            }
            targetFile = abstractFile;
          } else {
            const activeFile = app.workspace.getActiveFile();
            if (!activeFile) {
              throw new Error("No active file found");
            }
            targetFile = activeFile;
          }

          originalContent = await app.vault.read(targetFile);
          const targetText = content || originalContent;

          const data = await plugin.localAI.generateJSON<LocalModifyResult>(
            buildModifyMessages(targetText, instructions, originalContent),
            { temperature: 0.1, maxTokens: 1536 }
          );

          if (!data || typeof data.content !== "string") {
            throw new Error("Local AI did not return modified content");
          }

          setDiff(computeLineDiff(targetText, data.content));
          setExplanation(data.explanation || "Proposed local edit");

          const editor = app.workspace.activeEditor?.editor;
          setPendingChanges({
            content: data.content,
            targetFile,
            editor,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.error("Error modifying text in document:", error);
          handleAddResult(`Error: ${errorMessage}`);
          setModifySuccess(false);
        }
      }
    };

    void fetchModifications();
  }, [toolInvocation, handleAddResult, app, plugin]);

  const handleApplyChanges = async () => {
    if (!pendingChanges) return;

    setIsApplying(true);
    try {
      const { content, targetFile, editor } = pendingChanges;

      if (editor) {
        const selection = editor.getSelection();
        if (selection) {
          editor.replaceSelection(content);
        } else {
          editor.setValue(content);
        }
      } else {
        await app.vault.modify(targetFile, content);
      }

      logger.info(`Successfully modified text in document: ${targetFile.path}`);
      handleAddResult(
        `Successfully modified text in document${targetFile.path ? `: ${targetFile.path}` : ""}`
      );
      setModifySuccess(true);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Error applying modifications:", error);
      handleAddResult(`Error applying changes: ${errorMessage}`);
      setModifySuccess(false);
    } finally {
      setIsApplying(false);
    }
  };

  const handleDiscardChanges = () => {
    handleAddResult("Changes discarded by user");
    setModifySuccess(false);
    setPendingChanges(null);
  };

  const renderDiff = () => {
    return (
      <div className="font-mono text-xs leading-snug">
        {diff.map((line, index) => {
          if (!line.added && !line.removed && !line.value.trim()) {
            return null;
          }

          let bgColor = "";
          if (line.added) {
            bgColor = "rgba(var(--color-green-rgb, 0, 255, 0), 0.15)";
          } else if (line.removed) {
            bgColor = "rgba(var(--color-red-rgb, 255, 0, 0), 0.15)";
          }

          return (
            <div
              key={index}
              style={bgColor ? { backgroundColor: bgColor } : {}}
              className={`py-0.5 px-2 flex items-start border-l-2 ${
                line.added
                  ? "border-[--text-success]"
                  : line.removed
                    ? "border-[--text-error]"
                    : "border-transparent"
              }`}
            >
              <span
                className={`select-none mr-2 w-4 flex-shrink-0 font-bold ${
                  line.added
                    ? "text-[--text-success]"
                    : line.removed
                      ? "text-[--text-error]"
                      : "text-[--text-faint]"
                }`}
              >
                {line.added ? "+" : line.removed ? "−" : ""}
              </span>
              <span
                className={`flex-1 whitespace-pre-wrap break-words ${
                  line.removed ? "line-through opacity-75 text-[--text-error]" : ""
                } ${
                  line.added ? "font-medium text-[--text-success]" : ""
                } ${
                  !line.added && !line.removed ? "text-[--text-muted]" : ""
                }`}
              >
                {line.value}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  if (modifySuccess === null && !pendingChanges) {
    return (
      <div className="p-2 text-sm text-[--text-muted]">
        Analyzing changes...
      </div>
    );
  }

  if (pendingChanges && !modifySuccess) {
    const addedCount = diff.filter((d) => d.added).length;
    const removedCount = diff.filter((d) => d.removed).length;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between border-b border-[--background-modifier-border] pb-2">
          <div className="text-xs font-semibold text-[--text-muted] uppercase">
            Review Changes
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscardChanges}
              className="px-2 py-1 text-xs border border-[--background-modifier-border] hover:bg-[--background-modifier-hover] text-[--text-muted]"
              disabled={isApplying}
            >
              Discard
            </button>
            <button
              onClick={() => {
                void handleApplyChanges();
              }}
              disabled={isApplying}
              className="px-2 py-1 text-xs bg-[--interactive-accent] hover:bg-[--interactive-accent-hover] text-[--text-on-accent] flex items-center gap-1"
            >
              {isApplying ? (
                <>
                  <span className="animate-spin">⟳</span>
                  <span>Applying...</span>
                </>
              ) : (
                <>
                  <span>✓</span>
                  <span>Apply</span>
                </>
              )}
            </button>
          </div>
        </div>

        {explanation && (
          <div className="p-2 border-b border-[--background-modifier-border]">
            <div className="text-xs font-semibold text-[--text-muted] uppercase mb-1">
              Summary
            </div>
            <div className="text-xs text-[--text-normal]">{explanation}</div>
          </div>
        )}

        <div className="border border-[--background-modifier-border]">
          <div className="border-b border-[--background-modifier-border] px-2 py-1 flex items-center justify-between">
            <div className="text-xs font-semibold text-[--text-muted] uppercase">
              Diff
            </div>
            <div className="flex items-center gap-3 text-xs">
              {removedCount > 0 && (
                <span className="text-[--text-error] flex items-center gap-1">
                  <span>−</span>
                  <span>{removedCount} removed</span>
                </span>
              )}
              {addedCount > 0 && (
                <span className="text-[--text-success] flex items-center gap-1">
                  <span>+</span>
                  <span>{addedCount} added</span>
                </span>
              )}
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto">{renderDiff()}</div>
        </div>
      </div>
    );
  }

  if (modifySuccess) {
    return (
      <div className="p-3 space-y-2 border-b border-[--background-modifier-border]">
        <div className="flex items-center text-[--text-success] space-x-2">
          <span className="text-base">✓</span>
          <span className="text-sm font-medium">Changes Applied Successfully</span>
        </div>
        {explanation && (
          <div className="text-xs text-[--text-muted]">{explanation}</div>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2 border-b border-[--background-modifier-border]">
      <div className="flex items-center text-[--text-error] space-x-2">
        <span className="text-base">⚠</span>
        <span className="text-sm font-medium">Failed to Apply Changes</span>
      </div>
      {explanation && (
        <div className="text-xs text-[--text-muted]">
          <strong>Attempted Changes:</strong> {explanation}
        </div>
      )}
    </div>
  );
}
