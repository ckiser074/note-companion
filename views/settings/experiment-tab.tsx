import React, { useState, useEffect } from "react";
import FileOrganizer from "../../index";

interface ExperimentTabProps {
  plugin: FileOrganizer;
}

export const ExperimentTab: React.FC<ExperimentTabProps> = ({ plugin }) => {
  const [enableAtomicNotes, setEnableAtomicNotes] = useState(
    plugin.settings.enableAtomicNotes
  );
  const [enableTitleSuggestions, setEnableTitleSuggestions] = useState(
    plugin.settings.enableTitleSuggestions
  );
  const [enableScreenpipe, setEnableScreenpipe] = useState(
    plugin.settings.enableScreenpipe
  );
  const [screenpipeTimeRange, setScreenpipeTimeRange] = useState(
    plugin.settings.screenpipeTimeRange
  );
  const [queryScreenpipeLimit, setQueryScreenpipeLimit] = useState(
    plugin.settings.queryScreenpipeLimit
  );
  const [chatMaxStepsPref, setChatMaxStepsPref] = useState<"auto" | "3" | "5">(
    () => {
      const p = plugin.settings.chatMaxStepsPreference;
      if (p === "auto" || p == null) return "auto";
      return p === 3 ? "3" : "5";
    }
  );

  useEffect(() => {
    setEnableScreenpipe(plugin.settings.enableScreenpipe);
    setScreenpipeTimeRange(plugin.settings.screenpipeTimeRange);
    setQueryScreenpipeLimit(plugin.settings.queryScreenpipeLimit);
  }, [
    plugin.settings.enableScreenpipe,
    plugin.settings.screenpipeTimeRange,
    plugin.settings.queryScreenpipeLimit,
  ]);

  const handleToggleChange = async (
    value: boolean,
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    settingKey: keyof typeof plugin.settings
  ) => {
    setter(value);
    (plugin.settings[settingKey] as boolean) = value;
    await plugin.saveSettings();
  };

  return (
    <div className="experiment-settings p-4 space-y-8">
      <div className="mb-8">
        <p className="text-[--text-muted] mb-4">
          These experimental features enhance your Note Companion workflow
          locally on your device.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-[--text-normal] mb-4">
            Core Experiments
          </h3>
          <div className="space-y-3">
            <ToggleSetting
              name="Atomic Notes"
              description="Enable the generation of atomic notes in the assistant sidebar."
              value={enableAtomicNotes}
              onChange={(value) => {
                void handleToggleChange(
                  value,
                  setEnableAtomicNotes,
                  "enableAtomicNotes"
                );
              }}
            />

            <div className="setting-item p-4 bg-[--background-primary] rounded-lg border border-[--background-modifier-border] space-y-2">
              <div className="font-medium text-[--text-normal]">
                How much the assistant can do per message
              </div>
              <p className="text-sm text-[--text-muted]">
                Lets the assistant take multiple actions (search notes, open
                files, and similar) before replying.
              </p>
              <select
                className="w-full max-w-xs px-2 py-1.5 bg-[--background-primary] border border-[--background-modifier-border] rounded text-[--text-normal]"
                value={chatMaxStepsPref}
                onChange={(e) => {
                  void (async (e) => {
                    const v = e.target.value as "auto" | "3" | "5";
                    setChatMaxStepsPref(v);
                    plugin.settings.chatMaxStepsPreference =
                      v === "auto" ? "auto" : (Number(v) as 3 | 5);
                    await plugin.saveSettings();
                  })(e);
                }}
              >
                <option value="auto">Auto (recommended)</option>
                <option value="3">Lighter — fewer actions</option>
                <option value="5">Thorough — more actions</option>
              </select>
            </div>

            <ToggleSetting
              name="Title Suggestions"
              description="Show title suggestions in the organizer sidebar."
              value={enableTitleSuggestions}
              onChange={(value) => {
                void handleToggleChange(
                  value,
                  setEnableTitleSuggestions,
                  "enableTitleSuggestions"
                );
              }}
            />
          </div>
        </div>

        <div className="border-t border-[--background-modifier-border] pt-6">
          <h3 className="text-lg font-medium text-[--text-normal] mb-4">
            Local Integrations
          </h3>
          <div className="space-y-3">
            <ToggleSetting
              name="ScreenPipe Integration"
              description={
                <div className="space-y-2">
                  <p>
                    Enable ScreenPipe integration to query your local ScreenPipe
                    daemon on localhost:3030.
                  </p>
                  {enableScreenpipe && (
                    <div className="mt-4 ml-4 p-4 bg-[--background-primary-alt] rounded-lg border-l-2 border-[--text-accent] space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm text-[--text-normal] font-medium">
                          Time Range (hours)
                        </label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="number"
                            min="1"
                            max="24"
                            value={screenpipeTimeRange}
                            onChange={(e) => {
                              void (async (e) => {
                                const value = Number(e.target.value);
                                setScreenpipeTimeRange(value);
                                plugin.settings.screenpipeTimeRange = value;
                                await plugin.saveSettings();
                              })(e);
                            }}
                            className="w-20 px-2 py-1 bg-[--background-primary] border border-[--background-modifier-border] rounded"
                          />
                          <span className="text-sm text-[--text-muted]">
                            hours
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-[--text-normal] font-medium">
                          Query Limit
                        </label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={queryScreenpipeLimit}
                            onChange={(e) => {
                              void (async (e) => {
                                const value = Number(e.target.value);
                                setQueryScreenpipeLimit(value);
                                plugin.settings.queryScreenpipeLimit = value;
                                await plugin.saveSettings();
                              })(e);
                            }}
                            className="w-20 px-2 py-1 bg-[--background-primary] border border-[--background-modifier-border] rounded"
                          />
                          <span className="text-sm text-[--text-muted]">
                            items
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              }
              value={enableScreenpipe}
              onChange={(value) => {
                void handleToggleChange(
                  value,
                  setEnableScreenpipe,
                  "enableScreenpipe"
                );
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

interface ToggleSettingProps {
  name: string;
  description: string | React.JSX.Element;
  value: boolean;
  onChange: (value: boolean) => void;
}

const ToggleSetting: React.FC<ToggleSettingProps> = ({
  name,
  description,
  value,
  onChange,
}) => (
  <div className="setting-item flex items-center justify-between p-4 bg-[--background-primary] rounded-lg border border-[--background-modifier-border] hover:border-[--background-modifier-border-hover]">
    <div className="setting-item-info flex-1">
      <div className="setting-item-name font-medium text-[--text-normal]">
        {name}
      </div>
      <div className="setting-item-description text-sm text-[--text-muted]">
        {description}
      </div>
    </div>
    <div className="setting-item-control">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="text-[--interactive-accent] rounded border-[--background-modifier-border]"
      />
    </div>
  </div>
);
