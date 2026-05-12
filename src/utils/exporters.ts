import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import type { AnalysisResult } from '../types/analysis'

type ExportContext = {
  source: string
  generatedAt: string
  analyzerVersion: string
}

function flattenFunctionRows(result: AnalysisResult) {
  return result.files.flatMap((file) => (file.functions ?? []).map((fn) => ({
    file: file.file,
    function_name: fn.name,
    vg: fn.vg,
    predicate_count: fn.predicate_count,
    complexity_category: fn.complexity_category,
    start_line: fn.start_line ?? '',
    end_line: fn.end_line ?? '',
    edge_count: fn.cyclomatic_detail?.edge_count ?? '',
    node_count: fn.cyclomatic_detail?.node_count ?? '',
    connected_components: fn.cyclomatic_detail?.connected_components ?? '',
    vg_formula: fn.cyclomatic_detail?.vg_formula ?? '',
    vg_predicate: fn.cyclomatic_detail?.vg_predicate ?? '',
  })))
}

function flattenFileRows(result: AnalysisResult) {
  return result.files.map((item) => ({
    file: item.file,
    language: item.language,
    loc: item.loc,
    function_count: item.function_count,
    complexity_score: item.complexity_score,
    complexity_category: item.complexity_category,
    predicate_count: item.predicate_count,
    maintainability_index: Number(item.maintainability_index.toFixed(2)),
    maintainability_category: item.maintainability_category,
    halstead_n1: item.halstead_detail?.n1 ?? '',
    halstead_n2: item.halstead_detail?.n2 ?? '',
    halstead_N1: item.halstead_detail?.N1 ?? '',
    halstead_N2: item.halstead_detail?.N2 ?? '',
    halstead_program_length: item.halstead_detail?.program_length ?? '',
    halstead_vocabulary: item.halstead_detail?.vocabulary ?? '',
    halstead_volume: item.halstead_detail?.volume ?? '',
    halstead_difficulty: item.halstead_detail?.difficulty ?? '',
    halstead_effort: item.halstead_detail?.effort ?? '',
  }))
}

export function buildExcelBytes(result: AnalysisResult, context: ExportContext): Uint8Array {
  const workbook = XLSX.utils.book_new()
  const summaryRows = [
    { metric: 'source', value: context.source },
    { metric: 'generated_at', value: context.generatedAt },
    { metric: 'analyzer_version', value: context.analyzerVersion },
    { metric: 'scanned_files', value: result.summary.scanned_files },
    { metric: 'total_loc', value: result.summary.total_loc },
    { metric: 'total_functions', value: result.summary.total_functions },
    { metric: 'avg_complexity', value: result.summary.avg_complexity },
    { metric: 'avg_maintainability', value: result.summary.avg_maintainability },
    { metric: 'avg_halstead_volume', value: result.summary.avg_halstead_volume },
    { metric: 'most_complex_file', value: result.summary.most_complex_file },
  ]

  const fileRows = flattenFileRows(result)

  const functionRows = flattenFunctionRows(result)
  const recommendationRows = result.recommendations.map((recommendation, idx) => ({ no: idx + 1, recommendation }))

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(fileRows), 'Files')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(functionRows), 'Functions')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(recommendationRows), 'Recommendations')

  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
}

export function buildJsonBytes(result: AnalysisResult, context: ExportContext): Uint8Array {
  const fileRows = flattenFileRows(result)
  const functionRows = flattenFunctionRows(result)
  const recommendationRows = result.recommendations.map((recommendation, idx) => ({ no: idx + 1, recommendation }))

  const payload = {
    meta: context,
    schema_version: '1.0.0',
    sections: {
      summary: result.summary,
      files: fileRows,
      functions: functionRows,
      recommendations: recommendationRows,
    },
    data: result,
  }
  return new TextEncoder().encode(JSON.stringify(payload, null, 2))
}

