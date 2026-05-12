#!/usr/bin/env python3
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from typing import Dict, List, Optional, Tuple

import lizard
from radon.complexity import cc_visit
from radon.metrics import h_visit
from radon.raw import analyze as raw_analyze

SUPPORTED_EXTENSIONS = {".py", ".js", ".php"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".venv", "venv"}
LANG_TO_EXT = {"python": ".py", "javascript": ".js", "php": ".php"}

JS_KEYWORD_OPERATORS = {
    "if", "else", "switch", "case", "default", "for", "while", "do", "catch", "try", "finally", "return", "throw", "new", "delete", "typeof", "instanceof", "in", "void"
}

JS_OPERATOR_TOKENS = [
    "===", "!==", ">>>", "<<=", ">>=", "**=", "&&=", "||=", "??=", "=>",
    "==", "!=", "<=", ">=", "++", "--", "&&", "||", "??", "<<", ">>", "**", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
    "=", "+", "-", "*", "/", "%", "<", ">", "!", "~", "&", "|", "^", "?", ":", ".", ",", ";", "(", ")", "[", "]", "{", "}"
]

JS_OPERATOR_PATTERN = re.compile("|".join(re.escape(op) for op in sorted(JS_OPERATOR_TOKENS, key=len, reverse=True)))
JS_IDENTIFIER_PATTERN = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
JS_NUMBER_PATTERN = re.compile(r"\b\d+(?:\.\d+)?\b")
JS_STRING_PATTERN = re.compile(r"(['\"]).*?(?<!\\)\1", re.DOTALL)
GENERIC_DECISION_PATTERN = re.compile(r"\b(if|elif|else\s+if|for|while|case|catch|except)\b|&&|\|\||\?")


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


def cyclomatic_detail_from_flowgraph(flowgraph: Dict, predicate_count: int) -> Dict:
    edge_count = len(flowgraph.get("edges", []))
    node_count = len(flowgraph.get("nodes", []))
    connected_components = 1
    vg_formula = edge_count - node_count + 2 * connected_components
    vg_predicate = predicate_count + 1
    return {
        "edge_count": edge_count,
        "node_count": node_count,
        "connected_components": connected_components,
        "vg_formula": vg_formula,
        "vg_predicate": vg_predicate,
    }


def mi_from_cc_volume_loc(complexity: int, volume: float, loc: int) -> float:
    effective_cc = max(complexity, 1)
    effective_loc = max(loc, 1)
    effective_volume = max(volume, 1.0)
    mi = 171 - 5.2 * math.log(effective_volume) - 0.23 * effective_cc - 16.2 * math.log(effective_loc)
    return max(0.0, min(100.0, mi * 100 / 171))


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


def lines_for_range(content: str, start_line: Optional[int], end_line: Optional[int]) -> str:
    if not start_line or not end_line or start_line <= 0 or end_line < start_line:
        return ""
    lines = content.splitlines()
    if start_line > len(lines):
        return ""
    end = min(end_line, len(lines))
    return "\n".join(lines[start_line - 1:end])


def zero_halstead_detail() -> Dict:
    return {
        "n1": 0,
        "n2": 0,
        "N1": 0,
        "N2": 0,
        "program_length": 0,
        "vocabulary": 0,
        "volume": 0.0,
        "difficulty": 0.0,
        "effort": 0.0,
    }


def to_ideal_halstead(halstead_detail: Dict) -> Dict:
    effort = float(halstead_detail.get("effort", 0.0) or 0.0)
    return {
        "n1": int(halstead_detail.get("n1", 0) or 0),
        "n2": int(halstead_detail.get("n2", 0) or 0),
        "N1": int(halstead_detail.get("N1", 0) or 0),
        "N2": int(halstead_detail.get("N2", 0) or 0),
        "vocabulary": int(halstead_detail.get("vocabulary", 0) or 0),
        "length": int(halstead_detail.get("program_length", 0) or 0),
        "volume": round(float(halstead_detail.get("volume", 0.0) or 0.0), 2),
        "difficulty": round(float(halstead_detail.get("difficulty", 0.0) or 0.0), 2),
        "effort": round(effort, 2),
        "time_to_program": round(effort / 18.0, 2),
        "bugs": round(float(halstead_detail.get("volume", 0.0) or 0.0) / 3000.0, 4),
    }


