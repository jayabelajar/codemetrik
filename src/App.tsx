import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import ReactFlow, { Controls, Background, MarkerType, type Edge, type Node } from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import './App.css'
import { 
  LayoutDashboard, FolderOpen, FileCode2, TerminalSquare, History, 
  PieChart, Activity, Code2, BrainCircuit, 
  ChevronRight, ChevronLeft, FileSpreadsheet, FileJson2, 
  FileDown, Trash2, AlertCircle, Search, Settings2,
  FileBox, ShieldAlert, RefreshCw
} from 'lucide-react'

type FlowNode = { id: string; label: string }
type FlowEdge = { from: string; to: string; label: string }
type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; independent_paths: number }

type FunctionMetric = {
  file: string
  name: string
  predicate_count: number
  vg: number
  complexity_category: 'Good' | 'Moderate' | 'Complex'
  flowgraph: FlowGraph
}

type HalsteadDetail = {
  n1: number
  n2: number
  N1: number
  N2: number
  program_length: number
  vocabulary: number
  volume: number
  difficulty: number
  effort: number
}

type FileMetric = {
  file: string
  loc: number
  language: string
  function_count: number
  complexity_score: number
  complexity_category: string
  predicate_count: number
  maintainability_index: number
  maintainability_category: string
  halstead_detail: HalsteadDetail | null
  functions: FunctionMetric[]
}

type AnalysisSummary = {
  scanned_files: number
  total_loc: number
  total_functions: number
  avg_complexity: number
  avg_maintainability: number
  avg_halstead_volume: number
  most_complex_file: string
  complexity_distribution: { Good: number; Moderate: number; Complex: number }
  mi_distribution: { Excellent: number; Good: number; Warning: number; Poor: number }
  top_complex_functions: FunctionMetric[]
}

type AnalysisResult = {
  summary: AnalysisSummary
  files: FileMetric[]
  recommendations: string[]
}

type HistoryItem = {
  id: number
  analyzed_at: string
  project_path: string
  scanned_files: number
  avg_complexity: number
  avg_maintainability: number
}

type HistoryDetail = {
  id: number
  analyzed_at: string
  project_path: string
  result: AnalysisResult
}

type InputMode = 'folder' | 'file' | 'snippet'
type SnippetLanguage = 'python' | 'javascript' | 'typescript' | 'php'

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

