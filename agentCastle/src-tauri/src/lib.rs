use chrono::{SecondsFormat, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Emitter, Manager};
use tokio::{
    fs,
    io::AsyncWriteExt,
    sync::{watch, Mutex},
    time::{sleep, Duration},
};

#[derive(Clone)]
struct RunningJob {
    run_id: String,
    stop_tx: watch::Sender<bool>,
}

struct AppState {
    agents_root: PathBuf,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SandboxProviderName {
    Docker,
    Podman,
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
    agent_provider: Option<String>,
    prompt: CreatePromptPayload,
    max_iterations: u32,
    branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentConfig {
    id: String,
    name: String,
    directory: String,
    status: AgentStatus,
    latest_run_id: Option<String>,
    created_at: String,
    updated_at: String,
    target_repo_path: String,
    sandbox_provider: SandboxProviderName,
    model: String,
    agent_provider: String,
    prompt: AgentPrompt,
    max_iterations: u32,
    branch: String,
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
struct AgentDetails {
    agent: AgentConfig,
    latest_run: Option<RunRecord>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn app_err<E: std::fmt::Display>(ctx: &str, e: E) -> String {
    format!("{ctx}: {e}")
}

fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn index_path(agents_root: &Path) -> PathBuf {
    agents_root
        .parent()
        .unwrap_or(agents_root)
        .join("agents.json")
}

fn agent_json(agents_root: &Path, agent_id: &str) -> PathBuf {
    agents_root.join(agent_id).join("agent.json")
}

fn run_json(agents_root: &Path, agent_id: &str, run_id: &str) -> PathBuf {
    agents_root
        .join(agent_id)
        .join("runs")
        .join(run_id)
        .join("run.json")
}

async fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let data = fs::read_to_string(path)
        .await
        .map_err(|e| app_err(&format!("Failed to read {}", path.display()), e))?;
    serde_json::from_str(&data)
        .map_err(|e| app_err(&format!("Failed to parse {}", path.display()), e))
}

async fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| app_err("Failed to create directory", e))?;
    }
    let content =
        serde_json::to_string_pretty(value).map_err(|e| app_err("Failed to serialize json", e))?;
    fs::write(path, content)
        .await
        .map_err(|e| app_err(&format!("Failed to write {}", path.display()), e))
}

async fn write_text(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| app_err("Failed to create directory", e))?;
    }
    fs::write(path, content)
        .await
        .map_err(|e| app_err(&format!("Failed to write {}", path.display()), e))
}

async fn read_index(agents_root: &Path) -> Result<AgentsIndex, String> {
    let path = index_path(agents_root);
    if !path.exists() {
        return Ok(AgentsIndex::default());
    }
    read_json(&path).await
}

async fn write_index(agents_root: &Path, index: &AgentsIndex) -> Result<(), String> {
    write_json(&index_path(agents_root), index).await
}

fn to_summary(agent: &AgentConfig) -> AgentSummary {
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

async fn load_agent(agents_root: &Path, agent_id: &str) -> Result<AgentConfig, String> {
    read_json(&agent_json(agents_root, agent_id)).await
}

async fn save_agent(agents_root: &Path, agent: &AgentConfig) -> Result<(), String> {
    write_json(&agent_json(agents_root, &agent.id), agent).await?;
    let mut index = read_index(agents_root).await?;
    index.agents.retain(|a| a.id != agent.id);
    index.agents.push(to_summary(agent));
    index
        .agents
        .sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.name.cmp(&b.name)));
    write_index(agents_root, &index).await
}

