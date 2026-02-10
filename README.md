# exa-cli

AI-powered web search, content extraction, and deep research from the command line via [Exa API](https://exa.ai).

Built for speed. Optimized for AI agents — `--compact` mode strips all decoration for minimal token usage.

## Install

### Rust (recommended)

```bash
cargo install exa-cli
```

### Node.js

```bash
npm install -g @anthropic-ai/exa-cli
# or
npx exa-cli search "your query"
```

### From source

```bash
git clone https://github.com/Finesssee/exa-cli
cd exa-cli/rs
cargo build --release
# Binary at ./target/release/exa
```

## Setup

```bash
export EXA_API_KEY="your-key-here"   # Get one at https://exa.ai
```

## Usage

```bash
# Search the web
exa search "latest rust async patterns" -n 5

# Compact mode (recommended for AI agents — auto-enabled on pipe)
exa search "query" --compact -n 3

# Only specific fields
exa search "query" --compact --fields url
exa search "query" --compact --fields title,url

# Tab-separated output
exa search "query" --tsv -n 5

# Find similar pages
exa find "https://example.com" --compact

# Extract page content
exa content https://example.com --compact

# Quick answer with sources
exa answer "what is WebAssembly" --compact

# Deep research
exa research "compare React vs Svelte in 2025" --compact

# JSON output
exa search "query" --json --compact
```

## Flags

| Flag | Description |
|---|---|
| `--compact` | Terse output for AI/LLM consumption (auto on pipe) |
| `--fields <list>` | Comma-separated: `title,url,date,content` |
| `--tsv` | Tab-separated output (header + rows) |
| `--max-chars <n>` | Content truncation limit (default: 300 compact, 500 normal) |
| `-n <num>` | Number of results (default: 5) |
| `--content` | Include page text in search/find results |
| `--json` | JSON output (single-line with `--compact`) |
| `--domain <d>` | Restrict to domain |
| `--after <date>` | Published after YYYY-MM-DD |
| `--before <date>` | Published before YYYY-MM-DD |
| `--no-cache` | Bypass response cache |
| `--cache-ttl <min>` | Cache TTL in minutes (default: 60) |
| `--no-sources` | Hide sources in answer/research |
| `--model <m>` | `exa-research` (default) or `exa-research-pro` |
| `--schema <file>` | JSON schema for structured research output |

## Token Optimization

When used by AI agents, combine flags for minimal output:

```bash
# Absolute minimum — just URLs
exa search "query" --compact --fields url -n 3

# Titles + URLs only
exa search "query" --compact --fields title,url

# TSV for structured parsing
exa search "query" --tsv -n 5

# Cached repeat queries are instant (~13ms vs ~1200ms)
exa search "same query" --compact
```

## License

MIT
