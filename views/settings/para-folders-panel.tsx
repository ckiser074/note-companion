import React, { useState } from "react";
import type FileOrganizer from "../../index";
import { normalizeVaultPath } from "../../lib/para";

interface ParaFoldersPanelProps {
  plugin: FileOrganizer;
}

export const ParaFoldersPanel: React.FC<ParaFoldersPanelProps> = ({
  plugin,
}) => {
  const [roots, setRoots] = useState({
    project: plugin.settings.paraProjectsRoot,
    area: plugin.settings.paraAreasRoot,
    resource: plugin.settings.paraResourcesRoot,
    archive: plugin.settings.paraArchivesRoot,
  });
  const [autoCreate, setAutoCreate] = useState(
    plugin.settings.autoCreateParaFolders
  );
  const rootFields = [
    { key: "project", label: "Projects", setting: "paraProjectsRoot" },
    { key: "area", label: "Areas", setting: "paraAreasRoot" },
    { key: "resource", label: "Resources", setting: "paraResourcesRoot" },
    { key: "archive", label: "Archives", setting: "paraArchivesRoot" },
  ] as const;

  const saveRoot = async (
    category: keyof typeof roots,
    settingKey: (typeof rootFields)[number]["setting"]
  ) => {
    const path = normalizeVaultPath(roots[category]);
    if (!path) {
      setRoots((current) => ({
        ...current,
        [category]: plugin.settings[settingKey],
      }));
      return;
    }

    setRoots((current) => ({ ...current, [category]: path }));
    plugin.settings[settingKey] = path;
    plugin.clearOrganizerSuggestionCaches();
    await plugin.saveSettings();
    if (plugin.settings.autoCreateParaFolders) {
      await plugin.ensureFolderExists(path);
    }
  };

  const updateAutoCreate = async (enabled: boolean) => {
    setAutoCreate(enabled);
    plugin.settings.autoCreateParaFolders = enabled;
    await plugin.saveSettings();
    if (enabled) {
      await plugin.checkAndCreateFolders();
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-[--background-modifier-border] bg-[--background-primary-alt] p-4">
      <div>
        <h3 className="m-0 text-lg font-medium">PARA root folders</h3>
        <p className="m-0 mt-1 text-sm text-[--text-muted]">
          Configure the vault paths used for Projects, Areas, Resources, and
          Archives. PARA routing only proposes destinations within these roots.
        </p>
      </div>
      <div className="space-y-3">
        {rootFields.map(({ key, label, setting }) => (
          <label key={key} className="flex items-center justify-between gap-4">
            <span className="text-sm">{label}</span>
            <input
              className="w-56 rounded border border-[--background-modifier-border] bg-[--background-primary] px-2 py-1 text-sm"
              type="text"
              value={roots[key]}
              aria-label={`${label} root folder`}
              onChange={(event) =>
                setRoots((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              onBlur={() => {
                void saveRoot(key, setting);
              }}
            />
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoCreate}
          onChange={(event) => {
            void updateAutoCreate(event.target.checked);
          }}
        />
        Create PARA root folders if they do not exist
      </label>
    </section>
  );
};
