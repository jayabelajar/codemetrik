import { useEffect, useMemo, useState } from 'react'
import 'reactflow/dist/style.css'
import './App.css'
import { AppSidebar } from './components/layout/AppSidebar'
import { MainContent } from './components/layout/MainContent'
import { TopNavbar } from './components/layout/TopNavbar'
import { analyzePath, analyzeSnippet, clearHistory, deleteHistoryItem, formatTauriError, getHistory, getHistoryDetail, pickFile, pickFolder, saveBytes } from './lib/tauriClient'
import type { AnalysisResult, FunctionMetric, HistoryDetail, HistoryItem, InputMode, SnippetLanguage } from './types/analysis'
import { buildCsvBytes, buildExcelBytes, buildJsonBytes, buildPdfBytes } from './utils/exporters'

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
      const data = await getHistory(30)
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
      const data = inputMode === 'snippet'
        ? await analyzeSnippet(snippetLanguage, snippetCode)
        : await analyzePath(targetPath)
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
      await loadHistory()
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onClearHistory = async () => {
    try {
      await clearHistory()
      setHistoryDetail(null)
      await loadHistory()
    } catch (err) {
      setError(formatTauriError(err))
    }
  }

  const onExportExcel = async () => {
    if (!displayedResult) return
    try {
      const context = {
        source: historyDetail?.project_path || targetPath || 'snippet',
        generatedAt: new Date().toISOString(),
        analyzerVersion: 'codemetrik-v1',
      }
      const bytes = buildExcelBytes(displayedResult, context)
      await saveBytes(`codemetrik-${Date.now()}.xlsx`, [{ name: 'Excel', extensions: ['xlsx'] }], bytes)
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
          selectedFunctionKey={selectedFunctionKey}
          setSelectedFunctionKey={setSelectedFunctionKey}
          onExportExcel={onExportExcel}
          onExportCsv={onExportCsv}
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
