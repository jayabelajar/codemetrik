import { useMemo, useState } from 'react'
import { Activity, BrainCircuit, ChevronLeft, ChevronRight, Code2, FileCode2, FileDown, FileJson2, FileSpreadsheet, FolderOpen, LayoutDashboard, PieChart, ShieldAlert, TerminalSquare } from 'lucide-react'
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow'
import dagre from 'dagre'
import type { AnalysisResult, FunctionMetric, HistoryDetail } from '../../types/analysis'

type MainContentProps = {
  displayedResult: AnalysisResult | null
  historyDetail: HistoryDetail | null
  targetPath: string
  pagedFunctions: FunctionMetric[]
  selectedFunctionKey: string
  setSelectedFunctionKey: (value: string) => void
  onExportCsv: () => Promise<void>
  onExportPdf: () => Promise<void>
  onExportJson: () => Promise<void>
  pagedFiles: AnalysisResult['files']
  currentPage: number
  totalPages: number
  setCurrentPage: (fn: (prev: number) => number) => void
  allFunctions: FunctionMetric[]
}

type MetricTab = 'overview' | 'cyclomatic' | 'halstead'

function getMetricColor(score: number, type: 'vg' | 'mi') {
  if (type === 'vg') {
    if (score <= 10) return 'text-emerald-600 bg-emerald-50 border-emerald-100'
    if (score <= 20) return 'text-amber-600 bg-amber-50 border-amber-100'
    return 'text-rose-600 bg-rose-50 border-rose-100'
  }
  if (score >= 85) return 'text-emerald-600 bg-emerald-50 border-emerald-100'
  if (score >= 65) return 'text-sky-600 bg-sky-50 border-sky-100'
  if (score >= 45) return 'text-amber-600 bg-amber-50 border-amber-100'
  return 'text-rose-600 bg-rose-50 border-rose-100'
}

function buildAcademicLayout(flowNodes: { id: string; label: string }[], flowEdges: { from: string; to: string; label: string }[]) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of flowNodes) g.setNode(node.id, { width: 56, height: 56 })
  for (const edge of flowEdges) g.setEdge(edge.from, edge.to)
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

