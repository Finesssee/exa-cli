#!/usr/bin/env node

import Exa from "exa-js";

const VERSION = "1.1.0";

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
  --model <m>        Research model (exa-research, exa-research-pro)
  --schema <file>    JSON schema file for structured research output

${c.bold}ENVIRONMENT${c.reset}
  EXA_API_KEY        Required. Your Exa API key.

${c.bold}EXAMPLES${c.reset}
  exa search "rust async patterns"
  exa search "react hooks" -n 10 --content
  exa search "news" --domain nytimes.com --after 2025-01-01
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
    schema: null,
    compact: false,
    maxChars: null,
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
    } else if (arg === "--schema") {
      opts.schema = args[++i];
    } else if (arg === "--compact") {
      opts.compact = true;
    } else if (arg === "--max-chars") {
      opts.maxChars = parseInt(args[++i], 10) || null;
    } else if (!opts.command && ["search", "find", "content", "answer", "research"].includes(arg)) {
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

async function search(exa, opts) {
  const searchOpts = {
    numResults: opts.num,
    contents: opts.content ? { text: true } : undefined,
  };

  if (opts.domain) {
    searchOpts.includeDomains = [opts.domain];
  }
  if (opts.after) {
    searchOpts.startPublishedDate = opts.after;
  }
  if (opts.before) {
    searchOpts.endPublishedDate = opts.before;
  }

  const results = await exa.search(opts.query, searchOpts);

  if (opts.json) {
    console.log(opts.compact ? JSON.stringify(results) : JSON.stringify(results, null, 2));
    return;
  }

  if (!results.results || results.results.length === 0) {
    console.error("No results found.");
    process.exit(3);
  }

  const max = opts.effectiveMaxChars;

  if (opts.compact) {
    results.results.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.title}`);
      console.log(`url: ${r.url}`);
      if (r.publishedDate) console.log(`date: ${r.publishedDate}`);
      if (r.text) console.log(`content: ${r.text.slice(0, max)}${r.text.length > max ? "..." : ""}`);
    });
  } else {
    results.results.forEach((r, i) => {
      console.log(`${c.dim}--- Result ${i + 1} ---${c.reset}`);
      console.log(`${c.bold}Title:${c.reset} ${r.title}`);
      console.log(`${c.cyan}Link:${c.reset} ${r.url}`);
      if (r.publishedDate) {
        console.log(`${c.dim}Date:${c.reset} ${r.publishedDate}`);
      }
      if (r.text) {
        console.log(`${c.green}Content:${c.reset}`);
        console.log(r.text.slice(0, max) + (r.text.length > max ? "..." : ""));
      }
      console.log();
    });
  }
}

async function findSimilar(exa, opts) {
  const results = await exa.findSimilar(opts.query, {
    numResults: opts.num,
    contents: opts.content ? { text: true } : undefined,
  });

  if (opts.json) {
    console.log(opts.compact ? JSON.stringify(results) : JSON.stringify(results, null, 2));
    return;
  }

  if (!results.results || results.results.length === 0) {
    console.error("No similar results found.");
    process.exit(3);
  }

  const max = opts.effectiveMaxChars;

  if (opts.compact) {
    results.results.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.title}`);
      console.log(`url: ${r.url}`);
      if (r.text) console.log(`content: ${r.text.slice(0, max)}${r.text.length > max ? "..." : ""}`);
    });
  } else {
    results.results.forEach((r, i) => {
      console.log(`${c.dim}--- Result ${i + 1} ---${c.reset}`);
      console.log(`${c.bold}Title:${c.reset} ${r.title}`);
      console.log(`${c.cyan}Link:${c.reset} ${r.url}`);
      if (r.text) {
        console.log(`${c.green}Content:${c.reset}`);
        console.log(r.text.slice(0, max) + (r.text.length > max ? "..." : ""));
      }
      console.log();
    });
  }
}

async function getContent(exa, opts) {
  const results = await exa.getContents([opts.query], { text: true });

  if (opts.json) {
    console.log(opts.compact ? JSON.stringify(results) : JSON.stringify(results, null, 2));
    return;
  }

  if (!results.results || results.results.length === 0) {
    console.error("Could not extract content.");
    process.exit(1);
  }

  const r = results.results[0];
  const max = opts.effectiveMaxChars;

  if (opts.compact) {
    console.log(r.title);
    console.log(`url: ${r.url}`);
    console.log(r.text ? r.text.slice(0, max) + (r.text.length > max ? "..." : "") : "");
  } else {
    console.log(`${c.bold}Title:${c.reset} ${r.title}`);
    console.log(`${c.cyan}URL:${c.reset} ${r.url}`);
    console.log();
    console.log(r.text);
  }
}

async function answer(exa, opts) {
  const results = await exa.search(opts.query, {
    numResults: 5,
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
      if (firstText) console.log(firstText.slice(0, max) + (firstText.length > max ? "..." : ""));
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
        console.log(firstText.slice(0, max) + (firstText.length > max ? "..." : ""));
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
  const fs = await import("fs");

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

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.error(`${c.red}Error:${c.reset} EXA_API_KEY environment variable is required.`);
    console.error(`Get your key at: https://exa.ai`);
    process.exit(2);
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
  } catch (err) {
    if (opts.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`${c.red}Error:${c.reset} ${err.message}`);
    }
    process.exit(1);
  }
}

main();
