import type { ChatMLMessage } from "./types";
import type { ParaCategory, ParaRoots } from "../lib/para";
import { PARA_CATEGORIES } from "../lib/para";
import { getTokenCount } from "../utils/token-counter";

export const QWEN_IM_START = "<|im_start|>";
export const QWEN_IM_END = "<|im_end|>";
export const QWEN_STOP_TOKENS = [QWEN_IM_END, "<|endoftext|>"];
export const PARA_ORGANIZATION_ASSISTANT_PREFILL =
  '<think>\n\n</think>\n\n{"paraCategory": "';

/**
 * Formats conversation turns in Qwen3 ChatML format.
 * By default injects `/no_think` into the system prompt so Qwen3 responds
 * directly with fast JSON or concise text instead of long <think> traces.
 */
export function formatQwenChatML(
  messages: ChatMLMessage[],
  suppressThinking = true,
  assistantPrefill = ""
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
  prompt += `${QWEN_IM_START}assistant\n${assistantPrefill}`;
  return prompt;
}

export function fitChatMLMessagesToEstimatedTokenBudget(
  messages: ChatMLMessage[],
  maxTokens: number,
  assistantPrefill = ""
): ChatMLMessage[] {
  const fitted = messages.map((message) => ({ ...message }));
  const userMessage = [...fitted].reverse().find(
    (message) => message.role === "user"
  );

  while (
    userMessage &&
    userMessage.content.length > 0 &&
    getTokenCount(formatQwenChatML(fitted, true, assistantPrefill)) > maxTokens
  ) {
    userMessage.content = userMessage.content.slice(
      0,
      Math.max(0, userMessage.content.length - 80)
    );
  }

  if (
    getTokenCount(formatQwenChatML(fitted, true, assistantPrefill)) >
    maxTokens
  ) {
    throw new Error(
      `PARA organization instructions exceed the ${maxTokens}-token prompt budget.`
    );
  }

  return fitted;
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

export function parsePrefilledOrganizationOutput<T>(raw: string): T {
  const cleaned = stripThinkingBlocks(raw)
    .replace(/```(?:json)?/gi, "")
    .trimStart();
  const input = cleaned.startsWith("{")
    ? raw
    : `${PARA_ORGANIZATION_ASSISTANT_PREFILL}${raw}`;
  return parseJSONFromModelOutput<T>(input, raw);
}

/**
 * Extracts and repairs JSON from model output before parsing it.
 */
export function parseJSONFromModelOutput<T>(
  raw: string,
  rawForDiagnostics = raw
): T {
  const cleaned = stripThinkingBlocks(raw)
    .replace(/```(?:json)?/gi, "")
    .trim();
  const candidate = extractJsonCandidate(cleaned);
  if (!candidate) {
    console.warn("[PARA Companion] Raw model output:", rawForDiagnostics);
    throw new Error(
      `Model output did not contain valid JSON. Raw model output: ${rawForDiagnostics}`
    );
  }

  const repaired = repairJsonCandidate(candidate);
  try {
    return JSON.parse(repaired) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[PARA Companion] Raw model output:", rawForDiagnostics);
    throw new Error(
      `Model output did not contain valid JSON (${reason}). Raw model output: ${rawForDiagnostics}`
    );
  }
}

function extractJsonCandidate(input: string): string | null {
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

  const lastClose = input.lastIndexOf(closeChar);
  return lastClose >= start
    ? input.slice(start, lastClose + 1)
    : input.slice(start);
}

function repairJsonCandidate(input: string): string {
  let repaired = "";
  const closers: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        repaired += ch;
        escaped = false;
      } else if (ch === "\\") {
        repaired += ch;
        escaped = true;
      } else if (ch === '"') {
        repaired += ch;
        inString = false;
      } else if (ch === "\n" || ch === "\r") {
        repaired += "\\n";
        if (ch === "\r" && input[i + 1] === "\n") i++;
      } else {
        repaired += ch;
      }
      continue;
    }

    if (ch === '"') {
      repaired += ch;
      inString = true;
      continue;
    }
    if (ch === ",") {
      let next = i + 1;
      while (next < input.length && /\s/.test(input[next])) next++;
      if (
        next === input.length ||
        input[next] === "}" ||
        input[next] === "]"
      ) {
        continue;
      }
    }

    if (ch === "{") {
      closers.push("}");
    } else if (ch === "[") {
      closers.push("]");
    } else if (ch === "}" || ch === "]") {
      if (closers[closers.length - 1] === ch) closers.pop();
    }
    repaired += ch;
  }

  if (inString) repaired += '"';
  while (closers.length) repaired += closers.pop();
  return repaired;
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
  const folderList = folders.slice(0, 30);
  const extraInstructions = customInstructions.trim().slice(0, 200);

  return [
    {
      role: "system",
      content: `Route this Obsidian note using PARA. Return JSON only:
{"folders":[{"paraCategory":"project","folder":"1_Projects/Obsidian Plugin","score":92,"isNewFolder":false,"reason":"Brief reason"}]}
Choose one: project=active goal/deadline; area=ongoing responsibility; resource=reference/interest; archive=completed/inactive.
Use the matching root. Prefer an exact existing path; otherwise return the root or a short new child. isNewFolder is false only for an exact existing path.
Roots: ${roots ? PARA_CATEGORIES.map((category) => `${category}=${roots[category]}`).join(", ") : "not configured"}
Existing paths (max 30): ${folderList.length ? folderList.join(", ") : "none"}
Return up to ${count} results, score 0-100, highest first.${extraInstructions ? ` Extra instructions: ${extraInstructions}` : ""}`,
    },
    {
      role: "user",
      content: `File: "${fileName}"\n\nContent:\n"""\n${content}\n"""`,
    },
  ];
}

export function buildOrganizationMessages(
  content: string,
  fileName: string,
  folders: string[],
  existingTags: string[],
  roots: ParaRoots,
  currentCategory?: ParaCategory
): ChatMLMessage[] {
  const folderList = folders.slice(0, 12);
  const tagList = existingTags.slice(0, 12);

  return [
    {
      role: "system",
      content: `Classify and organize this Obsidian note with PARA. Return one compact JSON object only:
{"paraCategory":"projects","targetFolder":"1_Projects/Subfolder","suggestedFilename":"Clean Title","tags":["para/project","topic"]}
Projects=active goal/deadline; areas=ongoing responsibility; resources=reference/interest; archives=completed/inactive.
Choose a configured root and prefer a matching existing folder. Use a short child only if useful. Keep the filename concise.
Tags: 2-4 lowercase hyphenated values, no #, including exactly one matching status tag (para/project, para/area, para/resource, para/archive).
Roots: projects=${roots.project}; areas=${roots.area}; resources=${roots.resource}; archives=${roots.archive}
Folders: ${folderList.length ? folderList.join(", ") : "none"}
Existing tags: ${tagList.length ? tagList.join(", ") : "none"}
${currentCategory ? `Current category=${currentCategory}; retain unless clearly wrong.` : ""}`,
    },
    {
      role: "user",
      content: `File: ${fileName}\n${content}`,
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
