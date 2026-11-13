import type { ChatMLMessage } from "./types";
import type { ParaCategory, ParaRoots } from "../lib/para";
import { PARA_CATEGORIES } from "../lib/para";

export const QWEN_IM_START = "<|im_start|>";
export const QWEN_IM_END = "<|im_end|>";
export const QWEN_STOP_TOKENS = [QWEN_IM_END, "<|endoftext|>"];

/**
 * Formats conversation turns in Qwen3 ChatML format.
 * By default injects `/no_think` into the system prompt so Qwen3-1.7B responds
 * directly with fast JSON or concise text instead of long <think> traces.
 */
export function formatQwenChatML(
  messages: ChatMLMessage[],
  suppressThinking = true
): string {
  const normalized: ChatMLMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  if (suppressThinking) {
    const sysIndex = normalized.findIndex((m) => m.role === "system");
    if (sysIndex >= 0) {
      const existing = normalized[sysIndex].content.trim();
      if (!existing.includes("/no_think")) {
        normalized[sysIndex] = {
          role: "system",
          content: existing ? `${existing}\n/no_think` : "/no_think",
        };
      }
    } else {
      normalized.unshift({
        role: "system",
        content: "You are a helpful Obsidian knowledge assistant.\n/no_think",
      });
    }
  }

  let prompt = "";
  for (const msg of normalized) {
    prompt += `${QWEN_IM_START}${msg.role}\n${msg.content}${QWEN_IM_END}\n`;
  }
  prompt += `${QWEN_IM_START}assistant\n`;
  return prompt;
}

/**
 * Removes any `<think>...</think>` blocks emitted by Qwen3.
 * During streaming, if an unclosed `<think>` tag is present at the tail,
 * everything from `<think>` onward is withheld until `</think>` completes.
 */
export function stripThinkingBlocks(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const openIdx = cleaned.toLowerCase().indexOf("<think>");
  if (openIdx !== -1) {
    cleaned = cleaned.slice(0, openIdx);
  }
  return cleaned.trimStart();
}

/**
 * Strips markdown code fences and extracts the first balanced JSON object or array
 * from a model completion string.
 */
export function parseJSONFromModelOutput<T>(raw: string): T {
  const withoutThinking = stripThinkingBlocks(raw).trim();
  const withoutFences = withoutThinking
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFences) as T;
  } catch {
    // Scan for first balanced JSON object or array
  }

  const candidate = extractBalancedJson(withoutFences);
  if (!candidate) {
    throw new Error(
      `Model output did not contain valid JSON: ${withoutFences.slice(0, 240)}`
    );
  }

  return JSON.parse(candidate) as T;
}

function extractBalancedJson(input: string): string | null {
  const objStart = input.indexOf("{");
  const arrStart = input.indexOf("[");

  let start = -1;
  let openChar = "{";
  let closeChar = "}";

  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    start = objStart;
    openChar = "{";
    closeChar = "}";
  } else if (arrStart !== -1) {
    start = arrStart;
    openChar = "[";
    closeChar = "]";
  }

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function buildTagsMessages(
  content: string,
  fileName: string,
  existingTags: string[],
  customInstructions: string,
  count = 3,
  currentCategory?: ParaCategory
): ChatMLMessage[] {
  const existingList = existingTags.length
    ? `Existing vault tags (prefer matching these when relevant): ${existingTags.join(", ")}`
    : "No existing tags provided; create concise lowercase tags.";

  return [
    {
      role: "system",
      content: `You are an Obsidian PARA note classifier and tagging engine. Return ONLY a valid JSON object matching this exact schema, with no markdown fences and no extra prose:
{"paraCategory":"project","tags":[{"score":90,"tag":"example-tag","reason":"Brief reason","isNew":false}]}
Rules:
- Classify the note as exactly one of project, area, resource, or archive based on its content and actionability.
- Projects are active efforts with a specific goal, deliverable, or deadline. Areas are ongoing responsibilities without an end date. Resources are reference material and evergreen interests. Archives are completed projects, inactive areas, and outdated material.
- ${currentCategory ? `The note is currently inside a PARA ${currentCategory} folder; keep that category unless its content clearly contradicts the location.` : "The note is not currently inside a PARA folder; classify it from its content."}
- Suggest up to ${count} relevant lowercase tags sorted by score descending (0-100).
- Tags must not start with "#" and must not contain spaces (use hyphens).
- Do not include any para/* tag in the tags array; the plugin adds the selected category status tag.
- Set "isNew" to false if the tag is from the existing tags list, otherwise true.
- ${existingList}
${customInstructions ? `- User instructions: ${customInstructions}` : ""}`,
    },
    {
      role: "user",
      content: `File: "${fileName}"\n\nContent:\n"""\n${content}\n"""`,
    },
  ];
}

