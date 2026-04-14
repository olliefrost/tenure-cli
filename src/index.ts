#!/usr/bin/env bun
// Main CLI entry point.
// This file wires command-line flags/arguments to the concrete pipeline modules.
import process from "node:process";
import { Command, CommanderError } from "commander";
import { ingestSamples } from "./ingest.ts";
import { buildStyleProfile } from "./profile.ts";
import { rewriteWithProfile, readRewriteInput, renderDiff } from "./rewrite.ts";
import { loadProfile, saveProfile } from "./store.ts";

// Commander holds the root command plus all subcommands.
const program = new Command();

// Base metadata shown in `--help`.
program
  .name("tenure")
  .description("Extract and apply your writing style profile")
  .version("0.1.0");

// `init` builds and persists a style profile from writing samples.
program
  .command("init")
  .description("Ingest writing samples and generate a style profile")
  .argument("<paths...>", "directories or files to ingest")
  // Model can be overridden per run so users can experiment.
  .option("--model <model>", "Anthropic model", "claude-sonnet-4-20250514")
  // Verbose emits progress to stderr so stdout stays parse-friendly.
  .option("-v, --verbose", "show progress logs", false)
  .action(async (paths: string[], options: { model: string; verbose: boolean }) => {
    // 1) Read files + chunk into context-safe segments.
    const ingest = await ingestSamples(paths);
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
  .option("--model <model>", "Anthropic model", "claude-sonnet-4-20250514")
  .option("-v, --verbose", "show progress logs", false)
  .action(
    async (
      file: string | undefined,
      options: { diff: boolean; model: string; verbose: boolean }
    ) => {
      // Accept either `tenure rewrite file.md` or `cat file.md | tenure rewrite`.
      const input = await readRewriteInput(file);
      if (!input) {
        throw new Error("Input text is empty.");
      }

      // Rewrite requires an existing profile from `tenure init`.
      const stored = loadProfile();
      const rewritten = await rewriteWithProfile({
        text: input,
        profile: stored.profile,
        model: options.model,
        verbose: options.verbose
      });

      // In diff mode we render a text diff after streaming completes.
      if (options.diff) {
        process.stdout.write(`${renderDiff(input, rewritten)}\n`);
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
