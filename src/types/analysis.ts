export type FlowNode = { id: string; label: string }
export type FlowEdge = { from: string; to: string; label: string }
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; independent_paths: number }

export type FunctionMetric = {
  file: string
  name: string
  predicate_count: number
  vg: number
  complexity_category: 'Good' | 'Moderate' | 'Complex'
  flowgraph: FlowGraph
}

export type HalsteadDetail = {
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

export type FileMetric = {
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

export type AnalysisSummary = {
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

export type AnalysisResult = {
  summary: AnalysisSummary
  files: FileMetric[]
  recommendations: string[]
}

export type HistoryItem = {
  id: number
  analyzed_at: string
  project_path: string
  scanned_files: number
  avg_complexity: number
  avg_maintainability: number
}

export type HistoryDetail = {
  id: number
  analyzed_at: string
  project_path: string
  result: AnalysisResult
}

export type InputMode = 'folder' | 'file' | 'snippet'
export type SnippetLanguage = 'python' | 'javascript' | 'typescript' | 'php'
