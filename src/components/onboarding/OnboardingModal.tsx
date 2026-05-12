import { CheckCircle2, FolderSearch, PlayCircle, X } from 'lucide-react'

type OnboardingModalProps = {
  open: boolean
  onClose: () => void
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-[70] bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-3xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">Welcome to CodeMetric Studio</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Quick onboarding to start your first analysis.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Close onboarding"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 sm:p-7 grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center mb-3">
              <FolderSearch size={18} />
            </div>
            <p className="text-xs font-bold text-slate-900">1. Select Source</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Choose Folder, File, or Snippet from the left panel.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
              <PlayCircle size={18} />
            </div>
            <p className="text-xs font-bold text-slate-900">2. Run Analysis</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Click Analyze to generate complexity, Halstead, and MI metrics.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center mb-3">
              <CheckCircle2 size={18} />
            </div>
            <p className="text-xs font-bold text-slate-900">3. Review & Export</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Inspect tabs, then export report to CSV, PDF, or JSON.</p>
          </div>
        </div>

        <div className="px-5 sm:px-7 py-4 border-t border-slate-100 bg-slate-50 flex flex-col-reverse sm:flex-row gap-2 sm:items-center sm:justify-between">
          <p className="text-[11px] text-slate-500">This onboarding appears once after install.</p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-100 text-xs font-semibold"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
