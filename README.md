# tenure

Tenure is a Bun + TypeScript CLI that learns your writing style from a corpus and rewrites new text to match it.

## Quick Start

### 1) Install dependencies

```bash
bun install
```

### 2) Add your Anthropic API key

Set it for your current shell session:

```bash
export ANTHROPIC_API_KEY="your_key_here"
```

If you want it to persist, add the same line to your shell config (`~/.bashrc`, `~/.zshrc`, etc.), then restart your shell.

### 3) Prepare writing samples

Create a folder with your own `.txt` and/or `.md` writing samples. Example:

```bash
mkdir -p samples
cp ~/notes/*.md samples/
cp ~/essays/*.txt samples/
```

You can also point `tenure init` directly at existing folders; you do not need to copy files if you already have them organized.

### 4) Build your style profile

Initialize from one or more folders/files:

```bash
tenure init samples
# or:
tenure init ~/notes ~/essays ./old-drafts
```

Use verbose logs if you want to observe chunking and model progress:

```bash
tenure init --verbose samples
```

### 5) Rewrite text in your style

Rewrite from a file:

```bash
tenure rewrite draft.md
```

Rewrite piped stdin:

```bash
cat draft.md | tenure rewrite
```

Show a diff of original vs rewritten:

```bash
tenure rewrite --diff draft.md
```

Use a specific model if needed:

```bash
tenure rewrite --model claude-sonnet-4-20250514 draft.md
```

## CLI Reference

Main commands:

- `tenure init <paths...>`: ingest `.txt`/`.md` files and save a local style profile
- `tenure rewrite [file]`: rewrite a file or stdin using the saved profile
- `tenure rewrite --diff [file]`: print a line diff of original vs rewritten
- `tenure --help`: show command help

## Development

```bash
bun run dev -- --help
bun run typecheck
```

## Notes

- Profiles are persisted locally via `conf` under your user config directory (for example `~/.config` on Linux).
- v1 uses Anthropic for style extraction and rewriting.
- Offline embeddings are intentionally deferred; the codebase is structured so local clustering can be added later.
