mod key_manager;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use colored::Colorize;
use key_manager::KeyManager;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::IsTerminal;

const VERSION: &str = "1.1.0";

#[derive(Parser)]
#[command(name = "exa")]
#[command(about = "AI-powered web search via Exa API", long_about = None)]
#[command(version = VERSION)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Number of results (default: 5)
    #[arg(short = 'n', long = "num", global = true, default_value = "5")]
    num: usize,

    /// Include page content
    #[arg(long = "content", global = true)]
    content: bool,

    /// Filter to domain
    #[arg(long = "domain", global = true)]
    domain: Option<String>,

    /// Results after YYYY-MM-DD
    #[arg(long = "after", global = true)]
    after: Option<String>,

    /// Results before YYYY-MM-DD
    #[arg(long = "before", global = true)]
    before: Option<String>,

    /// Output as JSON
    #[arg(long = "json", global = true)]
    json: bool,

    /// Research model (exa-research, exa-research-pro)
    #[arg(long = "model", global = true, default_value = "exa-research")]
    model: String,

    /// JSON schema file for structured research output
    #[arg(long = "schema", global = true)]
    schema: Option<String>,

    /// Hide sources in output
    #[arg(long = "no-sources", global = true)]
    no_sources: bool,

    /// Compact output for AI/LLM consumption (minimal tokens)
    #[arg(long = "compact", global = true)]
    compact: bool,

    /// Max characters of content per result (default: 300 compact, 500 normal)
    #[arg(long = "max-chars", global = true)]
    max_chars: Option<usize>,

    /// Verbose output for debugging
    #[arg(short = 'v', long = "verbose", global = true)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Search the web
    Search {
        /// Search query
        query: Vec<String>,
    },
    /// Semantic similarity search
    Find {
        /// Query or URL for similarity search
        query: Vec<String>,
    },
    /// Extract content from URL
    Content {
        /// URL to extract content from
        url: String,
    },
    /// Get AI answer with sources
    Answer {
        /// Question to answer
        query: Vec<String>,
    },
    /// Deep AI research (async, multi-step)
    Research {
        /// Research instructions
        query: Vec<String>,
    },

    /// Show API key status, cooldowns, and usage
    Status,

    /// Reset cooldowns and usage statistics
    Reset,
}

// API Request/Response types
#[derive(Serialize)]
struct SearchRequest {
    query: String,
    #[serde(rename = "numResults")]
    num_results: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    contents: Option<ContentsConfig>,
    #[serde(rename = "includeDomains", skip_serializing_if = "Option::is_none")]
    include_domains: Option<Vec<String>>,
    #[serde(rename = "startPublishedDate", skip_serializing_if = "Option::is_none")]
    start_published_date: Option<String>,
    #[serde(rename = "endPublishedDate", skip_serializing_if = "Option::is_none")]
    end_published_date: Option<String>,
}

#[derive(Serialize)]
struct ContentsConfig {
    text: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    highlights: Option<bool>,
}

#[derive(Serialize)]
struct FindSimilarRequest {
    url: String,
    #[serde(rename = "numResults")]
    num_results: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    contents: Option<ContentsConfig>,
}

#[derive(Serialize)]
struct GetContentsRequest {
    urls: Vec<String>,
    text: bool,
}

#[derive(Serialize)]
struct ResearchCreateRequest {
    instructions: String,
    model: String,
    #[serde(rename = "outputSchema", skip_serializing_if = "Option::is_none")]
    output_schema: Option<serde_json::Value>,
}

#[derive(Deserialize, Serialize, Debug)]
struct SearchResponse {
    results: Vec<SearchResult>,
}

#[derive(Deserialize, Serialize, Debug)]
struct SearchResult {
    title: Option<String>,
    url: String,
    #[serde(rename = "publishedDate")]
    published_date: Option<String>,
    text: Option<String>,
    highlights: Option<Vec<String>>,
}

#[derive(Deserialize, Serialize, Debug)]
struct ResearchCreateResponse {
    #[serde(rename = "researchId")]
    research_id: String,
}

#[derive(Deserialize, Serialize, Debug)]
struct ResearchStatusResponse {
    status: String,
    error: Option<String>,
    output: Option<ResearchOutput>,
    outputs: Option<Vec<serde_json::Value>>,
    citations: Option<Vec<Citation>>,
    #[serde(rename = "costDollars")]
    cost_dollars: Option<CostDollars>,
}

