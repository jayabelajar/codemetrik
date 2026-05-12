#!/usr/bin/env python3
import json
import math
import os
import subprocess
import sys
import tempfile
from typing import Dict, List, Optional, Tuple

import lizard
from radon.complexity import cc_visit
from radon.metrics import h_visit
from radon.raw import analyze as raw_analyze

SUPPORTED_EXTENSIONS = {".py", ".js", ".ts", ".php"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".venv", "venv"}
LANG_TO_EXT = {"python": ".py", "javascript": ".js", "typescript": ".ts", "php": ".php"}


def complexity_category(vg: int) -> str:
    if vg <= 10:
        return "Good"
    if vg <= 20:
        return "Moderate"
    return "Complex"


def mi_category(mi: float) -> str:
    if mi >= 80:
        return "Excellent"
    if mi >= 60:
        return "Good"
    if mi >= 40:
        return "Warning"
    return "Poor"


def build_flowgraph(predicate_count: int) -> Dict:
    nodes = [{"id": "start", "label": "Start"}]
    edges = []
    prev = "start"
    for idx in range(predicate_count):
        nid = f"p{idx + 1}"
        nodes.append({"id": nid, "label": f"Predicate {idx + 1}"})
        edges.append({"from": prev, "to": nid, "label": "next"})
        edges.append({"from": nid, "to": "end", "label": "false"})
        prev = nid
    nodes.append({"id": "end", "label": "End"})
    edges.append({"from": prev, "to": "end", "label": "true"})
    return {"nodes": nodes, "edges": edges, "independent_paths": predicate_count + 1}


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


def py_metrics(content: str, rel_file: str) -> Tuple[int, int, float, Dict, List[Dict]]:
    blocks = cc_visit(content)
    complexity = int(sum(block.complexity for block in blocks)) if blocks else 1
    function_count = len(blocks)

    raw = raw_analyze(content)
    halstead = h_visit(content)
    total = getattr(halstead, "total", None)
    n1 = int(getattr(total, "h1", 0) or 0)
    n2 = int(getattr(total, "h2", 0) or 0)
    N1 = int(getattr(total, "N1", 0) or 0)
    N2 = int(getattr(total, "N2", 0) or 0)
    volume = float(getattr(total, "volume", 0.0) or 0.0)
    difficulty = float(getattr(total, "difficulty", 0.0) or 0.0)
    effort = float(getattr(total, "effort", 0.0) or 0.0)

    loc = max(raw.loc, 1)
    mi = 171 - 5.2 * math.log(max(volume, 1)) - 0.23 * complexity - 16.2 * math.log(loc)
    mi = max(0.0, min(100.0, mi * 100 / 171))

    functions: List[Dict] = []
    for block in blocks:
        vg = int(block.complexity)
        predicate_count = max(vg - 1, 0)
        functions.append({
            "file": rel_file,
            "name": str(block.name),
            "predicate_count": predicate_count,
            "vg": vg,
            "complexity_category": complexity_category(vg),
            "flowgraph": build_flowgraph(predicate_count),
        })

    halstead_detail = {
        "n1": n1,
        "n2": n2,
        "N1": N1,
        "N2": N2,
        "program_length": N1 + N2,
        "vocabulary": n1 + n2,
        "volume": round(volume, 2),
        "difficulty": round(difficulty, 2),
        "effort": round(effort, 2),
    }

    return complexity, function_count, round(mi, 2), halstead_detail, functions


def generic_metrics(path: str, rel_file: str, loc: int) -> Tuple[int, int, float, List[Dict]]:
    analysis = lizard.analyze_file(path)
    functions: List[Dict] = []
    complexity = 0
    for fn in analysis.function_list:
        vg = int(fn.cyclomatic_complexity)
        complexity += vg
        predicate_count = max(vg - 1, 0)
        functions.append({
            "file": rel_file,
            "name": str(fn.name),
            "predicate_count": predicate_count,
            "vg": vg,
            "complexity_category": complexity_category(vg),
            "flowgraph": build_flowgraph(predicate_count),
        })

    function_count = len(functions)
    penalty = complexity * 1.6 + max(loc - 250, 0) * 0.04 + function_count * 0.4
    mi = max(0.0, min(100.0, 100.0 - penalty))
    return complexity, function_count, round(mi, 2), functions


