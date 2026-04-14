import { readFile } from "node:fs/promises";
import process from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { diffLines } from "diff";
import OpenAI from "openai";
import { resolveProvider } from "./provider.ts";
import type { StyleProfile } from "./types.ts";

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
  onDelta?: (chunk: string) => void;
}): Promise<string> {
  const {
    text,
    profile,
    model,
    verbose = false,
    onDelta
  } = params;
  const selected = resolveProvider(model);
  const prompt = buildRewritePrompt(text, profile);

  if (verbose) {
    process.stderr.write(
      `Rewriting with ${selected.provider} model ${selected.model}...\n`
    );
  }

  if (selected.provider === "anthropic") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return rewriteWithAnthropic({
      client,
      model: selected.model,
      prompt,
      text,
      onDelta
    });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return rewriteWithOpenAI({
    client,
    model: selected.model,
    prompt,
    onDelta
  });
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

async function rewriteWithAnthropic(params: {
  client: Anthropic;
  model: string;
  prompt: string;
  text: string;
  onDelta?: (chunk: string) => void;
}): Promise<string> {
  const { client, model, prompt, text, onDelta } = params;
  const stream = client.messages.stream({
    model,
    max_tokens: Math.max(1400, Math.ceil(text.length * 0.8)),
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  });

  let rewritten = "";
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const delta = event.delta.text;
      rewritten += delta;
      onDelta?.(delta);
    }
  }

  return rewritten.trim();
}

async function rewriteWithOpenAI(params: {
  client: OpenAI;
  model: string;
  prompt: string;
  onDelta?: (chunk: string) => void;
}): Promise<string> {
  const { client, model, prompt, onDelta } = params;
  const stream = await client.chat.completions.create({
    model,
    temperature: 0.3,
    stream: true,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  });

  let rewritten = "";
  for await (const event of stream) {
    const delta = event.choices[0]?.delta?.content ?? "";
    if (delta.length > 0) {
      rewritten += delta;
      onDelta?.(delta);
    }
  }

  return rewritten.trim();
}