export function buildFoldersMessages(
  content: string,
  fileName: string,
  folders: string[],
  customInstructions: string,
  count = 3,
  roots?: ParaRoots
): ChatMLMessage[] {
  const folderList = folders.length
    ? `Existing vault folders: ${folders.join(", ")}`
    : "No existing vault folders.";

  return [
    {
      role: "system",
      content: `You are an Obsidian vault folder classifier. Return ONLY a valid JSON object matching this exact schema, with no markdown fences and no extra prose:
{"folders":[{"paraCategory":"project","folder":"1_Projects/Obsidian Plugin","score":92,"isNewFolder":false,"reason":"Brief reason"}]}
Rules:
- Classify each note as exactly one of project, area, resource, or archive.
- Projects are active efforts with a specific goal, deliverable, or deadline.
- Areas are ongoing responsibilities and life or work spheres without an end date.
- Resources are reference material, research, tutorials, and evergreen interests.
- Archives are completed projects, inactive areas, and outdated material.
- Return up to ${count} destination folders sorted by score descending (0-100).
- Each folder MUST be inside the matching configured PARA root. Prefer the root's existing subfolders when relevant; propose a new subfolder only when none fit.
- "isNewFolder" is false only when the exact path exists in the provided folder tree.
- ${roots ? `Configured roots: ${PARA_CATEGORIES.map((category) => `${category}=${roots[category]}`).join(", ")}` : ""}
- ${folderList}
${customInstructions ? `- User instructions: ${customInstructions}` : ""}`,
    },
    {
      role: "user",
      content: `File: "${fileName}"\n\nContent:\n"""\n${content}\n"""`,
    },
  ];
}

export function buildSearchExpansionMessages(query: string): ChatMLMessage[] {
  return [
    {
      role: "system",
      content:
        'Expand the search query with concise related terms and synonyms. Return ONLY JSON: {"queries":["original query","related term"]}. Do not answer the query.',
    },
    { role: "user", content: query },
  ];
}

export function buildNameMessages(
  content: string,
  fileName: string,
  customInstructions: string
): ChatMLMessage[] {
  return [
    {
      role: "system",
      content: `You are an Obsidian note renaming engine. Return ONLY a valid JSON object matching this exact schema, with no markdown fences and no extra prose:
{"titles":[{"title":"Descriptive Note Title","score":95,"reason":"Brief reason"}]}
Rules:
- Suggest 1 to 3 concise, filesystem-safe note titles (no / \\ : * ? " < > | characters, no .md extension), sorted by score descending (0-100).
${customInstructions ? `- Naming instructions: ${customInstructions}` : ""}`,
    },
    {
      role: "user",
      content: `Current filename: "${fileName}"\n\nContent:\n"""\n${content}\n"""`,
    },
  ];
}

export function buildClassifyMessages(
  content: string,
  classifications: string[]
): ChatMLMessage[] {
  return [
    {
      role: "system",
      content: `You are a document classifier. Choose which template type best matches the note content.
Available template types: ${classifications.join(", ")}
Return ONLY a valid JSON object matching:
{"documentType":"template_name_or_empty_string"}
If none of the template types clearly match, return {"documentType":""}. Do not invent template names not in the list.`,
    },
    {
      role: "user",
      content: `Content:\n"""\n${content}\n"""`,
    },
  ];
}

export function buildConceptsMessages(content: string): ChatMLMessage[] {
  return [
    {
      role: "system",
      content: `You extract atomic knowledge concepts from notes. Split the note into key self-contained concepts.
Return ONLY a valid JSON object matching this exact schema:
{"concepts":[{"name":"Concise Concept Title","chunk":"Relevant markdown section or summary for this concept"}]}`,
    },
    {
      role: "user",
      content: `Note content:\n"""\n${content}\n"""`,
    },
  ];
}

export function buildFormatMessages(
  content: string,
  formattingInstruction: string
): ChatMLMessage[] {
  return [
    {
      role: "system",
      content: `You are an expert Markdown editor for Obsidian. Reformat the user's note strictly following their formatting instructions. Preserve factual content. Output ONLY the formatted Markdown without wrapping the whole output in code fences.`,
    },
    {
      role: "user",
      content: `Formatting Instructions:\n${formattingInstruction}\n\nOriginal Content:\n"""\n${content}\n"""`,
    },
  ];
}

export function buildModifyMessages(
  content: string,
  instructions: string,
  originalContent?: string,
  customInstructions?: string
): ChatMLMessage[] {
  return [
    {
      role: "system",
      content: `You are an Obsidian note editor. Apply the requested edits cleanly.
Return ONLY a valid JSON object matching this exact schema:
{"content":"The full updated markdown text","explanation":"One sentence summarizing the edit"}
${customInstructions ? `Additional user instructions: ${customInstructions}` : ""}`,
    },
    {
      role: "user",
      content: `Edit Instructions: ${instructions}
${originalContent && originalContent !== content ? `\nFull Note Reference:\n"""\n${originalContent.slice(0, 2500)}\n"""` : ""}
\nTarget Text to Edit:\n"""\n${content}\n"""`,
    },
  ];
}
