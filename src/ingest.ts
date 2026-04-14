import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

// Target chunk size used to keep each prompt segment reasonably small.
// 500 words is a practical balance between context richness and token limits.
const WORDS_PER_CHUNK = 500;

// Output from the ingest phase that downstream profile extraction consumes.
export interface IngestResult {
  // Absolute file paths included in the corpus.
  files: string[];
  // Sentence-aware text chunks ready to send to the model.
  chunks: string[];
  // Approximate total words across normalised corpus text.
  wordCount: number;
}

// Public ingest pipeline:
// 1) resolve and collect corpus files
// 2) normalise text
// 3) chunk text at sentence boundaries
export async function ingestSamples(inputs: string[]): Promise<IngestResult> {
  if (inputs.length === 0) {
    throw new Error("Provide at least one file or directory for init.");
  }

  const files = await collectTextFiles(inputs);
  if (files.length === 0) {
    throw new Error("No .txt or .md files found in provided paths.");
  }

  const texts = await Promise.all(files.map((file) => readFile(file, "utf8")));
  // Remove formatting noise while preserving paragraph breaks.
  const normalized = texts.map(normalizeText).filter((text) => text.length > 0);
  // Chunk without splitting sentences where possible.
  const chunks = chunkTexts(normalized, WORDS_PER_CHUNK);
  const wordCount = countWords(normalized.join("\n"));

  if (chunks.length === 0) {
    throw new Error("Found files but no usable text content.");
  }

  return { files, chunks, wordCount };
}

async function collectTextFiles(inputs: string[]): Promise<string[]> {
  // Set guarantees uniqueness when paths overlap.
  const fileSet = new Set<string>();

  for (const input of inputs) {
    const target = path.resolve(input);
    // Stat lets us support both direct file paths and directories.
    const details = await stat(target);

    if (details.isFile()) {
      if (target.endsWith(".txt") || target.endsWith(".md")) {
        fileSet.add(target);
      }
      continue;
    }

    // Recursive glob over directory input.
    const matches = await glob("**/*.{txt,md}", {
      cwd: target,
      absolute: true,
      nodir: true
    });

    for (const file of matches) {
      fileSet.add(path.resolve(file));
    }
  }

  return [...fileSet].sort();
}

function normalizeText(value: string): string {
  // Normalisation strategy:
  // - convert CRLF to LF for consistency
  // - trim trailing spaces per line
  // - collapse very large blank-line runs
  // - remove leading/trailing outer whitespace
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkTexts(texts: string[], wordsPerChunk: number): string[] {
  const corpus = texts.join("\n\n");
  // Heuristic split:
  // Split on whitespace that follows sentence punctuation and precedes likely sentence starts.
  // It's not perfect NLP sentence segmentation, but robust enough for a lightweight CLI.
  const sentences = corpus
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentenceWordCount = countWords(sentence);
    // Only roll to a new chunk if we would overflow and we already have content.
    // This prevents empty chunks and allows long single sentences to stand alone.
    const wouldOverflow =
      currentWordCount + sentenceWordCount > wordsPerChunk &&
      currentChunk.length > 0;

    if (wouldOverflow) {
      chunks.push(currentChunk.join(" "));
      currentChunk = [];
      currentWordCount = 0;
    }

    currentChunk.push(sentence);
    currentWordCount += sentenceWordCount;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks;
}

function countWords(value: string): number {
  // Simple token estimate by non-whitespace runs.
  // Good enough for chunk sizing (not intended for linguistic precision).
  const words = value.trim().match(/\S+/g);
  return words?.length ?? 0;
}
