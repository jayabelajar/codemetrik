#!/usr/bin/env python3
import json
import math
import os
import sys
from typing import Dict, List, Tuple

import lizard
from radon.complexity import cc_visit
from radon.metrics import h_visit
from radon.raw import analyze as raw_analyze

SUPPORTED_EXTENSIONS = {".py", ".js", ".ts"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".venv", "venv"}


def find_source_files(root: str) -> List[str]:
    result: List[str] = []
    for current_root, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for filename in files:
            _, ext = os.path.splitext(filename)
            if ext.lower() in SUPPORTED_EXTENSIONS:
                result.append(os.path.join(current_root, filename))
    return result


def read_file(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def py_metrics(content: str) -> Tuple[int, int, float]:
    blocks = cc_visit(content)
    complexity = int(sum(block.complexity for block in blocks)) if blocks else 1
    function_count = len(blocks)

    raw = raw_analyze(content)
    halstead = h_visit(content)
    volume = float(getattr(getattr(halstead, "total", None), "volume", 0.0) or 0.0)
    loc = max(raw.loc, 1)

    # Maintainability Index formula (radon-compatible baseline, clamped 0-100)
    mi = 171 - 5.2 * math.log(max(volume, 1)) - 0.23 * complexity - 16.2 * math.log(loc)
    mi = max(0.0, min(100.0, mi * 100 / 171))
    return complexity, function_count, round(mi, 2)


def generic_metrics(path: str, loc: int) -> Tuple[int, int, float]:
    analysis = lizard.analyze_file(path)
    complexity = int(sum(fn.cyclomatic_complexity for fn in analysis.function_list))
    function_count = len(analysis.function_list)

    if function_count == 0:
        complexity = max(complexity, 1)

    # Proxy maintainability score for non-Python files
    penalty = complexity * 1.6 + max(loc - 250, 0) * 0.04 + function_count * 0.4
    mi = max(0.0, min(100.0, 100.0 - penalty))
    return complexity, function_count, round(mi, 2)


def analyze_file(path: str, root: str) -> Dict:
    content = read_file(path)
    loc = len([line for line in content.splitlines() if line.strip()])
    ext = os.path.splitext(path)[1].lower()

    if ext == ".py":
        complexity, function_count, maintainability_index = py_metrics(content)
    else:
        complexity, function_count, maintainability_index = generic_metrics(path, loc)

    return {
        "file": os.path.relpath(path, root).replace("\\", "/"),
        "loc": loc,
        "function_count": function_count,
        "complexity_score": complexity,
        "maintainability_index": maintainability_index,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: analyze.py <project_path>", file=sys.stderr)
        return 1

    project_path = os.path.abspath(sys.argv[1])
    if not os.path.isdir(project_path):
        print("Path project tidak ditemukan atau bukan folder.", file=sys.stderr)
        return 1

    files = [analyze_file(path, project_path) for path in find_source_files(project_path)]
    files.sort(key=lambda x: x["complexity_score"], reverse=True)

    total_loc = sum(item["loc"] for item in files)
    total_functions = sum(item["function_count"] for item in files)
    avg_complexity = (sum(item["complexity_score"] for item in files) / len(files)) if files else 0.0
    avg_maintainability = (
        sum(item["maintainability_index"] for item in files) / len(files)
    ) if files else 0.0

    payload = {
        "summary": {
            "scanned_files": len(files),
            "total_loc": total_loc,
            "total_functions": total_functions,
            "avg_complexity": round(avg_complexity, 2),
            "avg_maintainability": round(avg_maintainability, 2),
            "most_complex_file": files[0]["file"] if files else "",
        },
        "files": files,
    }

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