#[derive(Deserialize, Serialize, Debug)]
struct ResearchOutput {
    content: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
struct Citation {
    url: String,
}

#[derive(Deserialize, Serialize, Debug)]
struct CostDollars {
    total: Option<f64>,
}

struct ExaClient {
    client: reqwest::Client,
    key_manager: KeyManager,
    base_url: String,
}

impl ExaClient {
    fn new(key_manager: KeyManager) -> Self {
        Self {
            client: reqwest::Client::new(),
            key_manager,
            base_url: "https://api.exa.ai".to_string(),
        }
    }

    async fn search(&mut self, request: SearchRequest) -> Result<SearchResponse> {
        const MAX_RETRIES: usize = 3;

        for attempt in 0..MAX_RETRIES {
            let (key_idx, api_key) = self.key_manager.get_next_key()?;

            let resp = self
                .client
                .post(format!("{}/search", self.base_url))
                .header("x-api-key", &api_key)
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
                .context("Failed to send search request")?;

            let status = resp.status();
            let _ = self.key_manager.log_request(key_idx, "search", status.as_u16());

            if status.as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok());
                self.key_manager.mark_rate_limited(key_idx, retry_after);
                if attempt < MAX_RETRIES - 1 {
                    continue;
                }
                bail!("Rate limited after {} retries", MAX_RETRIES);
            }

            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                bail!("Search failed ({}): {}", status, text);
            }

            self.key_manager.record_success(key_idx);
            return resp.json().await.context("Failed to parse search response");
        }

        bail!("Search failed after {} retries", MAX_RETRIES)
    }

    async fn find_similar(&mut self, request: FindSimilarRequest) -> Result<SearchResponse> {
        const MAX_RETRIES: usize = 3;

        for attempt in 0..MAX_RETRIES {
            let (key_idx, api_key) = self.key_manager.get_next_key()?;

            let resp = self
                .client
                .post(format!("{}/findSimilar", self.base_url))
                .header("x-api-key", &api_key)
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
                .context("Failed to send find similar request")?;

            let status = resp.status();
            let _ = self.key_manager.log_request(key_idx, "findSimilar", status.as_u16());

            if status.as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok());
                self.key_manager.mark_rate_limited(key_idx, retry_after);
                if attempt < MAX_RETRIES - 1 {
                    continue;
                }
                bail!("Rate limited after {} retries", MAX_RETRIES);
            }

            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                bail!("Find similar failed ({}): {}", status, text);
            }

            self.key_manager.record_success(key_idx);
            return resp
                .json()
                .await
                .context("Failed to parse find similar response");
        }

        bail!("Find similar failed after {} retries", MAX_RETRIES)
    }

    async fn get_contents(&mut self, urls: Vec<String>) -> Result<SearchResponse> {
        const MAX_RETRIES: usize = 3;
        let request = GetContentsRequest { urls, text: true };

        for attempt in 0..MAX_RETRIES {
            let (key_idx, api_key) = self.key_manager.get_next_key()?;

            let resp = self
                .client
                .post(format!("{}/contents", self.base_url))
                .header("x-api-key", &api_key)
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
                .context("Failed to send get contents request")?;

            let status = resp.status();
            let _ = self.key_manager.log_request(key_idx, "contents", status.as_u16());

            if status.as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok());
                self.key_manager.mark_rate_limited(key_idx, retry_after);
                if attempt < MAX_RETRIES - 1 {
                    continue;
                }
                bail!("Rate limited after {} retries", MAX_RETRIES);
            }

            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                bail!("Get contents failed ({}): {}", status, text);
            }

            self.key_manager.record_success(key_idx);
            return resp
                .json()
                .await
                .context("Failed to parse get contents response");
        }

        bail!("Get contents failed after {} retries", MAX_RETRIES)
    }

    async fn research_create(&mut self, request: ResearchCreateRequest) -> Result<(ResearchCreateResponse, usize)> {
        const MAX_RETRIES: usize = 3;

        for attempt in 0..MAX_RETRIES {
            let (key_idx, api_key) = self.key_manager.get_next_key()?;

            let resp = self
                .client
                .post(format!("{}/research", self.base_url))
                .header("x-api-key", &api_key)
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
                .context("Failed to create research task")?;

            let status = resp.status();
            let _ = self.key_manager.log_request(key_idx, "research", status.as_u16());

            if status.as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok());
                self.key_manager.mark_rate_limited(key_idx, retry_after);
                if attempt < MAX_RETRIES - 1 {
                    continue;
                }
                bail!("Rate limited after {} retries", MAX_RETRIES);
            }

            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                bail!("Research create failed ({}): {}", status, text);
            }

            self.key_manager.record_success(key_idx);
            let response: ResearchCreateResponse = resp
                .json()
                .await
                .context("Failed to parse research create response")?;
            return Ok((response, key_idx));
        }

        bail!("Research create failed after {} retries", MAX_RETRIES)
    }

    async fn research_status(&mut self, research_id: &str, key_idx: Option<usize>) -> Result<ResearchStatusResponse> {
        const MAX_RETRIES: usize = 3;

        for attempt in 0..MAX_RETRIES {
            let (idx, api_key) = if let Some(specific_idx) = key_idx {
                let key = self.key_manager.get_key_by_index(specific_idx)
                    .context("Invalid key index")?;
                (specific_idx, key)
            } else {
                self.key_manager.get_next_key()?
            };

            let resp = self
                .client
                .get(format!("{}/research/{}", self.base_url, research_id))
                .header("x-api-key", &api_key)
                .send()
                .await
                .context("Failed to get research status")?;

            let status = resp.status();
            let _ = self.key_manager.log_request(idx, "research_status", status.as_u16());

            if status.as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok());
                self.key_manager.mark_rate_limited(idx, retry_after);
                if attempt < MAX_RETRIES - 1 {
                    continue;
                }
                bail!("Rate limited after {} retries", MAX_RETRIES);
            }

            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                bail!("Research status failed ({}): {}", status, text);
            }

            self.key_manager.record_success(idx);
            return resp
                .json()
                .await
                .context("Failed to parse research status response");
        }

        bail!("Research status failed after {} retries", MAX_RETRIES)
    }
}

