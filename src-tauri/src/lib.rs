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
            avg_maintainability REAL NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Gagal inisialisasi table history: {e}"))?;
    Ok(conn)
}

fn save_history(app: &AppHandle, project_path: &str, result: &AnalysisResult) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "INSERT INTO analysis_history (project_path, scanned_files, avg_complexity, avg_maintainability)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            project_path,
            result.summary.scanned_files,
            result.summary.avg_complexity,
            result.summary.avg_maintainability
        ],
    )
    .map_err(|e| format!("Gagal menyimpan history: {e}"))?;
    Ok(())
}

#[tauri::command]
fn analyze_project(app: AppHandle, project_path: String) -> Result<AnalysisResult, String> {
    let analyzer_path = PathBuf::from("analyzer").join("analyze.py");

    let output = Command::new("python")
        .arg(analyzer_path)
        .arg(&project_path)
        .output()
        .or_else(|_| {
            Command::new("py")
                .arg("-3")
                .arg("analyzer/analyze.py")
                .arg(&project_path)
                .output()
        })
        .map_err(|e| format!("Gagal menjalankan Python analyzer: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Analyzer error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result = serde_json::from_str::<AnalysisResult>(&stdout)
        .map_err(|e| format!("Output analyzer tidak valid JSON: {e}"))?;

    save_history(&app, &project_path, &result)?;
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![analyze_project, get_analysis_history])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
