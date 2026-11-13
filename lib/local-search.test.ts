import { rankLocalSearchDocuments, type SearchDocument } from "./local-search";

const documents: SearchDocument[] = [
  {
    path: "3_Resources/Plugin.md",
    title: "Plugin reference",
    tags: ["para/resource", "obsidian"],
    content: "A reference for plugin development.",
  },
  {
    path: "1_Projects/Roadmap.md",
    title: "Release roadmap",
    tags: ["para/project"],
    content: "Plan the next plugin release.",
  },
  {
    path: "2_Areas/Health.md",
    title: "Health",
    tags: ["para/area"],
    content: "Daily routines.",
  },
];

describe("rankLocalSearchDocuments", () => {
  it("ranks title, path, and metadata matches above content-only matches", () => {
    const results = rankLocalSearchDocuments(documents, ["plugin"], 3);
    expect(results.map(({ path }) => path)).toEqual([
      "3_Resources/Plugin.md",
      "1_Projects/Roadmap.md",
    ]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("returns no documents for unmatched terms and respects the result limit", () => {
    expect(rankLocalSearchDocuments(documents, ["nonexistent"])).toEqual([]);
    expect(rankLocalSearchDocuments(documents, ["para"], 1)).toHaveLength(1);
  });
});
