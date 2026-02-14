#!/usr/bin/env node

import Exa from "exa-js";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import os from "os";

const VERSION = "1.3.0";

// Colors (respects NO_COLOR)
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const c = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  red: useColor ? "\x1b[31m" : "",
  blue: useColor ? "\x1b[34m" : "",
};

function printHelp() {
  console.log(`${c.bold}exa${c.reset} - AI-powered web search via Exa API

${c.bold}USAGE${c.reset}
  exa <command> [options] <query|url>

${c.bold}COMMANDS${c.reset}
  search <query>     Search the web
  find <query>       Semantic similarity search
  content <url>      Extract content from URL
  answer <query>     Get AI answer with sources
  research <query>   Deep AI research (async, multi-step)
  status             Show API key status and usage stats

${c.bold}OPTIONS${c.reset}
  -h, --help         Show this help
  --version          Print version
  -n, --num <n>      Number of results (default: 5)
  --content          Include page content
  --domain <d>       Filter to domain
  --after <date>     Results after YYYY-MM-DD
  --before <date>    Results before YYYY-MM-DD
  --json             Output as JSON
  --no-color         Disable colors
  --type <t>         Search type: instant (default), auto, fast, deep, neural
  --category <c>     Content category: company, people, tweet, news, research paper
  --max-age <hrs>    Max content age in hours (0=always live, -1=cache only)
  --highlights [n]   Return key excerpts instead of full text (max chars, default: 2000)
  --verbosity <v>    Content verbosity: compact, standard, full
  --model <m>        Research model (exa-research, exa-research-pro)
  --schema <file>    JSON schema file for structured research output

${c.bold}ENVIRONMENT${c.reset}
  EXA_API_KEY        Your Exa API key (single key).
  EXA_API_KEYS       Comma-separated keys for round-robin rotation.

${c.bold}EXAMPLES${c.reset}
  exa search "rust async patterns"
  exa search "react hooks" -n 10 --content
  exa search "news" --domain nytimes.com --after 2025-01-01
  exa search "fast query" --type fast
  exa search "deep topic" --type deep
  exa search "real-time query" --type instant
  exa search "AI startups" --category company
  exa search "breaking news" --max-age 1
  exa search "react hooks" --highlights 3000
  exa search "rust async" --content --verbosity compact
  exa find "clean code principles"
  exa content https://example.com/article
  exa answer "what is kubernetes"
  exa search "node.js" --json | jq '.results[].url'
  exa research "compare nvidia rtx 4090 vs 5090"
  exa research "market size of AI" --model exa-research-pro
`);
}