def fallback_metrics(content: str, rel_file: str, ext: str, loc: int, error_message: str) -> Dict:
    decision_count = len(GENERIC_DECISION_PATTERN.findall(content))
    complexity = max(1, 1 + decision_count)
    predicate_count = max(complexity - 1, 0)
    flowgraph = build_flowgraph(predicate_count)
    if ext == ".js":
        halstead_detail = js_halstead(content)
    else:
        halstead_detail = zero_halstead_detail()

    mi = mi_from_cc_volume_loc(complexity, float(halstead_detail.get("volume", 0.0)), loc)
    function_name = "__parse_fallback__"
    fn = {
        "file": rel_file,
        "name": function_name,
        "function_name": function_name,
        "file_path": rel_file,
        "start_line": 1,
        "end_line": loc,
        "predicate_count": predicate_count,
        "vg": complexity,
        "cyclomatic_complexity": complexity,
        "complexity_category": complexity_category(complexity),
        "flowgraph": flowgraph,
        "cyclomatic_detail": cyclomatic_detail_from_flowgraph(flowgraph, predicate_count),
        "halstead": to_ideal_halstead(halstead_detail),
    }

    return {
        "file": rel_file,
        "file_path": rel_file,
        "loc": loc,
        "language": ext.replace(".", ""),
        "function_count": 1,
        "complexity_score": complexity,
        "complexity_category": complexity_category(complexity),
        "predicate_count": predicate_count,
        "maintainability_index": round(mi, 2),
        "maintainability_category": mi_category(mi),
        "halstead_detail": halstead_detail,
        "halstead": to_ideal_halstead(halstead_detail),
        "functions": [fn],
        "parse_fallback": True,
        "parse_error": error_message,
    }


def safe_loc(content: str) -> int:
    try:
        return max(raw_analyze(content).loc, 1)
    except Exception:
        return max(len(content.splitlines()), 1)


