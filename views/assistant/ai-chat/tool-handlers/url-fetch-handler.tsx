import React, { useRef, useState } from "react";
import { requestUrl } from "obsidian";
import { logger } from "../../../../services/logger";
import { ToolInvocation } from "./types";

interface UrlFetchHandlerProps {
  toolInvocation: ToolInvocation;
  handleAddResult: (result: string) => void;
}

function htmlToPlainText(html: string): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return {
    title,
    content: stripped.slice(0, 12000),
  };
}

export function UrlFetchHandler({
  toolInvocation,
  handleAddResult,
}: UrlFetchHandlerProps) {
  const hasFetchedRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );

  React.useEffect(() => {
    const run = async () => {
      if (hasFetchedRef.current || "result" in toolInvocation) {
        if ("result" in toolInvocation) {
          setStatus("success");
        }
        return;
      }
      hasFetchedRef.current = true;

      let url = (toolInvocation.args as { url?: string }).url;
      if (url && typeof (url as { then?: unknown }).then === "function") {
        handleAddResult(
          JSON.stringify({
            error: "Invalid url: received a Promise instead of a string",
          })
        );
        setStatus("error");
        return;
      }

      if (!url || typeof url !== "string") {
        handleAddResult(
          JSON.stringify({
            error: "url is required and must be a string",
          })
        );
        setStatus("error");
        return;
      }

      url = url.trim();
      if (!url) {
        handleAddResult(
          JSON.stringify({ error: "url cannot be empty" })
        );
        setStatus("error");
        return;
      }

      try {
        const response = await requestUrl({
          url,
          method: "GET",
          throw: false,
        });

        if (response.status >= 400) {
          handleAddResult(
            JSON.stringify({
              error: `Request failed with status ${response.status}`,
            })
          );
          setStatus("error");
          return;
        }

        const rawText = response.text || "";
        if (!rawText.trim()) {
          handleAddResult(
            JSON.stringify({ error: "Fetched page returned empty content" })
          );
          setStatus("error");
          return;
        }

        const isHtml =
          /<html[\s>]/i.test(rawText) || /<body[\s>]/i.test(rawText);
        const extracted = isHtml
          ? htmlToPlainText(rawText)
          : { title: "", content: rawText.slice(0, 12000).trim() };

        const titleLine = extracted.title
          ? `Page title: ${extracted.title}\n`
          : "";
        const sourceLine = `Source URL: ${url}\n\n`;
        const toolResult = `${titleLine}${sourceLine}Page content (plain text):\n\n${extracted.content}\n\nUse the content above to answer the user's question or provide the summary they asked for.`;

        handleAddResult(toolResult);
        setStatus("success");
      } catch (error) {
        logger.error("fetchUrlContent error:", error);
        const message =
          error instanceof Error ? error.message : "Unknown error";
        handleAddResult(JSON.stringify({ error: message }));
        setStatus("error");
      }
    };

    void run();
  }, [toolInvocation.toolCallId]);

  if (status === "loading") {
    return (
      <div className="text-sm text-[--text-muted]">Fetching page content…</div>
    );
  }
  if (status === "success") {
    return (
      <div className="text-sm text-[--text-muted]">
        Page content retrieved
      </div>
    );
  }
  return (
    <div className="text-sm text-[--text-error]">
      Failed to fetch page content
    </div>
  );
}
