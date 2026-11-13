import type {
  ChatRequestOptions,
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai";
import type FileOrganizer from "../index";
import { parseJSONFromModelOutput } from "./chatml";
import type { ChatMLMessage } from "./types";

const LOCAL_TOOL_SPECS = [
  {
    name: "getSearchQuery",
    description: "Search notes in the vault by keywords or topics.",
    parameters: '{"query":"string"}',
  },
  {
    name: "searchByName",
    description: "Find files in the vault whose file names match a query.",
    parameters: '{"query":"string"}',
  },
  {
    name: "getTaggedFiles",
    description: "List vault files containing a specific tag.",
    parameters: '{"tag":"string"}',
  },
  {
    name: "moveFiles",
    description: "Move one or more files into a destination folder.",
    parameters:
      '{"moves":[{"sourcePath":"path/to/file.md","destinationFolder":"Target/Folder"}]}',
  },
  {
    name: "renameFiles",
    description: "Rename vault files.",
    parameters:
      '{"files":[{"oldPath":"path/to/old.md","newName":"New Title"}]}',
  },
  {
    name: "addTags",
    description: "Add tags to specified vault files.",
    parameters: '{"files":["path/to/file.md"],"tags":["#tag1","#tag2"]}',
  },
  {
    name: "openFile",
    description: "Open a specific note in Obsidian.",
    parameters: '{"filePath":"path/to/file.md"}',
  },
  {
    name: "getFileMetadata",
    description: "Read frontmatter, tags, links, and metadata for files.",
    parameters: '{"filePaths":["path/to/file.md"]}',
  },
  {
    name: "updateFrontmatter",
    description: "Update YAML frontmatter properties on a note.",
    parameters: '{"filePath":"path/to/file.md","properties":{"key":"value"}}',
  },
  {
    name: "appendContentToFile",
    description: "Append markdown content to a vault file.",
    parameters: '{"filePath":"path/to/file.md","content":"markdown text"}',
  },
  {
    name: "createNewFiles",
    description: "Create one or more new notes in the vault.",
    parameters:
      '{"files":[{"fileName":"Note Title","content":"markdown","folder":"Optional/Folder"}]}',
  },
];

const VALID_TOOL_NAMES = new Set(LOCAL_TOOL_SPECS.map((t) => t.name));

interface ParsedToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Extracts a tool call JSON object if the model decided to invoke a vault tool.
 */
export function tryParseToolCall(raw: string): ParsedToolCall | null {
  const trimmed = raw.trim();
  if (!trimmed.includes('"tool"')) {
    return null;
  }
  try {
    const parsed = parseJSONFromModelOutput<Record<string, unknown>>(trimmed);
    if (
      parsed &&
      typeof parsed.tool === "string" &&
      VALID_TOOL_NAMES.has(parsed.tool)
    ) {
      const args =
        parsed.arguments && typeof parsed.arguments === "object"
          ? (parsed.arguments as Record<string, unknown>)
          : {};
      return {
        tool: parsed.tool,
        arguments: args,
      };
    }
  } catch {
    // Normal prose response
  }
  return null;
}

export function buildLocalChatMessages(
  messages: UIMessage[],
  contextString?: string,
  maxContextChars = 6000
): ChatMLMessage[] {
  const toolCatalog = LOCAL_TOOL_SPECS.map(
    (t) => `- ${t.name}: ${t.description} Schema: ${t.parameters}`
  ).join("\n");

  const trimmedContext = contextString
    ? contextString.slice(0, maxContextChars)
    : "";

  const systemPrompt = `You are PARA Companion, an offline AI assistant running locally on the user's computer inside Obsidian.
Help the user organize, search, tag, rename, move, and edit their notes concisely and accurately.

Available Vault Tools:
${toolCatalog}

TOOL CALLING RULES:
- If you need to invoke one of the tools above, respond with ONLY a single raw JSON object (no markdown fences, no commentary) formatted exactly as:
{"tool":"<tool_name>","arguments":{...}}
- Wait for the tool output turn before giving your final answer to the user.
- If no tool is needed, answer directly in clean Markdown.${
    trimmedContext
      ? `\n\nAttached Obsidian Vault Context:\n${trimmedContext}`
      : ""
  }`;

  const result: ChatMLMessage[] = [{ role: "system", content: systemPrompt }];

  // Keep recent turns so the small local CPU context stays responsive.
  const recentMessages = messages.slice(-12);

  for (const msg of recentMessages) {
    if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "system") {
      continue;
    }

    const partsText: string[] = [];
    const parts = Array.isArray(msg.parts) ? msg.parts : [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
        partsText.push(p.text);
      } else if (typeof p.type === "string" && p.type.startsWith("tool-")) {
        const toolName =
          typeof p.toolName === "string"
            ? p.toolName
            : p.type.replace(/^tool-/, "");
        if (p.state === "output-available") {
          const outStr = JSON.stringify(p.output ?? {}).slice(0, 2000);
          partsText.push(
            `[Tool "${toolName}" executed with input ${JSON.stringify(p.input ?? {})} -> Output: ${outStr}]`
          );
        } else if (p.state === "output-error") {
          partsText.push(
            `[Tool "${toolName}" failed: ${String(p.errorText ?? "error")}]`
          );
        } else if (p.input !== undefined) {
          partsText.push(
            JSON.stringify({ tool: toolName, arguments: p.input })
          );
        }
      }
    }

    const combined = partsText.join("\n").trim();
    if (combined) {
      result.push({
        role: msg.role,
        content: combined,
      });
    }
  }

  return result;
}