function parseArgs(args) {
  const opts = {
    command: null,
    query: [],
    num: 5,
    content: false,
    domain: null,
    after: null,
    before: null,
    json: false,
    noColor: false,
    help: false,
    version: false,
    summary: false,
    sources: true,
    model: "exa-research",
    type: "instant",
    category: null,
    maxAge: null,
    highlights: null,
    verbosity: null,
    schema: null,
    compact: false,
    maxChars: null,
    fields: null,
    noCache: false,
    cacheTtl: 60,
    tsv: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--version") {
      opts.version = true;
    } else if (arg === "-n" || arg === "--num") {
      opts.num = parseInt(args[++i], 10) || 5;
    } else if (arg === "--content") {
      opts.content = true;
    } else if (arg === "--domain") {
      opts.domain = args[++i];
    } else if (arg === "--after") {
      opts.after = args[++i];
    } else if (arg === "--before") {
      opts.before = args[++i];
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--no-color") {
      opts.noColor = true;
    } else if (arg === "--summary") {
      opts.summary = true;
    } else if (arg === "--no-sources") {
      opts.sources = false;
    } else if (arg === "--model") {
      opts.model = args[++i];
    } else if (arg === "--type") {
      opts.type = args[++i];
    } else if (arg === "--category") {
      opts.category = args[++i];
    } else if (arg === "--max-age") {
      opts.maxAge = parseInt(args[++i], 10);
    } else if (arg === "--highlights") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        opts.highlights = parseInt(next, 10) || 2000;
        i++;
      } else {
        opts.highlights = 2000;
      }
    } else if (arg === "--verbosity") {
      opts.verbosity = args[++i];
    } else if (arg === "--schema") {
      opts.schema = args[++i];
    } else if (arg === "--compact") {
      opts.compact = true;
    } else if (arg === "--max-chars") {
      opts.maxChars = parseInt(args[++i], 10) || null;
    } else if (arg === "--fields") {
      opts.fields = new Set(args[++i].split(",").map(s => s.trim().toLowerCase()));
    } else if (arg === "--no-cache") {
      opts.noCache = true;
    } else if (arg === "--cache-ttl") {
      opts.cacheTtl = parseInt(args[++i], 10) || 60;
    } else if (arg === "--tsv") {
      opts.tsv = true;
    } else if (!opts.command && ["search", "find", "content", "answer", "research", "status"].includes(arg)) {
      opts.command = arg;
    } else if (!arg.startsWith("-")) {
      opts.query.push(arg);
    }
    i++;
  }

  opts.query = opts.query.join(" ");
  // Auto-enable compact when stdout is piped (AI agents read via pipe)
  if (!process.stdout.isTTY) {
    opts.compact = true;
  }
  opts.effectiveMaxChars = opts.maxChars || (opts.compact ? 300 : 500);
  return opts;
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars);
  let cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
  if (cut > 0) cut += 1;
  else cut = window.lastIndexOf(" ");
  if (cut <= 0) cut = maxChars;
  return window.slice(0, cut).trimEnd() + "...";
}

function showField(fields, name) {
  return !fields || fields.has(name);
}

// --- Cache helpers ---

function configDir() {
  const dir = path.join(process.env.APPDATA || (process.env.HOME || os.homedir()), ".config", "exa");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheDir() {
  const dir = path.join(configDir(), "cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheKey(parts) {
  return crypto.createHash("md5").update(parts.join("|")).digest("hex");
}

function cacheRead(key, ttlMinutes) {
  const file = path.join(cacheDir(), `${key}.json`);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > ttlMinutes * 60 * 1000) return null;
    return fs.readFileSync(file, "utf-8");
  } catch { return null; }
}

function cacheWrite(key, data) {
  const dir = cacheDir();
  const file = path.join(dir, `${key}.json`);
  try {
    fs.writeFileSync(file, data);
    // LRU eviction: if >50 entries, delete oldest
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    if (files.length > 50) {
      files.slice(0, files.length - 50).forEach(f => fs.unlinkSync(path.join(dir, f.name)));
    }
  } catch { }
}

// --- Key Manager (round-robin with cooldown + usage tracking) ---

const DEFAULT_COOLDOWN_MS = 60_000;

function maskKey(key) {
  return key.length <= 3 ? "***" : `...${key.slice(-3)}`;
}

function loadKeysFromEnv() {
  const multi = (process.env.EXA_API_KEYS || "").trim();
  if (multi) {
    const keys = multi.split(",").map(s => s.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  const single = (process.env.EXA_API_KEY || "").trim();
  if (single) return [single];
  return null;
}

function stateFilePath() {
  return path.join(configDir(), "state.json");
}

function loadKeyState() {
  try {
    const raw = fs.readFileSync(stateFilePath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: 1, currentIndex: 0, lastValidated: Date.now(), keys: {} };
  }
}

function saveKeyState(state) {
  try { fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2)); } catch {}
}

