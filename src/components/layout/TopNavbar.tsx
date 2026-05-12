import { BrainCircuit } from 'lucide-react'

export function TopNavbar() {
  return (
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
  )
}
