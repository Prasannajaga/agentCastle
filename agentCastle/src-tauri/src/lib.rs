use chrono::{SecondsFormat, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};
use tauri::{Emitter, Manager};
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{watch, Mutex},
    time::{sleep, Duration},
};

const RESULT_PREFIX: &str = "**SANDCASTLE_RESULT**=";
const STREAM_PREFIX: &str = "**SANDCASTLE_STREAM**=";

#[derive(Clone)]
struct RunningJob {
    run_id: String,
    run_dir: PathBuf,
    stop_tx: watch::Sender<bool>,
}

struct AppState {
    agents_root: PathBuf,
    sandcastle_root: Option<PathBuf>,
    running_jobs: Arc<Mutex<HashMap<String, RunningJob>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentStatus {
    Idle,
    Initializing,
    Ready,
    Running,
    Failed,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SandboxProviderName {
    Docker,
    Podman,
}

impl SandboxProviderName {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::Podman => "podman",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum CreatePromptPayload {
    Inline { value: String },
    File { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AgentPrompt {
    File {
        path: String,
        source_path: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CreateAgentPayload {
    name: String,
    target_repo_path: String,
    sandbox_provider: SandboxProviderName,
    model: String,
    prompt: CreatePromptPayload,
    max_iterations: u32,
    branch: Option<String>,
    agent_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentConfig {
    id: String,
    name: String,
    directory: String,
    target_repo_path: String,
    sandbox_provider: SandboxProviderName,
    model: String,
    agent_provider: String,
    prompt: AgentPrompt,
    max_iterations: u32,
    branch: String,
    status: AgentStatus,
    latest_run_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentSummary {
    id: String,
    name: String,
    directory: String,
    status: AgentStatus,
    latest_run_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AgentsIndex {
    agents: Vec<AgentSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentDetails {
    agent: AgentConfig,
    latest_run: Option<RunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct GitState {
    branch: Option<String>,
    head_sha: Option<String>,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RunRecord {
    id: String,
    agent_id: String,
    status: RunStatus,
    started_at: String,
    ended_at: Option<String>,
    target_repo_path: String,
    branch: String,
    worktree_path: Option<String>,
    model: String,
    agent_provider: String,
    sandbox_provider: SandboxProviderName,
    max_iterations: u32,
    prompt_file: String,
    stdout_log: String,
    stderr_log: String,
    sandcastle_log: String,
    changes_patch: String,
    changed_files: String,
    commits_file: String,
    docker_metrics_file: String,
    error: Option<String>,
    warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JobStarted {
    agent_id: String,
    run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ChangedFiles {
    files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChangedFile {
    path: String,
    status: String,
    additions: u32,
    deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CommitInfo {
    sha: String,
    summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RunDetails {
    run: RunRecord,
    changed_files: ChangedFiles,
    commits: Vec<CommitInfo>,
    stdout_log_available: bool,
    stderr_log_available: bool,
    sandcastle_log_available: bool,
    patch_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RunLogs {
    stdout: String,
    stderr: String,
    sandcastle: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DockerMetricsPayload {
    agent_id: String,
    run_id: String,
    timestamp: String,
    provider: String,
    docker_available: bool,
    daemon_running: bool,
    containers: Vec<ContainerMetric>,
    unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ContainerMetric {
    id: Option<String>,
    name: Option<String>,
    image: Option<String>,
    status: Option<String>,
    cpu_percent: Option<String>,
    memory_usage: Option<String>,
    memory_limit: Option<String>,
    memory_percent: Option<String>,
    network_io: Option<String>,
    block_io: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProcessMetricsPayload {
    agent_id: String,
    run_id: String,
    timestamp: String,
    process_running: bool,
    pid: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandcastleResult {
    commits: Option<Vec<CommitInfo>>,
    branch: Option<String>,
    log_file_path: Option<String>,
    completion_signal: Option<Value>,
    iterations: Option<u32>,
    preserved_worktree_path: Option<String>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn app_err<E: std::fmt::Display>(context: &str, error: E) -> String {
    format!("{context}: {error}")
}

async fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let content = fs::read_to_string(path)
        .await
        .map_err(|e| app_err(&format!("Failed to read {}", path.display()), e))?;
    serde_json::from_str(&content)
        .map_err(|e| app_err(&format!("Failed to parse {}", path.display()), e))
}

async fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| app_err(&format!("Failed to create {}", parent.display()), e))?;
    }
    let tmp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| app_err(&format!("Failed to serialize {}", path.display()), e))?;
    fs::write(&tmp, content)
        .await
        .map_err(|e| app_err(&format!("Failed to write {}", tmp.display()), e))?;
    fs::rename(&tmp, path)
        .await
        .map_err(|e| app_err(&format!("Failed to replace {}", path.display()), e))?;
    Ok(())
}

async fn write_text_atomic(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| app_err(&format!("Failed to create {}", parent.display()), e))?;
    }
    let tmp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    fs::write(&tmp, content)
        .await
        .map_err(|e| app_err(&format!("Failed to write {}", tmp.display()), e))?;
    fs::rename(&tmp, path)
        .await
        .map_err(|e| app_err(&format!("Failed to replace {}", path.display()), e))?;
    Ok(())
}

async fn append_json_line<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| app_err(&format!("Failed to create {}", parent.display()), e))?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .map_err(|e| app_err(&format!("Failed to open {}", path.display()), e))?;
    let mut line = serde_json::to_string(value).map_err(|e| {
        app_err(
            &format!("Failed to serialize metrics for {}", path.display()),
            e,
        )
    })?;
    line.push('\n');
    file.write_all(line.as_bytes())
        .await
        .map_err(|e| app_err(&format!("Failed to append {}", path.display()), e))
}

fn index_path(agents_root: &Path) -> PathBuf {
    agents_root
        .parent()
        .unwrap_or(agents_root)
        .join("agents.json")
}

async fn load_index(agents_root: &Path) -> Result<AgentsIndex, String> {
    let path = index_path(agents_root);
    if !path.exists() {
        return Ok(AgentsIndex::default());
    }
    read_json(&path).await
}

async fn save_index(agents_root: &Path, index: &AgentsIndex) -> Result<(), String> {
    write_json_atomic(&index_path(agents_root), index).await
}

fn agent_path(agents_root: &Path, agent_id: &str) -> PathBuf {
    agents_root.join(agent_id).join("agent.json")
}

fn run_path(agents_root: &Path, agent_id: &str, run_id: &str) -> PathBuf {
    agents_root
        .join(agent_id)
        .join("runs")
        .join(run_id)
        .join("run.json")
}

fn agent_summary(agent: &AgentConfig) -> AgentSummary {
    AgentSummary {
        id: agent.id.clone(),
        name: agent.name.clone(),
        directory: agent.directory.clone(),
        status: agent.status.clone(),
        latest_run_id: agent.latest_run_id.clone(),
        created_at: agent.created_at.clone(),
        updated_at: agent.updated_at.clone(),
    }
}

async fn upsert_agent_index(agents_root: &Path, agent: &AgentConfig) -> Result<(), String> {
    let mut index = load_index(agents_root).await?;
    index.agents.retain(|entry| entry.id != agent.id);
    index.agents.push(agent_summary(agent));
    index
        .agents
        .sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.name.cmp(&b.name)));
    save_index(agents_root, &index).await
}

async fn remove_agent_from_index(agents_root: &Path, agent_id: &str) -> Result<(), String> {
    let mut index = load_index(agents_root).await?;
    index.agents.retain(|entry| entry.id != agent_id);
    save_index(agents_root, &index).await
}

async fn load_agent(agents_root: &Path, agent_id: &str) -> Result<AgentConfig, String> {
    validate_safe_id(agent_id, "agent id")?;
    read_json(&agent_path(agents_root, agent_id)).await
}

async fn save_agent(agents_root: &Path, agent: &AgentConfig) -> Result<(), String> {
    write_json_atomic(&agent_path(agents_root, &agent.id), agent).await?;
    upsert_agent_index(agents_root, agent).await
}

fn validate_safe_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.starts_with('.')
        || value.contains('/')
        || value.contains('\\')
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':' || c == '.')
    {
        return Err(format!("Invalid {label}"));
    }
    Ok(())
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

async fn unique_agent_id(agents_root: &Path, base_slug: &str) -> Result<String, String> {
    if base_slug.is_empty() {
        return Err("Agent name must contain at least one letter or number".to_string());
    }
    let mut candidate = base_slug.to_string();
    let mut counter = 2;
    while agents_root.join(&candidate).exists() {
        candidate = format!("{base_slug}-{counter}");
        counter += 1;
    }
    Ok(candidate)
}

async fn command_output(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
) -> Result<String, String> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command
        .output()
        .await
        .map_err(|e| app_err(&format!("Failed to run {program}"), e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

async fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    command_output("git", args, Some(repo)).await
}

async fn validate_create_payload(payload: &CreateAgentPayload) -> Result<PathBuf, String> {
    if payload.name.trim().is_empty() {
        return Err("Agent name is required".to_string());
    }
    if payload.target_repo_path.trim().is_empty() {
        return Err("Target repo path is required".to_string());
    }
    if payload.model.trim().is_empty() {
        return Err("Model is required".to_string());
    }
    if payload.max_iterations < 1 {
        return Err("max_iterations must be at least 1".to_string());
    }

    let target_repo = PathBuf::from(payload.target_repo_path.trim());
    if !target_repo.exists() {
        return Err("Target repo path does not exist".to_string());
    }
    if !target_repo.is_dir() {
        return Err("Target repo path is not a directory".to_string());
    }
    git(&target_repo, &["rev-parse", "--is-inside-work-tree"])
        .await
        .map_err(|_| "Target repo path is not a git repository".to_string())?;

    match &payload.prompt {
        CreatePromptPayload::Inline { value } if value.trim().is_empty() => {
            return Err("Prompt cannot be empty".to_string())
        }
        CreatePromptPayload::File { path } => {
            let prompt_path = PathBuf::from(path);
            if !prompt_path.exists() {
                return Err("Prompt file does not exist".to_string());
            }
            if !prompt_path.is_file() {
                return Err("Prompt path is not a file".to_string());
            }
        }
        _ => {}
    }

    if let Some(branch) = &payload.branch {
        validate_branch(&target_repo, branch).await?;
    }

    Ok(target_repo)
}

async fn validate_branch(repo: &Path, branch: &str) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("Branch cannot be empty".to_string());
    }
    git(repo, &["check-ref-format", "--branch", branch])
        .await
        .map(|_| ())
        .map_err(|_| format!("Invalid git branch name: {branch}"))
}

fn npm_command() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn path_to_file_url(path: &Path) -> String {
    let mut value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) && !value.starts_with('/') {
        value = format!("/{value}");
    }
    let encoded = value
        .replace('%', "%25")
        .replace(' ', "%20")
        .replace('#', "%23")
        .replace('?', "%3F");
    format!("file://{encoded}")
}

fn find_sandcastle_root() -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    let mut candidates = Vec::new();
    for root in roots {
        for ancestor in root.ancestors() {
            candidates.push(ancestor.to_path_buf());
            candidates.push(ancestor.join("sandcastle"));
            if let Some(parent) = ancestor.parent() {
                candidates.push(parent.join("sandcastle"));
            }
        }
    }
    candidates.into_iter().find(|candidate| {
        candidate.join("package.json").exists()
            && candidate.join("src").join("InitService.ts").exists()
            && candidate.join("src").join("run.ts").exists()
    })
}

async fn initialize_sandcastle(
    sandcastle_root: &Path,
    agent_dir: &Path,
    agent_provider: &str,
    model: &str,
    sandbox_provider: &SandboxProviderName,
) -> Result<(), String> {
    let wrapper_path = sandcastle_root.join(format!(
        ".agentcastle-init-{}-{}.mts",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let wrapper = r#"
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { scaffold, getAgent, getBacklogManager, getSandboxProvider } from "./src/InitService.ts";
const agentDir = process.env.AGENTCASTLE_AGENT_DIR;
const agentName = process.env.AGENTCASTLE_AGENT_PROVIDER ?? "claude-code";
const model = process.env.AGENTCASTLE_MODEL;
const providerName = process.env.AGENTCASTLE_SANDBOX_PROVIDER ?? "docker";
if (!agentDir) throw new Error("AGENTCASTLE_AGENT_DIR is required");
if (!model) throw new Error("AGENTCASTLE_MODEL is required");
const agent = getAgent(agentName);
if (!agent) throw new Error(`Unknown Sandcastle agent provider: ${agentName}`);
const sandboxProvider = getSandboxProvider(providerName);
if (!sandboxProvider) throw new Error(`Unknown sandbox provider: ${providerName}`);
const backlogManager = getBacklogManager("github-issues");
if (!backlogManager) throw new Error("Could not resolve default backlog manager");
await Effect.runPromise(scaffold(agentDir, {
  agent,
  model,
  templateName: "blank",
  createLabel: false,
  backlogManager,
  sandboxProvider,
}).pipe(Effect.provide(NodeFileSystem.layer)));
"#;
    fs::write(&wrapper_path, wrapper)
        .await
        .map_err(|e| app_err("Failed to write Sandcastle init wrapper", e))?;

    let output = Command::new(npm_command())
        .arg("exec")
        .arg("--yes")
        .arg("--prefix")
        .arg(sandcastle_root)
        .arg("--")
        .arg("tsx")
        .arg(&wrapper_path)
        .current_dir(sandcastle_root)
        .env("AGENTCASTLE_AGENT_DIR", agent_dir)
        .env("AGENTCASTLE_AGENT_PROVIDER", agent_provider)
        .env("AGENTCASTLE_MODEL", model)
        .env("AGENTCASTLE_SANDBOX_PROVIDER", sandbox_provider.as_str())
        .output()
        .await
        .map_err(|e| app_err("Failed to start Sandcastle init wrapper", e));

    let _ = fs::remove_file(&wrapper_path).await;
    let output = output?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if stderr.is_empty() { stdout } else { stderr };
        Err(format!(
            "Sandcastle init failed: {details}. Make sure dependencies are installed in {} with `npm install`.",
            sandcastle_root.display()
        ))
    }
}

fn runner_source(sandcastle_root: &Path) -> String {
    let index_url = path_to_file_url(&sandcastle_root.join("src").join("index.ts"));
    let docker_url = path_to_file_url(
        &sandcastle_root
            .join("src")
            .join("sandboxes")
            .join("docker.ts"),
    );
    let podman_url = path_to_file_url(
        &sandcastle_root
            .join("src")
            .join("sandboxes")
            .join("podman.ts"),
    );

    format!(
        r#"import {{ run, claudeCode, codex, opencode, pi }} from "{index_url}";
import {{ docker }} from "{docker_url}";
import {{ podman }} from "{podman_url}";

const required = (name) => {{
  const value = process.env[name];
  if (!value) throw new Error(`${{name}} is required`);
  return value;
}};

const agentProviderName = process.env.SANDCASTLE_AGENT_PROVIDER ?? "claude-code";
const model = required("SANDCASTLE_MODEL");
const providerName = process.env.SANDCASTLE_PROVIDER ?? "docker";
const agentFactory = agentProviderName === "codex" ? codex : agentProviderName === "opencode" ? opencode : agentProviderName === "pi" ? pi : claudeCode;
const sandbox = providerName === "podman" ? podman() : docker();
const result = await run({{
  cwd: required("TARGET_REPO_PATH"),
  configDir: required("SANDCASTLE_CONFIG_DIR"),
  agent: agentFactory(model),
  sandbox,
  branchStrategy: {{ type: "branch", branch: required("SANDCASTLE_BRANCH") }},
  promptFile: required("SANDCASTLE_PROMPT_FILE"),
  maxIterations: Number(process.env.SANDCASTLE_MAX_ITERATIONS ?? "1"),
  logging: {{
    type: "file",
    path: required("SANDCASTLE_LOG_FILE"),
    onAgentStreamEvent(event) {{ console.log("**SANDCASTLE_STREAM**=" + JSON.stringify(event)); }},
  }},
  name: process.env.SANDCASTLE_AGENT_ID ?? "agentcastle-agent",
}});
console.log("**SANDCASTLE_RESULT**=" + JSON.stringify({{
  commits: result.commits,
  branch: result.branch,
  logFilePath: result.logFilePath,
  completionSignal: result.completionSignal,
  iterations: result.iterations?.length ?? 0,
  preservedWorktreePath: result.preservedWorktreePath,
}}));
"#
    )
}

async fn set_agent_status(
    agents_root: &Path,
    agent_id: &str,
    status: AgentStatus,
    latest_run_id: Option<String>,
) -> Result<AgentConfig, String> {
    let mut agent = load_agent(agents_root, agent_id).await?;
    agent.status = status;
    if latest_run_id.is_some() {
        agent.latest_run_id = latest_run_id;
    }
    agent.updated_at = now_iso();
    save_agent(agents_root, &agent).await?;
    Ok(agent)
}

async fn save_run(run_dir: &Path, run: &RunRecord) -> Result<(), String> {
    write_json_atomic(&run_dir.join("run.json"), run).await
}

async fn collect_git_state(repo: &Path) -> GitState {
    let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string());
    let head_sha = git(repo, &["rev-parse", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string());
    let status = git(repo, &["status", "--porcelain"])
        .await
        .unwrap_or_default();
    GitState {
        branch,
        head_sha,
        status,
    }
}

async fn collect_changes(
    agent: &AgentConfig,
    run_dir: &Path,
    base: &GitState,
    result: Option<&SandcastleResult>,
) -> Result<(ChangedFiles, Vec<CommitInfo>, Option<String>), String> {
    let target_repo = PathBuf::from(&agent.target_repo_path);
    let branch = result
        .and_then(|r| r.branch.clone())
        .unwrap_or_else(|| agent.branch.clone());
    let worktree_path = result.and_then(|r| r.preserved_worktree_path.clone());
    let base_sha = base.head_sha.clone().unwrap_or_default();

    let (patch, changed_files, commits) = if let Some(worktree) = &worktree_path {
        let worktree = PathBuf::from(worktree);
        let patch = git(&worktree, &["diff", "--binary", "HEAD"])
            .await
            .unwrap_or_default();
        let changed_files = collect_changed_files_from_status(&worktree).await;
        let commits =
            collect_commits_from_result_or_git(result, &target_repo, &base_sha, &branch).await;
        (patch, changed_files, commits)
    } else if !base_sha.is_empty() {
        let range = format!("{base_sha}...{branch}");
        let patch = git(&target_repo, &["diff", "--binary", &range])
            .await
            .unwrap_or_else(|_| String::new());
        let changed_files = collect_changed_files_from_diff(&target_repo, &range).await;
        let commits =
            collect_commits_from_result_or_git(result, &target_repo, &base_sha, &branch).await;
        (patch, changed_files, commits)
    } else {
        (String::new(), ChangedFiles::default(), vec![])
    };

    write_text_atomic(&run_dir.join("changes.patch"), &patch).await?;
    write_json_atomic(&run_dir.join("changed-files.json"), &changed_files).await?;
    write_json_atomic(&run_dir.join("commits.json"), &commits).await?;
    Ok((changed_files, commits, worktree_path))
}

async fn collect_changed_files_from_status(repo: &Path) -> ChangedFiles {
    let status = git(repo, &["status", "--porcelain"])
        .await
        .unwrap_or_default();
    let files = status
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let code = line[..2].trim().to_string();
            let path = line[3..].trim().to_string();
            let status = match code.as_str() {
                "A" | "??" => "created",
                "D" => "deleted",
                "R" => "renamed",
                _ => "modified",
            };
            Some(ChangedFile {
                path,
                status: status.to_string(),
                additions: 0,
                deletions: 0,
            })
        })
        .collect();
    ChangedFiles { files }
}

async fn collect_changed_files_from_diff(repo: &Path, range: &str) -> ChangedFiles {
    let name_status = git(repo, &["diff", "--name-status", "--find-renames", range])
        .await
        .unwrap_or_default();
    let numstat = git(repo, &["diff", "--numstat", "--find-renames", range])
        .await
        .unwrap_or_default();
    let mut status_by_path: HashMap<String, String> = HashMap::new();
    for line in name_status.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let code = parts[0];
        let path = parts.last().unwrap_or(&"").to_string();
        let status = if code.starts_with('A') {
            "created"
        } else if code.starts_with('D') {
            "deleted"
        } else if code.starts_with('R') {
            "renamed"
        } else if code.starts_with('C') {
            "copied"
        } else {
            "modified"
        };
        status_by_path.insert(path, status.to_string());
    }
    let mut files = Vec::new();
    for line in numstat.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let path = parts.last().unwrap_or(&"").to_string();
        let additions = parts[0].parse::<u32>().unwrap_or(0);
        let deletions = parts[1].parse::<u32>().unwrap_or(0);
        let status = status_by_path
            .get(&path)
            .cloned()
            .unwrap_or_else(|| "modified".to_string());
        files.push(ChangedFile {
            path,
            status,
            additions,
            deletions,
        });
    }
    for (path, status) in status_by_path {
        if !files.iter().any(|file| file.path == path) {
            files.push(ChangedFile {
                path,
                status,
                additions: 0,
                deletions: 0,
            });
        }
    }
    ChangedFiles { files }
}

async fn collect_commits_from_result_or_git(
    result: Option<&SandcastleResult>,
    repo: &Path,
    base_sha: &str,
    branch: &str,
) -> Vec<CommitInfo> {
    if let Some(commits) = result.and_then(|r| r.commits.clone()) {
        if !commits.is_empty() {
            return commits;
        }
    }
    if base_sha.is_empty() {
        return vec![];
    }
    let range = format!("{base_sha}..{branch}");
    let output = git(repo, &["log", "--format=%H%x09%s", &range])
        .await
        .unwrap_or_default();
    output
        .lines()
        .filter_map(|line| {
            let (sha, summary) = line.split_once('\t')?;
            Some(CommitInfo {
                sha: sha.to_string(),
                summary: Some(summary.to_string()),
            })
        })
        .collect()
}

async fn cleanup_managed_worktree_after_failure(
    agent: &AgentConfig,
    run_dir: &Path,
    result: Option<&SandcastleResult>,
) -> Option<String> {
    let target_repo = PathBuf::from(&agent.target_repo_path);
    let mut candidates = Vec::new();
    if let Some(path) = result.and_then(|result| result.preserved_worktree_path.clone()) {
        candidates.push(PathBuf::from(path));
    }
    candidates.extend(find_agent_worktrees_for_branch(agent).await);
    candidates.push(
        PathBuf::from(&agent.directory)
            .join(".sandcastle")
            .join("worktrees")
            .join(agent.branch.replace('/', "-")),
    );
    candidates.sort();
    candidates.dedup();

    let mut notes = Vec::new();
    for worktree_path in candidates {
        if !worktree_path.exists() {
            continue;
        }
        let status = git(&worktree_path, &["status", "--porcelain"])
            .await
            .unwrap_or_else(|error| format!("__AGENTCASTLE_STATUS_ERROR__{error}"));
        if status.starts_with("__AGENTCASTLE_STATUS_ERROR__") {
            notes.push(format!(
                "Could not inspect worktree {}: {}",
                worktree_path.display(),
                status.trim_start_matches("__AGENTCASTLE_STATUS_ERROR__")
            ));
            continue;
        }
        if !status.trim().is_empty() {
            notes.push(format!(
                "Preserved dirty worktree at {}. Review or remove it manually after saving useful changes.",
                worktree_path.display()
            ));
            continue;
        }
        let worktree_arg = worktree_path.to_string_lossy().to_string();
        let removed = match git(&target_repo, &["worktree", "remove", &worktree_arg]).await {
            Ok(_) => true,
            Err(first_error) => match git(
                &target_repo,
                &["worktree", "remove", "--force", &worktree_arg],
            )
            .await
            {
                Ok(_) => true,
                Err(force_error) => {
                    notes.push(format!(
                        "Failed to remove clean worktree {}: {}; force remove also failed: {}",
                        worktree_path.display(),
                        first_error,
                        force_error
                    ));
                    false
                }
            },
        };
        if removed {
            let _ = git(&target_repo, &["worktree", "prune"]).await;
            notes.push(format!(
                "Removed clean failed-run worktree {} and pruned Git worktree metadata.",
                worktree_path.display()
            ));
        }
    }
    if notes.is_empty() {
        return None;
    }
    let payload = json!({ "timestamp": now_iso(), "notes": notes });
    let _ = write_json_atomic(&run_dir.join("worktree-cleanup.json"), &payload).await;
    Some(notes.join(" "))
}

async fn find_agent_worktrees_for_branch(agent: &AgentConfig) -> Vec<PathBuf> {
    let target_repo = PathBuf::from(&agent.target_repo_path);
    let output = git(&target_repo, &["worktree", "list", "--porcelain"])
        .await
        .unwrap_or_default();
    let agent_config_dir = PathBuf::from(&agent.directory).join(".sandcastle");
    let branch_ref = format!("refs/heads/{}", agent.branch);
    let mut current_path: Option<PathBuf> = None;
    let mut matches = Vec::new();
    for line in output.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current_path = Some(PathBuf::from(path.trim()));
            continue;
        }
        if let Some(branch) = line.strip_prefix("branch ") {
            if branch.trim() == branch_ref {
                if let Some(path) = current_path.as_ref() {
                    if path.starts_with(&agent_config_dir) {
                        matches.push(path.clone());
                    }
                }
            }
        }
    }
    matches
}

async fn stream_output<R>(
    reader: R,
    log_path: PathBuf,
    app: tauri::AppHandle,
    agent_id: String,
    run_id: String,
    stream: &'static str,
    result_slot: Arc<Mutex<Option<SandcastleResult>>>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut log_file = match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .await
    {
        Ok(file) => file,
        Err(_) => return,
    };
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if stream == "stdout" && line.starts_with(RESULT_PREFIX) {
            let json = &line[RESULT_PREFIX.len()..];
            if let Ok(result) = serde_json::from_str::<SandcastleResult>(json) {
                *result_slot.lock().await = Some(result);
            }
            let _ = log_file.write_all(line.as_bytes()).await;
            let _ = log_file.write_all(b"\n").await;
            continue;
        }
        let display_line = if stream == "stdout" && line.starts_with(STREAM_PREFIX) {
            format_stream_event(&line[STREAM_PREFIX.len()..]).unwrap_or(line.clone())
        } else {
            line.clone()
        };
        let _ = log_file.write_all(display_line.as_bytes()).await;
        let _ = log_file.write_all(b"\n").await;
        let _ = app.emit(
            "agent://log",
            json!({
                "agent_id": agent_id,
                "run_id": run_id,
                "stream": stream,
                "line": display_line,
                "timestamp": now_iso(),
            }),
        );
    }
}

fn format_stream_event(raw: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw).ok()?;
    match value.get("type")?.as_str()? {
        "text" => value.get("message")?.as_str().map(|s| s.to_string()),
        "toolCall" => {
            let name = value.get("name").and_then(Value::as_str).unwrap_or("tool");
            let args = value
                .get("formattedArgs")
                .and_then(Value::as_str)
                .unwrap_or("");
            Some(format!("[tool] {name}({args})"))
        }
        _ => None,
    }
}

async fn collect_runtime_metrics(
    provider: &SandboxProviderName,
    agent_id: &str,
    run_id: &str,
) -> DockerMetricsPayload {
    let provider_binary = provider.as_str();
    let timestamp = now_iso();
    let available = Command::new(provider_binary)
        .arg("--version")
        .output()
        .await
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !available {
        return DockerMetricsPayload {
            agent_id: agent_id.to_string(),
            run_id: run_id.to_string(),
            timestamp,
            provider: provider_binary.to_string(),
            docker_available: false,
            daemon_running: false,
            containers: vec![],
            unavailable_reason: Some(format!("{provider_binary} CLI is not available")),
        };
    }
    let daemon_running = Command::new(provider_binary)
        .arg("info")
        .output()
        .await
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !daemon_running {
        return DockerMetricsPayload {
            agent_id: agent_id.to_string(),
            run_id: run_id.to_string(),
            timestamp,
            provider: provider_binary.to_string(),
            docker_available: true,
            daemon_running: false,
            containers: vec![],
            unavailable_reason: Some(format!("{provider_binary} daemon is not running")),
        };
    }
    let containers = collect_container_metrics(provider_binary).await;
    DockerMetricsPayload {
        agent_id: agent_id.to_string(),
        run_id: run_id.to_string(),
        timestamp,
        provider: provider_binary.to_string(),
        docker_available: true,
        daemon_running: true,
        containers,
        unavailable_reason: None,
    }
}

async fn collect_container_metrics(provider_binary: &str) -> Vec<ContainerMetric> {
    let output = Command::new(provider_binary)
        .args(["stats", "--no-stream", "--format", "json"])
        .output()
        .await;
    let Ok(output) = output else { return vec![] };
    if !output.status.success() {
        return vec![];
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    let mut metrics = Vec::new();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        match value {
            Value::Array(values) => {
                for value in values {
                    metrics.push(container_metric_from_value(&value));
                }
            }
            Value::Object(_) => metrics.push(container_metric_from_value(&value)),
            _ => {}
        }
    } else {
        for line in trimmed.lines() {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                metrics.push(container_metric_from_value(&value));
            }
        }
    }
    let likely_sandcastle: Vec<ContainerMetric> = metrics
        .iter()
        .filter(|metric| {
            metric
                .name
                .as_deref()
                .unwrap_or_default()
                .contains("sandcastle")
                || metric
                    .image
                    .as_deref()
                    .unwrap_or_default()
                    .contains("sandcastle")
        })
        .cloned()
        .collect();
    if likely_sandcastle.is_empty() {
        metrics
    } else {
        likely_sandcastle
    }
}

fn container_metric_from_value(value: &Value) -> ContainerMetric {
    let string_field = |names: &[&str]| -> Option<String> {
        names
            .iter()
            .find_map(|name| value.get(*name).and_then(Value::as_str).map(str::to_string))
    };
    let mem_usage = string_field(&["MemUsage", "mem_usage", "MemUsageBytes"]);
    let (memory_usage, memory_limit) = mem_usage
        .as_deref()
        .and_then(|usage| usage.split_once(" / "))
        .map(|(usage, limit)| (Some(usage.to_string()), Some(limit.to_string())))
        .unwrap_or((mem_usage, None));
    ContainerMetric {
        id: string_field(&["ID", "Container", "container", "id"]),
        name: string_field(&["Name", "Names", "name"]),
        image: string_field(&["Image", "image"]),
        status: string_field(&["Status", "State", "status"]),
        cpu_percent: string_field(&["CPUPerc", "CPU", "cpu_percent"]),
        memory_usage,
        memory_limit,
        memory_percent: string_field(&["MemPerc", "Mem", "mem_percent"]),
        network_io: string_field(&["NetIO", "NetworkIO", "net_io"]),
        block_io: string_field(&["BlockIO", "block_io"]),
    }
}

async fn metrics_loop(
    app: tauri::AppHandle,
    agent_id: String,
    run_id: String,
    provider: SandboxProviderName,
    metrics_path: PathBuf,
    pid: Option<u32>,
    mut stop_rx: watch::Receiver<bool>,
) {
    loop {
        let metrics = collect_runtime_metrics(&provider, &agent_id, &run_id).await;
        let _ = append_json_line(&metrics_path, &metrics).await;
        let _ = app.emit("agent://docker-metrics", &metrics);
        let _ = app.emit(
            "agent://process-metrics",
            ProcessMetricsPayload {
                agent_id: agent_id.clone(),
                run_id: run_id.clone(),
                timestamp: now_iso(),
                process_running: !*stop_rx.borrow(),
                pid,
            },
        );
        tokio::select! {
            changed = stop_rx.changed() => {
                if changed.is_err() || *stop_rx.borrow() {
                    break;
                }
            }
            _ = sleep(Duration::from_secs(2)) => {}
        }
    }
    let _ = app.emit(
        "agent://process-metrics",
        ProcessMetricsPayload {
            agent_id,
            run_id,
            timestamp: now_iso(),
            process_running: false,
            pid,
        },
    );
}

async fn remove_running_job(jobs: &Arc<Mutex<HashMap<String, RunningJob>>>, agent_id: &str) {
    if let Some(job) = jobs.lock().await.remove(agent_id) {
        let _ = (&job.run_id, &job.run_dir);
        let _ = job.stop_tx.send(true);
    }
}

async fn run_agent_job(
    app: tauri::AppHandle,
    agents_root: PathBuf,
    sandcastle_root: PathBuf,
    agent: AgentConfig,
    run_dir: PathBuf,
    mut run_record: RunRecord,
    base_git: GitState,
    stop_rx: watch::Receiver<bool>,
    jobs: Arc<Mutex<HashMap<String, RunningJob>>>,
) {
    let agent_id = agent.id.clone();
    let run_id = run_record.id.clone();
    let stdout_path = run_dir.join("stdout.log");
    let stderr_path = run_dir.join("stderr.log");
    let sandcastle_log_path = run_dir.join("sandcastle.log");
    let metrics_path = run_dir.join("docker-metrics.jsonl");
    let result_slot: Arc<Mutex<Option<SandcastleResult>>> = Arc::new(Mutex::new(None));
    let mut stop_rx_for_child = stop_rx.clone();

    let mut child = match Command::new(npm_command())
        .arg("exec")
        .arg("--yes")
        .arg("--prefix")
        .arg(&sandcastle_root)
        .arg("--")
        .arg("tsx")
        .arg(PathBuf::from(&agent.directory).join("runner.mts"))
        .current_dir(&agent.directory)
        .env("TARGET_REPO_PATH", &agent.target_repo_path)
        .env(
            "SANDCASTLE_CONFIG_DIR",
            PathBuf::from(&agent.directory).join(".sandcastle"),
        )
        .env("SANDCASTLE_AGENT_ID", &agent.id)
        .env("SANDCASTLE_AGENT_PROVIDER", &agent.agent_provider)
        .env("SANDCASTLE_PROVIDER", agent.sandbox_provider.as_str())
        .env("SANDCASTLE_MODEL", &agent.model)
        .env("SANDCASTLE_BRANCH", &agent.branch)
        .env(
            "SANDCASTLE_PROMPT_FILE",
            PathBuf::from(&agent.directory).join("prompt.md"),
        )
        .env(
            "SANDCASTLE_MAX_ITERATIONS",
            agent.max_iterations.to_string(),
        )
        .env("SANDCASTLE_LOG_FILE", &sandcastle_log_path)
        .env("NO_COLOR", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            finish_run_with_error(
                &app,
                &agents_root,
                &agent,
                &run_dir,
                &mut run_record,
                format!("Failed to start Sandcastle runner: {error}"),
                RunStatus::Failed,
            )
            .await;
            remove_running_job(&jobs, &agent_id).await;
            return;
        }
    };

