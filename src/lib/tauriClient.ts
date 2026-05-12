import type { AnalysisResult, HistoryDetail, HistoryItem, SnippetLanguage } from '../types/analysis'

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
type DialogOpen = (options?: Record<string, unknown>) => Promise<string | string[] | null>
type DialogSave = (options?: Record<string, unknown>) => Promise<string | null>
type WriteFile = (path: string, contents: Uint8Array | number[]) => Promise<void>

declare global { interface Window { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown } }

let invokeRef: TauriInvoke | null = null
let dialogOpenRef: DialogOpen | null = null
let dialogSaveRef: DialogSave | null = null
let writeFileRef: WriteFile | null = null

function isTauriRuntime() {
  return typeof window !== 'undefined' && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__))
}

export function formatUnknownError(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

export function formatTauriError(err: unknown) {
  const raw = formatUnknownError(err)
  if (raw === 'NOT_TAURI_RUNTIME') {
    return 'Aplikasi ini berjalan di browser biasa, bukan window Tauri. Jalankan: npm run tauri:dev'
  }
  return `Tauri error: ${raw || 'unknown'}`
}

export async function ensureTauriApi() {
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

export async function analyzePath(targetPath: string): Promise<AnalysisResult> {
  await ensureTauriApi()
  return invokeRef!<AnalysisResult>('analyze_path', { targetPath: targetPath.trim() })
}

export async function analyzeSnippet(language: SnippetLanguage, code: string): Promise<AnalysisResult> {
  await ensureTauriApi()
  return invokeRef!<AnalysisResult>('analyze_snippet', { language, code })
}

export async function getHistory(limit = 30): Promise<HistoryItem[]> {
  await ensureTauriApi()
  return invokeRef!<HistoryItem[]>('get_analysis_history', { limit })
}

export async function getHistoryDetail(id: number): Promise<HistoryDetail> {
  await ensureTauriApi()
  return invokeRef!<HistoryDetail>('get_history_detail', { id })
}

export async function deleteHistoryItem(id: number): Promise<void> {
  await ensureTauriApi()
  await invokeRef!('delete_history_item', { id })
}

export async function clearHistory(): Promise<void> {
  await ensureTauriApi()
  await invokeRef!('clear_history')
}

export async function pickFolder(): Promise<string | null> {
  await ensureTauriApi()
  const selected = await dialogOpenRef!({ directory: true, multiple: false })
  return typeof selected === 'string' ? selected : null
}

export async function pickFile(): Promise<string | null> {
  await ensureTauriApi()
  const selected = await dialogOpenRef!({ directory: false, multiple: false, filters: [{ name: 'Source', extensions: ['py', 'js', 'php'] }] })
  return typeof selected === 'string' ? selected : null
}

export async function saveBytes(defaultPath: string, filters: Array<{ name: string; extensions: string[] }>, bytes: Uint8Array): Promise<boolean> {
  await ensureTauriApi()
  const target = await dialogSaveRef!({ defaultPath, filters })
  if (!target) return false
  await writeFileRef!(target, bytes)
  return true
}
