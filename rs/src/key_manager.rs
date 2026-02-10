use anyhow::{bail, Context, Result};
use chrono::{DateTime, Duration, Utc};
use colored::Colorize;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;

const DEFAULT_COOLDOWN_SECS: i64 = 60;
const STALE_THRESHOLD_HOURS: i64 = 24;
const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024; // 5MB

/// Masks an API key, showing only the last 3 characters
pub fn mask_key(key: &str) -> String {
    if key.len() <= 3 {
        "***".to_string()
    } else {
        format!("...{}", &key[key.len() - 3..])
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageStats {
    pub requests: u64,
    pub success: u64,
    pub errors: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyInfo {
    #[serde(default)]
    pub cooldown_until: Option<DateTime<Utc>>,
    #[serde(default = "default_valid")]
    pub valid: bool,
    #[serde(default)]
    pub usage: UsageStats,
}

fn default_valid() -> bool {
    true
}

impl Default for KeyInfo {
    fn default() -> Self {
        Self {
            cooldown_until: None,
            valid: true,
            usage: UsageStats::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyState {
    pub version: u32,
    pub current_index: usize,
    pub last_validated: DateTime<Utc>,
    pub keys: HashMap<usize, KeyInfo>,
}

impl Default for KeyState {
    fn default() -> Self {
        Self {
            version: 1,
            current_index: 0,
            last_validated: Utc::now(),
            keys: HashMap::new(),
        }
    }
}

#[derive(Debug)]
pub struct KeyManager {
    keys: Vec<String>,
    state: KeyState,
    config_dir: PathBuf,
    pub verbose: bool,
    log_enabled: bool,
}

/// Log entry for request logging
#[derive(Serialize)]
struct LogEntry {
    ts: DateTime<Utc>,
    key: String,
    cmd: String,
    status: u16,
}

impl KeyManager {
    /// Create a new KeyManager, loading keys from environment and state from disk
    pub fn new(verbose: bool) -> Result<Self> {
        let keys = Self::load_keys_from_env()?;
        let config_dir = Self::get_config_dir()?;
        let log_enabled = env::var("EXA_LOG_REQUESTS").map(|v| v == "1").unwrap_or(false);

        let mut manager = Self {
            keys,
            state: KeyState::default(),
            config_dir,
            verbose,
            log_enabled,
        };

        // Load existing state if available
        manager.load_state()?;

        // Initialize key info for any new keys
        for i in 0..manager.keys.len() {
            manager.state.keys.entry(i).or_insert_with(KeyInfo::default);
        }

        Ok(manager)
    }

    /// Load API keys from environment variables
    fn load_keys_from_env() -> Result<Vec<String>> {
        // First try EXA_API_KEYS (comma-separated)
        if let Ok(keys_str) = env::var("EXA_API_KEYS") {
            let keys: Vec<String> = keys_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            if !keys.is_empty() {
                return Ok(keys);
            }
        }

        // Fall back to single EXA_API_KEY
        if let Ok(key) = env::var("EXA_API_KEY") {
            if !key.trim().is_empty() {
                return Ok(vec![key.trim().to_string()]);
            }
        }

        bail!(
            "No API keys found.\nSet EXA_API_KEYS (comma-separated) or EXA_API_KEY.\nGet your key at: https://exa.ai"
        )
    }

    /// Get the config directory path
    fn get_config_dir() -> Result<PathBuf> {
        let config_dir = if cfg!(windows) {
            dirs::config_dir()
                .context("Could not find config directory")?
                .join("exa")
        } else {
            dirs::home_dir()
                .context("Could not find home directory")?
                .join(".config")
                .join("exa")
        };

        // Create directory if it doesn't exist
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).context("Failed to create config directory")?;
        }

        Ok(config_dir)
    }

    /// Get the state file path
    fn state_file_path(&self) -> PathBuf {
        self.config_dir.join("state.json")
    }

    /// Get the log file path
    fn log_file_path(&self) -> PathBuf {
        self.config_dir.join("requests.log")
    }

    /// Load state from disk
    fn load_state(&mut self) -> Result<()> {
        let state_path = self.state_file_path();
        if state_path.exists() {
            let content = fs::read_to_string(&state_path).context("Failed to read state file")?;
            self.state = serde_json::from_str(&content).unwrap_or_else(|_| KeyState::default());
        }
        Ok(())
    }

    /// Save state to disk
    pub fn save_state(&self) -> Result<()> {
        let state_path = self.state_file_path();
        let content = serde_json::to_string_pretty(&self.state)?;
        fs::write(&state_path, content).context("Failed to write state file")?;
        Ok(())
    }

    /// Check if state is stale (older than 24 hours)
    pub fn is_state_stale(&self) -> bool {
        let threshold = Utc::now() - Duration::hours(STALE_THRESHOLD_HOURS);
        self.state.last_validated < threshold
    }

    /// Get the next available key (cooldown-aware)
    pub fn get_next_key(&mut self) -> Result<(usize, String)> {
        let now = Utc::now();
        let valid_indices: Vec<usize> = (0..self.keys.len())
            .filter(|&i| {
                let info = self.state.keys.get(&i).cloned().unwrap_or_default();
                info.valid
            })
            .collect();

        if valid_indices.is_empty() {
            bail!("No valid API keys available");
        }

        // Find keys not on cooldown
        let available: Vec<usize> = valid_indices
            .iter()
            .filter(|&&i| {
                let info = self.state.keys.get(&i).cloned().unwrap_or_default();
                match info.cooldown_until {
                    Some(until) => now >= until,
                    None => true,
                }
            })
            .copied()
            .collect();

        let selected_idx = if available.is_empty() {
            // All keys on cooldown - find the one with shortest remaining cooldown
            if self.verbose {
                eprintln!("{}", "All keys on cooldown, waiting...".yellow());
            }

            let (idx, wait_until) = valid_indices
                .iter()
                .filter_map(|&i| {
                    let info = self.state.keys.get(&i)?;
                    info.cooldown_until.map(|until| (i, until))
                })
                .min_by_key(|(_, until)| *until)
                .context("No keys with cooldown found")?;

            // Wait for cooldown to expire
            let wait_duration = (wait_until - now).to_std().unwrap_or_default();
            if self.verbose {
                eprintln!(
                    "Waiting {:.1}s for key {} to become available",
                    wait_duration.as_secs_f64(),
                    mask_key(&self.keys[idx])
                );
            }
            std::thread::sleep(wait_duration);

            idx
        } else {
            // Round-robin among available keys, preferring lower usage
            let start = self.state.current_index % self.keys.len();
            let mut best_idx = available[0];
            let mut best_usage = u64::MAX;

            // Try to find the next key in round-robin order with lowest usage
            for offset in 0..self.keys.len() {
                let idx = (start + offset) % self.keys.len();
                if available.contains(&idx) {
                    let usage = self
                        .state
                        .keys
                        .get(&idx)
                        .map(|info| info.usage.requests)
                        .unwrap_or(0);
                    if usage < best_usage {
                        best_usage = usage;
                        best_idx = idx;
                    }
                }
            }
            best_idx
        };

        // Update current index for round-robin
        self.state.current_index = (selected_idx + 1) % self.keys.len();

        if self.verbose {
            eprintln!(
                "Using key {} (index {})",
                mask_key(&self.keys[selected_idx]),
                selected_idx
            );
        }

        Ok((selected_idx, self.keys[selected_idx].clone()))
    }

    /// Mark a key as rate limited with cooldown
    pub fn mark_rate_limited(&mut self, key_idx: usize, retry_after: Option<u64>) {
        let cooldown_secs = retry_after.unwrap_or(DEFAULT_COOLDOWN_SECS as u64) as i64;
        let cooldown_until = Utc::now() + Duration::seconds(cooldown_secs);

        let info = self.state.keys.entry(key_idx).or_insert_with(KeyInfo::default);
        info.cooldown_until = Some(cooldown_until);
        info.usage.errors += 1;

        if self.verbose {
            eprintln!(
                "{} Key {} rate limited, cooldown {}s",
                "Warning:".yellow(),
                mask_key(&self.keys[key_idx]),
                cooldown_secs
            );
        }
    }

    /// Record a successful request
    pub fn record_success(&mut self, key_idx: usize) {
        let info = self.state.keys.entry(key_idx).or_insert_with(KeyInfo::default);
        info.usage.requests += 1;
        info.usage.success += 1;
        // Clear cooldown on success
        info.cooldown_until = None;
    }

    /// Mark a key as invalid
    pub fn mark_invalid(&mut self, key_idx: usize) {
        let info = self.state.keys.entry(key_idx).or_insert_with(KeyInfo::default);
        info.valid = false;

        eprintln!(
            "{} Key {} is invalid and will be skipped",
            "Warning:".yellow(),
            mask_key(&self.keys[key_idx])
        );
    }

    /// Log a request if logging is enabled
    pub fn log_request(&self, key_idx: usize, cmd: &str, status: u16) -> Result<()> {
        if !self.log_enabled {
            return Ok(());
        }

        let log_path = self.log_file_path();

        // Check for rotation
        if log_path.exists() {
            if let Ok(metadata) = fs::metadata(&log_path) {
                if metadata.len() >= MAX_LOG_SIZE {
                    let backup_path = self.config_dir.join("requests.log.1");
                    let _ = fs::rename(&log_path, backup_path);
                }
            }
        }

        let entry = LogEntry {
            ts: Utc::now(),
            key: mask_key(&self.keys[key_idx]),
            cmd: cmd.to_string(),
            status,
        };

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .context("Failed to open log file")?;

        let mut writer = BufWriter::new(file);
        serde_json::to_writer(&mut writer, &entry)?;
        writeln!(writer)?;
        writer.flush()?;

        Ok(())
    }

    /// Validate all keys if state is stale
    pub async fn validate_keys_if_stale(&mut self, client: &reqwest::Client) -> Result<()> {
        if !self.is_state_stale() {
            return Ok(());
        }

        if self.verbose {
            eprintln!("Validating API keys (state is stale)...");
        }

        let mut invalid_indices = Vec::new();

        for (idx, key) in self.keys.iter().enumerate() {
            let resp = client
                .post("https://api.exa.ai/search")
                .header("x-api-key", key)
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "query": "test",
                    "numResults": 1
                }))
                .send()
                .await;

            match resp {
                Ok(r) => {
                    let status = r.status();
                    if status.as_u16() == 401 || status.as_u16() == 403 {
                        invalid_indices.push(idx);
                    } else if self.verbose {
                        eprintln!("Key {} is valid", mask_key(key));
                    }
                }
                Err(e) => {
                    if self.verbose {
                        eprintln!(
                            "{} Failed to validate key {}: {}",
                            "Warning:".yellow(),
                            mask_key(key),
                            e
                        );
                    }
                }
            }
        }

        // Mark invalid keys after the iteration
        for idx in invalid_indices {
            self.mark_invalid(idx);
        }

        self.state.last_validated = Utc::now();
        self.save_state()?;

        Ok(())
    }

    /// Reset all cooldowns and usage statistics
    pub fn reset(&mut self) -> Result<()> {
        for info in self.state.keys.values_mut() {
            info.cooldown_until = None;
            info.usage = UsageStats::default();
        }
        self.state.current_index = 0;
        self.save_state()?;

        if self.verbose {
            eprintln!("Reset all cooldowns and usage statistics");
        }

        Ok(())
    }

    /// Print status information
    pub fn print_status(&self) {
        println!("{}", "Exa API Key Status".bold());
        println!("{}", "=".repeat(50));
        println!();

        println!("{}: {}", "Total Keys".bold(), self.keys.len());
        println!(
            "{}: {}",
            "Next Key Index".bold(),
            self.state.current_index % self.keys.len()
        );
        println!(
            "{}: {}",
            "Last Validated".bold(),
            self.state.last_validated.format("%Y-%m-%d %H:%M:%S UTC")
        );
        println!(
            "{}: {}",
            "State Stale".bold(),
            if self.is_state_stale() { "Yes" } else { "No" }
        );
        println!();

        let now = Utc::now();

        for (idx, key) in self.keys.iter().enumerate() {
            let info = self.state.keys.get(&idx).cloned().unwrap_or_default();
            let masked = mask_key(key);

            let status = if !info.valid {
                "INVALID".red().to_string()
            } else if let Some(until) = info.cooldown_until {
                if now < until {
                    let remaining = (until - now).num_seconds();
                    format!("COOLDOWN ({}s)", remaining).yellow().to_string()
                } else {
                    "READY".green().to_string()
                }
            } else {
                "READY".green().to_string()
            };

            println!(
                "Key {}: {} - {}",
                idx,
                masked.cyan(),
                status
            );
            println!(
                "  Requests: {} | Success: {} | Errors: {}",
                info.usage.requests, info.usage.success, info.usage.errors
            );
        }

        println!();
        println!(
            "{}: {}",
            "Logging".bold(),
            if env::var("EXA_LOG_REQUESTS").map(|v| v == "1").unwrap_or(false) {
                "Enabled".green()
            } else {
                "Disabled".dimmed()
            }
        );

        if let Ok(log_path) = Self::get_config_dir() {
            println!("{}: {}", "Config Dir".bold(), log_path.display());
        }
    }

    /// Get a key by index (for research command that needs same key for create + polls)
    pub fn get_key_by_index(&self, idx: usize) -> Option<String> {
        self.keys.get(idx).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_key() {
        assert_eq!(mask_key("abc123def"), "...def");
        assert_eq!(mask_key("ab"), "***");
        assert_eq!(mask_key(""), "***");
        assert_eq!(mask_key("abcdefghijklmnop"), "...nop");
    }
}