function buildAcademicLayout(flowNodes: FlowNode[], flowEdges: FlowEdge[]) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of flowNodes) {
    g.setNode(node.id, { width: 56, height: 56 })
  }
  for (const edge of flowEdges) {
    g.setEdge(edge.from, edge.to)
  }
  dagre.layout(g)

  const orderedIds = [...flowNodes].map((n) => n.id)
  const idToNumber = new Map<string, number>()
  orderedIds.forEach((id, idx) => idToNumber.set(id, idx + 1))

  const nodes: Node[] = flowNodes.map((n) => {
    const pos = g.node(n.id)
    return {
      id: n.id,
      data: { label: String(idToNumber.get(n.id) ?? '?') },
      position: { x: pos.x - 28, y: pos.y - 28 },
      draggable: true,
      className: 'cfg-node',
    }
  })
  const edges: Edge[] = flowEdges.map((e, idx) => ({
    id: `${e.from}-${e.to}-${idx}`,
    source: e.from,
    target: e.to,
    label: e.label,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#334155' },
    style: { stroke: '#475569', strokeWidth: 2 },
    labelStyle: { fill: '#0f172a', fontSize: 11, fontWeight: 600, fillOpacity: 0.8 },
  }))
  const legend = orderedIds.map((id) => {
    const src = flowNodes.find((n) => n.id === id)
    return { no: idToNumber.get(id) ?? 0, label: src?.label ?? id }
  })
  return { nodes, edges, legend }
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
  const pageSize = 10 // Reduced for cleaner look

  const displayedResult = historyDetail?.result ?? result
  const sortedFiles = useMemo(() => displayedResult ? [...displayedResult.files].sort((a, b) => b.complexity_score - a.complexity_score) : [], [displayedResult])
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

  useEffect(() => { setCurrentPage(1); setFunctionPage(1) }, [displayedResult])
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

  const selectedFunction = useMemo(() => allFunctions.find((f) => `${f.file}::${f.name}` === selectedFunctionKey) ?? null, [allFunctions, selectedFunctionKey])
  const highlightedPathNodeIds = useMemo(() => {
    if (!selectedFunction) return new Set<string>()
    const ids = new Set<string>(['start'])
    for (let i = 1; i <= Math.max(selectedFunction.predicate_count, 0); i++) ids.add(`p${i}`)
    ids.add('end')
    return ids
  }, [selectedFunction])

  const flowView = useMemo(() => {
    const flow = selectedFunction?.flowgraph
    if (!flow) return { nodes: [] as Node[], edges: [] as Edge[], legend: [] as Array<{ no: number; label: string }> }
    const base = buildAcademicLayout(flow.nodes, flow.edges)
    const nodes = base.nodes.map((n) =>
      highlightedPathNodeIds.has(n.id)
        ? { ...n, className: `${n.className ?? ''} cfg-node-highlight`.trim() }
        : n,
    )
    return { nodes, edges: base.edges, legend: base.legend }
  }, [selectedFunction, highlightedPathNodeIds])

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
    setLoading(true); setError(null); setHistoryDetail(null)
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
    } finally { setLoading(false) }
  }

  const onPickFolder = async () => { try { await ensureTauriApi(); const selected = await dialogOpenRef!({ directory: true, multiple: false }); if (selected && typeof selected === 'string') { setTargetPath(selected); setInputMode('folder') } } catch (err) { setError(formatTauriError(err)) } }
  const onPickFile = async () => { try { await ensureTauriApi(); const selected = await dialogOpenRef!({ directory: false, multiple: false, filters: [{ name: 'Source', extensions: ['py', 'js', 'ts', 'php'] }] }); if (selected && typeof selected === 'string') { setTargetPath(selected); setInputMode('file') } } catch (err) { setError(formatTauriError(err)) } }
  const onViewHistoryDetail = async (id: number) => { try { await ensureTauriApi(); const detail = await invokeRef!<HistoryDetail>('get_history_detail', { id }); setHistoryDetail(detail); setResult(null) } catch (err) { setError(formatTauriError(err)) } }
  const onDeleteHistory = async (id: number) => { try { await ensureTauriApi(); await invokeRef!('delete_history_item', { id }); if (historyDetail?.id === id) setHistoryDetail(null); await loadHistory() } catch (err) { setError(formatTauriError(err)) } }
  const onClearHistory = async () => { try { await ensureTauriApi(); await invokeRef!('clear_history'); setHistoryDetail(null); await loadHistory() } catch (err) { setError(formatTauriError(err)) } }

  const exportRows = useMemo(() => sortedFiles.map((item) => ({
    File: item.file, Language: item.language, LOC: item.loc, Functions: item.function_count,
    Predicate: item.predicate_count, Cyclomatic: item.complexity_score, ComplexityCategory: item.complexity_category,
    MI: Number(item.maintainability_index.toFixed(2)), MICategory: item.maintainability_category,
    n1: item.halstead_detail?.n1 ?? 'N/A', n2: item.halstead_detail?.n2 ?? 'N/A',
    N1: item.halstead_detail?.N1 ?? 'N/A', N2: item.halstead_detail?.N2 ?? 'N/A',
    ProgramLength: item.halstead_detail?.program_length ?? 'N/A', Vocabulary: item.halstead_detail?.vocabulary ?? 'N/A',
    HalsteadVolume: item.halstead_detail?.volume ?? 'N/A', HalsteadDifficulty: item.halstead_detail?.difficulty ?? 'N/A', HalsteadEffort: item.halstead_detail?.effort ?? 'N/A',
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
    } catch (err) { setError(formatTauriError(err)) }
  }

  const onExportJson = async () => {
    if (!displayedResult) return
    try {
      await ensureTauriApi()
      const target = await dialogSaveRef!({ defaultPath: `codemetrik-${Date.now()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (!target) return
      const bytes = new TextEncoder().encode(JSON.stringify(displayedResult, null, 2))
      await writeFileRef!(target, bytes)
    } catch (err) { setError(formatTauriError(err)) }
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
    } catch (err) { setError(formatTauriError(err)) }
  }

  const getMetricColor = (score: number, type: 'vg' | 'mi') => {
    if (type === 'vg') {
      if (score <= 10) return 'text-emerald-600 bg-emerald-50 border-emerald-100'
      if (score <= 20) return 'text-amber-600 bg-amber-50 border-amber-100'
      return 'text-rose-600 bg-rose-50 border-rose-100'
    } else {
      if (score >= 85) return 'text-emerald-600 bg-emerald-50 border-emerald-100'
      if (score >= 65) return 'text-sky-600 bg-sky-50 border-sky-100'
      if (score >= 45) return 'text-amber-600 bg-amber-50 border-amber-100'
      return 'text-rose-600 bg-rose-50 border-rose-100'
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 selection:bg-indigo-100 overflow-hidden flex flex-col">
      {/* Top Navigation Navbar */}
      <nav className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-50 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-200 text-white">
            <BrainCircuit size={22} className="stroke-[2.5]" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-slate-900 leading-tight">CodeMetric Studio</h1>
            <p className="text-xs text-slate-500 font-medium">Enterprise Code Quality Toolkit</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-full font-medium border border-slate-200/50">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
            Engine Operational
          </div>
        </div>
      </nav>

      {/* Main App Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto">
          {/* Configuration Panel */}
          <div className="p-5 border-b border-slate-100 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Settings2 size={16} className="text-indigo-600" /> Analysis Source
              </h2>
              <div className="flex p-1 bg-slate-100 rounded-lg shadow-inner">
                {(['folder', 'file', 'snippet'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setInputMode(mode)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-1 text-xs font-medium transition-all rounded-md duration-200 ${
                      inputMode === mode ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {mode === 'folder' && <FolderOpen size={13} />}
                    {mode === 'file' && <FileCode2 size={13} />}
                    {mode === 'snippet' && <TerminalSquare size={13} />}
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {inputMode !== 'snippet' ? (
                <>
                  <div className="relative">
                    <input
                      type="text"
                      value={targetPath}
                      onChange={(e) => setTargetPath(e.target.value)}
                      placeholder={inputMode === 'folder' ? 'Select workspace...' : 'Select source file...'}
                      className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700"
                    />
                    <Search className="absolute right-3 top-3 text-slate-400" size={16} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={inputMode === 'folder' ? onPickFolder : onPickFile}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors"
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      onClick={onAnalyze}
                      disabled={loading || !targetPath}
                      className="flex-[1.5] flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-slate-900 text-white rounded-xl text-sm font-semibold shadow-sm active:scale-[0.98] transition-all"
                    >
                      {loading ? <RefreshCw size={16} className="animate-spin" /> : <Activity size={16} />}
                      {loading ? 'Analyzing...' : 'Analyze'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <select
                      value={snippetLanguage}
                      onChange={(e) => setSnippetLanguage(e.target.value as SnippetLanguage)}
                      className="w-32 pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 appearance-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    >
                      <option value="python">Python</option>
                      <option value="javascript">JS</option>
                      <option value="typescript">TS</option>
                      <option value="php">PHP</option>
                    </select>
                    <button
                      type="button"
                      onClick={onAnalyze}
                      disabled={loading || !snippetCode.trim()}
                      className="flex-1 flex items-center justify-center gap-2 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
                    >
                      {loading ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />}
                      Run Analysis
                    </button>
                  </div>
                  <textarea
                    value={snippetCode}
                    onChange={(e) => setSnippetCode(e.target.value)}
                    placeholder="// Paste your source code here..."
                    className="w-full h-48 p-3 bg-slate-900 text-slate-50 rounded-xl text-xs font-mono placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500/30 border-none outline-none resize-none"
                  />
                </>
              )}
            </div>
            
            {error && (
              <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <p className="leading-relaxed font-medium">{error}</p>
              </div>
            )}
          </div>

          {/* History Section */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 pb-2 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <History size={16} className="text-indigo-600" />
                <span>History</span>
                <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{history.length}</span>
              </div>
              {history.length > 0 && (
                <button onClick={onClearHistory} className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold transition-colors flex items-center gap-1">
                  Clear
                </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2 text-center p-4">
                  <FileBox size={32} className="opacity-30" />
                  <p className="text-xs font-medium leading-relaxed">No recent history.<br/>Scan a repository to get started.</p>
                </div>
              ) : (
                history.map((item) => (
                  <div 
                    key={item.id}
                    className={`group relative p-3 rounded-xl border transition-all duration-200 cursor-pointer hover:shadow-md ${
                      historyDetail?.id === item.id 
                        ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-100' 
                        : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-slate-50/50'
                    }`}
                    onClick={() => onViewHistoryDetail(item.id)}
                  >
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <div className="truncate">
                        <div className="flex items-center gap-1.5 text-slate-900 text-xs font-bold truncate">
                          <FolderOpen size={12} className={historyDetail?.id === item.id ? 'text-indigo-600' : 'text-slate-400'} />
                          {item.project_path.split(/[/\\]/).pop() || item.project_path}
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium mt-0.5 flex items-center gap-1">
                          {new Date(item.analyzed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onDeleteHistory(item.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all shrink-0"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-200/50 text-[10px] font-semibold">
                      <div className="flex items-center justify-between bg-white rounded-md px-1.5 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-slate-100">
                        <span className="text-slate-400">Complexity</span>
                        <span className={item.avg_complexity > 10 ? 'text-rose-600' : 'text-emerald-600'}>{item.avg_complexity.toFixed(1)}</span>
                      </div>
                      <div className="flex items-center justify-between bg-white rounded-md px-1.5 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-slate-100">
                        <span className="text-slate-400">Files</span>
                        <span className="text-indigo-600">{item.scanned_files}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Main Workspace Panel */}
        <main className="flex-1 flex flex-col bg-[#F8FAFC] overflow-y-auto relative">
          {!displayedResult ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
              <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center shadow-lg shadow-indigo-100/50 border border-indigo-100 mb-6">
                <LayoutDashboard size={36} />
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Welcome to Studio</h2>
              <p className="text-slate-500 max-w-md mx-auto leading-relaxed mb-8 font-medium text-sm">
                Select a project folder, a source file, or paste a code snippet on the left sidebar to initiate a comprehensive static analysis.
              </p>
              <div className="grid grid-cols-2 gap-4 text-left max-w-lg w-full">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-2 text-indigo-700">
                    <ShieldAlert size={18} />
                    <h3 className="font-bold text-sm">Full Support</h3>
                  </div>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed mb-3">Comprehensive metrics, graphs and AI recommendations.</p>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-700 border border-slate-200">PHP</span>
                    <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-700 border border-slate-200">Python</span>
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-2 text-emerald-700">
                    <Code2 size={18} />
                    <h3 className="font-bold text-sm">Partial Support</h3>
                  </div>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed mb-3">Core complexity analysis and maintainability evaluation.</p>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-700 border border-slate-200">JavaScript</span>
                    <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-700 border border-slate-200">TypeScript</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full duration-500">
              {/* Dashboard Top Banner Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Analysis Overview</h2>
                  <p className="text-sm text-slate-500 font-medium flex items-center gap-2 mt-1">
                    <FolderOpen size={14} /> {historyDetail?.project_path || targetPath || 'Code Snippet'}
                  </p>
                </div>
                <div className="flex gap-2 bg-white p-1.5 border border-slate-200 rounded-xl shadow-sm shrink-0 self-start sm:self-center">
                  <button onClick={onExportExcel} className="p-2 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold" title="Export to Excel">
                    <FileSpreadsheet size={16} />
                    <span className="hidden md:inline">Excel</span>
                  </button>
                  <button onClick={onExportPdf} className="p-2 text-slate-600 hover:bg-rose-50 hover:text-rose-700 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold" title="Export PDF">
                    <FileDown size={16} />
                    <span className="hidden md:inline">PDF</span>
                  </button>
                  <button onClick={onExportJson} className="p-2 text-slate-600 hover:bg-amber-50 hover:text-amber-700 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold" title="Export JSON">
                    <FileJson2 size={16} />
                    <span className="hidden md:inline">JSON</span>
                  </button>
                </div>
              </div>

              {/* Scorecards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                  <div className="absolute right-0 bottom-0 translate-x-1/4 translate-y-1/4 text-slate-50 opacity-50 group-hover:text-indigo-50 transition-colors">
                    <FileCode2 size={100} />
                  </div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Assets</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-3xl font-extrabold text-slate-900">{displayedResult.summary.scanned_files}</h3>
                    <span className="text-xs text-slate-500 font-semibold">Files Scanned</span>
                  </div>
                  <div className="mt-3 flex items-center text-xs font-medium text-slate-500 bg-slate-50 w-fit px-2 py-1 rounded-md border border-slate-100">
                    {displayedResult.summary.total_functions} total functions
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Cyclomatic</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className={`text-3xl font-extrabold ${displayedResult.summary.avg_complexity > 10 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {displayedResult.summary.avg_complexity.toFixed(2)}
                    </h3>
                  </div>
                  <div className="mt-3">
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                      {(() => {
                        const total = displayedResult.summary.complexity_distribution.Good + displayedResult.summary.complexity_distribution.Moderate + displayedResult.summary.complexity_distribution.Complex || 1
                        return (
                          <>
                            <div className="bg-emerald-500 h-full" style={{ width: `${(displayedResult.summary.complexity_distribution.Good / total) * 100}%` }}></div>
                            <div className="bg-amber-400 h-full" style={{ width: `${(displayedResult.summary.complexity_distribution.Moderate / total) * 100}%` }}></div>
                            <div className="bg-rose-500 h-full" style={{ width: `${(displayedResult.summary.complexity_distribution.Complex / total) * 100}%` }}></div>
                          </>
                        )
                      })()}
                    </div>
                    <div className="flex justify-between text-[9px] font-bold text-slate-400 mt-1.5">
                      <span>G: {displayedResult.summary.complexity_distribution.Good}</span>
                      <span>M: {displayedResult.summary.complexity_distribution.Moderate}</span>
                      <span>C: {displayedResult.summary.complexity_distribution.Complex}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Maintainability Index</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className={`text-3xl font-extrabold ${displayedResult.summary.avg_maintainability >= 65 ? 'text-emerald-600' : displayedResult.summary.avg_maintainability >= 45 ? 'text-amber-500' : 'text-rose-600'}`}>
                      {displayedResult.summary.avg_maintainability.toFixed(2)}
                    </h3>
                  </div>
                  <div className="mt-3">
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                      {(() => {
                        const sum = displayedResult.summary.mi_distribution
                        const total = sum.Excellent + sum.Good + sum.Warning + sum.Poor || 1
                        return (
                          <>
                            <div className="bg-emerald-500 h-full" style={{ width: `${(sum.Excellent / total) * 100}%` }}></div>
                            <div className="bg-sky-500 h-full" style={{ width: `${(sum.Good / total) * 100}%` }}></div>
                            <div className="bg-amber-400 h-full" style={{ width: `${(sum.Warning / total) * 100}%` }}></div>
                            <div className="bg-rose-500 h-full" style={{ width: `${(sum.Poor / total) * 100}%` }}></div>
                          </>
                        )
                      })()}
                    </div>
                    <div className="flex justify-between text-[9px] font-bold text-slate-400 mt-1.5">
                      <span className="text-emerald-600">{displayedResult.summary.mi_distribution.Excellent + displayedResult.summary.mi_distribution.Good} High</span>
                      <span className="text-rose-500">{displayedResult.summary.mi_distribution.Warning + displayedResult.summary.mi_distribution.Poor} Low</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Critical Focus</p>
                  <div className="text-sm font-bold text-slate-800 truncate mt-1" title={displayedResult.summary.most_complex_file}>
                    {displayedResult.summary.most_complex_file ? displayedResult.summary.most_complex_file.split(/[/\\]/).pop() : '-'}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 mb-2">Most complex file identified</p>
                  <div className="text-xs font-medium flex gap-2 mt-auto">
                     <span className="bg-rose-50 text-rose-700 border border-rose-100 px-2 py-0.5 rounded-full text-[10px] font-bold">Refactoring Needed</span>
                  </div>
                </div>
              </div>

              {/* Middle Section: Recommendations & Charts Split */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
                    <PieChart size={18} className="text-indigo-600" />
                    <h3 className="font-bold text-slate-900 text-sm">Actionable Refactoring Recommendations</h3>
                  </div>
                  <div className="p-6 space-y-3">
                    {displayedResult.recommendations.length === 0 ? (
                      <p className="text-sm text-slate-500 italic">Everything looks excellent. No recommendations generated.</p>
                    ) : (
                      displayedResult.recommendations.map((rec, i) => (
                        <div key={i} className="flex items-start gap-3 bg-white p-3.5 rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:border-indigo-100 transition-colors">
                          <div className="h-6 w-6 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 border border-indigo-100 mt-0.5">
                            {i + 1}
                          </div>
                          <p className="text-sm text-slate-700 font-medium leading-relaxed pt-0.5">{rec}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
                    <Activity size={18} className="text-indigo-600" />
                    <h3 className="font-bold text-slate-900 text-sm">Top Complex Functions</h3>
                  </div>
                  <div className="p-4 flex-1 space-y-2.5 overflow-y-auto max-h-[320px]">
                    {pagedFunctions.slice(0, 6).map((fn, idx) => (
                      <div key={idx} className="group flex flex-col gap-1 bg-slate-50 p-3 rounded-xl border border-slate-100 hover:bg-indigo-50/30 transition-all cursor-pointer" onClick={() => setSelectedFunctionKey(`${fn.file}::${fn.name}`)}>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-800 truncate flex items-center gap-1">
                            <TerminalSquare size={12} className="text-indigo-500 shrink-0" />
                            {fn.name}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${getMetricColor(fn.vg, 'vg')}`}>
                            VG: {fn.vg}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium truncate font-mono">{fn.file.split(/[/\\]/).pop()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Detailed File Table */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h3 className="font-bold text-slate-900 text-sm">Metric Assessment Per File</h3>
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">Page {currentPage} / {totalPages}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50/50 text-slate-500 text-xs font-bold border-b border-slate-200">
                        <th className="py-3 px-4 font-bold">FILE PATH</th>
                        <th className="py-3 px-3 text-center">LANGUAGE</th>
                        <th className="py-3 px-3 text-center">LOC</th>
                        <th className="py-3 px-3 text-center">V(G)</th>
                        <th className="py-3 px-3 text-center">M.I</th>
                        <th className="py-3 px-3 text-center">DIFFICULTY</th>
                        <th className="py-3 px-3 text-center">EFFORT</th>
                        <th className="py-3 px-4 text-right">STATUS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagedFiles.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="py-3.5 px-4 font-medium text-slate-700 max-w-xs truncate text-xs" title={item.file}>{item.file}</td>
                          <td className="py-3.5 px-3 text-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{item.language}</span>
                          </td>
                          <td className="py-3.5 px-3 text-center font-mono text-xs text-slate-600">{item.loc}</td>
                          <td className="py-3.5 px-3 text-center">
                            <span className={`font-bold text-xs ${item.complexity_score > 10 ? 'text-rose-600' : 'text-slate-700'}`}>
                              {item.complexity_score}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-center">
                             <span className={`font-bold text-xs ${item.maintainability_index < 65 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {item.maintainability_index.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-center text-slate-500 text-xs font-medium">
                            {item.halstead_detail?.difficulty ? Number(item.halstead_detail.difficulty).toFixed(1) : '-'}
                          </td>
                          <td className="py-3.5 px-3 text-center text-slate-500 text-xs font-medium">
                            {item.halstead_detail?.effort ? Number(item.halstead_detail.effort).toLocaleString(undefined, {maximumFractionDigits:0}) : '-'}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getMetricColor(item.maintainability_index, 'mi')}`}>
                              {item.maintainability_category}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-white">
                  <button 
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 transition-all disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className="text-xs font-medium text-slate-500">Showing {pagedFiles.length} files</span>
                  <button 
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 transition-all disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              {/* Flowgraph & Deep Dive Analyzer */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-10">
                <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
                  <div className="flex items-center gap-2">
                    <BrainCircuit size={18} className="text-indigo-600" />
                    <h3 className="font-bold text-slate-900 text-sm">Control Flowgraph (CFG) Visualization</h3>
                  </div>
                  <div className="flex items-center gap-3 min-w-0">
                    <select 
                      value={selectedFunctionKey} 
                      onChange={(e) => setSelectedFunctionKey(e.target.value)}
                      disabled={allFunctions.length === 0}
                      className="text-xs border border-slate-200 rounded-lg py-1.5 pl-3 pr-8 bg-white text-slate-700 font-medium outline-none focus:ring-2 focus:ring-indigo-500/20 max-w-[300px] truncate"
                    >
                      {allFunctions.length === 0 ? (
                        <option value="">No functions detected</option>
                      ) : (
                        allFunctions.map((fn, idx) => (
                          <option key={idx} value={`${fn.file}::${fn.name}`}>
                            {fn.name} ({fn.file.split(/[/\\]/).pop()})
                          </option>
                        ))
                      )}
                    </select>
                    {selectedFunction && (
                      <span className="text-[11px] font-bold bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md shrink-0">
                        Paths: {selectedFunction.flowgraph.independent_paths}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-0 h-[500px]">
                  <div className="lg:col-span-3 relative bg-slate-50 border-r border-slate-200">
                    {selectedFunction ? (
                      <ReactFlow 
                        nodes={flowView.nodes} 
                        edges={flowView.edges} 
                        fitView
                        proOptions={{ hideAttribution: true }}
                      >
                        <Background color="#cbd5e1" gap={16} size={1} />
                        <Controls className="!border-slate-200 !shadow-sm !bg-white !rounded-lg overflow-hidden" />
                      </ReactFlow>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-3">
                        <Activity size={40} className="opacity-20" />
                        <p className="text-sm font-medium">No control flow data available to visualize.</p>
                      </div>
                    )}
                  </div>

                  <div className="bg-white flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500 tracking-wider flex items-center justify-between">
                      NODE IDENTIFIERS
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                      {selectedFunction ? (
                        flowView.legend.length > 0 ? (
                          flowView.legend.map((item) => (
                            <div key={item.no} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group border border-transparent hover:border-slate-100">
                              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-sm border transition-all ${
                                highlightedPathNodeIds.has(`p${item.no}`) || item.label === 'start' || item.label === 'end' 
                                ? 'bg-indigo-600 text-white border-indigo-700 shadow-indigo-200' 
                                : 'bg-slate-900 text-slate-50 border-slate-800'
                              }`}>
                                {item.no}
                              </div>
                              <div className="text-xs font-medium text-slate-700 truncate font-mono tracking-tight" title={item.label}>
                                {item.label}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-10 text-xs text-slate-400">No identifiers for this graph.</div>
                        )
                      ) : (
                        <div className="text-center py-10 text-xs text-slate-400">Select a function.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App