def php_metrics(path: str, loc: int, rel_file: str) -> Tuple[int, int, float, Dict, List[Dict]]:
    helper_path = os.path.join(os.path.dirname(__file__), "php_metrics.php")
    output = subprocess.run(["php", helper_path, path], check=True, capture_output=True, text=True)
    parsed = json.loads(output.stdout)

    complexity = int(parsed.get("complexity", 0))
    function_count = int(parsed.get("function_count", 0))
    volume = float(parsed.get("halstead_volume", 0.0))
    difficulty = float(parsed.get("halstead_difficulty", 0.0))
    effort = float(parsed.get("halstead_effort", 0.0))

    effective_cc = max(complexity, 1)
    effective_loc = max(loc, 1)
    effective_volume = max(volume, 1.0)
    mi = 171 - 5.2 * math.log(effective_volume) - 0.23 * effective_cc - 16.2 * math.log(effective_loc)
    mi = max(0.0, min(100.0, mi * 100 / 171))

    functions: List[Dict] = []
    for fn in parsed.get("functions", []):
        vg = int(fn.get("vg", 1))
        predicate_count = int(fn.get("predicate_count", max(vg - 1, 0)))
        flowgraph = fn.get("flowgraph")
        if not isinstance(flowgraph, dict):
            flowgraph = build_flowgraph(predicate_count)
        functions.append({
            "file": rel_file,
            "name": str(fn.get("name", "function")),
            "predicate_count": predicate_count,
            "vg": vg,
            "complexity_category": complexity_category(vg),
            "flowgraph": flowgraph,
        })

    halstead_detail = {
        "n1": int(parsed.get("halstead_n1", 0)),
        "n2": int(parsed.get("halstead_n2", 0)),
        "N1": int(parsed.get("halstead_N1", 0)),
        "N2": int(parsed.get("halstead_N2", 0)),
        "program_length": int(parsed.get("halstead_length", 0)),
        "vocabulary": int(parsed.get("halstead_vocabulary", 0)),
        "volume": round(volume, 2),
        "difficulty": round(difficulty, 2),
        "effort": round(effort, 2),
    }

    return complexity, function_count, round(mi, 2), halstead_detail, functions


def analyze_file(path: str, root: str) -> Dict:
    content = read_file(path)
    loc = len([line for line in content.splitlines() if line.strip()])
    ext = os.path.splitext(path)[1].lower()
    rel_file = os.path.relpath(path, root).replace("\\", "/")

    halstead_detail: Optional[Dict] = None
    functions: List[Dict] = []

    if ext == ".py":
        complexity, function_count, mi, halstead_detail, functions = py_metrics(content, rel_file)
    elif ext == ".php":
        complexity, function_count, mi, halstead_detail, functions = php_metrics(path, loc, rel_file)
    else:
        complexity, function_count, mi, functions = generic_metrics(path, rel_file, loc)

    return {
        "file": rel_file,
        "loc": loc,
        "language": ext.replace(".", ""),
        "function_count": function_count,
        "complexity_score": complexity,
        "complexity_category": complexity_category(complexity),
        "predicate_count": max(complexity - function_count, 0),
        "maintainability_index": mi,
        "maintainability_category": mi_category(mi),
        "halstead_detail": halstead_detail,
        "functions": functions,
    }


def build_recommendations(files: List[Dict], functions: List[Dict], avg_mi: float) -> List[str]:
    recs: List[str] = []
    if any(fn["vg"] > 20 for fn in functions):
        recs.append("Pecah fungsi dengan V(G) > 20 menjadi fungsi yang lebih kecil.")
    if any(fn["predicate_count"] >= 8 for fn in functions):
        recs.append("Kurangi nested if/loop dan gunakan guard clause.")
    if any(item["loc"] > 300 for item in files):
        recs.append("Pisahkan file besar (>300 LOC) agar lebih mudah dirawat.")
    if avg_mi < 60:
        recs.append("Prioritaskan refactor pada file dengan MI rendah untuk meningkatkan maintainability.")
    if not recs:
        recs.append("Struktur kode relatif sehat, lanjutkan konsistensi style dan pengujian.")
    return recs


