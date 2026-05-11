#![cfg_attr(mobile, tauri::mobile_entry_point)]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::Command};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
struct FileMetric {
    file: String,
    loc: u32,
    function_count: u32,
    complexity_score: u32,
    maintainability_index: f64,
}

#[derive(Serialize, Deserialize, Clone)]
struct AnalysisSummary {
    scanned_files: u32,
    total_loc: u32,
    total_functions: u32,
    avg_complexity: f64,
    avg_maintainability: f64,
    most_complex_file: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct AnalysisResult {
    summary: AnalysisSummary,
    files: Vec<FileMetric>,
}

#[derive(Serialize)]
struct HistoryItem {
    id: i64,
    analyzed_at: String,
    project_path: String,
    scanned_files: u32,
    avg_complexity: f64,
    avg_maintainability: f64,
}

#[derive(Serialize)]
struct HistoryDetail {
    id: i64,
    analyzed_at: String,
    project_path: String,
    result: AnalysisResult,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Gagal mendapatkan app data dir: {e}"))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("Gagal membuat data dir: {e}"))?;
    Ok(app_data.join("codemetrik.sqlite"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| format!("Gagal membuka SQLite: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS analysis_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            project_path TEXT NOT NULL,
            scanned_files INTEGER NOT NULL,
            avg_complexity REAL NOT NULL,
            avg_maintainability REAL NOT NULL,
            result_json TEXT
        )",
        [],
    )
    .map_err(|e| format!("Gagal inisialisasi table history: {e}"))?;
    conn.execute(
        "ALTER TABLE analysis_history ADD COLUMN result_json TEXT",
        [],
    )
    .ok();
    Ok(conn)
}

fn save_history(app: &AppHandle, source_label: &str, result: &AnalysisResult) -> Result<(), String> {
    let conn = open_db(app)?;
    let result_json =
        serde_json::to_string(result).map_err(|e| format!("Gagal serialize result history: {e}"))?;
    conn.execute(
        "INSERT INTO analysis_history (project_path, scanned_files, avg_complexity, avg_maintainability, result_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            source_label,
            result.summary.scanned_files,
            result.summary.avg_complexity,
            result.summary.avg_maintainability,
            result_json
        ],
    )
    .map_err(|e| format!("Gagal menyimpan history: {e}"))?;
    Ok(())
}

fn resolve_analyzer_path() -> Result<PathBuf, String> {
    let candidates = [
        PathBuf::from("analyzer").join("analyze.py"),
        PathBuf::from("..").join("analyzer").join("analyze.py"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("analyzer")
            .join("analyze.py"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("File analyzer/analyze.py tidak ditemukan.".to_string())
}

fn run_analyzer_path(path: &str) -> Result<AnalysisResult, String> {
    let analyzer_path = resolve_analyzer_path()?;

    let output = Command::new("python")
        .arg(&analyzer_path)
        .arg("--path")
        .arg(path)
        .output()
        .or_else(|_| {
            Command::new("py")
                .arg("-3")
                .arg(&analyzer_path)
                .arg("--path")
                .arg(path)
                .output()
        })
        .map_err(|e| format!("Gagal menjalankan Python analyzer: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Analyzer error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<AnalysisResult>(&stdout)
        .map_err(|e| format!("Output analyzer tidak valid JSON: {e}"))
}

fn run_analyzer_snippet(language: &str, code: &str) -> Result<AnalysisResult, String> {
    let analyzer_path = resolve_analyzer_path()?;

    let output = Command::new("python")
        .arg(&analyzer_path)
        .arg("--snippet")
        .arg(language)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .or_else(|_| {
            Command::new("py")
                .arg("-3")
                .arg(&analyzer_path)
                .arg("--snippet")
                .arg(language)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
        })
        .map_err(|e| format!("Gagal menjalankan Python analyzer: {e}"))?;

    let mut child = output;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin
            .write_all(code.as_bytes())
            .map_err(|e| format!("Gagal kirim snippet ke analyzer: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Gagal menunggu proses analyzer: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Analyzer error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<AnalysisResult>(&stdout)
        .map_err(|e| format!("Output analyzer tidak valid JSON: {e}"))
}

#[tauri::command]
fn analyze_path(app: AppHandle, target_path: String) -> Result<AnalysisResult, String> {
    let result = run_analyzer_path(&target_path)?;
    save_history(&app, &target_path, &result)?;
    Ok(result)
}

#[tauri::command]
fn analyze_snippet(app: AppHandle, language: String, code: String) -> Result<AnalysisResult, String> {
    let result = run_analyzer_snippet(&language, &code)?;
    let source = format!("snippet:{language}");
    save_history(&app, &source, &result)?;
    Ok(result)
}

#[tauri::command]
fn get_analysis_history(app: AppHandle, limit: Option<u32>) -> Result<Vec<HistoryItem>, String> {
    let conn = open_db(&app)?;
    let row_limit = i64::from(limit.unwrap_or(20));

    let mut stmt = conn
        .prepare(
            "SELECT id, analyzed_at, project_path, scanned_files, avg_complexity, avg_maintainability
             FROM analysis_history
             ORDER BY id DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Gagal query history: {e}"))?;

    let rows = stmt
        .query_map([row_limit], |row| {
            Ok(HistoryItem {
                id: row.get(0)?,
                analyzed_at: row.get(1)?,
                project_path: row.get(2)?,
                scanned_files: row.get(3)?,
                avg_complexity: row.get(4)?,
                avg_maintainability: row.get(5)?,
            })
        })
        .map_err(|e| format!("Gagal mapping history: {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Row history invalid: {e}"))?);
    }

    Ok(result)
}

#[tauri::command]
fn get_history_detail(app: AppHandle, id: i64) -> Result<HistoryDetail, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, analyzed_at, project_path, result_json
             FROM analysis_history
             WHERE id = ?1",
        )
        .map_err(|e| format!("Gagal query detail history: {e}"))?;

    let mut rows = stmt
        .query([id])
        .map_err(|e| format!("Gagal eksekusi query detail history: {e}"))?;

    let row = rows
        .next()
        .map_err(|e| format!("Gagal membaca row detail history: {e}"))?
        .ok_or_else(|| "History tidak ditemukan".to_string())?;

    let result_json: Option<String> = row
        .get(3)
        .map_err(|e| format!("Gagal membaca result_json history: {e}"))?;
    let result_json = result_json.ok_or_else(|| "Detail history tidak tersedia untuk data lama".to_string())?;
    let result: AnalysisResult = serde_json::from_str(&result_json)
        .map_err(|e| format!("Gagal parse detail history: {e}"))?;

    Ok(HistoryDetail {
        id: row.get(0).map_err(|e| format!("Gagal membaca id history: {e}"))?,
        analyzed_at: row
            .get(1)
            .map_err(|e| format!("Gagal membaca analyzed_at history: {e}"))?,
        project_path: row
            .get(2)
            .map_err(|e| format!("Gagal membaca project_path history: {e}"))?,
        result,
    })
}

#[tauri::command]
fn delete_history_item(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM analysis_history WHERE id = ?1", [id])
        .map_err(|e| format!("Gagal hapus history item: {e}"))?;
    Ok(())
}

#[tauri::command]
fn clear_history(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM analysis_history", [])
        .map_err(|e| format!("Gagal hapus semua history: {e}"))?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            analyze_path,
            analyze_snippet,
            get_analysis_history,
            get_history_detail,
            delete_history_item,
            clear_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
