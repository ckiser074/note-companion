import React, { useRef } from "react";
import { logger } from "../../../../services/logger";
import { addSearchContext, useContextItems } from "../use-context-items";
import { buildSearchExpansionMessages } from "../../../../ai/chatml";
import {
  rankLocalSearchDocuments,
  type SearchDocument,
} from "../../../../lib/local-search";
import { usePlugin } from "../../provider";
import { ToolHandlerProps } from "./types";

export function SearchHandler({
  toolInvocation,
  handleAddResult,
  app,
}: ToolHandlerProps) {
  const plugin = usePlugin();
  const hasFetchedRef = useRef(false);

  const searchNotes = async (query: string) => {
    const expanded = await plugin.localAI.generateJSON<{ queries?: unknown }>(
      buildSearchExpansionMessages(query),
      { temperature: 0.1, maxTokens: 128 }
    );
    const expandedQueries = Array.isArray(expanded.queries)
      ? expanded.queries.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0
        )
      : [];
    const queries = [...new Set([query, ...expandedQueries])].slice(0, 8);
    const files = app.vault.getMarkdownFiles();
    const rankedResults: Array<
      ReturnType<typeof rankLocalSearchDocuments>[number] & {
        contentPreview: string;
        contentLength: number;
        wordCount: number;
      }
    > = [];
    const batchSize = 32;

    for (let offset = 0; offset < files.length; offset += batchSize) {
      const batch = await Promise.all(
        files.slice(offset, offset + batchSize).map(async (file) => {
          const content = await app.vault.read(file);
          const cache = app.metadataCache.getFileCache(file);
          const frontmatterTags = cache?.frontmatter?.tags;
          const tags = [
            ...(cache?.tags?.map((tag) => tag.tag) ?? []),
            ...(Array.isArray(frontmatterTags)
              ? frontmatterTags.filter(
                  (tag): tag is string => typeof tag === "string"
                )
              : typeof frontmatterTags === "string"
              ? [frontmatterTags]
              : []),
          ];
          const title =
            typeof cache?.frontmatter?.title === "string"
              ? cache.frontmatter.title
              : file.basename;
          return {
            path: file.path,
            title,
            tags,
            content,
          } satisfies SearchDocument;
        })
      );
      rankedResults.push(
        ...rankLocalSearchDocuments(batch, queries, 10).map((result) => ({
          ...result,
          contentPreview:
            result.content.slice(0, 500) +
            (result.content.length > 500 ? "..." : ""),
          contentLength: result.content.length,
          wordCount: result.content.split(/\s+/).length,
        }))
      );
    }

    return rankedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  };

  React.useEffect(() => {
    const handleSearchNotes = async () => {
      if (!hasFetchedRef.current && !("result" in toolInvocation)) {
        hasFetchedRef.current = true;
        const args = toolInvocation.args;
        const query =
          args &&
          typeof args === "object" &&
          "query" in args &&
          typeof args.query === "string"
            ? args.query
            : "";
        if (!query.trim()) {
          handleAddResult(JSON.stringify({ error: "Search query is missing" }));
          return;
        }
        
        try {
          const searchResults = await searchNotes(query);
          
          const contextResults = searchResults.map(
            ({ content, ...metadata }) => metadata
          );
          addSearchContext(query, contextResults);
          handleAddResult(JSON.stringify(contextResults));
        } catch (error) {
          logger.error("Error searching notes:", error);
          handleAddResult(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      }
    };

    void handleSearchNotes();
  }, [toolInvocation, handleAddResult, app]);

  const searchResults = useContextItems(state => state.searchResults);

  return (
    <div className="text-sm text-[--text-muted]">
      {!("result" in toolInvocation)
        ? "Searching through your notes..."
        : Object.keys(searchResults).length > 0
        ? `Found ${Object.keys(searchResults).length} matching notes`
        : "No files matching that criteria were found"}
    </div>
  );
}
