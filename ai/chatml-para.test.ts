import {
  buildFoldersMessages,
  buildOrganizationMessages,
  buildTagsMessages,
  fitChatMLMessagesToEstimatedTokenBudget,
  formatQwenChatML,
  PARA_ORGANIZATION_ASSISTANT_PREFILL,
  parseJSONFromModelOutput,
  parsePrefilledOrganizationOutput,
  QWEN_STOP_TOKENS,
} from "./chatml";
import { getTokenCount } from "../utils/token-counter";

describe("PARA prompt context", () => {
  it("includes the configured roots and existing PARA folders in routing prompts", () => {
    const [systemMessage] = buildFoldersMessages(
      "Plan a release",
      "Release Plan",
      ["Workspace/Projects", "Workspace/Projects/Obsidian"],
      "",
      3,
      {
        project: "Workspace/Projects",
        area: "Workspace/Areas",
        resource: "Workspace/Resources",
        archive: "Workspace/Archives",
      }
    );

    expect(systemMessage.content).toContain(
      "project=Workspace/Projects, area=Workspace/Areas"
    );
    expect(systemMessage.content).toContain(
      "Workspace/Projects/Obsidian"
    );
    expect(systemMessage.content).toContain(
      "project=active goal/deadline; area=ongoing responsibility"
    );
    expect(systemMessage.content.split(/\s+/).length).toBeLessThan(250);
  });

  it("keeps the folder prompt compact and limits existing paths to 30", () => {
    const folders = Array.from(
      { length: 40 },
      (_, i) => `1_Projects/Folder${i}`
    );
    const [systemMessage] = buildFoldersMessages(
      "Plan a release",
      "Release Plan",
      folders,
      "",
      3,
      {
        project: "1_Projects",
        area: "2_Areas",
        resource: "3_Resources",
        archive: "4_Archives",
      }
    );
    const existingPaths = systemMessage.content.match(
      /Existing paths \(max 30\): (.*)\n/
    )?.[1];

    expect(existingPaths?.split(", ")).toHaveLength(30);
    expect(systemMessage.content.split(/\s+/).length).toBeLessThan(250);
  });

  it("requires the category status tag for generated note tags", () => {
    const [systemMessage] = buildTagsMessages(
      "Completed notes",
      "Archived Project",
      [],
      "",
      3,
      "archive"
    );

    expect(systemMessage.content).toContain(
      'Do not include any para/* tag in the tags array; the plugin adds the selected category status tag.'
    );
    expect(systemMessage.content).toContain(
      '"paraCategory":"project","tags"'
    );
  });

  it("stops model output at the ChatML end token", () => {
    expect(QWEN_STOP_TOKENS).toEqual(["<|im_end|>", "<|endoftext|>"]);
  });

  it("prefills the assistant turn with the PARA JSON key", () => {
    const prompt = formatQwenChatML(
      [{ role: "system", content: "Return JSON." }],
      true,
      PARA_ORGANIZATION_ASSISTANT_PREFILL
    );

    expect(
      prompt.endsWith(
        '<|im_start|>assistant\n<think>\n\n</think>\n\n{"paraCategory": "'
      )
    ).toBe(true);
  });

  it("reconstructs the prefilled key and repairs common JSON truncation", () => {
    const raw =
      'resources", "targetFolder":"3_Resources","suggestedFilename":"New\nTitle","tags":["para/resource",],';

    expect(parsePrefilledOrganizationOutput<{
      paraCategory: string;
      targetFolder: string;
      suggestedFilename: string;
      tags: string[];
    }>(raw)).toEqual({
      paraCategory: "resources",
      targetFolder: "3_Resources",
      suggestedFilename: "New\nTitle",
      tags: ["para/resource"],
    });
  });

  it("extracts JSON from thinking text and markdown fences", () => {
    const raw =
      '<think>reasoning</think>\n```json\n{"value":"ok"}\n```\nDone.';

    expect(parseJSONFromModelOutput(raw)).toEqual({ value: "ok" });
  });

  it("logs and includes the exact raw output when parsing fails", () => {
    const raw = "not valid JSON";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(() => parseJSONFromModelOutput(raw)).toThrow(raw);
      expect(warn).toHaveBeenCalledWith(
        "[PARA Companion] Raw model output:",
        raw
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("requests one combined PARA, filename, folder, and tags result", () => {
    const [systemMessage] = buildOrganizationMessages(
      "A note about an active release goal.",
      "Release Notes",
      ["1_Projects/Release"],
      ["release", "planning"],
      {
        project: "1_Projects",
        area: "2_Areas",
        resource: "3_Resources",
        archive: "4_Archives",
      },
      "project"
    );

    expect(systemMessage.content).toContain(
      '"paraCategory":"projects","targetFolder":"1_Projects/Subfolder","suggestedFilename":"Clean Title","tags"'
    );
    expect(systemMessage.content).toContain(
      "Current category=project; retain unless clearly wrong."
    );
    expect(systemMessage.content.split(/\s+/).length).toBeLessThan(250);
  });

  it("limits organization prompt context to concise folders and tags", () => {
    const folders = Array.from({ length: 40 }, (_, i) => `1_Projects/F${i}`);
    const tags = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    const messages = buildOrganizationMessages(
      "A note",
      "Release Notes",
      folders,
      tags,
      {
        project: "1_Projects",
        area: "2_Areas",
        resource: "3_Resources",
        archive: "4_Archives",
      }
    );

    expect(messages[0].content.match(/Folders: ([^\n]*)/)?.[1].split(", ")).toHaveLength(12);
    expect(messages[0].content.match(/Existing tags: ([^\n]*)/)?.[1].split(", ")).toHaveLength(12);
  });

  it("fits the full PARA prompt within the estimated token budget", () => {
    const messages = fitChatMLMessagesToEstimatedTokenBudget(
      buildOrganizationMessages(
        "A".repeat(800),
        "Release Notes",
        Array.from({ length: 12 }, (_, i) => `1_Projects/Folder${i}`),
        Array.from({ length: 12 }, (_, i) => `tag${i}`),
        {
          project: "1_Projects",
          area: "2_Areas",
          resource: "3_Resources",
          archive: "4_Archives",
        }
      ),
      350,
      PARA_ORGANIZATION_ASSISTANT_PREFILL
    );

    expect(
      getTokenCount(
        formatQwenChatML(
          messages,
          true,
          PARA_ORGANIZATION_ASSISTANT_PREFILL
        )
      )
    ).toBeLessThanOrEqual(350);
    expect(messages[1].content).toMatch(/^File: Release Notes\n/);
  });
});
