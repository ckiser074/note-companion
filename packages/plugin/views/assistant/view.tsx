import { Events, ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { Root, createRoot } from "react-dom/client";
import { AssistantView } from "./organizer/organizer";
import FileOrganizer from "../..";
import { InboxLogs } from "./inbox-logs";
import { SectionHeader } from "./section-header";
import { AppContext } from "./provider";
import AIChatSidebar from "./ai-chat/container";
import { MeetingsTab } from "./meetings";
import { StyledContainer } from "../../components/ui/utils";
import { tw } from "../../lib/utils";
import { Sparkles, Inbox, MessageSquare, Mic } from "lucide-react";
import { Inbox as InboxService } from "../../inbox";

export const ORGANIZER_VIEW_TYPE = "fo2k.assistant.sidebar2";

type Tab = "organizer" | "inbox" | "chat" | "meetings";

function TabContent({
  activeTab,
  plugin,
  leaf,
}: {
  activeTab: Tab;
  plugin: FileOrganizer;
  leaf: WorkspaceLeaf;
}) {
  return (
    <div className={tw("flex flex-col h-full w-full")}>
      <div
        className={tw(
          "flex-1 min-h-0 w-full",
          activeTab === "organizer" ? "block" : "hidden"
        )}
      >
        <AssistantView plugin={plugin} leaf={leaf} />
      </div>

      <div
        className={tw(
          "flex-1 min-h-0 w-full flex flex-col",
          activeTab === "inbox" ? "block" : "hidden"
        )}
      >
        <SectionHeader text="Inbox Processing" icon="📥 " />
        <InboxLogs />
      </div>

      <div
        className={tw(
          "flex-1 min-h-0 w-full",
          activeTab === "chat" ? "flex flex-col" : "hidden"
        )}
      >
        <AIChatSidebar
          plugin={plugin}
          isChatTabActive={activeTab === "chat"}
        />
      </div>

      <div
        className={tw(
          "flex-1 min-h-0 w-full",
          activeTab === "meetings" ? "block" : "hidden"
        )}
      >
        <MeetingsTab plugin={plugin} />
      </div>
    </div>
  );
}

function TabButton({
  isActive,
  onClick,
  icon,
  children,
  badge,
}: {
  isActive: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={tw(
        "px-4 py-2 text-sm transition-all relative flex items-center gap-2",
        isActive
          ? "text-[--text-normal] font-medium"
          : "text-[--text-muted] hover:text-[--text-normal]"
      )}
      style={
        isActive
          ? {
              borderBottom: "2px solid var(--interactive-accent)",
              marginBottom: "-1px",
            }
          : undefined
      }
    >
      {icon && <span className={tw("w-4 h-4 flex-shrink-0")}>{icon}</span>}
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className={tw(
            "ml-1 px-1.5 py-0.5 text-xs rounded-full bg-[--interactive-accent] text-[--text-on-accent] font-medium min-w-[1.25rem] text-center"
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function AssistantContent({
  plugin,
  leaf,
  initialTab,
  onTabChange,
}: {
  plugin: FileOrganizer;
  leaf: WorkspaceLeaf;
  initialTab: Tab;
  onTabChange: (setTab: (tab: Tab) => void) => void;
}) {
  const [activeTab, setActiveTab] = React.useState<Tab>(initialTab);
  const [processingCount, setProcessingCount] = React.useState(0);

  React.useEffect(() => {
    onTabChange(setActiveTab);
  }, [onTabChange]);

  // Track processing count for Inbox badge
  React.useEffect(() => {
    const updateProcessingCount = () => {
      try {
        const inbox = InboxService.getInstance();
        const analytics = inbox.getAnalytics();
        const activeCount =
          analytics.queueStats.processing + analytics.queueStats.queued;
        setProcessingCount(activeCount);
      } catch {
        setProcessingCount(0);
      }
    };

    updateProcessingCount();
    const interval = window.setInterval(updateProcessingCount, 500);

    const handler = () => updateProcessingCount();
    const workspaceEvents = plugin.app.workspace as Events;
    workspaceEvents.on("file-organizer:processing-step", handler);

    return () => {
      window.clearInterval(interval);
      workspaceEvents.off("file-organizer:processing-step", handler);
    };
  }, [plugin]);

  return (
    <div className={tw("flex flex-col h-full w-full")}>
      {/* Native tab navigation */}
      <div
        className={tw(
          "flex gap-0 px-3 pt-2 pb-0 border-b border-[--background-modifier-border] bg-[--background-primary] items-center justify-between"
        )}
      >
        <div className={tw("flex gap-0")}>
          <TabButton
            isActive={activeTab === "organizer"}
            onClick={() => setActiveTab("organizer")}
            icon={<Sparkles className="w-4 h-4" />}
          >
            Organizer
          </TabButton>
          <TabButton
            isActive={activeTab === "inbox"}
            onClick={() => setActiveTab("inbox")}
            icon={<Inbox className="w-4 h-4" />}
            badge={processingCount}
          >
            Inbox
          </TabButton>
          <TabButton
            isActive={activeTab === "chat"}
            onClick={() => setActiveTab("chat")}
            icon={<MessageSquare className="w-4 h-4" />}
          >
            Chat
          </TabButton>
          <TabButton
            isActive={activeTab === "meetings"}
            onClick={() => setActiveTab("meetings")}
            icon={<Mic className="w-4 h-4" />}
          >
            Meetings
          </TabButton>
        </div>
      </div>

      {/* Content area - no padding */}
      <div className={tw("flex-1 min-h-0 w-full overflow-hidden")}>
        <TabContent activeTab={activeTab} plugin={plugin} leaf={leaf} />
      </div>
    </div>
  );
}

export class AssistantViewWrapper extends ItemView {
  root: Root | null = null;
  plugin: FileOrganizer;
  private activeTab: Tab = "organizer";
  private setActiveTab: (tab: Tab) => void = () => {};

  constructor(leaf: WorkspaceLeaf, plugin: FileOrganizer) {
    super(leaf);
    this.plugin = plugin;

    this.plugin.addCommand({
      id: "open-organizer-tab",
      name: "Open organizer tab",
      callback: () => this.activateTab("organizer"),
    });

    this.plugin.addCommand({
      id: "open-inbox-tab",
      name: "Open inbox tab",
      callback: () => this.activateTab("inbox"),
    });

    this.plugin.addCommand({
      id: "open-chat-tab",
      name: "Open chat tab",
      callback: () => this.activateTab("chat"),
    });

    this.plugin.addCommand({
      id: "open-meetings-tab",
      name: "Open meetings tab",
      callback: () => this.activateTab("meetings"),
    });
  }

  activateTab(tab: Tab) {
    // Ensure view is open
    void this.plugin.app.workspace.revealLeaf(this.leaf);

    // Update tab
    this.activeTab = tab;
    this.setActiveTab(tab);
  }

  getViewType(): string {
    return ORGANIZER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Note companion";
  }

  getIcon(): string {
    return "sparkle";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.addClass("fo2k-view");
    this.root = createRoot(container);
    this.render();
  }

  render(): void {
    this.root?.render(
      <AppContext.Provider value={{ plugin: this.plugin, root: this.root }}>
        <React.StrictMode>
          <StyledContainer>
            <AssistantContent
              plugin={this.plugin}
              leaf={this.leaf}
              initialTab={this.activeTab}
              onTabChange={setTab => {
                this.setActiveTab = setTab;
              }}
            />
          </StyledContainer>
        </React.StrictMode>
      </AppContext.Provider>
    );
  }

  async onClose(): Promise<void> {
    this.containerEl.children[1].removeClass("fo2k-view");
    this.root?.unmount();
  }
}
