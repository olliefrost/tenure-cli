# tenure

Tenure is a Bun + TypeScript CLI that learns your writing style from a corpus and rewrites new text to match it.

Command examples below use `tenure ...`, with `bun run` equivalents shown for local development before linking the binary globally.

Defaults:
- `tenure init` uses `./samples` when no sample path is supplied.
- `tenure rewrite` writes to `./outputs` by default when no output location is supplied.

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

Initialise from one or more folders/files:

```bash
tenure init
# defaults to ./samples

# bun run equivalent:
bun run src/index.ts init

# explicit paths:
tenure init samples
# or:
tenure init ~/notes ~/essays ./old-drafts

# bun run equivalents:
bun run src/index.ts init samples
bun run src/index.ts init ~/notes ~/essays ./old-drafts
```

Use verbose logs if you want to observe chunking and model progress:

```bash
tenure init --verbose samples

# bun run equivalent:
bun run src/index.ts init --verbose samples
```

### 5) Rewrite text in your style

Rewrite from a file:

```bash
tenure rewrite draft.md
# writes to ./outputs/draft.rewritten.md by default

# bun run equivalent:
bun run src/index.ts rewrite draft.md
```

Pipe rewritten output into a new file:

```bash
tenure rewrite --stdout draft.md > rewritten.md

# bun run equivalent:
bun run src/index.ts rewrite --stdout draft.md > rewritten.md
```

Rewrite piped stdin:

```bash
cat draft.md | tenure rewrite
# writes to ./outputs/rewritten-<timestamp>.txt by default

# bun run equivalent:
cat draft.md | bun run src/index.ts rewrite
```

Rewrite piped stdin to stdout (for shell piping):

```bash
cat draft.md | tenure rewrite --stdout > rewritten.md

# bun run equivalent:
cat draft.md | bun run src/index.ts rewrite --stdout > rewritten.md
```

Show a diff of original vs rewritten:

```bash
tenure rewrite --diff draft.md

# bun run equivalent:
bun run src/index.ts rewrite --diff draft.md
```

Use a specific model if needed:

```bash
tenure rewrite --model claude-sonnet-4-20250514 draft.md

# bun run equivalent:
bun run src/index.ts rewrite --model claude-sonnet-4-20250514 draft.md
```

Write directly to a file (without shell redirection):

```bash
tenure rewrite -o rewritten.md draft.md

# bun run equivalent:
bun run src/index.ts rewrite -o rewritten.md draft.md
```

## CLI Reference

Main commands:

- `tenure init <paths...>`: ingest `.txt`/`.md` files and save a local style profile
  - `bun run src/index.ts init <paths...>`
- `tenure rewrite [file]`: rewrite a file or stdin using the saved profile
  - `bun run src/index.ts rewrite [file]`
- `tenure rewrite --stdout [file]`: stream rewritten text to stdout (useful for shell pipes)
  - `bun run src/index.ts rewrite --stdout [file]`
- `tenure rewrite --diff [file]`: print a line diff of original vs rewritten
  - `bun run src/index.ts rewrite --diff [file]`
- `tenure rewrite -o <output-file> [file]`: write rewritten text to file
  - `bun run src/index.ts rewrite -o <output-file> [file]`
- `tenure --help`: show command help
  - `bun run src/index.ts --help`

## Development

```bash
bun run dev -- --help
bun run typecheck
```

## Notes

- Profiles are persisted locally via `conf` under your user config directory (for example `~/.config` on Linux).
- v1 uses Anthropic for style extraction and rewriting.
- Offline embeddings are intentionally deferred; the codebase is structured so local clustering can be added later.
