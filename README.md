# CodeMetric Studio

CodeMetric Studio is a desktop static-analysis toolkit for Python, JavaScript, and PHP codebases.
It provides cyclomatic complexity, control-flow graphs, Halstead metrics, maintainability scoring, analysis history, and exportable reports.

## Core Capabilities

- Analyze by project folder, single source file, or inline code snippet.
- Language support: `.py`, `.js`, `.php`.
- Cyclomatic metrics per file and per function.
- CFG (Control Flow Graph) visualization for function-level logic.
- Halstead metrics and maintainability index per file.
- Recommendations generated from analysis results.
- Export report to `CSV`, `JSON`, and `PDF`.
- Local analysis history with detail view and deletion.

## Technology Stack

- Frontend: React + TypeScript + Vite + Tailwind CSS
- Desktop runtime: Tauri v2
- Analyzer engine: Python (`radon`, `lizard`) + PHP helper (`nikic/php-parser`)

## Prerequisites

Install the following before running locally:

1. Node.js 20+ and npm
2. Rust toolchain (required by Tauri)
3. Python 3.10+
4. PHP 8+

Recommended environment:

- Windows 10/11 x64
- PowerShell terminal

## Project Setup

Run from `app` directory.

```bash
cd app
npm install
```

Install Python dependencies for analyzer:

```bash
cd analyzer
pip install -r requirements.txt
cd ..
```

PHP dependencies (already committed in this repository, optional to refresh):

```bash
cd analyzer
composer install
cd ..
```

## Development Commands

From `app`:

```bash
npm run dev
```

Runs Vite in browser mode. Tauri APIs are not available in this mode.

```bash
npm run tauri:dev
```

Runs full desktop app with native Tauri APIs (recommended for normal use).

```bash
npm run lint
npm run test
npm run build
```

- `lint`: ESLint validation
- `test`: Vitest unit tests
- `build`: production web build

```bash
npm run tauri:build
```

Builds desktop distributable binaries.

## How To Use

1. Launch with `npm run tauri:dev`.
2. Select analysis source in sidebar:
   - `Folder`: scan all supported files recursively.
   - `File`: analyze a single file.
   - `Snippet`: analyze pasted code with language selection.
3. Click `Analyze` / `Run Analysis`.
4. Review tabs:
   - `Overview`: summary cards + recommendations.
   - `Cyclomatic`: file/function complexity, CFG, audit table.
   - `Halstead & Maintainability`: operator/operand and MI detail.
5. Export result via top-right actions:
   - `CSV`
   - `PDF`
   - `JSON`

## Metrics Reference

The UI includes a `Metric Legend` section and PDF legend page covering:

- `V(G)`: Cyclomatic complexity
- `E, N, P`: Graph terms in McCabe formula `V(G) = E - N + 2P`
- `n1/n2`, `N1/N2`: Halstead operator/operand counts
- `Volume`, `Difficulty`, `Effort`
- `MI`: Maintainability Index

## Export Output

- `CSV`: flat table for spreadsheet and quick filtering
- `JSON`: structured payload for integrations and automation
- `PDF`: presentation-ready report including metric legend and attribution footer

## Troubleshooting

### `NOT_TAURI_RUNTIME` or Tauri error in browser

Run the app with:

```bash
npm run tauri:dev
```

### Python analyzer dependency errors

Reinstall requirements:

```bash
cd analyzer
pip install -r requirements.txt
```

### PHP parser errors

Ensure PHP is installed and available in `PATH`. If needed:

```bash
cd analyzer
composer install
```

### Large bundle warning during build

The project already uses lazy loading for exporters. Warning can still appear due to PDF/Excel libraries and is expected unless further code splitting is added.

## Repository Structure

```text
app/
  src/                      # React UI
  src/components/layout/    # Main layout components
  src/utils/exporters.ts    # CSV/JSON/PDF export builders
  src/lib/tauriClient.ts    # Tauri bridge
  analyzer/                 # Python + PHP analyzer engine
  src-tauri/                # Tauri Rust backend
```

## Attribution

- Product: CodeMetric Studio
- Built by Jayadev
