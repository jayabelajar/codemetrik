import type { FunctionMetric } from '../types/analysis'

export function clampPage(page: number, totalPages: number): number {
  return Math.min(page, Math.max(totalPages, 1))
}

export function getEffectiveSelectedFunctionKey(
  allFunctions: FunctionMetric[],
  selectedFunctionKey: string,
): string {
  if (allFunctions.length === 0) return ''
  const exists = allFunctions.some((fn) => `${fn.file}::${fn.name}` === selectedFunctionKey)
  return exists ? selectedFunctionKey : `${allFunctions[0].file}::${allFunctions[0].name}`
}