export class LocalChatTransport implements ChatTransport<UIMessage> {
  constructor(private plugin: FileOrganizer) {}

  async sendMessages(
    options: {
      trigger: "submit-message" | "regenerate-message";
      chatId: string;
      messageId: string | undefined;
      messages: UIMessage[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    const body = (options.body ?? {}) as {
      newUnifiedContext?: string;
    };

    const maxCtx = this.plugin.settings.localContextSize || 2048;
    const contextBudget = Math.max(2000, Math.floor(maxCtx * 2.2));
    const chatMessages = buildLocalChatMessages(
      options.messages,
      body.newUnifiedContext,
      contextBudget
    );

    const textPartId = `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        let textStarted = false;
        let bufferedPrefix = "";
        let decidedTextMode = false;

        try {
          controller.enqueue({ type: "start" });
          controller.enqueue({ type: "start-step" });

          const fullText = await this.plugin.localAI.streamGenerate(
            chatMessages,
            {
              temperature: 0.1,
              maxTokens: 1024,
              signal: options.abortSignal,
              suppressThinking: true,
            },
            (delta, cleanFullText) => {
              // Hold the first few characters if it looks like a JSON tool call so
              // raw tool JSON isn't flashed as assistant prose before emitting tool-input-available.
              if (!decidedTextMode) {
                bufferedPrefix = cleanFullText;
                const trimmedStart = cleanFullText.trimStart();
                if (trimmedStart.startsWith("{") || trimmedStart.startsWith("```")) {
                  return;
                }
                if (trimmedStart.length > 0) {
                  decidedTextMode = true;
                  textStarted = true;
                  controller.enqueue({ type: "text-start", id: textPartId });
                  controller.enqueue({
                    type: "text-delta",
                    id: textPartId,
                    delta: bufferedPrefix,
                  });
                }
                return;
              }

              if (delta) {
                controller.enqueue({
                  type: "text-delta",
                  id: textPartId,
                  delta,
                });
              }
            }
          );

          const toolCall = tryParseToolCall(fullText);
          if (toolCall && !textStarted) {
            const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            controller.enqueue({
              type: "tool-input-start",
              toolCallId,
              toolName: toolCall.tool,
            });
            controller.enqueue({
              type: "tool-input-available",
              toolCallId,
              toolName: toolCall.tool,
              input: toolCall.arguments,
            });
          } else {
            if (!textStarted) {
              controller.enqueue({ type: "text-start", id: textPartId });
              if (fullText) {
                controller.enqueue({
                  type: "text-delta",
                  id: textPartId,
                  delta: fullText,
                });
              }
            }
            controller.enqueue({ type: "text-end", id: textPartId });
          }

          controller.enqueue({ type: "finish-step" });
          controller.enqueue({ type: "finish" });
          controller.close();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (error instanceof Error && error.name === "AbortError") {
            if (textStarted) {
              controller.enqueue({ type: "text-end", id: textPartId });
            }
            controller.enqueue({ type: "finish-step" });
            controller.enqueue({ type: "finish" });
            controller.close();
            return;
          }
          controller.enqueue({
            type: "error",
            errorText: message,
          });
          controller.close();
        }
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
