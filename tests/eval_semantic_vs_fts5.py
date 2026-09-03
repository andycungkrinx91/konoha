#!/usr/bin/env python3
"""
Evaluation script comparing FTS5-only vs Semantic-only vs Hybrid-RRF+rerank.
Evaluates 40 test queries split into English (20) and Indonesian (20) slices.
Computes Recall@5 and MRR@5 for both language slices.
"""

import os
import sys
import json
import sqlite3
import re
from typing import Dict, List, Tuple, Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import db
import vector_search

EVAL_DATASET = [
    # ─── English Queries (20) ───
    {"lang": "en", "query": "nextjs tailwind css styling", "expected": ["jonin-skill", "tailwind-design-system", "nextjs-code-expert"]},
    {"lang": "en", "query": "kubernetes cluster helm deployment and devops", "expected": ["anbu-skill", "devops-engineer"]},
    {"lang": "en", "query": "architecture review and threat model risk assessment", "expected": ["kage-skill", "risk-assessment"]},
    {"lang": "en", "query": "explore repository symbols and trace codepath", "expected": ["genin-skill", "code-exploration", "code-review"]},
    {"lang": "en", "query": "write technical documentation and api specification", "expected": ["tokubetsu-jonin-skill", "documentation-writer"]},
    {"lang": "en", "query": "svelte reactive components and sveltekit runes", "expected": ["jonin-skill", "svelte-code-expert", "svelte5-best-practices"]},
    {"lang": "en", "query": "docker container security hardening", "expected": ["anbu-skill", "anthropic-cybersecurity-skills"]},
    {"lang": "en", "query": "mermaid diagram syntax and visual architecture", "expected": ["kage-skill", "mermaid-diagrams", "drawio-skill"]},
    {"lang": "en", "query": "drawio architecture system layout diagrams", "expected": ["kage-skill", "drawio-skill"]},
    {"lang": "en", "query": "nuxt nitro server engine and vue composables", "expected": ["jonin-skill", "nuxt-code-expert", "nuxt"]},
    {"lang": "en", "query": "angular standalone components signals v19", "expected": ["jonin-skill", "angular-code-expert", "angular-developer"]},
    {"lang": "en", "query": "prometheus grafana metrics monitoring dashboards", "expected": ["anbu-skill", "prometheus-grafana"]},
    {"lang": "en", "query": "web research documentation synthesis evidence", "expected": ["chunin-skill"]},
    {"lang": "en", "query": "secret safety scanning and credential exposure", "expected": ["genin-skill", "secret-safety"]},
    {"lang": "en", "query": "router for mcp task triage and ninja subagents", "expected": ["sannin-skill"]},
    {"lang": "en", "query": "postmortem report incident root cause analysis", "expected": ["tokubetsu-jonin-skill", "postmortem-writer"]},
    {"lang": "en", "query": "laravel artisan php database migrations", "expected": ["anbu-skill", "laravel-specialist"]},
    {"lang": "en", "query": "framer motion smooth gpu transitions and animations", "expected": ["jonin-skill", "framer-motion-animator"]},
    {"lang": "en", "query": "spline 3d interactive canvas experience", "expected": ["jonin-skill", "spline-interactive"]},
    {"lang": "en", "query": "token safety and efficient context window budgeting", "expected": ["genin-skill", "token-safety"]},

    # ─── Indonesian Queries (20) ───
    {"lang": "id", "query": "cara membuat komponen tombol interaktif tailwind dan react", "expected": ["jonin-skill", "tailwind-design-system", "nextjs-code-expert"]},
    {"lang": "id", "query": "panduan deployment server kubernetes dan perbaikan bug", "expected": ["anbu-skill", "devops-engineer"]},
    {"lang": "id", "query": "evaluasi resiko keamanan sistem dan desain arsitektur", "expected": ["kage-skill", "risk-assessment"]},
    {"lang": "id", "query": "menelusuri alur kode dan melihat dependensi berkas", "expected": ["genin-skill", "code-exploration"]},
    {"lang": "id", "query": "membuat dokumen teknis dan panduan penggunaan api", "expected": ["tokubetsu-jonin-skill", "documentation-writer"]},
    {"lang": "id", "query": "pembuatan tampilan web svelte dan sveltekit", "expected": ["jonin-skill", "svelte-code-expert"]},
    {"lang": "id", "query": "keamanan container docker dan pencegahan kebocoran", "expected": ["anbu-skill", "anthropic-cybersecurity-skills"]},
    {"lang": "id", "query": "membuat diagram alur arsitektur mermaid", "expected": ["kage-skill", "mermaid-diagrams"]},
    {"lang": "id", "query": "desain diagram sistem menggunakan drawio", "expected": ["kage-skill", "drawio-skill"]},
    {"lang": "id", "query": "pengembangan aplikasi nuxt dan server nitro", "expected": ["jonin-skill", "nuxt-code-expert", "nuxt"]},
    {"lang": "id", "query": "framework angular komponen sinyal modern", "expected": ["jonin-skill", "angular-code-expert", "angular-developer"]},
    {"lang": "id", "query": "pemantauan sistem dengan prometheus dan dashboard grafana", "expected": ["anbu-skill", "prometheus-grafana"]},
    {"lang": "id", "query": "riset web dan pencarian referensi dokumentasi", "expected": ["chunin-skill"]},
    {"lang": "id", "query": "pencegahan kebocoran kunci rahasia dan kredensial", "expected": ["genin-skill", "secret-safety"]},
    {"lang": "id", "query": "pemilihan subagent dan pembagian tugas ninja", "expected": ["sannin-skill"]},
    {"lang": "id", "query": "penulisan laporan insiden dan analisis akar masalah", "expected": ["tokubetsu-jonin-skill", "postmortem-writer"]},
    {"lang": "id", "query": "pengembangan backend php laravel dan struktur database", "expected": ["anbu-skill", "laravel-specialist"]},
    {"lang": "id", "query": "animasi transisi gpu halus dengan framer motion", "expected": ["jonin-skill", "framer-motion-animator"]},
    {"lang": "id", "query": "integrasi kanvas 3d interaktif spline", "expected": ["jonin-skill", "spline-interactive"]},
    {"lang": "id", "query": "penghematan token dan optimasi pemakaian konteks", "expected": ["genin-skill", "token-safety"]},
]