/// Get the effective max chars for content truncation
fn get_max_chars(cli: &Cli) -> usize {
    cli.max_chars.unwrap_or(if cli.compact { 300 } else { 500 })
}

/// Truncate text to max_chars, appending "..." if truncated
fn truncate_text(text: &str, max_chars: usize) -> String {
    if text.len() > max_chars {
        format!("{}...", &text[..max_chars])
    } else {
        text.to_string()
    }
}

/// Serialize to JSON — compact (no whitespace) or pretty
fn to_json<T: Serialize>(value: &T, compact: bool) -> Result<String> {
    if compact {
        Ok(serde_json::to_string(value)?)
    } else {
        Ok(serde_json::to_string_pretty(value)?)
    }
}

async fn cmd_search(client: &mut ExaClient, cli: &Cli, query: String) -> Result<()> {
    let request = SearchRequest {
        query,
        num_results: cli.num,
        contents: if cli.content {
            Some(ContentsConfig {
                text: true,
                highlights: None,
            })
        } else {
            None
        },
        include_domains: cli.domain.as_ref().map(|d| vec![d.clone()]),
        start_published_date: cli.after.clone(),
        end_published_date: cli.before.clone(),
    };

    let results = client.search(request).await?;

    if cli.json {
        println!("{}", to_json(&results, cli.compact)?);
        return Ok(());
    }

    if results.results.is_empty() {
        eprintln!("No results found.");
        std::process::exit(3);
    }

    let max_chars = get_max_chars(cli);

    if cli.compact {
        for (i, r) in results.results.iter().enumerate() {
            println!("[{}] {}", i + 1, r.title.as_deref().unwrap_or("N/A"));
            println!("url: {}", r.url);
            if let Some(date) = &r.published_date {
                println!("date: {}", date);
            }
            if let Some(text) = &r.text {
                println!("content: {}", truncate_text(text, max_chars));
            }
        }
    } else {
        for (i, r) in results.results.iter().enumerate() {
            println!("{}", format!("--- Result {} ---", i + 1).dimmed());
            println!("{} {}", "Title:".bold(), r.title.as_deref().unwrap_or("N/A"));
            println!("{} {}", "Link:".cyan(), r.url);
            if let Some(date) = &r.published_date {
                println!("{} {}", "Date:".dimmed(), date);
            }
            if let Some(text) = &r.text {
                println!("{}", "Content:".green());
                println!("{}", truncate_text(text, max_chars));
            }
            println!();
        }
    }

    Ok(())
}