async fn simulate_run(
    app: tauri::AppHandle,
    agents_root: PathBuf,
    agent: AgentConfig,
    run_id: String,
    stop_rx: watch::Receiver<bool>,
    jobs: Arc<Mutex<HashMap<String, RunningJob>>>,
) {
    let run_dir = PathBuf::from(&agent.directory).join("runs").join(&run_id);
    let stdout_path = run_dir.join("stdout.log");
    let stderr_path = run_dir.join("stderr.log");
    let patch_path = run_dir.join("changes.patch");
    let changed_files_path = run_dir.join("changed-files.json");
    let commits_path = run_dir.join("commits.json");
    let metrics_path = run_dir.join("docker-metrics.jsonl");

    let mut cancelled = false;
    for i in 1..=4 {
        if *stop_rx.borrow() {
            cancelled = true;
            break;
        }
        let line = format!("[simulated] running step {i}/4 for {}\n", agent.name);
        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stdout_path)
            .await
        {
            let _ = f.write_all(line.as_bytes()).await;
        }

        let _ = app.emit(
            "agent://log",
            json!({
                "agent_id": agent.id,
                "run_id": run_id,
                "stream": "stdout",
                "line": line.trim_end(),
                "timestamp": now_iso(),
            }),
        );

        let metrics = DockerMetricsPayload {
            agent_id: agent.id.clone(),
            run_id: run_id.clone(),
            timestamp: now_iso(),
            provider: match agent.sandbox_provider {
                SandboxProviderName::Docker => "docker".to_string(),
                SandboxProviderName::Podman => "podman".to_string(),
            },
            docker_available: true,
            daemon_running: true,
            containers: vec![],
            unavailable_reason: None,
        };
        if let Ok(line) = serde_json::to_string(&metrics) {
            if let Ok(mut f) = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&metrics_path)
                .await
            {
                let _ = f.write_all(line.as_bytes()).await;
                let _ = f.write_all(b"\n").await;
            }
        }
        let _ = app.emit("agent://docker-metrics", metrics);

        sleep(Duration::from_millis(800)).await;
    }

    let mut run: RunRecord = match read_json(&run_json(&agents_root, &agent.id, &run_id)).await {
        Ok(r) => r,
        Err(_) => return,
    };
    run.ended_at = Some(now_iso());

    if cancelled {
        run.status = RunStatus::Cancelled;
        run.error = Some("Run cancelled by user".to_string());
        let _ = write_json(&run_json(&agents_root, &agent.id, &run_id), &run).await;
        if let Ok(mut a) = load_agent(&agents_root, &agent.id).await {
            a.status = AgentStatus::Cancelled;
            a.updated_at = now_iso();
            let _ = save_agent(&agents_root, &a).await;
        }
        let _ = app.emit(
            "agent://run-cancelled",
            json!({"agent_id": agent.id, "run_id": run_id, "status": "cancelled", "ended_at": run.ended_at}),
        );
    } else {
        run.status = RunStatus::Completed;
        let _ = write_text(&patch_path, "# simulated patch\n").await;
        let _ = write_json(&changed_files_path, &ChangedFiles::default()).await;
        let _ = write_json(&commits_path, &Vec::<CommitInfo>::new()).await;
        let _ = write_json(&run_json(&agents_root, &agent.id, &run_id), &run).await;

        if let Ok(mut a) = load_agent(&agents_root, &agent.id).await {
            a.status = AgentStatus::Completed;
            a.updated_at = now_iso();
            a.latest_run_id = Some(run_id.clone());
            let _ = save_agent(&agents_root, &a).await;
        }

        let _ = app.emit(
            "agent://changes-collected",
            json!({"agent_id": agent.id, "run_id": run_id, "changed_files": [], "patch_path": patch_path.to_string_lossy(), "commits": []}),
        );
        let _ = app.emit(
            "agent://run-completed",
            json!({"agent_id": agent.id, "run_id": run_id, "status": "completed", "changed_files_count": 0, "ended_at": run.ended_at}),
        );
    }

    let _ = app.emit(
        "agent://status-changed",
        json!({
            "agent_id": agent.id,
            "run_id": run_id,
            "status": if cancelled { "cancelled" } else { "completed" },
            "timestamp": now_iso(),
        }),
    );

    jobs.lock().await.remove(&agent.id);
}

#[tauri::command]
async fn list_agents(state: tauri::State<'_, AppState>) -> Result<Vec<AgentSummary>, String> {
    Ok(read_index(&state.agents_root).await?.agents)
}

