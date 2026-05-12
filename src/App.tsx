import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import 'reactflow/dist/style.css'
import './App.css'
import { AppSidebar } from './components/layout/AppSidebar'
import { MainContent } from './components/layout/MainContent'
import { TopNavbar } from './components/layout/TopNavbar'
import type { AnalysisResult, FunctionMetric, HistoryDetail, HistoryItem, InputMode, SnippetLanguage } from './types/analysis'

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
type DialogOpen = (options?: Record<string, unknown>) => Promise<string | string[] | null>
type DialogSave = (options?: Record<string, unknown>) => Promise<string | null>
type WriteFile = (path: string, contents: Uint8Array | number[]) => Promise<void>

declare global { interface Window { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown } }

let invokeRef: TauriInvoke | null = null
let dialogOpenRef: DialogOpen | null = null
let dialogSaveRef: DialogSave | null = null
let writeFileRef: WriteFile | null = null

function isTauriRuntime() { return typeof window !== 'undefined' && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__)) }

async function ensureTauriApi() {
  if (!isTauriRuntime()) throw new Error('NOT_TAURI_RUNTIME')
  if (invokeRef && dialogOpenRef && dialogSaveRef && writeFileRef) return
  const core = await import('@tauri-apps/api/core')
  const dialog = await import('@tauri-apps/plugin-dialog')
  const fs = await import('@tauri-apps/plugin-fs')
  invokeRef = core.invoke as TauriInvoke
  dialogOpenRef = dialog.open as DialogOpen
  dialogSaveRef = dialog.save as DialogSave
  writeFileRef = fs.writeFile as WriteFile
}

