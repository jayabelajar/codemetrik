import { useEffect, useMemo, useState } from 'react'
import 'reactflow/dist/style.css'
import './App.css'
import { AppSidebar } from './components/layout/AppSidebar'
import { MainContent } from './components/layout/MainContent'
import { TopNavbar } from './components/layout/TopNavbar'
import { analyzePath, analyzeSnippet, clearHistory, deleteHistoryItem, formatTauriError, getHistory, getHistoryDetail, pickFile, pickFolder, saveBytes } from './lib/tauriClient'
import type { AnalysisResult, FunctionMetric, HistoryDetail, HistoryItem, InputMode, SnippetLanguage } from './types/analysis'
import { clampPage, getEffectiveSelectedFunctionKey } from './utils/appState'

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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedFiles.length / pageSize)), [sortedFiles.length])
  const functionTotalPages = useMemo(() => Math.max(1, Math.ceil(allFunctions.length / pageSize)), [allFunctions.length])
  const safeCurrentPage = useMemo(() => clampPage(currentPage, totalPages), [currentPage, totalPages])
  const safeFunctionPage = useMemo(() => clampPage(functionPage, functionTotalPages), [functionPage, functionTotalPages])
  const pagedFiles = useMemo(
    () => sortedFiles.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize),
    [sortedFiles, safeCurrentPage],
  )
  const pagedFunctions = useMemo(
    () => allFunctions.slice((safeFunctionPage - 1) * pageSize, safeFunctionPage * pageSize),
    [allFunctions, safeFunctionPage],
  )
  const effectiveSelectedFunctionKey = useMemo(() => {
    return getEffectiveSelectedFunctionKey(allFunctions, selectedFunctionKey)
  }, [allFunctions, selectedFunctionKey])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await getHistory(30)
        if (!cancelled) setHistory(data)
      } catch {
        if (!cancelled) setHistory([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const onAnalyze = async () => {
    setLoading(true)
    setError(null)
    setHistoryDetail(null)
    setCurrentPage(1)
    setFunctionPage(1)
    setSelectedFunctionKey('')
    try {
      const data = inputMode === 'snippet'
        ? await analyzeSnippet(snippetLanguage, snippetCode)
        : await analyzePath(targetPath)
      setResult(data)
      try {
        const refreshed = await getHistory(30)
        setHistory(refreshed)
      } catch {
        setHistory([])
      }
    } catch (err) {
      setResult(null)
      setError(formatTauriError(err))
    } finally {
      setLoading(false)
    }
  }

  const onPickFolder = async () => {
    try {
      const selected = await pickFolder()
      if (selected) {
        setTargetPath(selected)
        setInputMode('folder')
      }
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onPickFile = async () => {
    try {
      const selected = await pickFile()
      if (selected) {
        setTargetPath(selected)
        setInputMode('file')
      }
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onViewHistoryDetail = async (id: number) => {
    try {
      const detail = await getHistoryDetail(id)
      setCurrentPage(1)
      setFunctionPage(1)
      setSelectedFunctionKey('')
      setHistoryDetail(detail)
      setResult(null)
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onDeleteHistory = async (id: number) => {
    try {
      await deleteHistoryItem(id)
      if (historyDetail?.id === id) setHistoryDetail(null)
      try {
        const refreshed = await getHistory(30)
        setHistory(refreshed)
      } catch {
        setHistory([])
      }
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onClearHistory = async () => {
    try {
      await clearHistory()
      setHistoryDetail(null)
      setHistory([])
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onExportJson = async () => {
    if (!displayedResult) return
    try {
      const context = {
        source: historyDetail?.project_path || targetPath || 'snippet',
        generatedAt: new Date().toISOString(),
        analyzerVersion: 'codemetrik-v1',
      }
      const { buildJsonBytes } = await import('./utils/exporters')
      const bytes = buildJsonBytes(displayedResult, context)
      await saveBytes(`codemetrik-${Date.now()}.json`, [{ name: 'JSON', extensions: ['json'] }], bytes)
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onExportCsv = async () => {
    if (!displayedResult) return
    try {
      const context = {
        source: historyDetail?.project_path || targetPath || 'snippet',
        generatedAt: new Date().toISOString(),
        analyzerVersion: 'codemetrik-v1',
      }
      const { buildCsvBytes } = await import('./utils/exporters')
      const bytes = buildCsvBytes(displayedResult, context)
      await saveBytes(`codemetrik-${Date.now()}.csv`, [{ name: 'CSV', extensions: ['csv'] }], bytes)
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onExportPdf = async () => {
    if (!displayedResult) return
    try {
      const context = {
        source: historyDetail?.project_path || targetPath || 'snippet',
        generatedAt: new Date().toISOString(),
        analyzerVersion: 'codemetrik-v1',
      }
      const { buildPdfBytes } = await import('./utils/exporters')
      const bytes = buildPdfBytes(displayedResult, context)
      await saveBytes(`codemetrik-${Date.now()}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], bytes)
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  return (
    <div className="h-screen bg-[#F8FAFC] text-slate-900 selection:bg-indigo-100 overflow-hidden flex flex-col">
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
          selectedFunctionKey={effectiveSelectedFunctionKey}
          setSelectedFunctionKey={setSelectedFunctionKey}
          onExportCsv={onExportCsv}
          onExportPdf={onExportPdf}
          onExportJson={onExportJson}
          pagedFiles={pagedFiles}
          currentPage={safeCurrentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
          allFunctions={allFunctions}
        />
      </div>
      <footer className="h-9 border-t border-slate-200 bg-white/90 px-6 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
        <span>Copyright © {new Date().getFullYear()} CodeMetric Studio</span>
        <span>Built by Jayadev</span>
      </footer>
    </div>
  )
}

export default App
