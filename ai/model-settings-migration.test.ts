jest.mock("obsidian", () => ({
  FileSystemAdapter: class {},
  Notice: class {},
}));

import {
  DEFAULT_LOCAL_MODEL_FILENAME,
  DEFAULT_LOCAL_MODEL_ID,
  DEFAULT_LOCAL_MODEL_URL,
} from "./model-downloader";
import {
  FileOrganizerSettings,
  migrateLocalModelSettings,
} from "../settings";

describe("local model settings migration", () => {
  it("replaces persisted Qwen3-1.7B defaults with Qwen3-0.6B", () => {
    const loaded = {
      localModelId: "unsloth/Qwen3-1.7B-GGUF",
      localModelFileName: "Qwen3-1.7B-Q4_K_M.gguf",
      localModelUrl:
        "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf",
    };
    const settings = Object.assign(new FileOrganizerSettings(), loaded);

    expect(migrateLocalModelSettings(settings, loaded)).toBe(true);
    expect(settings.localModelId).toBe(DEFAULT_LOCAL_MODEL_ID);
    expect(settings.localModelFileName).toBe(DEFAULT_LOCAL_MODEL_FILENAME);
    expect(settings.localModelUrl).toBe(DEFAULT_LOCAL_MODEL_URL);
  });

  it("preserves a user-selected custom GGUF model", () => {
    const loaded = {
      localModelId: "custom-model",
      localModelFileName: "my-local-model.gguf",
      localModelUrl: "https://example.invalid/custom-model.gguf",
    };
    const settings = Object.assign(new FileOrganizerSettings(), loaded);

    expect(migrateLocalModelSettings(settings, loaded)).toBe(false);
    expect(settings.localModelFileName).toBe("my-local-model.gguf");
    expect(settings.localModelUrl).toBe(
      "https://example.invalid/custom-model.gguf"
    );
  });
});