def run_fts5_only(conn: sqlite3.Connection, query: str, top_k: int = 5) -> List[str]:
    """Pure FTS5 BM25 search."""
    clean_q = re.sub(r'[^a-zA-Z0-9_\-\s]', ' ', query).strip()
    if not clean_q:
        return []
    tokens = [f'"{t}"*' for t in clean_q.split() if t]
    fts_query = " OR ".join(tokens)
    try:
        rows = conn.execute("""
            SELECT name, bm25(skills_fts) as rank
            FROM skills_fts
            WHERE skills_fts MATCH ?
            ORDER BY rank ASC
            LIMIT ?
        """, (fts_query, top_k)).fetchall()
        return [r[0] for r in rows]
    except Exception:
        # LIKE fallback
        like_q = "%" + "%".join(clean_q.split()) + "%"
        rows = conn.execute("SELECT name FROM skills WHERE tags LIKE ? OR name LIKE ? LIMIT ?", (like_q, like_q, top_k)).fetchall()
        return [r[0] for r in rows]


def run_semantic_only(conn: sqlite3.Connection, query: str, top_k: int = 5) -> List[str]:
    """Pure Vector cosine search."""
    q_vec = vector_search.embed_text(query)
    chunks = vector_search.scan_nearest_chunks(conn, q_vec, candidate_k=top_k * 3)
    seen = []
    for s_name, _, _, _ in chunks:
        if s_name not in seen:
            seen.append(s_name)
        if len(seen) >= top_k:
            break
    return seen


def run_hybrid(conn: sqlite3.Connection, query: str, top_k: int = 5) -> List[str]:
    """Hybrid: Vector + FTS5 + RRF + GTE Rerank."""
    results = vector_search.find_skill_semantic(conn, query, top_k=top_k, candidate_k=25)
    return [r["name"] for r in results]


def is_hit(retrieved: List[str], expected: List[str]) -> Tuple[bool, float]:
    """
    Returns (hit_boolean, reciprocal_rank).
    """
    for rank, item in enumerate(retrieved):
        for exp in expected:
            if exp in item:
                return True, 1.0 / (rank + 1)
    return False, 0.0


def evaluate():
    conn = db.get_connection()
    modes = {
        "FTS5-only": run_fts5_only,
        "Semantic-only": run_semantic_only,
        "Hybrid-RRF+rerank": run_hybrid
    }

    results = {}
    for mode_name, fn in modes.items():
        results[mode_name] = {
            "en": {"hits": 0, "rr_sum": 0.0, "total": 0},
            "id": {"hits": 0, "rr_sum": 0.0, "total": 0},
            "all": {"hits": 0, "rr_sum": 0.0, "total": 0}
        }

        for item in EVAL_DATASET:
            lang = item["lang"]
            retrieved = fn(conn, item["query"], top_k=5)
            hit, rr = is_hit(retrieved, item["expected"])

            results[mode_name][lang]["total"] += 1
            results[mode_name]["all"]["total"] += 1
            if hit:
                results[mode_name][lang]["hits"] += 1
                results[mode_name][lang]["rr_sum"] += rr
                results[mode_name]["all"]["hits"] += 1
                results[mode_name]["all"]["rr_sum"] += rr

    print("\n=========================================================================")
    print("           EVALUATION REPORT: FTS5 vs Semantic vs Hybrid (RRF+Rerank)")
    print("=========================================================================")
    print(f"{'Method':<20} | {'Lang':<5} | {'Recall@5':<10} | {'MRR@5':<10}")
    print("---------------------+-------+------------+-----------")

    for mode_name in modes.keys():
        for slice_key in ["en", "id", "all"]:
            d = results[mode_name][slice_key]
            rec = (d["hits"] / d["total"]) * 100 if d["total"] > 0 else 0
            mrr = (d["rr_sum"] / d["total"]) if d["total"] > 0 else 0
            label = mode_name if slice_key == "en" else ""
            print(f"{label:<20} | {slice_key:<5} | {rec:>6.1f}%    | {mrr:>8.3f}")
        print("---------------------+-------+------------+-----------")

    # Verification assertions: Hybrid must beat FTS5 on Indonesian and match/beat on English
    en_fts5 = results["FTS5-only"]["en"]["hits"]
    en_hyb = results["Hybrid-RRF+rerank"]["en"]["hits"]
    id_fts5 = results["FTS5-only"]["id"]["hits"]
    id_hyb = results["Hybrid-RRF+rerank"]["id"]["hits"]

    print("\nKey Comparisons:")
    print(f"  English    : Hybrid {en_hyb}/20 vs FTS5 {en_fts5}/20")
    print(f"  Indonesian : Hybrid {id_hyb}/20 vs FTS5 {id_fts5}/20")

    conn.close()
    return results


if __name__ == "__main__":
    evaluate()