export function MainContent(props: MainContentProps) {
  const {
    displayedResult, historyDetail, targetPath, pagedFunctions, selectedFunctionKey, setSelectedFunctionKey,
    onExportCsv, onExportPdf, onExportJson, pagedFiles, currentPage, totalPages, setCurrentPage, allFunctions,
  } = props

  const [activeTab, setActiveTab] = useState<MetricTab>('overview')

  const selectedFunction = useMemo(
    () => allFunctions.find((f) => `${f.file}::${f.name}` === selectedFunctionKey) ?? null,
    [allFunctions, selectedFunctionKey],
  )

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
    const nodes = base.nodes.map((n) => highlightedPathNodeIds.has(n.id)
      ? { ...n, className: `${n.className ?? ''} cfg-node-highlight`.trim() }
      : n)
    return { nodes, edges: base.edges, legend: base.legend }
  }, [selectedFunction, highlightedPathNodeIds])

  if (!displayedResult) {
    return (
      <main className="flex-1 flex flex-col bg-[#F8FAFC] overflow-y-auto relative">
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
              <div className="flex items-center gap-2 mb-2 text-indigo-700"><ShieldAlert size={18} /><h3 className="font-bold text-sm">Full Support</h3></div>
              <p className="text-xs text-slate-500 font-medium leading-relaxed mb-3">Comprehensive metrics, graphs and AI recommendations.</p>
              <div className="flex gap-2"><span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-700 border border-slate-200">PHP</span><span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-700 border border-slate-200">Python</span></div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-emerald-700"><Code2 size={18} /><h3 className="font-bold text-sm">Supported</h3></div>
              <p className="text-xs text-slate-500 font-medium leading-relaxed mb-3">Core complexity analysis and maintainability evaluation.</p>
              <div className="flex gap-2"><span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-700 border border-slate-200">JavaScript</span></div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col bg-[#F8FAFC] overflow-y-auto relative">
      <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Analysis Overview</h2>
            <p className="text-sm text-slate-500 font-medium flex items-center gap-2 mt-1"><FolderOpen size={14} /> {historyDetail?.project_path || targetPath || 'Code Snippet'}</p>
          </div>
          <div className="flex gap-2 bg-white p-1.5 border border-slate-200 rounded-xl shadow-sm shrink-0 self-start sm:self-center">
            <button onClick={() => void onExportCsv()} className="p-2 text-slate-600 hover:bg-cyan-50 hover:text-cyan-700 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold" title="Export CSV"><FileSpreadsheet size={16} /><span className="hidden md:inline">CSV</span></button>
            <button onClick={() => void onExportPdf()} className="p-2 text-slate-600 hover:bg-rose-50 hover:text-rose-700 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold" title="Export PDF"><FileDown size={16} /><span className="hidden md:inline">PDF</span></button>
            <button onClick={() => void onExportJson()} className="p-2 text-slate-600 hover:bg-amber-50 hover:text-amber-700 rounded-lg transition-all flex items-center gap-1.5 text-xs font-bold" title="Export JSON"><FileJson2 size={16} /><span className="hidden md:inline">JSON</span></button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 w-full sm:w-fit">
          <button onClick={() => setActiveTab('overview')} className={`px-4 py-2 text-xs font-bold rounded-lg ${activeTab === 'overview' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Overview</button>
          <button onClick={() => setActiveTab('cyclomatic')} className={`px-4 py-2 text-xs font-bold rounded-lg ${activeTab === 'cyclomatic' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Cyclomatic</button>
          <button onClick={() => setActiveTab('halstead')} className={`px-4 py-2 text-xs font-bold rounded-lg ${activeTab === 'halstead' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Halstead & Maintainability</button>
        </div>

        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                <div className="absolute right-0 bottom-0 translate-x-1/4 translate-y-1/4 text-slate-50 opacity-50 group-hover:text-indigo-50 transition-colors"><FileCode2 size={100} /></div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Assets</p>
                <div className="flex items-baseline gap-2"><h3 className="text-3xl font-extrabold text-slate-900">{displayedResult.summary.scanned_files}</h3><span className="text-xs text-slate-500 font-semibold">Files Scanned</span></div>
                <div className="mt-3 flex items-center text-xs font-medium text-slate-500 bg-slate-50 w-fit px-2 py-1 rounded-md border border-slate-100">{displayedResult.summary.total_functions} total functions</div>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Cyclomatic</p><h3 className={`text-3xl font-extrabold ${displayedResult.summary.avg_complexity > 10 ? 'text-rose-600' : 'text-emerald-600'}`}>{displayedResult.summary.avg_complexity.toFixed(2)}</h3></div>
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Maintainability Index</p><h3 className={`text-3xl font-extrabold ${displayedResult.summary.avg_maintainability >= 65 ? 'text-emerald-600' : displayedResult.summary.avg_maintainability >= 45 ? 'text-amber-500' : 'text-rose-600'}`}>{displayedResult.summary.avg_maintainability.toFixed(2)}</h3></div>
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Halstead Volume</p><h3 className="text-3xl font-extrabold text-slate-900">{displayedResult.summary.avg_halstead_volume.toFixed(2)}</h3></div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50"><PieChart size={18} className="text-indigo-600" /><h3 className="font-bold text-slate-900 text-sm">Actionable Refactoring Recommendations</h3></div>
              <div className="p-6 space-y-3">
                {displayedResult.recommendations.length === 0 ? <p className="text-sm text-slate-500 italic">Everything looks excellent. No recommendations generated.</p> : displayedResult.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-3 bg-white p-3.5 rounded-xl border border-slate-100"><div className="h-6 w-6 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 border border-indigo-100 mt-0.5">{i + 1}</div><p className="text-sm text-slate-700 font-medium leading-relaxed pt-0.5">{rec}</p></div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'cyclomatic' && (
          <>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50"><h3 className="font-bold text-slate-900 text-sm">Cyclomatic Detail Per File</h3><span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">Page {currentPage} / {totalPages}</span></div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead><tr className="bg-slate-50/50 text-slate-500 text-xs font-bold border-b border-slate-200"><th className="py-3 px-4">FILE</th><th className="py-3 px-3 text-center">V(G)</th><th className="py-3 px-3 text-center">PREDICATE</th><th className="py-3 px-3 text-center">TOP FN</th><th className="py-3 px-4 text-right">STATUS</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedFiles.map((item, idx) => {
                      const topFn = (item.functions ?? []).slice().sort((a, b) => b.vg - a.vg)[0]
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3.5 px-4 font-medium text-slate-700 max-w-xs truncate text-xs" title={item.file}>{item.file}</td>
                          <td className="py-3.5 px-3 text-center font-bold text-xs">{item.complexity_score}</td>
                          <td className="py-3.5 px-3 text-center text-xs">{item.predicate_count}</td>
                          <td className="py-3.5 px-3 text-center text-xs">{topFn ? `${topFn.name} (${topFn.vg})` : '-'}</td>
                          <td className="py-3.5 px-4 text-right"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getMetricColor(item.complexity_score, 'vg')}`}>{item.complexity_category}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-white">
                <button disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={18} /></button>
                <span className="text-xs font-medium text-slate-500">Showing {pagedFiles.length} files</span>
                <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={18} /></button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50"><BrainCircuit size={18} className="text-indigo-600" /><h3 className="font-bold text-slate-900 text-sm">Control Flowgraph (CFG) Visualization</h3></div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-0 h-[500px]">
                  <div className="lg:col-span-3 relative bg-slate-50 border-r border-slate-200">
                    {selectedFunction ? (
                      <ReactFlow nodes={flowView.nodes} edges={flowView.edges} fitView proOptions={{ hideAttribution: true }}><Background color="#cbd5e1" gap={16} size={1} /><Controls className="!border-slate-200 !shadow-sm !bg-white !rounded-lg overflow-hidden" /></ReactFlow>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-3"><Activity size={40} className="opacity-20" /><p className="text-sm font-medium">No control flow data available to visualize.</p></div>
                    )}
                  </div>
                  <div className="bg-white flex flex-col overflow-hidden"><div className="px-4 py-3 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500 tracking-wider">NODE IDENTIFIERS</div><div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">{flowView.legend.map((item) => <div key={item.no} className="text-xs font-medium text-slate-700 truncate p-2 border border-slate-100 rounded">{item.no}. {item.label}</div>)}</div></div>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50"><Activity size={18} className="text-indigo-600" /><h3 className="font-bold text-slate-900 text-sm">Top Complex Functions</h3></div>
                <div className="p-4 flex-1 space-y-2.5 overflow-y-auto max-h-[320px]">
                  {pagedFunctions.slice(0, 8).map((fn, idx) => (
                    <div key={idx} className="group flex flex-col gap-1 bg-slate-50 p-3 rounded-xl border border-slate-100 hover:bg-indigo-50/30 transition-all cursor-pointer" onClick={() => setSelectedFunctionKey(`${fn.file}::${fn.name}`)}>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-slate-800 truncate flex items-center gap-1"><TerminalSquare size={12} className="text-indigo-500 shrink-0" />{fn.name}</span><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${getMetricColor(fn.vg, 'vg')}`}>VG: {fn.vg}</span></div>
                      <span className="text-[10px] text-slate-400 font-medium truncate font-mono">{fn.file.split(/[/\\]/).pop()}</span>
                      <span className="text-[10px] text-slate-500">E={fn.cyclomatic_detail?.edge_count ?? '-'} N={fn.cyclomatic_detail?.node_count ?? '-'} P={fn.cyclomatic_detail?.connected_components ?? '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-sm">Cyclomatic Audit Per Function</h3>
                <span className="text-xs font-medium text-slate-500">VG Engine vs Formula</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-xs font-bold border-b border-slate-200">
                      <th className="py-3 px-4">FUNCTION</th>
                      <th className="py-3 px-3 text-center">FILE</th>
                      <th className="py-3 px-3 text-center">VG (ENGINE)</th>
                      <th className="py-3 px-3 text-center">E</th>
                      <th className="py-3 px-3 text-center">N</th>
                      <th className="py-3 px-3 text-center">P</th>
                      <th className="py-3 px-3 text-center">VG FORMULA</th>
                      <th className="py-3 px-3 text-center">VG PREDICATE</th>
                      <th className="py-3 px-4 text-right">CHECK</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allFunctions.slice(0, 50).map((fn, idx) => {
                      const d = fn.cyclomatic_detail
                      const formulaOk = d ? d.vg_formula === fn.vg : false
                      const predicateOk = d ? d.vg_predicate === fn.vg : false
                      return (
                        <tr key={`${fn.file}-${fn.name}-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3.5 px-4 font-medium text-slate-700 text-xs">{fn.name}</td>
                          <td className="py-3.5 px-3 text-center text-xs text-slate-500">{fn.file.split(/[/\\]/).pop()}</td>
                          <td className="py-3.5 px-3 text-center text-xs font-bold">{fn.vg}</td>
                          <td className="py-3.5 px-3 text-center text-xs">{d?.edge_count ?? '-'}</td>
                          <td className="py-3.5 px-3 text-center text-xs">{d?.node_count ?? '-'}</td>
                          <td className="py-3.5 px-3 text-center text-xs">{d?.connected_components ?? '-'}</td>
                          <td className="py-3.5 px-3 text-center text-xs">{d?.vg_formula ?? '-'}</td>
                          <td className="py-3.5 px-3 text-center text-xs">{d?.vg_predicate ?? '-'}</td>
                          <td className="py-3.5 px-4 text-right">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${(formulaOk && predicateOk) ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-amber-600 bg-amber-50 border-amber-100'}`}>
                              {(formulaOk && predicateOk) ? 'MATCH' : 'CHECK'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === 'halstead' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50"><h3 className="font-bold text-slate-900 text-sm">Halstead & Maintainability Per File</h3><span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">Page {currentPage} / {totalPages}</span></div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead><tr className="bg-slate-50/50 text-slate-500 text-xs font-bold border-b border-slate-200"><th className="py-3 px-4">FILE</th><th className="py-3 px-3 text-center">n1</th><th className="py-3 px-3 text-center">n2</th><th className="py-3 px-3 text-center">N1</th><th className="py-3 px-3 text-center">N2</th><th className="py-3 px-3 text-center">Volume</th><th className="py-3 px-3 text-center">Difficulty</th><th className="py-3 px-3 text-center">Effort</th><th className="py-3 px-3 text-center">MI</th><th className="py-3 px-4 text-right">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedFiles.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-medium text-slate-700 max-w-xs truncate text-xs" title={item.file}>{item.file}</td>
                      <td className="py-3.5 px-3 text-center text-xs">{item.halstead_detail?.n1 ?? '-'}</td>
                      <td className="py-3.5 px-3 text-center text-xs">{item.halstead_detail?.n2 ?? '-'}</td>
                      <td className="py-3.5 px-3 text-center text-xs">{item.halstead_detail?.N1 ?? '-'}</td>
                      <td className="py-3.5 px-3 text-center text-xs">{item.halstead_detail?.N2 ?? '-'}</td>
                      <td className="py-3.5 px-3 text-center text-xs">{item.halstead_detail?.volume ?? '-'}</td>
                      <td className="py-3.5 px-3 text-center text-xs">{item.halstead_detail?.difficulty ?? '-'}</td>
                      <td className="py-3.5 px-3 text-center text-xs">{item.halstead_detail?.effort ?? '-'}</td>
                      <td className="py-3.5 px-3 text-center text-xs font-bold">{item.maintainability_index.toFixed(1)}</td>
                      <td className="py-3.5 px-4 text-right"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getMetricColor(item.maintainability_index, 'mi')}`}>{item.maintainability_category}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-white">
              <button disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={18} /></button>
              <span className="text-xs font-medium text-slate-500">Showing {pagedFiles.length} files</span>
              <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={18} /></button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="font-bold text-slate-900 text-sm">Metric Legend</h3>
            <p className="text-xs text-slate-500 mt-1">Penjelasan simbol dan rumus yang dipakai di tabel Cyclomatic dan Halstead.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 text-xs font-bold border-b border-slate-200">
                  <th className="py-3 px-4">SIMBOL</th>
                  <th className="py-3 px-4">ARTI</th>
                  <th className="py-3 px-4">CATATAN / RUMUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">V(G)</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Cyclomatic Complexity</td>
                  <td className="py-3 px-4 text-xs text-slate-500">Jumlah jalur independen logika program.</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">E, N, P</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Edges, Nodes, Connected Components</td>
                  <td className="py-3 px-4 text-xs text-slate-500">Dipakai di rumus McCabe: `V(G) = E - N + 2P`.</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">Predicate</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Titik keputusan logika</td>
                  <td className="py-3 px-4 text-xs text-slate-500">Contoh: `if`, `else if`, `for`, `while`, `case`, operator boolean.</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">n1 / n2</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Operator unik / Operand unik</td>
                  <td className="py-3 px-4 text-xs text-slate-500">Ukuran ragam simbol yang berbeda di kode.</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">N1 / N2</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Total operator / Total operand</td>
                  <td className="py-3 px-4 text-xs text-slate-500">Frekuensi kemunculan operator dan operand.</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">Volume</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Halstead Volume</td>
                  <td className="py-3 px-4 text-xs text-slate-500">`Volume = (N1 + N2) * log2(n1 + n2)`.</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">Difficulty</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Halstead Difficulty</td>
                  <td className="py-3 px-4 text-xs text-slate-500">`Difficulty = (n1 / 2) * (N2 / n2)`.</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">Effort</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Perkiraan effort implementasi</td>
                  <td className="py-3 px-4 text-xs text-slate-500">`Effort = Difficulty * Volume`.</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-xs font-bold text-slate-700">MI</td>
                  <td className="py-3 px-4 text-xs text-slate-700">Maintainability Index</td>
                  <td className="py-3 px-4 text-xs text-slate-500">Skor maintainability (0-100), makin tinggi makin mudah dirawat.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}
