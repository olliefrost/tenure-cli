#!/usr/bin/env bun
// Main CLI entry point.
// This file wires command-line flags/arguments to the concrete pipeline modules.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Command, CommanderError } from "commander";
import { ingestSamples } from "./ingest.ts";
import { buildStyleProfile } from "./profile.ts";
import { rewriteWithProfile, readRewriteInput, renderDiff } from "./rewrite.ts";
import { loadProfile, saveProfile } from "./store.ts";

const DEFAULT_SAMPLES_PATH = "samples";
const DEFAULT_OUTPUTS_DIR = "outputs";

// Commander holds the root command plus all subcommands.
const program = new Command();

// Base metadata shown in `--help`.
program
  .name("tenure")
  .description("Extract and apply your writing style profile")
  .version("1.0.0");

// `init` builds and persists a style profile from writing samples.
program
  .command("init")
  .description("Ingest writing samples and generate a style profile")
  .argument("[paths...]", "directories or files to ingest")
  // Model can be overridden per run so users can experiment.
  .option("--model <model>", "model override (Anthropic or OpenAI)")
  // Verbose emits progress to stderr so stdout stays parse-friendly.
  .option("-v, --verbose", "show progress logs", false)
  .action(async (paths: string[], options: { model?: string; verbose: boolean }) => {
    // Default to ./samples when no explicit path is supplied.
    const selectedPaths = paths.length > 0 ? paths : [DEFAULT_SAMPLES_PATH];
    if (options.verbose && paths.length === 0) {
      process.stderr.write(
        `No sample paths provided, defaulting to ./${DEFAULT_SAMPLES_PATH}.\n`
      );
    }

    // 1) Read files + chunk into context-safe segments.
    const ingest = await ingestSamples(selectedPaths);
    if (options.verbose) {
      process.stderr.write(
        `Loaded ${ingest.files.length} files, ${ingest.wordCount} words, ${ingest.chunks.length} chunks.\n`
      );
    }

    // 2) Ask Anthropic to extract a structured style profile.
    const { profile, model } = await buildStyleProfile({
      chunks: ingest.chunks,
      model: options.model,
      verbose: options.verbose
    });

    // 3) Save profile for future rewrite runs.
    const stored = saveProfile(profile, model);
    process.stdout.write(`Saved style profile at ${stored.updatedAt}.\n`);
  });

// `rewrite` applies the saved profile to new input text.
program
  .command("rewrite")
  .description("Rewrite input text with the stored style profile")
  // Optional file; when omitted we read from stdin.
  .argument("[file]", "file to rewrite, otherwise reads stdin")
  .option("--diff", "show diff instead of rewritten text", false)
  .option("-o, --out <file>", "write rewritten output to a file")
  .option("--stdout", "stream rewritten output to stdout", false)
  .option("--model <model>", "model override (Anthropic or OpenAI)")
  .option("-v, --verbose", "show progress logs", false)
  .action(
    async (
      file: string | undefined,
      options: {
        diff: boolean;
        out?: string;
        stdout: boolean;
        model?: string;
        verbose: boolean;
      }
    ) => {
      if (options.stdout && options.out) {
        throw new Error("Use either --stdout or --out, not both.");
      }

      // Accept either `tenure rewrite file.md` or `cat file.md | tenure rewrite`.
      const input = await readRewriteInput(file);
      if (!input) {
        throw new Error("Input text is empty.");
      }

      // Rewrite requires an existing profile from `tenure init`.
      const stored = loadProfile();
      // In normal mode we now default to writing output under ./outputs.
      // `--stdout` keeps pipe-friendly behaviour when explicitly requested.
      const shouldStreamToStdout = !options.diff && options.stdout;
      const rewritten = await rewriteWithProfile({
        text: input,
        profile: stored.profile,
        model: options.model,
        verbose: options.verbose,
        onDelta: shouldStreamToStdout
          ? (chunk) => {
              process.stdout.write(chunk);
            }
          : undefined
      });

      if (!options.diff && !shouldStreamToStdout) {
        const outputPath = resolveOutputPath({
          explicitOutPath: options.out,
          sourceFilePath: file
        });
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${rewritten}\n`, "utf8");
        process.stderr.write(`Saved rewritten output to ${outputPath}\n`);
      }

      // In diff mode we render a text diff after streaming completes.
      if (options.diff) {
        process.stdout.write(`${renderDiff(input, rewritten)}\n`);
      } else if (shouldStreamToStdout) {
        process.stdout.write("\n");
      }
    }
  );

// We override default exits so we can control error formatting and status codes.
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  // Help/version are "intentional exits", not real failures.
  if (
    error instanceof CommanderError &&
    (error.code === "commander.helpDisplayed" ||
      error.code === "commander.version")
  ) {
    process.exit(0);
  }

  // All other thrown errors are surfaced in a uniform CLI format.
  const message = error instanceof Error ? error.message : "Unknown error.";
  process.stderr.write(`tenure: ${message}\n`);
  process.exit(1);
}

function resolveOutputPath(params: {
  explicitOutPath?: string;
  sourceFilePath?: string;
}): string {
  const { explicitOutPath, sourceFilePath } = params;
  if (explicitOutPath) {
    return path.resolve(explicitOutPath);
  }

  if (sourceFilePath) {
    const ext = path.extname(sourceFilePath);
    const base = path.basename(sourceFilePath, ext);
    return path.resolve(DEFAULT_OUTPUTS_DIR, `${base}.rewritten${ext || ".txt"}`);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return path.resolve(DEFAULT_OUTPUTS_DIR, `rewritten-${timestamp}.txt`);
}
