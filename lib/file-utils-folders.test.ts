jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path,
  TFile: class {},
  TFolder: class {},
  parseYaml: jest.fn(),
}));
import { ensureFolderExists } from "../fileUtils";

describe("ensureFolderExists", () => {
  it("creates missing parent folders before a nested PARA root", async () => {
    const folders = new Set(["Workspace"]);
    const createFolder = jest.fn(async (path: string) => {
      folders.add(path);
    });
    const app = {
      vault: {
        adapter: { exists: async (path: string) => folders.has(path) },
        createFolder,
      },
    };

    await ensureFolderExists(app as never, "Workspace/Projects/Obsidian");

    expect(createFolder.mock.calls).toEqual([
      ["Workspace/Projects"],
      ["Workspace/Projects/Obsidian"],
    ]);
  });

  it("normalizes parent segments before creating a vault path", async () => {
    const folders = new Set<string>();
    const createFolder = jest.fn(async (path: string) => {
      folders.add(path);
    });
    const app = {
      vault: {
        adapter: { exists: async (path: string) => folders.has(path) },
        createFolder,
      },
    };

    await ensureFolderExists(app as never, "../../Projects/Notes");

    expect(createFolder).toHaveBeenLastCalledWith("Projects/Notes");
    expect([...folders]).toEqual(["Projects", "Projects/Notes"]);
  });
});