async fn cmd_find(client: &mut ExaClient, cli: &Cli, query: String) -> Result<()> {
    let request = FindSimilarRequest {
        url: query,
        num_results: cli.num,
        contents: if cli.content {
            Some(ContentsConfig {
                text: true,
                highlights: None,
            })
        } else {
            None
        },
    };

    let results = client.find_similar(request).await?;

    if cli.json {
        println!("{}", to_json(&results, cli.compact)?);
        return Ok(());
    }

    if results.results.is_empty() {
        eprintln!("No similar results found.");
        std::process::exit(3);
    }

    let max_chars = get_max_chars(cli);

    if cli.compact {
        for (i, r) in results.results.iter().enumerate() {
            println!("[{}] {}", i + 1, r.title.as_deref().unwrap_or("N/A"));
            println!("url: {}", r.url);
            if let Some(text) = &r.text {
                println!("content: {}", truncate_text(text, max_chars));
            }
        }
    } else {
        for (i, r) in results.results.iter().enumerate() {
            println!("{}", format!("--- Result {} ---", i + 1).dimmed());
            println!("{} {}", "Title:".bold(), r.title.as_deref().unwrap_or("N/A"));
            println!("{} {}", "Link:".cyan(), r.url);
            if let Some(text) = &r.text {
                println!("{}", "Content:".green());
                println!("{}", truncate_text(text, max_chars));
            }
            println!();
        }
    }

    Ok(())
}

async fn cmd_content(client: &mut ExaClient, cli: &Cli, url: String) -> Result<()> {
    let results = client.get_contents(vec![url]).await?;

    if cli.json {
        println!("{}", to_json(&results, cli.compact)?);
        return Ok(());
    }

    if results.results.is_empty() {
        eprintln!("Could not extract content.");
        std::process::exit(1);
    }

    let r = &results.results[0];
    let max_chars = get_max_chars(cli);

    if cli.compact {
        println!("{}", r.title.as_deref().unwrap_or("N/A"));
        println!("url: {}", r.url);
        if let Some(text) = &r.text {
            println!("{}", truncate_text(text, max_chars));
        }
    } else {
        println!("{} {}", "Title:".bold(), r.title.as_deref().unwrap_or("N/A"));
        println!("{} {}", "URL:".cyan(), r.url);
        println!();
        if let Some(text) = &r.text {
            println!("{}", text);
        }
    }

    Ok(())
}

async fn cmd_answer(client: &mut ExaClient, cli: &Cli, query: String) -> Result<()> {
    let request = SearchRequest {
        query,
        num_results: 5,
        contents: Some(ContentsConfig {
            text: true,
            highlights: Some(true),
        }),
        include_domains: None,
        start_published_date: None,
        end_published_date: None,
    };

    let results = client.search(request).await?;

    if cli.json {
        println!("{}", to_json(&results, cli.compact)?);
        return Ok(());
    }

    if results.results.is_empty() {
        eprintln!("No results found.");
        std::process::exit(3);
    }

    let max_chars = get_max_chars(cli);

    // Compile highlights as "answer"
    let highlights: Vec<&str> = results
        .results
        .iter()
        .filter_map(|r| r.highlights.as_ref())
        .flatten()
        .take(3)
        .map(|s| s.as_str())
        .collect();

    if cli.compact {
        if !highlights.is_empty() {
            for h in &highlights {
                println!("{}", h);
            }
        } else if let Some(text) = &results.results[0].text {
            println!("{}", truncate_text(text, max_chars));
        }
        if !cli.no_sources {
            println!("sources: {}", results.results.iter().take(3).map(|r| r.url.as_str()).collect::<Vec<_>>().join(" | "));
        }
    } else {
        println!("{}", "Answer:".bold().green());
        println!();

        if !highlights.is_empty() {
            for h in &highlights {
                println!("  {}", h);
            }
            println!();
        } else if let Some(text) = &results.results[0].text {
            println!("{}", truncate_text(text, max_chars));
            println!();
        }

        if !cli.no_sources {
            println!("{}", "Sources:".dimmed());
            for r in results.results.iter().take(3) {
                println!("  {}", r.url.cyan());
            }
        }
    }

    Ok(())
}

