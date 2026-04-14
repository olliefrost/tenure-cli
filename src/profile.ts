import Anthropic from "@anthropic-ai/sdk";
import { isStyleProfile, type StyleProfile } from "./types.ts";

// Default model for both style extraction and rewrite in v1.
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
// Batch size threshold used to keep each extraction request bounded.
const MAX_CHARS_PER_BATCH = 14_000;
// Lightweight retry count for transient API failures.
const MAX_RETRIES = 3;

export interface BuildProfileOptions {
  // Sentence-safe chunks produced by ingest.
  chunks: string[];
  // Optional model override.
  model?: string;
  // Emits progress logs to stderr.
  verbose?: boolean;
}

// Runs style extraction over chunk batches and returns one merged profile.
export async function buildStyleProfile({
  chunks,
  model = DEFAULT_MODEL,
  verbose = false
}: BuildProfileOptions): Promise<{ profile: StyleProfile; model: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  const client = new Anthropic({ apiKey });
  // Split chunks into prompt-sized batches.
  const batches = createBatches(chunks, MAX_CHARS_PER_BATCH);

  const partialProfiles: StyleProfile[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    if (verbose) {
      process.stderr.write(
        `Extracting style profile batch ${index + 1}/${batches.length}...\n`
      );
    }

    // Retry each batch extraction independently.
    const profile = await withRetries(async () => {
      const response = await client.messages.create({
        model,
        max_tokens: 1200,
        // Lower temperature to encourage consistent structured outputs.
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: buildExtractionPrompt(batches[index] ?? [])
          }
        ]
      });

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      // Parse and shape-check model output before accepting it.
      return parseProfileJson(text);
    });

    partialProfiles.push(profile);
  }

  // If multiple batches were used, merge into one aggregate profile.
  return { profile: mergeProfiles(partialProfiles), model };
}

function buildExtractionPrompt(chunks: string[]): string {
  // Prompt explicitly requests strict JSON, because free-form prose causes
  // fragile parsing in automation pipelines.
  return `Analyze the writing samples and return strict JSON only.

The JSON must match this shape exactly:
{
  "sentenceLength": {"averageWords": number, "p50Words": number, "p90Words": number},
  "vocabulary": {"lexicalDiversity": number, "complexityNotes": string[]},
  "hedgingLanguage": string[],
  "punctuationTendencies": string[],
  "paragraphRhythm": string,
  "argumentStructure": string,
  "openingPatterns": string[],
  "closingPatterns": string[],
  "recurringPhrases": string[]
}

Do not include markdown fences.

Samples:
${chunks.map((chunk, index) => `Sample ${index + 1}:\n${chunk}`).join("\n\n")}`;
}

function parseProfileJson(raw: string): StyleProfile {
  // Defensive cleanup in case model still wraps output in markdown fences.
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Anthropic returned invalid JSON while extracting profile.");
  }

  if (!isStyleProfile(parsed)) {
    throw new Error("Anthropic JSON did not match expected style profile shape.");
  }

  return parsed;
}

function createBatches(chunks: string[], maxCharsPerBatch: number): string[][] {
  // Greedy batching by character count.
  // Character length is a simple proxy for token usage.
  const batches: string[][] = [];
  let current: string[] = [];
  let currentSize = 0;

  for (const chunk of chunks) {
    const chunkSize = chunk.length;
    if (currentSize + chunkSize > maxCharsPerBatch && current.length > 0) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }

    current.push(chunk);
    currentSize += chunkSize;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function mergeProfiles(profiles: StyleProfile[]): StyleProfile {
  // Fast path for the common single-batch case.
  if (profiles.length === 1) {
    return profiles[0]!;
  }

  // Numeric fields are averaged, while phrase-like fields are deduplicated.
  // This keeps merged output stable and concise.
  const avg = (values: number[]): number =>
    Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  const uniq = (values: string[][]): string[] =>
    [...new Set(values.flat().map((entry) => entry.trim()).filter(Boolean))].slice(0, 15);

  return {
    sentenceLength: {
      averageWords: avg(profiles.map((profile) => profile.sentenceLength.averageWords)),
      p50Words: avg(profiles.map((profile) => profile.sentenceLength.p50Words)),
      p90Words: avg(profiles.map((profile) => profile.sentenceLength.p90Words))
    },
    vocabulary: {
      lexicalDiversity: avg(profiles.map((profile) => profile.vocabulary.lexicalDiversity)),
      complexityNotes: uniq(profiles.map((profile) => profile.vocabulary.complexityNotes))
    },
    hedgingLanguage: uniq(profiles.map((profile) => profile.hedgingLanguage)),
    punctuationTendencies: uniq(profiles.map((profile) => profile.punctuationTendencies)),
    paragraphRhythm: profiles[0]!.paragraphRhythm,
    argumentStructure: profiles[0]!.argumentStructure,
    openingPatterns: uniq(profiles.map((profile) => profile.openingPatterns)),
    closingPatterns: uniq(profiles.map((profile) => profile.closingPatterns)),
    recurringPhrases: uniq(profiles.map((profile) => profile.recurringPhrases))
  };
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  // Simple linear backoff to absorb transient network/API hiccups.
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await Bun.sleep(400 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown API failure.");
}