    let pid = child.id();
    let _metrics_handle = tokio::spawn(metrics_loop(
        app.clone(),
        agent_id.clone(),
        run_id.clone(),
        agent.sandbox_provider.clone(),
        metrics_path,
        pid,
        stop_rx.clone(),
    ));

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut readers = Vec::new();
    if let Some(stdout) = stdout {
        readers.push(tokio::spawn(stream_output(
            stdout,
            stdout_path,
            app.clone(),
            agent_id.clone(),
            run_id.clone(),
            "stdout",
            result_slot.clone(),
        )));
    }
    if let Some(stderr) = stderr {
        readers.push(tokio::spawn(stream_output(
            stderr,
            stderr_path,
            app.clone(),
            agent_id.clone(),
            run_id.clone(),
            "stderr",
            result_slot.clone(),
        )));
    }

    let wait_result = tokio::select! {
        status = child.wait() => status.map(|status| (status, false)),
        changed = stop_rx_for_child.changed() => {
            let _ = child.kill().await;
            child.wait().await.map(|status| (status, changed.is_ok()))
        }
    };

    for reader in readers {
        let _ = reader.await;
    }

    let result = result_slot.lock().await.clone();
    let final_git = collect_git_state(Path::new(&agent.target_repo_path)).await;
    let _ = write_json_atomic(&run_dir.join("final_git.json"), &final_git).await;

