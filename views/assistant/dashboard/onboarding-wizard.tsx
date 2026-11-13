import React, { useEffect, useState } from "react";
import FileOrganizer from "../../../index";
import { TFile, normalizePath, Notice } from "obsidian";
import { StyledContainer } from "../../../components/ui/utils";
import { tw } from "../../../lib/utils";
import { Inbox } from "../../../inbox";
import { useLocalAIState } from "../../../ai/local-ai-store";

interface OnboardingWizardProps {
  plugin: FileOrganizer;
  /** Which assistant tab to land on after setup or skipping. */
  onComplete: (tab: "inbox" | "organizer") => void;
}

const SAMPLE_NOTE_NAME = "Sample note - project kickoff.md";
const SAMPLE_NOTE_CONTENT = `Kickoff call with Sam and Priya, Tuesday.

Goal: ship the new onboarding by end of next month.
Sam will draft the user flow, Priya owns the copy.
Open question: do we offer a free tier to new users?
Next check-in: Friday 10am.

Ideas: short welcome video, checklist on first launch, email after day 3.
`;

type Step = "welcome" | "local-ai" | "sample" | "done";

function formatMB(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function OnboardingWizard({ plugin, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [isLoading, setIsLoading] = useState(false);
  const aiState = useLocalAIState();

  useEffect(() => {
    plugin.localAI?.refreshFileStatus();
  }, [plugin]);

  const isBusy =
    aiState.status === "downloading" || aiState.status === "loading";

  const progressPercent = aiState.downloadProgress
    ? aiState.downloadProgress.percent
    : aiState.loadProgress
    ? aiState.loadProgress.percent
    : 0;

  const markComplete = async () => {
    plugin.settings.hasRunOnboarding = true;
    await plugin.saveSettings();
  };

  const handleInitializeLocalAI = async () => {
    try {
      await plugin.localAI.initialize({ autoDownload: true });
      setStep("sample");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Local AI initialization failed: ${msg}`, 6000);
    }
  };

  const createSampleNote = async () => {
    setIsLoading(true);
    try {
      await plugin.checkAndCreateRequiredFolders();

      const path = normalizePath(
        `${plugin.settings.pathToWatch}/${SAMPLE_NOTE_NAME}`
      );
      const existing = plugin.app.vault.getAbstractFileByPath(path);
      if (!existing) {
        const file = await plugin.app.vault.create(path, SAMPLE_NOTE_CONTENT);
        if (!plugin.settings.useInbox && file instanceof TFile) {
          Inbox.getInstance().enqueueFiles([file]);
        }
      }
      await markComplete();
      setStep("done");
    } catch (err) {
      console.error("Failed to create sample note:", err);
      new Notice(
        "Could not create the sample note. You can still add notes to the inbox folder.",
        6000
      );
      await markComplete();
      setStep("done");
    } finally {
      setIsLoading(false);
    }
  };

  const skipSetup = async () => {
    await plugin.checkAndCreateRequiredFolders();
    await markComplete();
    onComplete("organizer");
  };

  return (
    <StyledContainer>
      <div className={tw("w-full max-w-xl mx-auto p-3 text-[--text-normal]")}>
        {step === "welcome" && (
          <div className={tw("space-y-3")}>
            <div
              className={tw(
                "text-[--font-ui-smaller] font-semibold text-[--text-muted] uppercase"
              )}
            >
              Welcome to Note Companion (Local Offline Edition)
            </div>
            <p className={tw("m-0")}>
              Drop notes in your Inbox and Note Companion files, tags, renames,
              and formats them 100% locally on your CPU.
            </p>
            <ul className={tw("list-disc pl-5 space-y-1 m-0")}>
              <li>Moves each note into the right folder</li>
              <li>Suggests tags and descriptive titles</li>
              <li>Reads Markdown and local PDF text layers offline</li>
              <li>Zero external servers, API keys, or cloud dependencies</li>
            </ul>
            <button
              onClick={() => setStep("local-ai")}
              className="mod-cta w-full"
            >
              Set up Local AI
            </button>
            <button
              onClick={() => {
                void skipSetup();
              }}
              className={tw(
                "w-full text-sm text-[--text-muted] hover:text-[--text-normal]"
              )}
            >
              Skip for now
            </button>
          </div>
        )}

        {step === "local-ai" && (
          <div className={tw("space-y-3")}>
            <div
              className={tw(
                "text-[--font-ui-smaller] font-semibold text-[--text-muted] uppercase"
              )}
            >
              Initialize Local AI Engine
            </div>
            <p className={tw("m-0 text-sm")}>
              Note Companion uses <strong>Qwen3-1.7B (Q4_K_M GGUF)</strong>{" "}
              inside a dedicated WebAssembly CPU worker. On first setup it
              downloads ~1.1 GB into your plugin folder so everything runs
              completely offline afterward.
            </p>

            <div
              className={tw(
                "border border-[--background-modifier-border] rounded p-3 text-xs space-y-1 bg-[--background-secondary]"
              )}
            >
              <div className={tw("flex justify-between gap-2")}>
                <span className={tw("text-[--text-muted]")}>Model file:</span>
                <span className={tw("font-mono")}>{aiState.modelFileName}</span>
              </div>
              <div className={tw("flex justify-between gap-2")}>
                <span className={tw("text-[--text-muted]")}>Status:</span>
                <span>{aiState.statusMessage}</span>
              </div>
              {aiState.modelExists && (
                <div className={tw("flex justify-between gap-2")}>
                  <span className={tw("text-[--text-muted]")}>Cached size:</span>
                  <span>{formatMB(aiState.modelSizeBytes)}</span>
                </div>
              )}
            </div>

            {(aiState.downloadProgress || aiState.loadProgress) && (
              <div className={tw("space-y-1")}>
                <div className={tw("flex justify-between text-xs text-[--text-muted]")}>
                  <span>
                    {aiState.downloadProgress
                      ? `Downloading ${formatMB(aiState.downloadProgress.downloadedBytes)} / ${
                          aiState.downloadProgress.totalBytes > 0
                            ? formatMB(aiState.downloadProgress.totalBytes)
                            : "..."
                        }`
                      : aiState.loadProgress?.message}
                  </span>
                  <span className={tw("font-mono")}>{progressPercent}%</span>
                </div>
                <div
                  className={tw(
                    "w-full h-2 rounded bg-[--background-modifier-border] overflow-hidden"
                  )}
                >
                  <div
                    className={tw("h-full bg-[--interactive-accent] transition-all")}
                    style={{
                      width: `${Math.min(100, Math.max(0, progressPercent))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {aiState.error && (
              <div className={tw("text-[--text-error] text-xs")}>
                {aiState.error}
              </div>
            )}

            {aiState.status === "downloading" ? (
              <button
                onClick={() => plugin.localAI.cancelDownload()}
                className="w-full"
              >
                Cancel Download
              </button>
            ) : aiState.status === "ready" ? (
              <button
                onClick={() => setStep("sample")}
                className="mod-cta w-full"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={() => {
                  void handleInitializeLocalAI();
                }}
                disabled={isBusy}
                className="mod-cta w-full"
              >
                {isBusy
                  ? "Initializing..."
                  : aiState.modelExists
                  ? "Load Local AI"
                  : "Initialize Local AI (~1.1 GB)"}
              </button>
            )}

            <button
              onClick={() => {
                void skipSetup();
              }}
              className={tw(
                "w-full text-sm text-[--text-muted] hover:text-[--text-normal]"
              )}
            >
              Skip for now
            </button>
          </div>
        )}

        {step === "sample" && (
          <div className={tw("space-y-3")}>
            <div
              className={tw(
                "text-[--font-ui-smaller] font-semibold text-[--text-muted] uppercase"
              )}
            >
              Try it on a note
            </div>
            <p className={tw("m-0")}>
              Local AI is ready. We&apos;ll add a short sample note to your Inbox
              so you can watch Note Companion organize it offline.
            </p>
            <div
              className={tw(
                "border border-[--background-modifier-border] p-2 text-sm"
              )}
            >
              <div className={tw("font-semibold mb-1")}>
                Folders we&apos;ll create:
              </div>
              <div>
                <strong>_NoteCompanion/Inbox</strong>: notes waiting to be
                processed
              </div>
              <div>
                <strong>_NoteCompanion/Processed</strong>: organized notes
              </div>
              <div>
                <strong>_NoteCompanion/References</strong>: reference material
              </div>
            </div>
            <button
              onClick={() => {
                void createSampleNote();
              }}
              disabled={isLoading}
              className="mod-cta w-full"
            >
              {isLoading ? "Setting up..." : "Organize a sample note"}
            </button>
          </div>
        )}

        {step === "done" && (
          <div className={tw("space-y-3")}>
            <div
              className={tw(
                "text-[--font-ui-smaller] font-semibold text-[--text-muted] uppercase"
              )}
            >
              Your first note is being organized
            </div>
            <p className={tw("m-0")}>
              Open the Inbox tab to follow its progress. When it finishes,
              you&apos;ll find the note in{" "}
              <strong>_NoteCompanion/Processed</strong>. From now on, anything
              you drop in the Inbox folder is organized locally on your CPU.
            </p>
            <button
              onClick={() => onComplete("inbox")}
              className="mod-cta w-full"
            >
              Open Inbox
            </button>
          </div>
        )}
      </div>
    </StyledContainer>
  );
}

