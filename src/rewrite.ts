import { readFile } from "node:fs/promises";
import process from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { diffLines } from "diff";
import type { StyleProfile } from "./types.ts";

// Default rewrite model; can be overridden by CLI flag.
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// Reads rewrite input from either a provided file or piped stdin.
// This keeps CLI UX flexible:
// - `tenure rewrite draft.md`
// - `cat draft.md | tenure rewrite`
export async function readRewriteInput(file?: string): Promise<string> {
  if (file) {
    return (await readFile(file, "utf8")).trim();
  }

  // If stdin is a TTY and no file was passed, user did not provide input.
  if (process.stdin.isTTY) {
    throw new Error("Provide a file or pipe text into stdin.");
  }

  let input = "";
  // Async iteration handles arbitrarily large streamed stdin without blocking.
  for await (const chunk of process.stdin) {
    input += String(chunk);
  }

  return input.trim();
}

export async function rewriteWithProfile(params: {
  text: string;
  profile: StyleProfile;
  model?: string;
  verbose?: boolean;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  const { text, profile, model = DEFAULT_MODEL, verbose = false } = params;
  const client = new Anthropic({ apiKey });

  // Use the SDK streaming API so users see incremental output.
  const stream = client.messages.stream({
    model,
    // A rough heuristic for max output budget.
    max_tokens: Math.max(1400, Math.ceil(text.length * 0.8)),
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: buildRewritePrompt(text, profile)
      }
    ]
  });

  if (verbose) {
    process.stderr.write(`Rewriting with model ${model}...\n`);
  }

  let rewritten = "";
  // The stream emits many event types; we only consume text deltas.
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const delta = event.delta.text;
      rewritten += delta;
      // Stream directly to stdout for responsive terminal UX.
      process.stdout.write(delta);
    }
  }

  process.stdout.write("\n");
  return rewritten.trim();
}

export function renderDiff(original: string, rewritten: string): string {
  // Unified-style line diff for quick terminal inspection.
  const chunks = diffLines(original, rewritten);
  const lines: string[] = ["--- Original", "+++ Rewritten"];

  for (const chunk of chunks) {
    const prefix = chunk.added ? "+" : chunk.removed ? "-" : " ";
    const chunkLines = chunk.value.split("\n");
    for (const line of chunkLines) {
      if (line.length > 0) {
        lines.push(`${prefix} ${line}`);
      }
    }
  }

  return lines.join("\n");
}

function buildRewritePrompt(text: string, profile: StyleProfile): string {
  // Prompt keeps a strict semantic-preservation constraint and supplies
  // the learned profile as structured JSON.
  return `Rewrite the text to match the provided style profile.

Rules:
- Preserve all facts and meaning.
- Do not add or remove claims.
- Change only expression and phrasing.
- Keep markdown structure if present.

Style profile JSON:
${JSON.stringify(profile, null, 2)}

Text to rewrite:
${text}`;
}