def py_metrics(content: str, rel_file: str, loc: int) -> Tuple[int, int, float, Dict, List[Dict]]:
    blocks = cc_visit(content)
    complexity = int(sum(block.complexity for block in blocks)) if blocks else 1
    function_count = len(blocks)

    halstead = h_visit(content)
    total = getattr(halstead, "total", None)
    n1 = int(getattr(total, "h1", 0) or 0)
    n2 = int(getattr(total, "h2", 0) or 0)
    N1 = int(getattr(total, "N1", 0) or 0)
    N2 = int(getattr(total, "N2", 0) or 0)
    volume = float(getattr(total, "volume", 0.0) or 0.0)
    difficulty = float(getattr(total, "difficulty", 0.0) or 0.0)
    effort = float(getattr(total, "effort", 0.0) or 0.0)

    mi = mi_from_cc_volume_loc(complexity, volume, loc)

    functions: List[Dict] = []
    for block in blocks:
        vg = int(block.complexity)
        predicate_count = max(vg - 1, 0)
        flowgraph = build_flowgraph(predicate_count)
        start_line = int(getattr(block, "lineno", 0) or 0)
        end_line = int(getattr(block, "endline", 0) or start_line)
        snippet = lines_for_range(content, start_line, end_line)
        fn_halstead = zero_halstead_detail()
        if snippet.strip():
            try:
                h_data = h_visit(snippet)
                h_total = getattr(h_data, "total", None)
                fn_n1 = int(getattr(h_total, "h1", 0) or 0)
                fn_n2 = int(getattr(h_total, "h2", 0) or 0)
                fn_N1 = int(getattr(h_total, "N1", 0) or 0)
                fn_N2 = int(getattr(h_total, "N2", 0) or 0)
                fn_halstead = {
                    "n1": fn_n1,
                    "n2": fn_n2,
                    "N1": fn_N1,
                    "N2": fn_N2,
                    "program_length": fn_N1 + fn_N2,
                    "vocabulary": fn_n1 + fn_n2,
                    "volume": round(float(getattr(h_total, "volume", 0.0) or 0.0), 2),
                    "difficulty": round(float(getattr(h_total, "difficulty", 0.0) or 0.0), 2),
                    "effort": round(float(getattr(h_total, "effort", 0.0) or 0.0), 2),
                }
            except Exception:
                fn_halstead = zero_halstead_detail()
        functions.append({
            "file": rel_file,
            "name": str(block.name),
            "function_name": str(block.name),
            "file_path": rel_file,
            "start_line": start_line,
            "end_line": end_line,
            "predicate_count": predicate_count,
            "vg": vg,
            "cyclomatic_complexity": vg,
            "complexity_category": complexity_category(vg),
            "flowgraph": flowgraph,
            "cyclomatic_detail": cyclomatic_detail_from_flowgraph(flowgraph, predicate_count),
            "halstead": to_ideal_halstead(fn_halstead),
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


def js_halstead(content: str) -> Dict:
    stripped = re.sub(r"//.*?$|/\*.*?\*/", " ", content, flags=re.MULTILINE | re.DOTALL)

    operators_unique = set()
    operands_unique = set()
    N1 = 0
    N2 = 0

    for keyword in JS_KEYWORD_OPERATORS:
        count = len(re.findall(rf"\b{re.escape(keyword)}\b", stripped))
        if count:
            operators_unique.add(keyword)
            N1 += count

    for match in JS_OPERATOR_PATTERN.finditer(stripped):
        op = match.group(0)
        operators_unique.add(op)
        N1 += 1

    for match in JS_STRING_PATTERN.finditer(stripped):
        operands_unique.add(match.group(0))
        N2 += 1

    for match in JS_NUMBER_PATTERN.finditer(stripped):
        operands_unique.add(match.group(0))
        N2 += 1

    for match in JS_IDENTIFIER_PATTERN.finditer(stripped):
        token = match.group(0)
        if token in JS_KEYWORD_OPERATORS:
            continue
        operands_unique.add(token)
        N2 += 1

    n1 = len(operators_unique)
    n2 = len(operands_unique)
    program_length = N1 + N2
    vocabulary = n1 + n2
    volume = program_length * math.log2(vocabulary) if vocabulary > 0 and program_length > 0 else 0.0
    difficulty = (n1 / 2.0) * (N2 / max(n2, 1)) if n1 > 0 and n2 > 0 else 0.0
    effort = volume * difficulty

    return {
        "n1": n1,
        "n2": n2,
        "N1": N1,
        "N2": N2,
        "program_length": program_length,
        "vocabulary": vocabulary,
        "volume": round(volume, 2),
        "difficulty": round(difficulty, 2),
        "effort": round(effort, 2),
    }


def js_metrics(path: str, rel_file: str, loc: int, content: str) -> Tuple[int, int, float, Dict, List[Dict]]:
    analysis = lizard.analyze_file(path)
    functions: List[Dict] = []
    complexity = 0

    for fn in analysis.function_list:
        vg = int(fn.cyclomatic_complexity)
        complexity += vg
        predicate_count = max(vg - 1, 0)
        flowgraph = build_flowgraph(predicate_count)
        start_line = int(getattr(fn, "start_line", 0) or 0)
        end_line = int(getattr(fn, "end_line", 0) or start_line)
        snippet = lines_for_range(content, start_line, end_line)
        fn_halstead = js_halstead(snippet) if snippet.strip() else zero_halstead_detail()
        functions.append({
            "file": rel_file,
            "name": str(fn.name),
            "function_name": str(fn.name),
            "file_path": rel_file,
            "start_line": start_line,
            "end_line": end_line,
            "predicate_count": predicate_count,
            "vg": vg,
            "cyclomatic_complexity": vg,
            "complexity_category": complexity_category(vg),
            "flowgraph": flowgraph,
            "cyclomatic_detail": cyclomatic_detail_from_flowgraph(flowgraph, predicate_count),
            "halstead": to_ideal_halstead(fn_halstead),
        })

    function_count = len(functions)
    halstead_detail = js_halstead(content)
    mi = mi_from_cc_volume_loc(complexity if complexity > 0 else 1, float(halstead_detail["volume"]), loc)
    return complexity, function_count, round(mi, 2), halstead_detail, functions


def classify_php_parse_issue(message: str) -> str:
    msg = message.lower()
    compatibility_hints = [
        "unexpected token",
        "unexpected",
        "syntax error",
        "parse error",
    ]
    if any(hint in msg for hint in compatibility_hints):
        return "ast_unavailable"
    return "analysis_unavailable"


def php_metrics(path: str, loc: int, rel_file: str) -> Tuple[int, int, float, Dict, List[Dict], Optional[Dict]]:
    helper_path = os.path.join(os.path.dirname(__file__), "php_metrics.php")
    output = subprocess.run(["php", helper_path, path], check=True, capture_output=True, text=True)
    parsed = json.loads(output.stdout)

    complexity = int(parsed.get("complexity", 0))
    function_count = int(parsed.get("function_count", 0))
    volume = float(parsed.get("halstead_volume", 0.0))
    difficulty = float(parsed.get("halstead_difficulty", 0.0))
    effort = float(parsed.get("halstead_effort", 0.0))

    mi = mi_from_cc_volume_loc(complexity, volume, loc)

    functions: List[Dict] = []
    for fn in parsed.get("functions", []):
        vg = int(fn.get("vg", 1))
        predicate_count = int(fn.get("predicate_count", max(vg - 1, 0)))
        flowgraph = fn.get("flowgraph")
        if not isinstance(flowgraph, dict):
            flowgraph = build_flowgraph(predicate_count)

        cyc_detail = fn.get("cyclomatic_detail")
        if not isinstance(cyc_detail, dict):
            cyc_detail = cyclomatic_detail_from_flowgraph(flowgraph, predicate_count)

        functions.append({
            "file": rel_file,
            "name": str(fn.get("name", "function")),
            "function_name": str(fn.get("name", "function")),
            "file_path": rel_file,
            "start_line": int(fn.get("start_line", 0) or 0),
            "end_line": int(fn.get("end_line", 0) or 0),
            "predicate_count": predicate_count,
            "vg": vg,
            "cyclomatic_complexity": vg,
            "complexity_category": complexity_category(vg),
            "flowgraph": flowgraph,
            "cyclomatic_detail": cyc_detail,
            "halstead": to_ideal_halstead(zero_halstead_detail()),
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

    parse_error = parsed.get("parse_error")
    parse_info = None
    if isinstance(parse_error, str) and parse_error.strip():
        parse_info = {
            "parse_fallback": True,
            "parse_error": parse_error.strip(),
            "parse_issue_type": classify_php_parse_issue(parse_error),
        }

    return complexity, function_count, round(mi, 2), halstead_detail, functions, parse_info


def analyze_file(path: str, root: str) -> Dict:
    content = read_file(path)
    loc = safe_loc(content)
    ext = os.path.splitext(path)[1].lower()
    rel_file = os.path.relpath(path, root).replace("\\", "/")

    parse_info: Dict = {}
    if ext == ".py":
        complexity, function_count, mi, halstead_detail, functions = py_metrics(content, rel_file, loc)
    elif ext == ".php":
        complexity, function_count, mi, halstead_detail, functions, php_parse_info = php_metrics(path, loc, rel_file)
        parse_info = php_parse_info or {}
    elif ext == ".js":
        complexity, function_count, mi, halstead_detail, functions = js_metrics(path, rel_file, loc, content)
    else:
        raise ValueError("Bahasa tidak didukung. Fokus analyzer: .py, .js, .php")

    result = {
        "file": rel_file,
        "file_path": rel_file,
        "loc": loc,
        "language": ext.replace(".", ""),
        "function_count": function_count,
        "complexity_score": complexity,
        "complexity_category": complexity_category(complexity),
        "predicate_count": max(complexity - function_count, 0),
        "maintainability_index": mi,
        "maintainability_category": mi_category(mi),
        "halstead_detail": halstead_detail,
        "halstead": to_ideal_halstead(halstead_detail),
        "functions": functions,
    }
    result.update(parse_info)
    return result


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
            flowgraph = build_flowgraph(pseudo_predicate)
            item["functions"] = [{
                "file": item["file"],
                "name": "__script__",
                "function_name": "__script__",
                "file_path": item["file"],
                "start_line": 1,
                "end_line": item.get("loc", 1),
                "predicate_count": pseudo_predicate,
                "vg": item["complexity_score"],
                "cyclomatic_complexity": item["complexity_score"],
                "complexity_category": complexity_category(item["complexity_score"]),
                "flowgraph": flowgraph,
                "cyclomatic_detail": cyclomatic_detail_from_flowgraph(flowgraph, pseudo_predicate),
                "halstead": to_ideal_halstead(item.get("halstead_detail") or zero_halstead_detail()),
            }]
        all_functions.extend(item.get("functions", []))

    top_functions = sorted(all_functions, key=lambda f: f["vg"], reverse=True)[:50]

    total_loc = sum(item["loc"] for item in files)
    total_functions = sum(item["function_count"] for item in files)
    avg_complexity = (sum(item["complexity_score"] for item in files) / len(files)) if files else 0.0
    avg_maintainability = (sum(item["maintainability_index"] for item in files) / len(files)) if files else 0.0
    avg_halstead_volume = (sum(float(item["halstead_detail"]["volume"]) for item in files) / len(files)) if files else 0.0

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
        files = []
        fallback_files: List[str] = []
        for path in find_source_files(abs_path):
            rel = os.path.relpath(path, abs_path).replace("\\", "/")
            try:
                files.append(analyze_file(path, abs_path))
            except Exception as exc:
                content = read_file(path)
                loc = safe_loc(content)
                ext = os.path.splitext(path)[1].lower()
                files.append(fallback_metrics(content, rel, ext, loc, str(exc)))
                fallback_files.append(f"{rel} ({exc})")

        payload = build_payload(files)
        parse_estimated_files = [item["file"] for item in files if item.get("parse_fallback")]
        if fallback_files:
            payload["recommendations"].insert(
                0,
                f"{len(fallback_files)} file gagal dianalisis penuh, diproses dengan estimator: "
                + "; ".join(fallback_files[:5])
                + ("; ..." if len(fallback_files) > 5 else ""),
            )
        elif parse_estimated_files:
            payload["recommendations"].insert(
                0,
                f"{len(parse_estimated_files)} file diproses dalam mode estimasi (AST parser tidak tersedia/kompatibel): "
                + "; ".join(parse_estimated_files[:5])
                + ("; ..." if len(parse_estimated_files) > 5 else ""),
            )
        return payload

    if os.path.isfile(abs_path):
        ext = os.path.splitext(abs_path)[1].lower()
        if ext not in SUPPORTED_EXTENSIONS:
            raise ValueError("File extension tidak didukung. Gunakan .py, .js, atau .php")
        root = os.path.dirname(abs_path)
        try:
            payload = build_payload([analyze_file(abs_path, root)])
            if payload["files"] and payload["files"][0].get("parse_fallback"):
                payload["recommendations"].insert(
                    0,
                    f"File '{os.path.basename(abs_path)}' diproses dalam mode estimasi (AST parser tidak tersedia/kompatibel).",
                )
            return payload
        except Exception as exc:
            filename = os.path.basename(abs_path)
            content = read_file(abs_path)
            loc = safe_loc(content)
            ext = os.path.splitext(abs_path)[1].lower()
            payload = build_payload([fallback_metrics(content, filename, ext, loc, str(exc))])
            payload["recommendations"].insert(
                0,
                f"File '{filename}' gagal dianalisis penuh, diproses dengan estimator: {exc}",
            )
            return payload

    raise ValueError("Path tidak ditemukan")


def analyze_snippet(language: str, code: str) -> Dict:
    ext = LANG_TO_EXT.get(language.lower())
    if not ext:
        raise ValueError("Language snippet tidak didukung. Gunakan python/javascript/php")

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, f"snippet{ext}")
        with open(path, "w", encoding="utf-8") as f:
            f.write(code)
        try:
            payload = build_payload([analyze_file(path, tmpdir)])
        except Exception as exc:
            raise ValueError(f"Snippet {language} gagal dianalisis penuh: {exc}") from exc
        if payload["files"] and payload["files"][0].get("parse_fallback"):
            payload["recommendations"].insert(
                0,
                "Snippet diproses dalam mode estimasi karena AST parser tidak tersedia/kompatibel.",
            )
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