def build_payload(files: List[Dict]) -> Dict:
    files.sort(key=lambda x: x["complexity_score"], reverse=True)
    all_functions: List[Dict] = []
    for item in files:
        if not item.get("functions") and item["complexity_score"] > 0:
            pseudo_predicate = max(item["complexity_score"] - 1, 0)
            item["functions"] = [{
                "file": item["file"],
                "name": "__script__",
                "predicate_count": pseudo_predicate,
                "vg": item["complexity_score"],
                "complexity_category": complexity_category(item["complexity_score"]),
                "flowgraph": build_flowgraph(pseudo_predicate),
            }]
        all_functions.extend(item.get("functions", []))

    top_functions = sorted(all_functions, key=lambda f: f["vg"], reverse=True)[:50]

    total_loc = sum(item["loc"] for item in files)
    total_functions = sum(item["function_count"] for item in files)
    avg_complexity = (sum(item["complexity_score"] for item in files) / len(files)) if files else 0.0
    avg_maintainability = (sum(item["maintainability_index"] for item in files) / len(files)) if files else 0.0

    halstead_items = [item for item in files if item.get("halstead_detail") is not None]
    avg_halstead_volume = (
        sum(float(item["halstead_detail"]["volume"]) for item in halstead_items) / len(halstead_items)
    ) if halstead_items else 0.0

    complexity_distribution = {"Good": 0, "Moderate": 0, "Complex": 0}
    for fn in all_functions:
        complexity_distribution[fn["complexity_category"]] += 1

    mi_distribution = {"Excellent": 0, "Good": 0, "Warning": 0, "Poor": 0}
    for item in files:
        mi_distribution[item["maintainability_category"]] += 1

    recommendations = build_recommendations(files, all_functions, avg_maintainability)

    return {
        "summary": {
            "scanned_files": len(files),
            "total_loc": total_loc,
            "total_functions": total_functions,
            "avg_complexity": round(avg_complexity, 2),
            "avg_maintainability": round(avg_maintainability, 2),
            "avg_halstead_volume": round(avg_halstead_volume, 2),
            "most_complex_file": files[0]["file"] if files else "",
            "complexity_distribution": complexity_distribution,
            "mi_distribution": mi_distribution,
            "top_complex_functions": top_functions,
        },
        "files": files,
        "recommendations": recommendations,
    }


def analyze_path(target_path: str) -> Dict:
    abs_path = os.path.abspath(target_path)
    if os.path.isdir(abs_path):
        files = [analyze_file(path, abs_path) for path in find_source_files(abs_path)]
        return build_payload(files)

    if os.path.isfile(abs_path):
        ext = os.path.splitext(abs_path)[1].lower()
        if ext not in SUPPORTED_EXTENSIONS:
            raise ValueError("File extension tidak didukung. Gunakan .py, .js, .ts, atau .php")
        root = os.path.dirname(abs_path)
        return build_payload([analyze_file(abs_path, root)])

    raise ValueError("Path tidak ditemukan")


def analyze_snippet(language: str, code: str) -> Dict:
    ext = LANG_TO_EXT.get(language.lower())
    if not ext:
        raise ValueError("Language snippet tidak didukung")

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, f"snippet{ext}")
        with open(path, "w", encoding="utf-8") as f:
            f.write(code)
        payload = build_payload([analyze_file(path, tmpdir)])
        if payload["files"]:
            payload["files"][0]["file"] = f"snippet{ext}"
            payload["summary"]["most_complex_file"] = f"snippet{ext}"
            for fn in payload["files"][0].get("functions", []):
                fn["file"] = f"snippet{ext}"
        return payload


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: analyze.py --path <path> | --snippet <language>", file=sys.stderr)
        return 1

    mode = sys.argv[1]

    try:
        if mode == "--path":
            payload = analyze_path(sys.argv[2])
        elif mode == "--snippet":
            language = sys.argv[2]
            code = sys.stdin.read()
            payload = analyze_snippet(language, code)
        else:
            raise ValueError("Mode tidak valid")
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