function getNextKey(keys, state) {
  const now = Date.now();

  // Ensure all keys have entries
  for (let i = 0; i < keys.length; i++) {
    if (!state.keys[i]) {
      state.keys[i] = { valid: true, cooldownUntil: null, requests: 0, success: 0, errors: 0 };
    }
  }

  // Filter valid keys
  const validIndices = [];
  for (let i = 0; i < keys.length; i++) {
    if (state.keys[i].valid !== false) validIndices.push(i);
  }
  if (validIndices.length === 0) return null;

  // Filter keys not on cooldown
  const available = validIndices.filter(i => {
    const cd = state.keys[i].cooldownUntil;
    return !cd || now >= cd;
  });

  let selected;
  if (available.length === 0) {
    // All on cooldown — pick the one expiring soonest
    selected = validIndices.reduce((best, i) => {
      const cd = state.keys[i].cooldownUntil || 0;
      const bestCd = state.keys[best].cooldownUntil || 0;
      return cd < bestCd ? i : best;
    });
    const wait = Math.max(0, (state.keys[selected].cooldownUntil || 0) - now);
    if (wait > 0) {
      // For CLI, just pick it — the slight wait is acceptable
    }
  } else {
    // Round-robin with usage balancing: start from currentIndex, pick lowest usage
    const start = (state.currentIndex || 0) % keys.length;
    let bestIdx = available[0];
    let bestUsage = Infinity;
    for (let offset = 0; offset < keys.length; offset++) {
      const idx = (start + offset) % keys.length;
      if (available.includes(idx)) {
        const usage = state.keys[idx].requests || 0;
        if (usage < bestUsage) {
          bestUsage = usage;
          bestIdx = idx;
        }
      }
    }
    selected = bestIdx;
  }

  state.currentIndex = (selected + 1) % keys.length;
  return selected;
}

function recordSuccess(state, idx) {
  const k = state.keys[idx];
  if (!k) return;
  k.requests = (k.requests || 0) + 1;
  k.success = (k.success || 0) + 1;
  k.cooldownUntil = null;
}

function recordRateLimit(state, idx, retryAfterMs) {
  const k = state.keys[idx];
  if (!k) return;
  k.errors = (k.errors || 0) + 1;
  k.cooldownUntil = Date.now() + (retryAfterMs || DEFAULT_COOLDOWN_MS);
}

function printKeyStatus(keys, state) {
  const now = Date.now();
  console.log(`${c.bold}Exa API Key Status${c.reset}`);
  console.log("=".repeat(50));
  console.log(`${c.bold}Total Keys:${c.reset} ${keys.length}`);
  console.log(`${c.bold}Next Index:${c.reset} ${(state.currentIndex || 0) % keys.length}`);
  console.log();
  for (let i = 0; i < keys.length; i++) {
    const info = state.keys[i] || { valid: true, requests: 0, success: 0, errors: 0 };
    const masked = maskKey(keys[i]);
    let status;
    if (info.valid === false) {
      status = `${c.red}INVALID${c.reset}`;
    } else if (info.cooldownUntil && now < info.cooldownUntil) {
      const remaining = Math.ceil((info.cooldownUntil - now) / 1000);
      status = `${c.yellow}COOLDOWN (${remaining}s)${c.reset}`;
    } else {
      status = `${c.green}READY${c.reset}`;
    }
    console.log(`Key ${i}: ${c.cyan}${masked}${c.reset} - ${status}`);
    console.log(`  Requests: ${info.requests || 0} | Success: ${info.success || 0} | Errors: ${info.errors || 0}`);
  }
}

function buildContentsOpt(opts) {
  if (opts.highlights != null) {
    const contentsObj = { highlights: { maxCharacters: opts.highlights } };
    if (opts.verbosity) contentsObj.verbosity = opts.verbosity;
    return contentsObj;
  }
  if (opts.content) {
    const contentsObj = { text: true };
    if (opts.verbosity) contentsObj.verbosity = opts.verbosity;
    return contentsObj;
  }
  return undefined;
}