#[tauri::command]
async fn get_agent(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<AgentDetails, String> {
    let agent = load_agent(&state.agents_root, &agent_id).await?;
    let latest_run = if let Some(run_id) = &agent.latest_run_id {
        read_json(&run_json(&state.agents_root, &agent_id, run_id))
            .await
            .ok()
    } else {
        None
    };
    Ok(AgentDetails { agent, latest_run })
}

#[tauri::command]
async fn create_agent(
    payload: CreateAgentPayload,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<AgentDetails, String> {
    if payload.name.trim().is_empty() {
        return Err("Agent name is required".to_string());
    }
    if payload.target_repo_path.trim().is_empty() {
        return Err("Target repository path is required".to_string());
    }

    let repo = PathBuf::from(payload.target_repo_path.trim());
    if !repo.exists() || !repo.is_dir() {
        return Err("Target repository path does not exist or is not a directory".to_string());
    }

    let mut id = slugify(&payload.name);
    if id.is_empty() {
        id = format!("agent-{}", Utc::now().timestamp());
    }
    let mut n = 2;
    while state.agents_root.join(&id).exists() {
        id = format!("{}-{}", slugify(&payload.name), n);
        n += 1;
    }

    let dir = state.agents_root.join(&id);
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| app_err("Failed to create agent directory", e))?;

    let prompt_content = match &payload.prompt {
        CreatePromptPayload::Inline { value } => value.clone(),
        CreatePromptPayload::File { path } => fs::read_to_string(path)
            .await
            .map_err(|e| app_err("Failed to read prompt file", e))?,
    };

    write_text(&dir.join("prompt.md"), &prompt_content).await?;
    write_text(&dir.join("runner.mts"), "// runner placeholder\n").await?;
    fs::create_dir_all(dir.join(".sandcastle"))
        .await
        .map_err(|e| app_err("Failed to create .sandcastle", e))?;

    let now = now_iso();
    let agent = AgentConfig {
        id: id.clone(),
        name: payload.name,
        directory: dir.to_string_lossy().to_string(),
        status: AgentStatus::Ready,
        latest_run_id: None,
        created_at: now.clone(),
        updated_at: now,
        target_repo_path: repo.to_string_lossy().to_string(),
        sandbox_provider: payload.sandbox_provider,
        model: payload.model,
        agent_provider: payload
            .agent_provider
            .unwrap_or_else(|| "claude-code".to_string()),
        prompt: AgentPrompt::File {
            path: "prompt.md".to_string(),
            source_path: match payload.prompt {
                CreatePromptPayload::File { path } => Some(path),
                _ => None,
            },
        },
        max_iterations: payload.max_iterations.max(1),
        branch: payload.branch.unwrap_or_else(|| format!("agent/{id}")),
    };

    save_agent(&state.agents_root, &agent).await?;
    let details = AgentDetails {
        agent: agent.clone(),
        latest_run: None,
    };

    let _ = app.emit(
        "agent://created",
        json!({"agent_id": agent.id, "agent": details}),
    );
    let _ = app.emit(
        "agent://status-changed",
        json!({"agent_id": agent.id, "run_id": null, "status": "ready", "timestamp": now_iso()}),
    );

    Ok(AgentDetails {
        agent,
        latest_run: None,
    })
}

#[tauri::command]
async fn run_agent(
    agent_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<JobStarted, String> {
    let mut jobs = state.running_jobs.lock().await;
    if jobs.contains_key(&agent_id) {
        return Err("Agent is already running".to_string());
    }

    let mut agent = load_agent(&state.agents_root, &agent_id).await?;
    let started_at = now_iso();
    let run_id = format!("run-{}", started_at.replace(':', "-").replace('.', "-"));
    let run_dir = PathBuf::from(&agent.directory).join("runs").join(&run_id);
    fs::create_dir_all(&run_dir)
        .await
        .map_err(|e| app_err("Failed to create run directory", e))?;

    write_text(&run_dir.join("stdout.log"), "").await?;
    write_text(&run_dir.join("stderr.log"), "").await?;
    write_text(&run_dir.join("sandcastle.log"), "").await?;
    write_text(&run_dir.join("changes.patch"), "").await?;
    write_text(&run_dir.join("docker-metrics.jsonl"), "").await?;
    write_json(
        &run_dir.join("changed-files.json"),
        &ChangedFiles::default(),
    )
    .await?;
    write_json(&run_dir.join("commits.json"), &Vec::<CommitInfo>::new()).await?;

    let run = RunRecord {
        id: run_id.clone(),
        agent_id: agent_id.clone(),
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
        warning: Some(
            "Simulated backend run: Sandcastle process wiring can be switched to real runner next."
                .to_string(),
        ),
    };

    write_json(&run_json(&state.agents_root, &agent_id, &run_id), &run).await?;

    agent.status = AgentStatus::Running;
    agent.latest_run_id = Some(run_id.clone());
    agent.updated_at = now_iso();
    save_agent(&state.agents_root, &agent).await?;

    let (stop_tx, stop_rx) = watch::channel(false);
    jobs.insert(
        agent_id.clone(),
        RunningJob {
            run_id: run_id.clone(),
            stop_tx,
        },
    );
    drop(jobs);

    let _ = app.emit(
        "agent://run-started",
        json!({"agent_id": agent_id, "run_id": run_id, "started_at": started_at}),
    );
    let _ = app.emit(
        "agent://status-changed",
        json!({"agent_id": agent.id, "run_id": run.id, "status": "running", "timestamp": now_iso()}),
    );

    tokio::spawn(simulate_run(
        app,
        state.agents_root.clone(),
        agent,
        run_id.clone(),
        stop_rx,
        state.running_jobs.clone(),
    ));

    Ok(JobStarted { agent_id, run_id })
}

#[tauri::command]
async fn stop_agent(agent_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let jobs = state.running_jobs.lock().await;
    let job = jobs
        .get(&agent_id)
        .ok_or_else(|| "Agent is not running".to_string())?;
    let _ = &job.run_id;
    job.stop_tx
        .send(true)
        .map_err(|_| "Failed to stop agent".to_string())
}

#[tauri::command]
async fn delete_agent(agent_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if state.running_jobs.lock().await.contains_key(&agent_id) {
        return Err("Cannot delete while agent is running".to_string());
    }
    let dir = state.agents_root.join(&agent_id);
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .await
            .map_err(|e| app_err("Failed to delete agent directory", e))?;
    }
    let mut idx = read_index(&state.agents_root).await?;
    idx.agents.retain(|a| a.id != agent_id);
    write_index(&state.agents_root, &idx).await
}

#[tauri::command]
async fn get_agent_runs(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RunRecord>, String> {
    let runs_dir = state.agents_root.join(&agent_id).join("runs");
    if !runs_dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = fs::read_dir(&runs_dir)
        .await
        .map_err(|e| app_err("Failed to read runs directory", e))?;
    let mut runs = Vec::new();
    while let Some(ent) = entries
        .next_entry()
        .await
        .map_err(|e| app_err("Failed to read run entry", e))?
    {
        let path = ent.path().join("run.json");
        if path.exists() {
            if let Ok(run) = read_json::<RunRecord>(&path).await {
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
    let run_dir = state.agents_root.join(&agent_id).join("runs").join(&run_id);
    let run = read_json::<RunRecord>(&run_dir.join("run.json")).await?;
    let changed_files = read_json(&run_dir.join("changed-files.json"))
        .await
        .unwrap_or_default();
    let commits = read_json(&run_dir.join("commits.json"))
        .await
        .unwrap_or_else(|_| Vec::<CommitInfo>::new());
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
    let run_id = if let Some(run_id) = run_id {
        run_id
    } else {
        let agent = load_agent(&state.agents_root, &agent_id).await?;
        agent
            .latest_run_id
            .ok_or_else(|| "Agent has no runs".to_string())?
    };

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
    if let Some(line) = content.lines().rev().find(|l| !l.trim().is_empty()) {
        serde_json::from_str::<DockerMetricsPayload>(line)
            .map(Some)
            .map_err(|e| app_err("Failed to parse metrics line", e))
    } else {
        Ok(None)
    }
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(path);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(path);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(path);
        c
    };
    cmd.spawn()
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
    open_path(&state.agents_root.join(agent_id).join("runs").join(run_id))
}

fn init_storage(agents_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(agents_root)?;
    let idx = index_path(agents_root);
    if !idx.exists() {
        std::fs::write(idx, serde_json::to_string_pretty(&AgentsIndex::default())?)?;
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