    let cancelled = wait_result.as_ref().map(|(_, c)| *c).unwrap_or(false) || *stop_rx.borrow();
    if cancelled {
        run_record.warning =
            cleanup_managed_worktree_after_failure(&agent, &run_dir, result.as_ref()).await;
        finish_run_with_error(
            &app,
            &agents_root,
            &agent,
            &run_dir,
            &mut run_record,
            "Run cancelled by user".to_string(),
            RunStatus::Cancelled,
        )
        .await;
        remove_running_job(&jobs, &agent_id).await;
        return;
    }

    match wait_result {
        Ok((status, _)) if status.success() => {
            let collection = collect_changes(&agent, &run_dir, &base_git, result.as_ref()).await;
            let mut warning = None;
            let (changed_files, commits) = match collection {
                Ok((changed_files, commits, worktree_path)) => {
                    run_record.worktree_path = worktree_path;
                    (changed_files, commits)
                }
                Err(error) => {
                    warning = Some(format!("Failed to collect changes: {error}"));
                    (ChangedFiles::default(), vec![])
                }
            };
            if let Some(result) = result.as_ref() {
                if let Some(branch) = &result.branch {
                    run_record.branch = branch.clone();
                }
                if let Some(log_path) = &result.log_file_path {
                    if log_path != &run_record.sandcastle_log {
                        let _ = fs::copy(log_path, run_dir.join("sandcastle.log")).await;
                    }
                }
                let _ = (&result.completion_signal, result.iterations);
            }
            run_record.status = RunStatus::Completed;
            run_record.ended_at = Some(now_iso());
            run_record.warning = warning;
            let _ = save_run(&run_dir, &run_record).await;
            let _ = set_agent_status(
                &agents_root,
                &agent.id,
                AgentStatus::Completed,
                Some(run_record.id.clone()),
            )
            .await;
            let _ = app.emit(
                "agent://changes-collected",
                json!({
                    "agent_id": agent.id,
                    "run_id": run_record.id,
                    "changed_files": changed_files.files,
                    "patch_path": run_dir.join("changes.patch").to_string_lossy(),
                    "commits": commits,
                }),
            );
            let _ = app.emit(
                "agent://run-completed",
                json!({
                    "agent_id": agent_id,
                    "run_id": run_id,
                    "status": "completed",
                    "commits": commits,
                    "branch": run_record.branch,
                    "changed_files_count": changed_files.files.len(),
                    "patch_path": run_dir.join("changes.patch").to_string_lossy(),
                    "ended_at": run_record.ended_at,
                }),
            );
            let _ = app.emit(
                "agent://status-changed",
                json!({
                    "agent_id": agent_id,
                    "run_id": run_id,
                    "status": "completed",
                    "timestamp": now_iso(),
                }),
            );
        }
        Ok((status, _)) => {
            let stderr_tail = fs::read_to_string(run_dir.join("stderr.log"))
                .await
                .unwrap_or_default();
            let error = format!(
                "Sandcastle runner exited with status {}{}",
                status,
                if stderr_tail.trim().is_empty() {
                    String::new()
                } else {
                    format!(
                        ": {}",
                        stderr_tail
                            .lines()
                            .rev()
                            .take(8)
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect::<Vec<_>>()
                            .join("\n")
                    )
                }
            );
            let _ = collect_changes(&agent, &run_dir, &base_git, result.as_ref()).await;
            run_record.warning =
                cleanup_managed_worktree_after_failure(&agent, &run_dir, result.as_ref()).await;
            finish_run_with_error(
                &app,
                &agents_root,
                &agent,
                &run_dir,
                &mut run_record,
                error,
                RunStatus::Failed,
            )
            .await;
        }
        Err(error) => {
            run_record.warning =
                cleanup_managed_worktree_after_failure(&agent, &run_dir, result.as_ref()).await;
            finish_run_with_error(
                &app,
                &agents_root,
                &agent,
                &run_dir,
                &mut run_record,
                format!("Failed while waiting for Sandcastle runner: {error}"),
                RunStatus::Failed,
            )
            .await;
        }
    }

