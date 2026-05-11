import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import './App.css'

type FileMetric = {
  file: string
  loc: number
  function_count: number
  complexity_score: number
  maintainability_index: number
}

type AnalysisSummary = {
  scanned_files: number
  total_loc: number
  total_functions: number
  avg_complexity: number
  avg_maintainability: number
  most_complex_file: string
}

type AnalysisResult = {
  summary: AnalysisSummary
  files: FileMetric[]
}

type HistoryItem = {
  id: number
  analyzed_at: string
  project_path: string
  scanned_files: number
  avg_complexity: number
  avg_maintainability: number
}

function App() {
  const [projectPath, setProjectPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const loadHistory = async () => {
    try {
      const data = await invoke<HistoryItem[]>('get_analysis_history', { limit: 12 })
      setHistory(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat history.')
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  const topFiles = useMemo(() => {
    if (!result) return []
    return [...result.files]
      .sort((a, b) => b.complexity_score - a.complexity_score)
      .slice(0, 10)
  }, [result])

  const trend = useMemo(() => [...history].reverse(), [history])
  const maxComplexity = useMemo(
    () => Math.max(...trend.map((item) => item.avg_complexity), 1),
    [trend],
  )

  const onPickFolder = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected && typeof selected === 'string') {
      setProjectPath(selected)
    }
  }

  const onAnalyze = async () => {
    const trimmed = projectPath.trim()
    if (!trimmed) {
      setError('Pilih folder project dulu.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await invoke<AnalysisResult>('analyze_project', {
        projectPath: trimmed,
      })
      setResult(data)
      await loadHistory()
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Gagal melakukan analisis.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>CodeMetric Studio</h1>
        <p className="subtitle">
          Real metrics: Python menggunakan radon, JavaScript/TypeScript menggunakan lizard.
        </p>

        <div className="input-row">
          <input
            type="text"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="Pilih folder project"
          />
          <button type="button" className="secondary" onClick={onPickFolder} disabled={loading}>
            Browse Folder
          </button>
          <button type="button" onClick={onAnalyze} disabled={loading}>
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="grid">
        <article className="card">
          <h2>Trend (History SQLite)</h2>
          {trend.length === 0 ? (
            <p className="muted">Belum ada history analisis.</p>
          ) : (
            <div className="trend-list">
              {trend.map((item) => (
                <div className="trend-row" key={item.id}>
                  <div className="trend-head">
                    <span title={item.project_path}>{item.project_path.split('\\').pop()}</span>
                    <small>{item.analyzed_at}</small>
                  </div>
                  <div className="bar-wrap">
                    <div
                      className="bar complexity"
                      style={{ width: `${(item.avg_complexity / maxComplexity) * 100}%` }}
                    />
                    <div
                      className="bar maintainability"
                      style={{ width: `${Math.max(item.avg_maintainability, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        {result ? (
          <>
            <article className="card">
              <h2>Summary</h2>
              <ul>
                <li>Scanned files: {result.summary.scanned_files}</li>
                <li>Total LOC: {result.summary.total_loc}</li>
                <li>Total functions: {result.summary.total_functions}</li>
                <li>Average complexity: {result.summary.avg_complexity.toFixed(2)}</li>
                <li>
                  Average maintainability: {result.summary.avg_maintainability.toFixed(2)}
                </li>
                <li>Most complex file: {result.summary.most_complex_file || '-'}</li>
              </ul>
            </article>

            <article className="card wide">
              <h2>Top Complex Files</h2>
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>LOC</th>
                    <th>Functions</th>
                    <th>Complexity</th>
                    <th>Maintainability</th>
                  </tr>
                </thead>
                <tbody>
                  {topFiles.map((item) => (
                    <tr key={item.file}>
                      <td>{item.file}</td>
                      <td>{item.loc}</td>
                      <td>{item.function_count}</td>
                      <td>{item.complexity_score}</td>
                      <td>{item.maintainability_index.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </>
        ) : null}
      </section>
    </main>
  )
}

export default App