async fn cmd_research(client: &mut ExaClient, cli: &Cli, query: String) -> Result<()> {
    // Load schema if provided
    let output_schema = if let Some(schema_path) = &cli.schema {
        let schema_content =
            fs::read_to_string(schema_path).context("Failed to read schema file")?;
        Some(serde_json::from_str(&schema_content).context("Failed to parse schema JSON")?)
    } else {
        None
    };

    let model = if cli.model == "exa-research-pro" {
        "exa-research"
    } else {
        "exa-research-fast"
    };

    let request = ResearchCreateRequest {
        instructions: query,
        model: model.to_string(),
        output_schema,
    };

    if !cli.json && !cli.compact {
        println!("{}", "Starting research task...".dimmed());
    }

    let (created, key_idx) = client.research_create(request).await?;
    let task_id = &created.research_id;

    if !cli.json && !cli.compact {
        println!("{}", format!("Task ID: {}", task_id).dimmed());
        println!("{}", "Polling for results...".dimmed());
    }

    // Poll until finished, using the same key that was used for create
    let result = loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        let status = client.research_status(task_id, Some(key_idx)).await?;

        match status.status.as_str() {
            "completed" => break status,
            "failed" => {
                bail!(
                    "Research task failed: {}",
                    status.error.unwrap_or_else(|| "Unknown error".to_string())
                );
            }
            "canceled" => {
                bail!("Research task was canceled");
            }
            _ => continue,
        }
    };

    if cli.json {
        println!("{}", to_json(&result, cli.compact)?);
        return Ok(());
    }

    if cli.compact {
        // Compact: just the content and sources, nothing else
        if let Some(output) = &result.output {
            if let Some(content) = &output.content {
                println!("{}", content);
            }
        } else if let Some(outputs) = &result.outputs {
            for output in outputs.iter() {
                println!("{}", serde_json::to_string(output)?);
            }
        }
        if !cli.no_sources {
            if let Some(citations) = &result.citations {
                if !citations.is_empty() {
                    println!("sources: {}", citations.iter().take(5).map(|c| c.url.as_str()).collect::<Vec<_>>().join(" | "));
                }
            }
        }
    } else {
        // Normal pretty print
        println!();
        println!("{}", "Research Complete".bold().green());
        if let Some(cost) = &result.cost_dollars {
            if let Some(total) = cost.total {
                println!("{}", format!("Cost: ${:.4}", total).dimmed());
            }
        }
        println!();

        if let Some(output) = &result.output {
            if let Some(content) = &output.content {
                println!("{}", content);
                println!();
            }
        } else if let Some(outputs) = &result.outputs {
            for (i, output) in outputs.iter().enumerate() {
                if outputs.len() > 1 {
                    println!("{}", format!("--- Output {} ---", i + 1).bold());
                }
                println!("{}", serde_json::to_string_pretty(output)?);
                println!();
            }
        }

        if !cli.no_sources {
            if let Some(citations) = &result.citations {
                if !citations.is_empty() {
                    println!("{}", "Sources:".dimmed());
                    for cite in citations.iter().take(5) {
                        println!("  {}", cite.url.cyan());
                    }
                }
            }
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let mut cli = Cli::parse();

    // Auto-enable compact mode when stdout is piped (not a terminal)
    // AI agents read stdout via pipe, so they get compact output automatically
    if !std::io::stdout().is_terminal() {
        cli.compact = true;
    }

    let mut key_manager = KeyManager::new(cli.verbose)?;

    // Handle Status and Reset commands before creating ExaClient
    match &cli.command {
        Commands::Status => {
            key_manager.print_status();
            return Ok(());
        }
        Commands::Reset => {
            key_manager.reset()?;
            println!("Cooldowns and usage statistics have been reset.");
            return Ok(());
        }
        _ => {}
    }

    // Validate keys if state is stale
    let http_client = reqwest::Client::new();
    key_manager.validate_keys_if_stale(&http_client).await?;

    let mut client = ExaClient::new(key_manager);

    let result = match &cli.command {
        Commands::Search { query } => {
            let query = query.join(" ");
            if query.is_empty() {
                bail!("No query provided");
            }
            cmd_search(&mut client, &cli, query).await
        }
        Commands::Find { query } => {
            let query = query.join(" ");
            if query.is_empty() {
                bail!("No query provided");
            }
            cmd_find(&mut client, &cli, query).await
        }
        Commands::Content { url } => {
            cmd_content(&mut client, &cli, url.clone()).await
        }
        Commands::Answer { query } => {
            let query = query.join(" ");
            if query.is_empty() {
                bail!("No query provided");
            }
            cmd_answer(&mut client, &cli, query).await
        }
        Commands::Research { query } => {
            let query = query.join(" ");
            if query.is_empty() {
                bail!("No query provided");
            }
            cmd_research(&mut client, &cli, query).await
        }
        Commands::Status | Commands::Reset => {
            // Already handled above
            Ok(())
        }
    };

    // Save state after command completes
    client.key_manager.save_state()?;

    result
}
