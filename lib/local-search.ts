export interface SearchDocument {
  path: string;
  title: string;
  tags: string[];
  content: string;
}

export interface RankedSearchDocument extends SearchDocument {
  score: number;
}

function termsFrom(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9_/-]+/g) ?? [];
}

export function rankLocalSearchDocuments(
  documents: SearchDocument[],
  queries: string[],
  limit = 10
): RankedSearchDocument[] {
  const expandedTerms = [...new Set(queries.flatMap(termsFrom))];
  if (expandedTerms.length === 0) return [];

  return documents
    .map((document, index) => {
      const title = `${document.title} ${document.path}`.toLowerCase();
      const metadata = document.tags.join(" ").toLowerCase();
      const content = document.content.toLowerCase();
      let score = 0;
      let matchedTerms = 0;

      for (const term of expandedTerms) {
        const inTitle = title.includes(term);
        const inMetadata = metadata.includes(term);
        const inContent = content.includes(term);
        if (inTitle) score += 4;
        if (inMetadata) score += 3;
        if (inContent) score += 1;
        if (inTitle || inMetadata || inContent) matchedTerms++;
      }

      if (matchedTerms > 1) score += matchedTerms * 2;
      if (score === 0) return null;
      return { ...document, score, index };
    })
    .filter(
      (document): document is RankedSearchDocument & { index: number } =>
        document !== null
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ index: _index, ...document }) => document);
}
