import { buildFoldersMessages, buildTagsMessages } from "./chatml";

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
      "exactly one of project, area, resource, or archive"
    );
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
});