    remove_running_job(&jobs, &agent_id).await;
}

async fn finish_run_with_error(
    app: &tauri::AppHandle,
    agents_root: &Path,
    agent: &AgentConfig,
    run_dir: &Path,
    run_record: &mut RunRecord,
    error: String,
    status: RunStatus,
) {
    run_record.status = status.clone();
    run_record.ended_at = Some(now_iso());
    run_record.error = Some(error.clone());
    let _ = save_run(run_dir, run_record).await;
    let agent_status = match status {
        RunStatus::Cancelled => AgentStatus::Cancelled,
        _ => AgentStatus::Failed,
    };
    let _ = set_agent_status(
        agents_root,
        &agent.id,
        agent_status,
        Some(run_record.id.clone()),
    )
    .await;
    let event = match status {
        RunStatus::Cancelled => "agent://run-cancelled",
        _ => "agent://run-failed",
    };
    let _ = app.emit(
        event,
        json!({
            "agent_id": agent.id,
            "run_id": run_record.id,
            "status": match status { RunStatus::Cancelled => "cancelled", _ => "failed" },
            "error": error,
            "warning": run_record.warning,
            "ended_at": run_record.ended_at,
        }),
    );
    let _ = app.emit(
        "agent://status-changed",
        json!({
            "agent_id": agent.id,
            "run_id": run_record.id,
            "status": match status { RunStatus::Cancelled => "cancelled", _ => "failed" },
            "timestamp": now_iso(),
        }),
    );
}