export function buildCsvBytes(result: AnalysisResult, context: ExportContext): Uint8Array {
  const rows = result.files.flatMap((file) => {
    const base = {
      source: context.source,
      generated_at: context.generatedAt,
      analyzer_version: context.analyzerVersion,
      file: file.file,
      language: file.language,
      loc: file.loc,
      file_complexity_score: file.complexity_score,
      file_complexity_category: file.complexity_category,
      file_predicate_count: file.predicate_count,
      file_maintainability_index: Number(file.maintainability_index.toFixed(2)),
      file_maintainability_category: file.maintainability_category,
      halstead_n1: file.halstead_detail?.n1 ?? '',
      halstead_n2: file.halstead_detail?.n2 ?? '',
      halstead_N1: file.halstead_detail?.N1 ?? '',
      halstead_N2: file.halstead_detail?.N2 ?? '',
      halstead_program_length: file.halstead_detail?.program_length ?? '',
      halstead_vocabulary: file.halstead_detail?.vocabulary ?? '',
      halstead_volume: file.halstead_detail?.volume ?? '',
      halstead_difficulty: file.halstead_detail?.difficulty ?? '',
      halstead_effort: file.halstead_detail?.effort ?? '',
    }
    if (!file.functions || file.functions.length === 0) return [{ ...base }]
    return file.functions.map((fn) => ({
      ...base,
      function_name: fn.name,
      function_vg: fn.vg,
      function_predicate_count: fn.predicate_count,
      function_complexity_category: fn.complexity_category,
      start_line: fn.start_line ?? '',
      end_line: fn.end_line ?? '',
      edge_count: fn.cyclomatic_detail?.edge_count ?? '',
      node_count: fn.cyclomatic_detail?.node_count ?? '',
      connected_components: fn.cyclomatic_detail?.connected_components ?? '',
      vg_formula: fn.cyclomatic_detail?.vg_formula ?? '',
      vg_predicate: fn.cyclomatic_detail?.vg_predicate ?? '',
    }))
  })
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(worksheet)
  return new TextEncoder().encode(csv)
}

export function buildPdfBytes(result: AnalysisResult, context: ExportContext): Uint8Array {
  const doc = new jsPDF()
  doc.setFontSize(14)
  doc.text('CodeMetric Analysis Report', 14, 16)
  doc.setFontSize(10)
  doc.text(`Source: ${context.source}`, 14, 24)
  doc.text(`Generated At: ${context.generatedAt}`, 14, 30)
  doc.text(`Analyzer Version: ${context.analyzerVersion}`, 14, 36)
  doc.text(`Scanned Files: ${result.summary.scanned_files}`, 14, 42)
  doc.text(`Total Functions: ${result.summary.total_functions}`, 14, 48)
  doc.text(`Avg Complexity: ${result.summary.avg_complexity.toFixed(2)}`, 14, 54)
  doc.text(`Avg MI: ${result.summary.avg_maintainability.toFixed(2)}`, 14, 60)

  autoTable(doc, {
    startY: 66,
    head: [['File', 'Lang', 'LOC', 'VG', 'MI', 'Complexity', 'MI Cat']],
    body: result.files.map((f) => [
      f.file,
      f.language,
      String(f.loc),
      String(f.complexity_score),
      f.maintainability_index.toFixed(2),
      f.complexity_category,
      f.maintainability_category,
    ]),
    styles: { fontSize: 8 },
  })

  const pdfDoc = doc as unknown as { lastAutoTable?: { finalY?: number } }
  const functions = flattenFunctionRows(result)
  autoTable(doc, {
    startY: (pdfDoc.lastAutoTable?.finalY ?? 66) + 8,
    head: [['Function', 'File', 'VG', 'Pred', 'Category', 'Start', 'End']],
    body: functions.slice(0, 200).map((fn) => [
      String(fn.function_name),
      String(fn.file),
      String(fn.vg),
      String(fn.predicate_count),
      String(fn.complexity_category),
      String(fn.start_line),
      String(fn.end_line),
    ]),
    styles: { fontSize: 7 },
    didDrawPage: () => {
      doc.setFontSize(8)
      doc.text('Top 200 functions shown in PDF. Use JSON/Excel for full details.', 14, 8)
    },
  })

  autoTable(doc, {
    startY: ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 80) + 8,
    head: [['File', 'n1', 'n2', 'N1', 'N2', 'Volume', 'Difficulty', 'Effort', 'MI']],
    body: result.files.map((f) => [
      f.file,
      String(f.halstead_detail?.n1 ?? '-'),
      String(f.halstead_detail?.n2 ?? '-'),
      String(f.halstead_detail?.N1 ?? '-'),
      String(f.halstead_detail?.N2 ?? '-'),
      String(f.halstead_detail?.volume ?? '-'),
      String(f.halstead_detail?.difficulty ?? '-'),
      String(f.halstead_detail?.effort ?? '-'),
      f.maintainability_index.toFixed(2),
    ]),
    styles: { fontSize: 8 },
  })

  autoTable(doc, {
    startY: ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 80) + 8,
    head: [['Recommendations']],
    body: result.recommendations.map((r) => [r]),
    styles: { fontSize: 8 },
  })

  return new Uint8Array(doc.output('arraybuffer'))
}
