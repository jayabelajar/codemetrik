import { describe, expect, it } from 'vitest'
import { clampPage, getEffectiveSelectedFunctionKey } from './appState'
import type { FunctionMetric } from '../types/analysis'

function makeFn(file: string, name: string): FunctionMetric {
  return {
    file,
    name,
    predicate_count: 0,
    vg: 1,
    complexity_category: 'Good',
    flowgraph: { nodes: [], edges: [], independent_paths: 1 },
  }
}

describe('clampPage', () => {
  it('clamps to total pages', () => {
    expect(clampPage(5, 3)).toBe(3)
  })

  it('keeps valid page', () => {
    expect(clampPage(2, 3)).toBe(2)
  })

  it('returns at least 1 when totalPages invalid', () => {
    expect(clampPage(2, 0)).toBe(1)
  })
})

describe('getEffectiveSelectedFunctionKey', () => {
  const allFunctions = [makeFn('a.php', 'foo'), makeFn('b.php', 'bar')]

  it('returns empty string when no functions', () => {
    expect(getEffectiveSelectedFunctionKey([], 'a.php::foo')).toBe('')
  })

  it('keeps selected key when exists', () => {
    expect(getEffectiveSelectedFunctionKey(allFunctions, 'b.php::bar')).toBe('b.php::bar')
  })

  it('falls back to first function when selected key missing', () => {
    expect(getEffectiveSelectedFunctionKey(allFunctions, 'c.php::baz')).toBe('a.php::foo')
  })
})
