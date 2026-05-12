import { AlertCircle, FileBox, FileCode2, FolderOpen, History, RefreshCw, Search, Settings2, TerminalSquare, Trash2, Activity } from 'lucide-react'
import type { HistoryDetail, HistoryItem, InputMode, SnippetLanguage } from '../../types/analysis'

type AppSidebarProps = {
  inputMode: InputMode
  setInputMode: (mode: InputMode) => void
  targetPath: string
  setTargetPath: (value: string) => void
  snippetCode: string
  setSnippetCode: (value: string) => void
  snippetLanguage: SnippetLanguage
  setSnippetLanguage: (value: SnippetLanguage) => void
  loading: boolean
  error: string | null
  history: HistoryItem[]
  historyDetail: HistoryDetail | null
  onPickFolder: () => Promise<void>
  onPickFile: () => Promise<void>
  onAnalyze: () => Promise<void>
  onViewHistoryDetail: (id: number) => Promise<void>
  onDeleteHistory: (id: number) => Promise<void>
  onClearHistory: () => Promise<void>
}

export function AppSidebar(props: AppSidebarProps) {
  const {
    inputMode, setInputMode, targetPath, setTargetPath, snippetCode, setSnippetCode, snippetLanguage, setSnippetLanguage,
    loading, error, history, historyDetail, onPickFolder, onPickFile, onAnalyze, onViewHistoryDetail, onDeleteHistory, onClearHistory,
  } = props

  return (
    <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto">
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
                  onClick={() => void onAnalyze()}
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
                  <option value="php">PHP</option>
                </select>
                <button
                  type="button"
                  onClick={() => void onAnalyze()}
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

      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-4 pb-2 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <History size={16} className="text-indigo-600" />
            <span>History</span>
            <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{history.length}</span>
          </div>
          {history.length > 0 && (
            <button onClick={() => void onClearHistory()} className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold transition-colors flex items-center gap-1">
              Clear
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2 text-center p-4">
              <FileBox size={32} className="opacity-30" />
              <p className="text-xs font-medium leading-relaxed">No recent history.<br />Scan a repository to get started.</p>
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
                onClick={() => void onViewHistoryDetail(item.id)}
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
                    onClick={(e) => { e.stopPropagation(); void onDeleteHistory(item.id) }}
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
  )
}
