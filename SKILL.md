---
name: exa-cli
description: AI-powered web search, content extraction, and deep research via Exa API. Always use --compact flag to minimize token usage.
---

# Exa CLI

Needs env: `EXA_API_KEY`

**Always use `--compact` when calling from an AI agent.** This reduces output tokens by removing decorative formatting, ANSI colors, and verbose labels. Piped output auto-enables compact mode.

## Commands

```bash
exa search "query" --compact -n 3              # Web search
exa search "query" --compact --content         # With page content
exa search "query" --compact --fields url      # Only URLs (minimal tokens)
exa find "similar to this" --compact           # Semantic similarity
exa content https://example.com --compact      # Extract page content
exa answer "what is X" --compact               # AI answer with sources
exa research "compare X vs Y" --compact        # Deep async research
```

## Key Flags

- `--compact` — **Always use.** Terse output for AI/LLM consumption
- `--fields <list>` — Comma-separated: `title,url,date,content`. Only show selected fields
- `--max-chars <n>` — Content truncation (default: 300 compact, 500 normal)
- `-n <num>` — Number of results (default: 5)
- `--content` — Include page content in search/find
- `--json` — JSON output (compact single-line with `--compact`)
- `--domain <d>` — Filter to domain
- `--after/--before <YYYY-MM-DD>` — Date filter
- `--no-cache` — Bypass response cache
- `--cache-ttl <min>` — Cache TTL in minutes (default: 60)
- `--model exa-research-pro` — Thorough research model
- `--schema <file>` — Structured research output