async function search(exa, opts) {
  const ck = cacheKey(["search", opts.query, String(opts.num), opts.type, opts.category || "", opts.domain || "", opts.after || "", opts.before || "", String(opts.maxAge ?? ""), String(opts.highlights ?? ""), opts.verbosity || ""]);

  if (!opts.noCache) {
    const cached = cacheRead(ck, opts.cacheTtl);
    if (cached) {
      const results = JSON.parse(cached);
      return printSearchResults(opts, results);
    }
  }

  const searchOpts = {
    numResults: opts.num,
    type: opts.type,
    contents: buildContentsOpt(opts),
  };

  if (opts.domain) searchOpts.includeDomains = [opts.domain];
  if (opts.after) searchOpts.startPublishedDate = opts.after;
  if (opts.before) searchOpts.endPublishedDate = opts.before;
  if (opts.category) searchOpts.category = opts.category;
  if (opts.maxAge != null) searchOpts.maxAgeHours = opts.maxAge;

  const results = await exa.search(opts.query, searchOpts);

  if (!opts.noCache) {
    cacheWrite(ck, JSON.stringify(results));
  }

  return printSearchResults(opts, results);
}

function printSearchResults(opts, results) {
  if (opts.json) {
    console.log(opts.compact ? JSON.stringify(results) : JSON.stringify(results, null, 2));
    return;
  }

  if (!results.results || results.results.length === 0) {
    console.error("No results found.");
    process.exit(3);
  }

  const max = opts.effectiveMaxChars;
  const f = opts.fields;

  if (opts.tsv) {
    console.log("title\turl\tdate");
    results.results.forEach(r => {
      const title = (r.title || "N/A").replace(/\t/g, " ");
      console.log(`${title}\t${r.url}\t${r.publishedDate || ""}`);
    });
    return;
  }

  if (opts.compact) {
    results.results.forEach((r, i) => {
      if (showField(f, "title")) console.log(`[${i + 1}] ${r.title}`);
      if (showField(f, "url")) console.log(`url: ${r.url}`);
      if (showField(f, "date") && r.publishedDate) console.log(`date: ${r.publishedDate}`);
      if (showField(f, "content") && r.text) console.log(`content: ${truncateText(r.text, max)}`);
      if (showField(f, "highlights") && r.highlights && r.highlights.length > 0) {
        r.highlights.forEach(h => console.log(`highlight: ${h}`));
      }
    });
  } else {
    results.results.forEach((r, i) => {
      console.log(`${c.dim}--- Result ${i + 1} ---${c.reset}`);
      if (showField(f, "title")) console.log(`${c.bold}Title:${c.reset} ${r.title}`);
      if (showField(f, "url")) console.log(`${c.cyan}Link:${c.reset} ${r.url}`);
      if (showField(f, "date") && r.publishedDate) console.log(`${c.dim}Date:${c.reset} ${r.publishedDate}`);
      if (showField(f, "content") && r.text) {
        console.log(`${c.green}Content:${c.reset}`);
        console.log(truncateText(r.text, max));
      }
      if (showField(f, "highlights") && r.highlights && r.highlights.length > 0) {
        console.log(`${c.yellow}Highlights:${c.reset}`);
        r.highlights.forEach(h => console.log(`  ${h}`));
      }
      console.log();
    });
  }
}

async function findSimilar(exa, opts) {
  const ck = cacheKey(["find", opts.query, String(opts.num), opts.type]);

  if (!opts.noCache) {
    const cached = cacheRead(ck, opts.cacheTtl);
    if (cached) return printSearchResults(opts, JSON.parse(cached));
  }

  const results = await exa.findSimilar(opts.query, {
    numResults: opts.num,
    type: opts.type,
    contents: buildContentsOpt(opts),
  });

  if (!opts.noCache) cacheWrite(ck, JSON.stringify(results));
  return printSearchResults(opts, results);
}

async function getContent(exa, opts) {
  const ck = cacheKey(["content", opts.query]);

  if (!opts.noCache) {
    const cached = cacheRead(ck, opts.cacheTtl);
    if (cached) {
      const results = JSON.parse(cached);
      if (results.results && results.results[0]) {
        return printContentResult(opts, results.results[0]);
      }
    }
  }

  const results = await exa.getContents([opts.query], { text: true });

  if (!opts.noCache) cacheWrite(ck, JSON.stringify(results));

  if (opts.json) {
    console.log(opts.compact ? JSON.stringify(results) : JSON.stringify(results, null, 2));
    return;
  }

  if (!results.results || results.results.length === 0) {
    console.error("Could not extract content.");
    process.exit(1);
  }

  printContentResult(opts, results.results[0]);
}