function formatUnknownError(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

function formatTauriError(err: unknown) {
  const raw = formatUnknownError(err)
  if (raw === 'NOT_TAURI_RUNTIME') return 'Aplikasi ini berjalan di browser biasa, bukan window Tauri. Jalankan: npm run tauri:dev'
  return `Tauri error: ${raw || 'unknown'}`
}

function App() {
  const [inputMode, setInputMode] = useState<InputMode>('folder')
  const [targetPath, setTargetPath] = useState('')
  const [snippetCode, setSnippetCode] = useState('')
  const [snippetLanguage, setSnippetLanguage] = useState<SnippetLanguage>('php')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [functionPage, setFunctionPage] = useState(1)
  const [selectedFunctionKey, setSelectedFunctionKey] = useState('')
  const pageSize = 10

  const displayedResult = historyDetail?.result ?? result

  const sortedFiles = useMemo(
    () => displayedResult ? [...displayedResult.files].sort((a, b) => b.complexity_score - a.complexity_score) : [],
    [displayedResult],
  )

  const topFunctions = useMemo(() => displayedResult?.summary.top_complex_functions ?? [], [displayedResult])

  const allFunctions = useMemo(() => {
    if (!displayedResult) return []
    if (topFunctions.length > 0) return topFunctions
    const flattened: FunctionMetric[] = []
    for (const file of displayedResult.files) {
      for (const fn of file.functions ?? []) flattened.push(fn)
    }
    return flattened.sort((a, b) => b.vg - a.vg)
  }, [displayedResult, topFunctions])

  useEffect(() => {
    setCurrentPage(1)
    setFunctionPage(1)
  }, [displayedResult])

  useEffect(() => {
    if (allFunctions.length > 0) {
      setSelectedFunctionKey(`${allFunctions[0].file}::${allFunctions[0].name}`)
    } else {
      setSelectedFunctionKey('')
    }
  }, [allFunctions])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedFiles.length / pageSize)), [sortedFiles.length])
  const pagedFiles = useMemo(() => sortedFiles.slice((currentPage - 1) * pageSize, currentPage * pageSize), [sortedFiles, currentPage])
  const pagedFunctions = useMemo(() => allFunctions.slice((functionPage - 1) * pageSize, functionPage * pageSize), [allFunctions, functionPage])

  const loadHistory = async () => {
    try {
      await ensureTauriApi()
      const data = await invokeRef!<HistoryItem[]>('get_analysis_history', { limit: 30 })
      setHistory(data)
    } catch {
      setHistory([])
    }
  }

  useEffect(() => { void loadHistory() }, [])

  const onAnalyze = async () => {
    setLoading(true)
    setError(null)
    setHistoryDetail(null)
    try {
      await ensureTauriApi()
      const data = inputMode === 'snippet'
        ? await invokeRef!<AnalysisResult>('analyze_snippet', { language: snippetLanguage, code: snippetCode })
        : await invokeRef!<AnalysisResult>('analyze_path', { targetPath: targetPath.trim() })
      setResult(data)
      await loadHistory()
    } catch (err) {
      setResult(null)
      setError(formatTauriError(err))
    } finally {
      setLoading(false)
    }
  }

  const onPickFolder = async () => {
    try {
      await ensureTauriApi()
      const selected = await dialogOpenRef!({ directory: true, multiple: false })
      if (selected && typeof selected === 'string') {
        setTargetPath(selected)
        setInputMode('folder')
      }
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onPickFile = async () => {
    try {
      await ensureTauriApi()
      const selected = await dialogOpenRef!({ directory: false, multiple: false, filters: [{ name: 'Source', extensions: ['py', 'js', 'ts', 'php'] }] })
      if (selected && typeof selected === 'string') {
        setTargetPath(selected)
        setInputMode('file')
      }
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onViewHistoryDetail = async (id: number) => {
    try {
      await ensureTauriApi()
      const detail = await invokeRef!<HistoryDetail>('get_history_detail', { id })
      setHistoryDetail(detail)
      setResult(null)
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onDeleteHistory = async (id: number) => {
    try {
      await ensureTauriApi()
      await invokeRef!('delete_history_item', { id })
      if (historyDetail?.id === id) setHistoryDetail(null)
      await loadHistory()
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onClearHistory = async () => {
    try {
      await ensureTauriApi()
      await invokeRef!('clear_history')
      setHistoryDetail(null)
      await loadHistory()
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const exportRows = useMemo(() => sortedFiles.map((item) => ({
    File: item.file,
    Language: item.language,
    LOC: item.loc,
    Functions: item.function_count,
    Predicate: item.predicate_count,
    Cyclomatic: item.complexity_score,
    ComplexityCategory: item.complexity_category,
    MI: Number(item.maintainability_index.toFixed(2)),
    MICategory: item.maintainability_category,
    n1: item.halstead_detail?.n1 ?? 'N/A',
    n2: item.halstead_detail?.n2 ?? 'N/A',
    N1: item.halstead_detail?.N1 ?? 'N/A',
    N2: item.halstead_detail?.N2 ?? 'N/A',
    ProgramLength: item.halstead_detail?.program_length ?? 'N/A',
    Vocabulary: item.halstead_detail?.vocabulary ?? 'N/A',
    HalsteadVolume: item.halstead_detail?.volume ?? 'N/A',
    HalsteadDifficulty: item.halstead_detail?.difficulty ?? 'N/A',
    HalsteadEffort: item.halstead_detail?.effort ?? 'N/A',
  })), [sortedFiles])

  const onExportExcel = async () => {
    if (!displayedResult) return
    try {
      await ensureTauriApi()
      const target = await dialogSaveRef!({ defaultPath: `codemetrik-${Date.now()}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
      if (!target) return
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows), 'Metric Result')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(displayedResult.summary.top_complex_functions), 'Top Functions')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(displayedResult.recommendations.map((r) => ({ recommendation: r }))), 'Recommendations')
      const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      await writeFileRef!(target, new Uint8Array(bytes))
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onExportJson = async () => {
    if (!displayedResult) return
    try {
      await ensureTauriApi()
      const target = await dialogSaveRef!({ defaultPath: `codemetrik-${Date.now()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (!target) return
      const bytes = new TextEncoder().encode(JSON.stringify(displayedResult, null, 2))
      await writeFileRef!(target, bytes)
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onExportPdf = async () => {
    if (!displayedResult) return
    try {
      await ensureTauriApi()
      const target = await dialogSaveRef!({ defaultPath: `codemetrik-${Date.now()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      if (!target) return
      const d = displayedResult
      const doc = new jsPDF()
      doc.setFontSize(14)
      doc.text('CodeMetric Analysis Report', 14, 16)
      doc.setFontSize(10)
      doc.text(`Scanned Files: ${d.summary.scanned_files}`, 14, 24)
      doc.text(`Total Functions: ${d.summary.total_functions}`, 14, 30)
      doc.text(`Avg Complexity: ${d.summary.avg_complexity.toFixed(2)}`, 14, 36)
      doc.text(`Avg MI: ${d.summary.avg_maintainability.toFixed(2)} (${d.summary.mi_distribution.Excellent + d.summary.mi_distribution.Good} good files)`, 14, 42)
      autoTable(doc, { startY: 48, head: [['File', 'VG', 'Category', 'MI', 'MI Cat']], body: d.files.map((f) => [f.file, f.complexity_score, f.complexity_category, f.maintainability_index.toFixed(2), f.maintainability_category]), styles: { fontSize: 8 } })
      autoTable(doc, { startY: (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ? ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8) : 160, head: [['Recommendations']], body: d.recommendations.map((r) => [r]), styles: { fontSize: 8 } })
      const bytes = doc.output('arraybuffer')
      await writeFileRef!(target, new Uint8Array(bytes))
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 selection:bg-indigo-100 overflow-hidden flex flex-col">
      <TopNavbar />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar
          inputMode={inputMode}
          setInputMode={setInputMode}
          targetPath={targetPath}
          setTargetPath={setTargetPath}
          snippetCode={snippetCode}
          setSnippetCode={setSnippetCode}
          snippetLanguage={snippetLanguage}
          setSnippetLanguage={setSnippetLanguage}
          loading={loading}
          error={error}
          history={history}
          historyDetail={historyDetail}
          onPickFolder={onPickFolder}
          onPickFile={onPickFile}
          onAnalyze={onAnalyze}
          onViewHistoryDetail={onViewHistoryDetail}
          onDeleteHistory={onDeleteHistory}
          onClearHistory={onClearHistory}
        />
        <MainContent
          displayedResult={displayedResult}
          historyDetail={historyDetail}
          targetPath={targetPath}
          pagedFunctions={pagedFunctions}
          selectedFunctionKey={selectedFunctionKey}
          setSelectedFunctionKey={setSelectedFunctionKey}
          onExportExcel={onExportExcel}
          onExportPdf={onExportPdf}
          onExportJson={onExportJson}
          pagedFiles={pagedFiles}
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
          allFunctions={allFunctions}
        />
      </div>
    </div>
  )
}

export default App