#[tauri::command]
async fn list_agents(state: tauri::State<'_, AppState>) -> Result<Vec<AgentSummary>, String> {
    Ok(load_index(&state.agents_root).await?.agents)
}

#[tauri::command]
async fn get_agent(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<AgentDetails, String> {
    let agent = load_agent(&state.agents_root, &agent_id).await?;
    let latest_run = match &agent.latest_run_id {
        Some(run_id) => read_json(&run_path(&state.agents_root, &agent.id, run_id))
            .await
            .ok(),
        None => None,
    };
    Ok(AgentDetails { agent, latest_run })
}

#[tauri::command]
async fn create_agent(
    payload: CreateAgentPayload,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<AgentDetails, String> {
    let target_repo = validate_create_payload(&payload).await?;
    let slug = slugify(&payload.name);
    let agent_id = unique_agent_id(&state.agents_root, &slug).await?;
    let branch = payload
        .branch
        .clone()
        .unwrap_or_else(|| format!("agent/{agent_id}"));
    validate_branch(&target_repo, &branch).await?;

    let sandcastle_root = state
        .sandcastle_root
        .clone()
        .ok_or_else(|| "Could not locate the local Sandcastle source directory".to_string())?;

    let agent_dir = state.agents_root.join(&agent_id);
    if agent_dir.exists() {
        return Err("Agent directory already exists".to_string());
    }
    fs::create_dir_all(&agent_dir)
        .await
        .map_err(|e| app_err("Failed to create agent directory", e))?;

    let now = now_iso();
    let agent_provider = payload
        .agent_provider
        .clone()
        .unwrap_or_else(|| "claude-code".to_string());
    let prompt_content = match &payload.prompt {
        CreatePromptPayload::Inline { value } => value.clone(),
        CreatePromptPayload::File { path } => fs::read_to_string(path)
            .await
            .map_err(|e| app_err("Failed to read prompt file", e))?,
    };
    write_text_atomic(&agent_dir.join("prompt.md"), &prompt_content).await?;

    let mut agent = AgentConfig {
        id: agent_id.clone(),
        name: payload.name.trim().to_string(),
        directory: agent_dir.to_string_lossy().to_string(),
        target_repo_path: target_repo.to_string_lossy().to_string(),
        sandbox_provider: payload.sandbox_provider.clone(),
        model: payload.model.trim().to_string(),
        agent_provider,
        prompt: AgentPrompt::File {
            path: "prompt.md".to_string(),
            source_path: match &payload.prompt {
                CreatePromptPayload::File { path } => Some(path.clone()),
                _ => None,
            },
        },
        max_iterations: payload.max_iterations,
        branch,
        status: AgentStatus::Initializing,
        latest_run_id: None,
        created_at: now.clone(),
        updated_at: now,
    };
    save_agent(&state.agents_root, &agent).await?;
    let _ = app.emit(
        "agent://status-changed",
        json!({ "agent_id": agent.id, "run_id": null, "status": "initializing", "timestamp": now_iso() }),
    );

    if let Err(error) = initialize_sandcastle(
        &sandcastle_root,
        &agent_dir,
        &agent.agent_provider,
        &agent.model,
        &agent.sandbox_provider,
    )
    .await
    {
        agent.status = AgentStatus::Failed;
        agent.updated_at = now_iso();
        save_agent(&state.agents_root, &agent).await?;
        let _ = app.emit(
            "agent://status-changed",
            json!({ "agent_id": agent.id, "run_id": null, "status": "failed", "timestamp": now_iso() }),
        );
        return Err(error);
    }

    if let Err(error) = write_text_atomic(
        &agent_dir.join("runner.mts"),
        &runner_source(&sandcastle_root),
    )
    .await
    {
        agent.status = AgentStatus::Failed;
        agent.updated_at = now_iso();
        save_agent(&state.agents_root, &agent).await?;
        let _ = app.emit(
            "agent://status-changed",
            json!({ "agent_id": agent.id, "run_id": null, "status": "failed", "timestamp": now_iso() }),
        );
        return Err(error);
    }

    agent.status = AgentStatus::Ready;
    agent.updated_at = now_iso();
    save_agent(&state.agents_root, &agent).await?;
    let details = AgentDetails {
        agent: agent.clone(),
        latest_run: None,
    };
    let _ = app.emit(
        "agent://created",
        json!({ "agent_id": agent.id, "agent": details }),
    );
    let _ = app.emit(
        "agent://status-changed",
        json!({ "agent_id": agent.id, "run_id": null, "status": "ready", "timestamp": now_iso() }),
    );
    Ok(details)
}

#[tauri::command]
async fn run_agent(
    agent_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<JobStarted, String> {
    validate_safe_id(&agent_id, "agent id")?;
    let mut jobs = state.running_jobs.lock().await;
    if jobs.contains_key(&agent_id) {
        return Err("Agent is already running".to_string());
    }
    let agent = load_agent(&state.agents_root, &agent_id).await?;
    let sandcastle_root = state
        .sandcastle_root
        .clone()
        .ok_or_else(|| "Could not locate the local Sandcastle source directory".to_string())?;
    let started_at = now_iso();
    let run_id = format!("run-{}", started_at.replace(':', "-").replace('.', "-"));
    let run_dir = PathBuf::from(&agent.directory).join("runs").join(&run_id);
    fs::create_dir_all(&run_dir)
        .await
        .map_err(|e| app_err("Failed to create run directory", e))?;

    let base_git = collect_git_state(Path::new(&agent.target_repo_path)).await;
    write_json_atomic(&run_dir.join("base_git.json"), &base_git).await?;
    for file in [
        "stdout.log",
        "stderr.log",
        "sandcastle.log",
        "docker-metrics.jsonl",
        "changes.patch",
    ] {
        write_text_atomic(&run_dir.join(file), "").await?;
    }
    write_json_atomic(
        &run_dir.join("changed-files.json"),
        &ChangedFiles::default(),
    )
    .await?;
    write_json_atomic(&run_dir.join("commits.json"), &Vec::<CommitInfo>::new()).await?;

    let run_record = RunRecord {
        id: run_id.clone(),
        agent_id: agent.id.clone(),
        status: RunStatus::Running,
        started_at: started_at.clone(),
        ended_at: None,
        target_repo_path: agent.target_repo_path.clone(),
        branch: agent.branch.clone(),
        worktree_path: None,
        model: agent.model.clone(),
        agent_provider: agent.agent_provider.clone(),
        sandbox_provider: agent.sandbox_provider.clone(),
        max_iterations: agent.max_iterations,
        prompt_file: "prompt.md".to_string(),
        stdout_log: "stdout.log".to_string(),
        stderr_log: "stderr.log".to_string(),
        sandcastle_log: "sandcastle.log".to_string(),
        changes_patch: "changes.patch".to_string(),
        changed_files: "changed-files.json".to_string(),
        commits_file: "commits.json".to_string(),
        docker_metrics_file: "docker-metrics.jsonl".to_string(),
        error: None,
        warning: None,
    };
    save_run(&run_dir, &run_record).await?;
    set_agent_status(
        &state.agents_root,
        &agent_id,
        AgentStatus::Running,
        Some(run_id.clone()),
    )
    .await?;

    let (stop_tx, stop_rx) = watch::channel(false);
    jobs.insert(
        agent_id.clone(),
        RunningJob {
            run_id: run_id.clone(),
            run_dir: run_dir.clone(),
            stop_tx,
        },
    );
    drop(jobs);

    let _ = app.emit(
        "agent://run-started",
        json!({ "agent_id": agent_id, "run_id": run_id, "started_at": started_at }),
    );
    let _ = app.emit(
        "agent://status-changed",
        json!({ "agent_id": agent.id, "run_id": run_id, "status": "running", "timestamp": now_iso() }),
    );

    let jobs = state.running_jobs.clone();
    let agents_root = state.agents_root.clone();
    tokio::spawn(run_agent_job(
        app,
        agents_root,
        sandcastle_root,
        agent,
        run_dir,
        run_record,
        base_git,
        stop_rx,
        jobs,
    ));
    Ok(JobStarted { agent_id, run_id })
}

#[tauri::command]
async fn stop_agent(agent_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    validate_safe_id(&agent_id, "agent id")?;
    let jobs = state.running_jobs.lock().await;
    let job = jobs
        .get(&agent_id)
        .ok_or_else(|| "Agent is not running".to_string())?;
    let _ = (&job.run_id, &job.run_dir);
    job.stop_tx
        .send(true)
        .map_err(|_| "Failed to signal running agent".to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_agent(agent_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    validate_safe_id(&agent_id, "agent id")?;
    if state.running_jobs.lock().await.contains_key(&agent_id) {
        return Err("Cannot delete an agent while it is running".to_string());
    }
    let dir = state.agents_root.join(&agent_id);
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .await
            .map_err(|e| app_err("Failed to delete agent directory", e))?;
    }
    remove_agent_from_index(&state.agents_root, &agent_id).await
}

#[tauri::command]
async fn get_agent_runs(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RunRecord>, String> {
    validate_safe_id(&agent_id, "agent id")?;
    let runs_dir = state.agents_root.join(&agent_id).join("runs");
    if !runs_dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = fs::read_dir(&runs_dir)
        .await
        .map_err(|e| app_err("Failed to read runs directory", e))?;
    let mut runs = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| app_err("Failed to read run entry", e))?
    {
        let run_json = entry.path().join("run.json");
        if run_json.exists() {
            if let Ok(run) = read_json::<RunRecord>(&run_json).await {
                runs.push(run);
            }
        }
    }
    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(runs)
}

#[tauri::command]
async fn get_run_details(
    agent_id: String,
    run_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RunDetails, String> {
    validate_safe_id(&agent_id, "agent id")?;
    validate_safe_id(&run_id, "run id")?;
    let run_dir = state.agents_root.join(&agent_id).join("runs").join(&run_id);
    let run: RunRecord = read_json(&run_dir.join("run.json")).await?;
    let changed_files = read_json(&run_dir.join("changed-files.json"))
        .await
        .unwrap_or_default();
    let commits = read_json(&run_dir.join("commits.json"))
        .await
        .unwrap_or_default();
    Ok(RunDetails {
        run,
        changed_files,
        commits,
        stdout_log_available: run_dir.join("stdout.log").exists(),
        stderr_log_available: run_dir.join("stderr.log").exists(),
        sandcastle_log_available: run_dir.join("sandcastle.log").exists(),
        patch_available: run_dir.join("changes.patch").exists(),
    })
}

#[tauri::command]
async fn get_run_patch(
    agent_id: String,
    run_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    validate_safe_id(&agent_id, "agent id")?;
    validate_safe_id(&run_id, "run id")?;
    let path = state
        .agents_root
        .join(agent_id)
        .join("runs")
        .join(run_id)
        .join("changes.patch");
    fs::read_to_string(&path)
        .await
        .map_err(|e| app_err(&format!("Failed to read {}", path.display()), e))
}

#[tauri::command]
async fn get_run_logs(
    agent_id: String,
    run_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RunLogs, String> {
    validate_safe_id(&agent_id, "agent id")?;
    validate_safe_id(&run_id, "run id")?;
    let run_dir = state.agents_root.join(agent_id).join("runs").join(run_id);
    Ok(RunLogs {
        stdout: fs::read_to_string(run_dir.join("stdout.log"))
            .await
            .unwrap_or_default(),
        stderr: fs::read_to_string(run_dir.join("stderr.log"))
            .await
            .unwrap_or_default(),
        sandcastle: fs::read_to_string(run_dir.join("sandcastle.log"))
            .await
            .unwrap_or_default(),
    })
}

#[tauri::command]
async fn get_latest_metrics(
    agent_id: String,
    run_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Option<DockerMetricsPayload>, String> {
    validate_safe_id(&agent_id, "agent id")?;
    let run_id = match run_id {
        Some(run_id) => run_id,
        None => load_agent(&state.agents_root, &agent_id)
            .await?
            .latest_run_id
            .ok_or_else(|| "Agent has no runs".to_string())?,
    };
    validate_safe_id(&run_id, "run id")?;
    let path = state
        .agents_root
        .join(agent_id)
        .join("runs")
        .join(run_id)
        .join("docker-metrics.jsonl");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .await
        .map_err(|e| app_err(&format!("Failed to read {}", path.display()), e))?;
    let latest = content.lines().rev().find(|line| !line.trim().is_empty());
    match latest {
        Some(line) => serde_json::from_str(line)
            .map(Some)
            .map_err(|e| app_err("Failed to parse latest metrics", e)),
        None => Ok(None),
    }
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(path);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(path);
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| app_err(&format!("Failed to open {}", path.display()), e))
}

#[tauri::command]
async fn open_agent_directory(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let agent = load_agent(&state.agents_root, &agent_id).await?;
    open_path(Path::new(&agent.directory))
}

#[tauri::command]
async fn open_run_directory(
    agent_id: String,
    run_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    validate_safe_id(&agent_id, "agent id")?;
    validate_safe_id(&run_id, "run id")?;
    let path = state.agents_root.join(agent_id).join("runs").join(run_id);
    open_path(&path)
}

fn init_storage(agents_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(agents_root)?;
    let index = index_path(agents_root);
    if !index.exists() {
        std::fs::write(
            index,
            serde_json::to_string_pretty(&AgentsIndex::default())?,
        )?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let agents_root = app_data_dir.join("agents");
            init_storage(&agents_root)?;
            app.manage(AppState {
                agents_root,
                sandcastle_root: find_sandcastle_root(),
                running_jobs: Arc::new(Mutex::new(HashMap::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_agents,
            get_agent,
            create_agent,
            run_agent,
            stop_agent,
            delete_agent,
            get_agent_runs,
            get_run_details,
            get_run_patch,
            get_run_logs,
            get_latest_metrics,
            open_agent_directory,
            open_run_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
