import { useEffect, useMemo, useState } from 'react'
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

type InputMode = 'folder' | 'file' | 'snippet'
type SnippetLanguage = 'python' | 'javascript' | 'typescript'

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
type DialogOpen = (options?: Record<string, unknown>) => Promise<string | string[] | null>

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: unknown
  }
}

let invokeRef: TauriInvoke | null = null
let dialogOpenRef: DialogOpen | null = null

function isTauriRuntime() {
  return typeof window !== 'undefined' && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__))
}

async function ensureTauriApi() {
  if (!isTauriRuntime()) {
    throw new Error('NOT_TAURI_RUNTIME')
  }
  if (invokeRef && dialogOpenRef) return
  const core = await import('@tauri-apps/api/core')
  const dialog = await import('@tauri-apps/plugin-dialog')
  invokeRef = core.invoke as TauriInvoke
  dialogOpenRef = dialog.open as DialogOpen
}

function formatUnknownError(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function formatTauriError(err: unknown) {
  const raw = formatUnknownError(err)
  if (raw === 'NOT_TAURI_RUNTIME') {
    return 'Aplikasi ini berjalan di browser biasa, bukan window Tauri. Jalankan: npm run tauri:dev'
  }
  return `Tauri error: ${raw || 'unknown'}`
}

function App() {
  const [inputMode, setInputMode] = useState<InputMode>('folder')
  const [targetPath, setTargetPath] = useState('')
  const [snippetCode, setSnippetCode] = useState('')
  const [snippetLanguage, setSnippetLanguage] = useState<SnippetLanguage>('python')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const loadHistory = async () => {
    try {
      await ensureTauriApi()
      const data = await invokeRef!<HistoryItem[]>('get_analysis_history', { limit: 12 })
      setHistory(data)
    } catch {
      setHistory([])
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  const topFiles = useMemo(() => {
    if (!result) return []
    return [...result.files].sort((a, b) => b.complexity_score - a.complexity_score).slice(0, 10)
  }, [result])

  const trend = useMemo(() => [...history].reverse(), [history])
  const maxComplexity = useMemo(() => Math.max(...trend.map((item) => item.avg_complexity), 1), [trend])

  const onPickFolder = async () => {
    try {
      await ensureTauriApi()
      const selected = await dialogOpenRef!({ directory: true, multiple: false })
      if (selected && typeof selected === 'string') {
        setTargetPath(selected)
        setInputMode('folder')
      }
    } catch (err) {
      console.error('onPickFolder error', err)
      setError(formatTauriError(err))
    }
  }

  const onPickFile = async () => {
    try {
      await ensureTauriApi()
      const selected = await dialogOpenRef!({
        directory: false,
        multiple: false,
        filters: [{ name: 'Source', extensions: ['py', 'js', 'ts'] }],
      })
      if (selected && typeof selected === 'string') {
        setTargetPath(selected)
        setInputMode('file')
      }
    } catch (err) {
      console.error('onPickFile error', err)
      setError(formatTauriError(err))
    }
  }

  const onAnalyze = async () => {
    setLoading(true)
    setError(null)

    try {
      await ensureTauriApi()
      let data: AnalysisResult
      if (inputMode === 'snippet') {
        if (!snippetCode.trim()) {
          setError('Paste code dulu.')
          setLoading(false)
          return
        }
        data = await invokeRef!<AnalysisResult>('analyze_snippet', {
          language: snippetLanguage,
          code: snippetCode,
        })
      } else {
        if (!targetPath.trim()) {
          setError(`Pilih ${inputMode === 'folder' ? 'folder' : 'file'} dulu.`)
          setLoading(false)
          return
        }
        data = await invokeRef!<AnalysisResult>('analyze_path', {
          targetPath: targetPath.trim(),
        })
      }

      setResult(data)
      await loadHistory()
    } catch (err) {
      console.error('onAnalyze error', err)
      setResult(null)
      setError(formatTauriError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Code Quality Desktop Toolkit</p>
        <h1>CodeMetric Studio</h1>
        <p className="lead">Analyze per folder, single file, atau snippet dengan tampilan ringkas dan fokus.</p>
      </header>

      <section className="surface">
        <div className="tabs" role="tablist" aria-label="Input mode">
          <button className={inputMode === 'folder' ? 'tab active' : 'tab'} onClick={() => setInputMode('folder')} type="button">Folder</button>
          <button className={inputMode === 'file' ? 'tab active' : 'tab'} onClick={() => setInputMode('file')} type="button">File</button>
          <button className={inputMode === 'snippet' ? 'tab active' : 'tab'} onClick={() => setInputMode('snippet')} type="button">Snippet</button>
        </div>

        {inputMode !== 'snippet' ? (
          <div className="input-row">
            <input
              type="text"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              placeholder={inputMode === 'folder' ? 'Select project folder' : 'Select source file'}
            />
            {inputMode === 'folder' ? (
              <button type="button" className="ghost" onClick={onPickFolder} disabled={loading}>Browse Folder</button>
            ) : (
              <button type="button" className="ghost" onClick={onPickFile} disabled={loading}>Browse File</button>
            )}
            <button type="button" className="primary" onClick={onAnalyze} disabled={loading}>{loading ? 'Analyzing...' : 'Analyze'}</button>
          </div>
        ) : (
          <div className="snippet-block">
            <div className="input-row">
              <select value={snippetLanguage} onChange={(e) => setSnippetLanguage(e.target.value as SnippetLanguage)}>
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
              </select>
              <button type="button" className="primary" onClick={onAnalyze} disabled={loading}>{loading ? 'Analyzing...' : 'Analyze Snippet'}</button>
            </div>
            <textarea value={snippetCode} onChange={(e) => setSnippetCode(e.target.value)} placeholder="Paste your code here..." rows={12} />
          </div>
        )}

        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="grid">
        <article className="surface">
          <h2>Trend</h2>
          {trend.length === 0 ? (
            <p className="muted">No history yet.</p>
          ) : (
            <div className="trend-list">
              {trend.map((item) => (
                <div className="trend-row" key={item.id}>
                  <div className="trend-head">
                    <span title={item.project_path}>{item.project_path}</span>
                    <small>{item.analyzed_at}</small>
                  </div>
                  <div className="bar-wrap">
                    <div className="bar complexity" style={{ width: `${(item.avg_complexity / maxComplexity) * 100}%` }} />
                    <div className="bar maintainability" style={{ width: `${Math.max(item.avg_maintainability, 2)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        {result ? (
          <>
            <article className="surface stats">
              <h2>Summary</h2>
              <div className="stats-grid">
                <div><label>Scanned Files</label><strong>{result.summary.scanned_files}</strong></div>
                <div><label>Total LOC</label><strong>{result.summary.total_loc}</strong></div>
                <div><label>Total Functions</label><strong>{result.summary.total_functions}</strong></div>
                <div><label>Avg Complexity</label><strong>{result.summary.avg_complexity.toFixed(2)}</strong></div>
                <div><label>Avg Maintainability</label><strong>{result.summary.avg_maintainability.toFixed(2)}</strong></div>
                <div><label>Most Complex File</label><strong>{result.summary.most_complex_file || '-'}</strong></div>
              </div>
            </article>

            <article className="surface table-wrap">
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