function printContentResult(opts, r) {
  const max = opts.effectiveMaxChars;
  const f = opts.fields;

  if (opts.compact) {
    if (showField(f, "title")) console.log(r.title);
    if (showField(f, "url")) console.log(`url: ${r.url}`);
    if (showField(f, "content")) console.log(r.text ? truncateText(r.text, max) : "");
  } else {
    if (showField(f, "title")) console.log(`${c.bold}Title:${c.reset} ${r.title}`);
    if (showField(f, "url")) console.log(`${c.cyan}URL:${c.reset} ${r.url}`);
    console.log();
    if (showField(f, "content")) console.log(r.text);
  }
}

async function answer(exa, opts) {
  const results = await exa.search(opts.query, {
    numResults: 5,
    type: opts.type,
    contents: { text: true, highlights: true },
  });

  if (opts.json) {
    console.log(opts.compact ? JSON.stringify(results) : JSON.stringify(results, null, 2));
    return;
  }

  if (!results.results || results.results.length === 0) {
    console.error("No results found.");
    process.exit(3);
  }

  const max = opts.effectiveMaxChars;
  const highlights = results.results
    .filter((r) => r.highlights && r.highlights.length > 0)
    .flatMap((r) => r.highlights)
    .slice(0, 3);

  if (opts.compact) {
    if (highlights.length > 0) {
      highlights.forEach((h) => console.log(h));
    } else {
      const firstText = results.results[0]?.text;
      if (firstText) console.log(truncateText(firstText, max));
    }
    if (opts.sources) {
      console.log(`sources: ${results.results.slice(0, 3).map((r) => r.url).join(" | ")}`);
    }
  } else {
    console.log(`${c.bold}${c.green}Answer:${c.reset}`);
    console.log();

    if (highlights.length > 0) {
      highlights.forEach((h) => console.log(`  ${h}`));
      console.log();
    } else {
      const firstText = results.results[0]?.text;
      if (firstText) {
        console.log(truncateText(firstText, max));
        console.log();
      }
    }

    if (opts.sources) {
      console.log(`${c.dim}Sources:${c.reset}`);
      results.results.slice(0, 3).forEach((r) => {
        console.log(`  ${c.cyan}${r.url}${c.reset}`);
      });
    }
  }
}

