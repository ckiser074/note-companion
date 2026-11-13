export type ParaCategory = "project" | "area" | "resource" | "archive";

export interface ParaRoots {
  project: string;
  area: string;
  resource: string;
  archive: string;
}

export const DEFAULT_PARA_ROOTS: ParaRoots = {
  project: "1_Projects",
  area: "2_Areas",
  resource: "3_Resources",
  archive: "4_Archives",
};

export const PARA_CATEGORIES: ParaCategory[] = [
  "project",
  "area",
  "resource",
  "archive",
];

export function getParaCategoryForPath(
  path: string,
  roots: ParaRoots
): ParaCategory | undefined {
  const normalizedPath = normalizeVaultPath(path);
  return PARA_CATEGORIES
    .map((category) => ({
      category,
      root: normalizeVaultPath(roots[category]),
    }))
    .filter(
      ({ root }) =>
        root &&
        (normalizedPath === root || normalizedPath.startsWith(`${root}/`))
    )
    .sort((a, b) => b.root.length - a.root.length)[0]?.category;
}

export function getParaStatusTag(category: ParaCategory): string {
  return `para/${category}`;
}

export function normalizeVaultPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    const normalizedPart = part.trim();
    if (!normalizedPart || normalizedPart === ".") continue;
    if (normalizedPart === "..") {
      parts.pop();
      continue;
    }
    parts.push(normalizedPart);
  }
  return parts.join("/");
}

export function normalizeVaultTag(tag: string): string {
  return tag
    .replace(/^#+/, "")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_/-]/g, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^-+|-+$/g, "");
}
