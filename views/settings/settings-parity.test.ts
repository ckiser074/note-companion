/**
 * Parity guard between the two settings UIs.
 *
 * Obsidian 1.13+ builds settings from getSettingDefinitions() and skips the
 * plugin's own React screens (display()). Anything that exists only in the
 * React screens is invisible to users on current Obsidian, so this test fails
 * when a setting or feature exists in the React tabs but not in the definitions.
 */
import fs from "node:fs";
import path from "node:path";

jest.mock("obsidian", () => ({
  FileSystemAdapter: class {},
  Notice: class {},
  Setting: class {},
  TFile: class {},
  TFolder: class {},
  normalizePath: (p: string) => p,
  requestUrl: jest.fn(),
}));

import {
  getParaCompanionSettingDefinitions,
  type ParaCompanionSettingDefinition,
} from "./setting-definitions";

/** In the React screens but not yet in the declarative UI. */
const KNOWN_GAPS: Record<string, string> = {
  ignoreFolders:
    "Folders excluded from AI organization. Only in the React Vault Access screen (file-config-tab.tsx); needs a list or textarea control in the declarative UI.",
};

/** Written by the React screens but not a user-facing setting. */
const NOT_USER_FACING: Record<string, string> = {
  useFolderEmbeddings:
    "Forced to false on mount by the React Customization tab; users cannot change it.",
  enableImageDescription:
    "Forced to false on mount in offline text-only mode.",
  enableAudioTranscription:
    "Forced to false on mount in offline text-only mode.",
};

const REACT_SCREENS = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith(".tsx"));

function extractReactSettingKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(/plugin\.settings\.(\w+)\s*=(?!=)/g)) {
    keys.add(match[1]);
  }
  for (const match of source.matchAll(
    /handle\w+\([^;]*?,\s*['"](\w+)['"]\s*\)/g
  )) {
    keys.add(match[1]);
  }
  return [...keys];
}

function collectDefinitionKeys(
  definitions: ParaCompanionSettingDefinition[],
  into = new Set<string>()
): Set<string> {
  for (const definition of definitions) {
    if (definition.control?.key) into.add(definition.control.key);
    for (const key of definition.covers ?? []) into.add(key);
    if (definition.items) collectDefinitionKeys(definition.items, into);
  }
  return into;
}

function collectNames(
  definitions: ParaCompanionSettingDefinition[],
  into = new Set<string>()
): Set<string> {
  for (const definition of definitions) {
    if (definition.name) into.add(definition.name);
    if (definition.items) collectNames(definition.items, into);
  }
  return into;
}

const definitions = getParaCompanionSettingDefinitions({
  settings: {},
  app: { vault: { getAbstractFileByPath: () => null } },
} as never);

const reactKeys = new Set(
  REACT_SCREENS.flatMap((name) =>
    extractReactSettingKeys(
      fs.readFileSync(path.join(__dirname, name), "utf8")
    )
  )
);
const definitionKeys = collectDefinitionKeys(definitions);

describe("settings parity (React screens vs Obsidian 1.13+ definitions)", () => {
  it("finds the React screens and extracts their setting keys", () => {
    expect(REACT_SCREENS.length).toBeGreaterThanOrEqual(5);
    expect(reactKeys.size).toBeGreaterThanOrEqual(25);
  });

  it("exposes every React setting in the definitions, or lists it as a known gap", () => {
    const unaccounted = [...reactKeys]
      .filter(
        (key) =>
          !definitionKeys.has(key) &&
          !(key in KNOWN_GAPS) &&
          !(key in NOT_USER_FACING)
      )
      .sort();
    expect(unaccounted).toEqual([]);
  });

  it("keeps KNOWN_GAPS and NOT_USER_FACING honest", () => {
    const resolved = Object.keys(KNOWN_GAPS).filter((key) =>
      definitionKeys.has(key)
    );
    expect(resolved).toEqual([]);
    const stale = [
      ...Object.keys(KNOWN_GAPS),
      ...Object.keys(NOT_USER_FACING),
    ].filter((key) => !reactKeys.has(key));
    expect(stale).toEqual([]);
  });

  it("exposes local wllama model controls in the declarative settings", () => {
    const names = collectNames(definitions);
    expect(definitionKeys.has("localCpuThreads")).toBe(true);
    expect(definitionKeys.has("localContextSize")).toBe(true);
    expect(names.has("Local AI Model")).toBe(true);
  });
});

describe("extractReactSettingKeys", () => {
  it("finds assignments and handler string arguments, ignoring comparisons", () => {
    const source = `
      plugin.settings.alpha = 1;
      if (plugin.settings.beta === 2) {}
      void handleToggleChange(value, setGamma, 'gamma');
      handleSettingChange(e.target.value, setDelta, "delta");
    `;
    expect(extractReactSettingKeys(source).sort()).toEqual([
      "alpha",
      "delta",
      "gamma",
    ]);
  });
});