async function research(exa, opts) {
  const researchOpts = {
    instructions: opts.query,
    model: opts.model === "exa-research-pro" ? "exa-research" : "exa-research-fast",
  };

  if (opts.schema) {
    try {
      const schemaContent = fs.readFileSync(opts.schema, "utf-8");
      researchOpts.outputSchema = JSON.parse(schemaContent);
    } catch (err) {
      console.error(`Error: Failed to read schema file: ${err.message}`);
      process.exit(2);
    }
  }

  if (!opts.json && !opts.compact) {
    console.log("Starting research task...");
  }

  const created = await exa.research.create(researchOpts);
  const taskId = created.researchId;

  if (!opts.json && !opts.compact) {
    console.log(`Task ID: ${taskId}`);
    console.log("Polling for results...");
  }

  const result = await exa.research.pollUntilFinished(taskId, {
    pollIntervalMs: 5000,
    timeoutMs: 600000,
  });

  if (result.status === "failed") {
    throw new Error(`Research task failed: ${result.error || "Unknown error"}`);
  }
  if (result.status === "canceled") {
    throw new Error("Research task was canceled");
  }

  if (opts.json) {
    console.log(opts.compact ? JSON.stringify(result) : JSON.stringify(result, null, 2));
    return;
  }

  if (opts.compact) {
    if (result.output?.content) {
      console.log(result.output.content);
    } else if (result.outputs && result.outputs.length > 0) {
      result.outputs.forEach((output) => {
        console.log(typeof output === "object" ? JSON.stringify(output) : output);
      });
    }
    if (opts.sources && result.citations && result.citations.length > 0) {
      console.log(`sources: ${result.citations.slice(0, 5).map((c) => c.url).join(" | ")}`);
    }
  } else {
    console.log();
    console.log(`${c.bold}${c.green}Research Complete${c.reset}`);
    if (result.costDollars?.total) {
      console.log(`${c.dim}Cost: $${result.costDollars.total.toFixed(4)}${c.reset}`);
    }
    console.log();

    if (result.output?.content) {
      console.log(result.output.content);
      console.log();
    } else if (result.outputs && result.outputs.length > 0) {
      result.outputs.forEach((output, i) => {
        if (result.outputs.length > 1) {
          console.log(`${c.bold}--- Output ${i + 1} ---${c.reset}`);
        }
        console.log(typeof output === "object" ? JSON.stringify(output, null, 2) : output);
        console.log();
      });
    }

    if (opts.sources && result.citations && result.citations.length > 0) {
      console.log(`${c.dim}Sources:${c.reset}`);
      result.citations.slice(0, 5).forEach((cite) => {
        console.log(`  ${c.cyan}${cite.url}${c.reset}`);
      });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  if (opts.help || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    console.log(VERSION);
    process.exit(0);
  }

  const keys = loadKeysFromEnv();
  if (!keys) {
    console.error(`${c.red}Error:${c.reset} No API key found.`);
    console.error(`Set EXA_API_KEY or EXA_API_KEYS (comma-separated).`);
    console.error(`Get your key at: https://exa.ai`);
    process.exit(2);
  }

  const state = loadKeyState();

  if (opts.command === "status") {
    printKeyStatus(keys, state);
    process.exit(0);
  }

  if (!opts.command) {
    console.error(`${c.red}Error:${c.reset} No command specified.`);
    console.error(`Run 'exa --help' for usage.`);
    process.exit(2);
  }

  if (!opts.query) {
    console.error(`${c.red}Error:${c.reset} No query provided.`);
    process.exit(2);
  }

  const keyIdx = getNextKey(keys, state);
  if (keyIdx === null) {
    console.error(`${c.red}Error:${c.reset} No valid API keys available.`);
    process.exit(2);
  }

  const apiKey = keys[keyIdx];
  const exa = new Exa(apiKey);

  try {
    switch (opts.command) {
      case "search":
        await search(exa, opts);
        break;
      case "find":
        await findSimilar(exa, opts);
        break;
      case "content":
        await getContent(exa, opts);
        break;
      case "answer":
        await answer(exa, opts);
        break;
      case "research":
        await research(exa, opts);
        break;
      default:
        console.error(`${c.red}Unknown command:${c.reset} ${opts.command}`);
        process.exit(2);
    }
    recordSuccess(state, keyIdx);
    saveKeyState(state);
  } catch (err) {
    // Check if rate limited (429)
    if (err.status === 429 || (err.message && err.message.includes("429"))) {
      recordRateLimit(state, keyIdx);
      saveKeyState(state);
      // If we have more keys, retry with next one
      if (keys.length > 1) {
        const retryIdx = getNextKey(keys, state);
        if (retryIdx !== null && retryIdx !== keyIdx) {
          const retryExa = new Exa(keys[retryIdx]);
          try {
            switch (opts.command) {
              case "search": await search(retryExa, opts); break;
              case "find": await findSimilar(retryExa, opts); break;
              case "content": await getContent(retryExa, opts); break;
              case "answer": await answer(retryExa, opts); break;
              case "research": await research(retryExa, opts); break;
            }
            recordSuccess(state, retryIdx);
            saveKeyState(state);
            return;
          } catch (retryErr) {
            if (retryErr.status === 429 || (retryErr.message && retryErr.message.includes("429"))) {
              recordRateLimit(state, retryIdx);
            }
            saveKeyState(state);
          }
        }
      }
    }
    if (opts.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
    }
    process.exit(1);
  }
}

main();
