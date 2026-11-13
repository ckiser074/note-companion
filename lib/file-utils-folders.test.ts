jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path,
  TFile: class {},
  TFolder: class {},
  parseYaml: jest.fn(),
}));
import { TFile, TFolder } from "obsidian";
import { ensureFolderExists, safeMove } from "../fileUtils";

const makeFolder = (path: string) => Object.assign(new TFolder(), { path });

describe("ensureFolderExists", () => {
  it("creates missing parent folders before a nested PARA root", async () => {
    const folders = new Map([["Workspace", makeFolder("Workspace")]]);
    const createFolder = jest.fn(async (path: string) => {
      folders.set(path, makeFolder(path));
    });
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => folders.get(path) ?? null,
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
    const folders = new Map<string, TFolder>();
    const createFolder = jest.fn(async (path: string) => {
      folders.set(path, makeFolder(path));
    });
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => folders.get(path) ?? null,
        adapter: { exists: async (path: string) => folders.has(path) },
        createFolder,
      },
    };

    await ensureFolderExists(app as never, "../../Projects/Notes");

    expect(createFolder).toHaveBeenLastCalledWith("Projects/Notes");
    expect([...folders.keys()]).toEqual(["Projects", "Projects/Notes"]);
  });

  it("ignores a concurrent duplicate folder creation error", async () => {
    const folders = new Map<string, TFolder>();
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => folders.get(path) ?? null,
        adapter: { exists: async (path: string) => folders.has(path) },
        createFolder: async (path: string) => {
          folders.set(path, makeFolder(path));
          throw new Error("Folder already exists");
        },
      },
    };

    await expect(
      ensureFolderExists(app as never, "Workspace/Projects")
    ).resolves.toBeUndefined();
    expect([...folders.keys()]).toEqual(["Workspace", "Workspace/Projects"]);
  });

  it("adds a numeric suffix when the destination note name already exists", async () => {
    const folders = new Map<string, TFolder>();
    const files = new Set(["Projects/Note.md"]);
    const file = Object.assign(new TFile(), {
      path: "Inbox/Note.md",
      basename: "Note",
      extension: "md",
    });
    const renameFile = jest.fn(async (_file: TFile, path: string) => {
      files.add(path);
      file.path = path;
    });
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => folders.get(path) ?? null,
        adapter: {
          exists: async (path: string) =>
            folders.has(path) || files.has(path),
        },
        createFolder: async (path: string) => {
          folders.set(path, makeFolder(path));
        },
      },
      fileManager: { renameFile },
    };

    await expect(
      safeMove(app as never, file, "Projects")
    ).resolves.toBe("Projects/Note-1.md");
    expect(renameFile).toHaveBeenCalledWith(file, "Projects/Note-1.md");
  });
});
