jest.mock("obsidian", () => ({
  FileSystemAdapter: class {},
  Notice: class {},
}));

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { FileSystemAdapter } from "obsidian";
import {
  DEFAULT_LOCAL_MODEL_FILENAME,
  DEFAULT_LOCAL_MODEL_ID,
  DEFAULT_LOCAL_MODEL_URL,
  ModelDownloader,
} from "./model-downloader";

describe("ModelDownloader plugin paths", () => {
  it("defaults to Qwen3-0.6B and lists installed GGUF files", async () => {
    const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "para-models-"));
    const modelsDir = path.join(pluginDir, "models");
    fs.mkdirSync(modelsDir);
    fs.writeFileSync(path.join(modelsDir, DEFAULT_LOCAL_MODEL_FILENAME), "model");
    fs.writeFileSync(path.join(modelsDir, "custom.gguf"), "custom");
    fs.writeFileSync(path.join(modelsDir, "empty.gguf"), "");
    fs.writeFileSync(path.join(modelsDir, "ignored.bin"), "not a model");

    try {
      const adapter = Object.assign(new FileSystemAdapter(), {
        getBasePath: () => "C:\\Vault",
      });
      const app = {
        vault: {
          adapter,
          configDir: ".obsidian",
        },
      };
      const downloader = new ModelDownloader(
        app as never,
        "para-companion",
        pluginDir
      );

      expect(DEFAULT_LOCAL_MODEL_ID).toBe("unsloth/Qwen3-0.6B-GGUF");
      expect(DEFAULT_LOCAL_MODEL_FILENAME).toBe("Qwen3-0.6B-Q4_K_M.gguf");
      expect(DEFAULT_LOCAL_MODEL_URL).toContain(
        "/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf"
      );
      await expect(downloader.listModelFiles()).resolves.toEqual([
        "custom.gguf",
        DEFAULT_LOCAL_MODEL_FILENAME,
      ]);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });

  it("uses the installed plugin directory from the manifest", () => {
    const adapter = Object.assign(new FileSystemAdapter(), {
      getBasePath: () => "C:\\Vault",
    });
    const app = {
      vault: {
        adapter,
        configDir: ".obsidian",
      },
    };
    const downloader = new ModelDownloader(
      app as never,
      "para-companion",
      ".obsidian/plugins/para-companion"
    );

    expect(downloader.getPluginDir()).toBe(
      path.resolve("C:\\Vault", ".obsidian/plugins/para-companion")
    );
    expect(downloader.getWasmFilePath()).toBe(
      path.join(
        "C:\\Vault",
        ".obsidian",
        "plugins",
        "para-companion",
        "wasm",
        "wllama.wasm"
      )
    );
    expect(downloader.getModelFilePath()).toContain(
      path.join("plugins", "para-companion", "models")
    );
  });

  it("falls back to the configured plugins directory without a manifest path", () => {
    const adapter = Object.assign(new FileSystemAdapter(), {
      getBasePath: () => "C:\\Vault",
    });
    const app = {
      vault: {
        adapter,
        configDir: ".obsidian",
      },
    };
    const downloader = new ModelDownloader(app as never, "para-companion");

    expect(downloader.getPluginDir()).toBe(
      path.join("C:\\Vault", ".obsidian", "plugins", "para-companion")
    );
  });
});
