# exa-cli

AI-powered web search, content extraction, and deep research from the command line via [Exa API](https://exa.ai).

Built for speed. Optimized for AI agents — `--compact` mode strips all decoration for minimal token usage.

## Install

```bash
cargo install exa-cli
```

### From source

```bash
git clone https://github.com/Finesssee/exa-cli
cd exa-cli/rs
cargo build --release
# Binary at ./target/release/exa
```

> **Note:** The Node.js version (`npm install -g exa-cli`) is deprecated. Use the Rust version above.

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

# Search types (instant is default — sub-150ms)
exa search "query" --type auto       # highest quality
exa search "query" --type fast       # balanced speed/quality
exa search "topic" --type deep       # comprehensive research

# Category filters
exa search "AI startups" --category company
exa search "Elon Musk" --category people

# Highlights (token-efficient excerpts)
exa search "react hooks" --highlights 3000

# Content freshness
exa search "breaking news" --max-age 1
exa search "historical data" --max-age -1   # cache only

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
| `--highlights [n]` | Key excerpts instead of full text (max chars, default: 2000) |
| `--type <t>` | Search type: `instant` (default, sub-150ms), `auto`, `fast`, `deep`, `neural` |
| `--category <c>` | Content category: `company`, `people`, `tweet`, `news`, `research paper` |
| `--max-age <hrs>` | Max content age in hours (`0`=always live, `-1`=cache only) |
| `--verbosity <v>` | Content verbosity: `compact`, `standard`, `full` |
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
