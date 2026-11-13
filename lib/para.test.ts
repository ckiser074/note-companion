import {
  getParaCategoryForPath,
  getParaStatusTag,
  normalizeVaultPath,
  normalizeVaultTag,
  type ParaRoots,
} from "./para";

const roots: ParaRoots = {
  project: "1_Projects",
  area: "2_Areas",
  resource: "3_Resources",
  archive: "4_Archives",
};

describe("PARA path and tag helpers", () => {
  it("recognizes root and nested paths using configured roots", () => {
    expect(getParaCategoryForPath("1_Projects/Plugin/Plan.md", roots)).toBe(
      "project"
    );
    expect(getParaCategoryForPath("2_Areas", roots)).toBe("area");
    expect(getParaCategoryForPath("Resources/Book.md", roots)).toBeUndefined();
  });

  it("uses the most specific configured root when roots overlap", () => {
    expect(
      getParaCategoryForPath("Shared/Projects/Plan.md", {
        ...roots,
        project: "Shared",
        area: "Shared/Projects",
      })
    ).toBe("area");
  });

  it("normalizes separators and parent segments without escaping the vault", () => {
    expect(normalizeVaultPath("1_Projects\\Plugin\\..\\Plan")).toBe(
      "1_Projects/Plan"
    );
    expect(normalizeVaultPath("../../Outside")).toBe("Outside");
  });

  it("normalizes tags and emits the PARA status tag", () => {
    expect(normalizeVaultTag("#PARA/Project Planning")).toBe(
      "para/project-planning"
    );
    expect(getParaStatusTag("archive")).toBe("para/archive");
  });
});
