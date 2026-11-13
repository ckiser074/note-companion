jest.mock("obsidian", () => ({
  FileSystemAdapter: class {},
  Notice: class {},
}));

import * as path from "path";
import { FileSystemAdapter } from "obsidian";
import { ModelDownloader } from "./model-downloader";

describe("ModelDownloader plugin paths", () => {
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
