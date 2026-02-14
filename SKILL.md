---
name: exa-cli
description: AI-powered web search, content extraction, and deep research via Exa API. Always use --compact flag to minimize token usage.
---

# Exa CLI

Needs env: `EXA_API_KEY`

**Always use `--compact` when calling from an AI agent.** Piped output auto-enables compact mode.

## Commands

```bash
exa search "query" --compact -n 3              # Web search (instant type, sub-150ms)
exa search "query" --compact --fields url      # Only URLs (minimal tokens)
exa search "query" --tsv -n 5                  # Tab-separated output
exa search "query" --type auto --compact       # Highest quality search
exa search "AI startups" --category company    # Category-filtered search
exa search "news" --highlights --compact       # Token-efficient excerpts
exa search "breaking" --max-age 1 --compact    # Fresh content only
exa find "similar to this" --compact           # Semantic similarity
exa content https://example.com --compact      # Extract page content
exa answer "what is X" --compact               # AI answer with sources
exa research "compare X vs Y" --compact        # Deep async research
```

## Key Flags

- `--compact` — **Always use.** Terse output for AI/LLM consumption
- `--fields <list>` — Comma-separated: `title,url,date,content`
- `--tsv` — Tab-separated output (header + one row per result)
- `--max-chars <n>` — Content truncation (default: 300 compact, 500 normal)
- `-n <num>` — Number of results (default: 5)
- `--content` — Include page content in search/find
- `--highlights [n]` — Key excerpts instead of full text (max chars, default: 2000)
- `--type <t>` — Search type: `instant` (default, sub-150ms), `auto`, `fast`, `deep`, `neural`
- `--category <c>` — Content category: `company`, `people`, `tweet`, `news`, `research paper`
- `--max-age <hrs>` — Max content age in hours (`0`=always live, `-1`=cache only)
- `--verbosity <v>` — Content verbosity: `compact`, `standard`, `full`
- `--json` — JSON output (compact single-line with `--compact`)
- `--domain <d>` — Filter to domain
- `--after/--before <YYYY-MM-DD>` — Date filter
- `--no-cache` — Bypass response cache
- `--cache-ttl <min>` — Cache TTL in minutes (default: 60)
- `--model exa-research-pro` — Thorough research model
- `--schema <file>` — Structured research output
