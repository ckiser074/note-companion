import { DEFAULT_SETTINGS } from "../../../settings";
import {
  formatQwenChatML,
  parseJSONFromModelOutput,
  stripThinkingBlocks,
} from "../../../ai/chatml";
import {
  buildLocalChatMessages,
  tryParseToolCall,
} from "../../../ai/local-chat-transport";

describe("local offline AI chat routing & Qwen3 ChatML", () => {
  it("configures local Qwen3 defaults with num_ctx 2048 and offline audio/OCR disabled", () => {
    expect(DEFAULT_SETTINGS.localModelId).toContain("Qwen3-0.6B");
    expect(DEFAULT_SETTINGS.localModelFileName).toBe("Qwen3-0.6B-Q4_K_M.gguf");
    expect(DEFAULT_SETTINGS.localContextSize).toBe(2048);
    expect(DEFAULT_SETTINGS.enableImageDescription).toBe(false);
    expect(DEFAULT_SETTINGS.enableAudioTranscription).toBe(false);
  });

  it("formats prompts in Qwen3 ChatML with /no_think injected by default", () => {
    const prompt = formatQwenChatML([
      { role: "system", content: "Return JSON." },
      { role: "user", content: "Tag this note." },
    ]);
    expect(prompt).toContain("<|im_start|>system\nReturn JSON.\n/no_think<|im_end|>");
    expect(prompt).toContain("<|im_start|>user\nTag this note.<|im_end|>");
    expect(prompt.endsWith("<|im_start|>assistant\n")).toBe(true);
  });

  it("strips completed and partial <think> blocks cleanly", () => {
    expect(stripThinkingBlocks("<think>reasoning</think>\nHello")).toBe("Hello");
    expect(stripThinkingBlocks("Hello<think>unclosed")).toBe("Hello");
  });

  it("parses JSON wrapped in markdown fences or prose", () => {
    const parsed = parseJSONFromModelOutput<{ tags: string[] }>(
      '<think>ok</think>\n```json\n{"tags":["#work"]}\n```'
    );
    expect(parsed.tags).toEqual(["#work"]);
  });

  it("extracts valid vault tool calls and ignores normal prose", () => {
    const call = tryParseToolCall(
      '{"tool":"moveFiles","arguments":{"moves":[{"sourcePath":"a.md","destinationFolder":"Notes"}]}}'
    );
    expect(call).toEqual({
      tool: "moveFiles",
      arguments: {
        moves: [{ sourcePath: "a.md", destinationFolder: "Notes" }],
      },
    });
    expect(tryParseToolCall("Here is a summary of your note.")).toBeNull();
  });

  it("builds local chat messages preserving recent context and tool results", () => {
    const msgs = buildLocalChatMessages(
      [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "Find notes about React" }],
        },
      ],
      '{"currentFile":{"title":"React Notes"}}'
    );
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("getSearchQuery");
    expect(msgs[0].content).toContain("React Notes");
    expect(msgs[1]).toEqual({ role: "user", content: "Find notes about React" });
  });
});

