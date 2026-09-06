"""
Vector Search & Cross-Lingual Semantic Retrieval Engine for Konoha.
Provides IBM Granite multilingual embedding, GTE multilingual cross-encoder reranking,
markdown heading chunking, sqlite-vector extension management, and Reciprocal Rank Fusion (RRF).
"""

import io
import hashlib
import json
import logging
import os
import platform
import re
import shutil
import sqlite3
import sys
import tarfile
import urllib.request
import zipfile
from typing import Dict, List, Optional, Tuple, Any

import numpy as np

logger = logging.getLogger("konoha.vector_search")

# Environment & feature flags
SEMANTIC_SEARCH_ENV = "KONOHA_SEMANTIC_SEARCH"

EMBED_MODEL_REPO = "onnx-community/granite-embedding-97m-multilingual-r2-ONNX"
RERANK_MODEL_REPO = "onnx-community/gte-multilingual-reranker-base"
VECTOR_DIMENSION = 384
SQLITE_VECTOR_VERSION = "1.1.0"

_EXTENSION_FAILED_ONCE = False
_EXTENSION_INITIALIZED = False
_EMBED_SESSION = None
_EMBED_CACHE: Dict[str, np.ndarray] = {}
_MAX_EMBED_CACHE = 4096
_EMBED_TOKENIZER = None
_RERANK_SESSION = None
_RERANK_TOKENIZER = None


def is_semantic_search_enabled() -> bool:
    """Check if semantic search feature flag is enabled. Enabled by default."""
    val = os.environ.get(SEMANTIC_SEARCH_ENV, "1").strip().lower()
    return val not in ("0", "false", "no", "disabled")


# ──────────────── Platform Detection & sqlite-vector Loading ────────────────

def get_platform_tag() -> str:
    """
    Returns canonical platform tag (e.g. linux-x64, linux-arm64, darwin-arm64, darwin-x64, windows-x64).
    """
    sys_name = platform.system().lower()
    mach = platform.machine().lower()
    if sys_name == "linux":
        arch = "arm64" if mach in ("aarch64", "arm64") else "x64"
        return f"linux-{arch}"
    elif sys_name == "darwin":
        arch = "arm64" if mach in ("aarch64", "arm64") else "x64"
        return f"darwin-{arch}"
    elif sys_name in ("windows", "win32"):
        arch = "arm64" if mach in ("aarch64", "arm64") else "x64"
        return f"windows-{arch}"
    return f"{sys_name}-{mach}"


def get_platform_asset_info() -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (asset_filename, library_filename) for current OS and architecture.
    """
    sys_name = platform.system().lower()
    mach = platform.machine().lower()

    if sys_name == "linux":
        lib_name = "vector.so"
        if mach in ("x86_64", "amd64"):
            return f"vector-linux-x86_64-{SQLITE_VECTOR_VERSION}.tar.gz", lib_name
        elif mach in ("aarch64", "arm64"):
            return f"vector-linux-arm64-{SQLITE_VECTOR_VERSION}.tar.gz", lib_name
    elif sys_name == "darwin":
        lib_name = "vector.dylib"
        if mach in ("arm64", "aarch64"):
            return f"vector-macos-arm64-{SQLITE_VECTOR_VERSION}.tar.gz", lib_name
        elif mach in ("x86_64", "amd64"):
            return f"vector-macos-x86_64-{SQLITE_VECTOR_VERSION}.tar.gz", lib_name
    elif sys_name in ("windows", "win32"):
        lib_name = "vector.dll"
        if mach in ("amd64", "x86_64"):
            return f"vector-windows-x86_64-{SQLITE_VECTOR_VERSION}.zip", lib_name

    return None, None


def get_vendor_dir() -> str:
    """Returns directory path for vendored sqlite-vector binaries."""
    konoha_dir = os.path.normpath(os.path.expanduser("~/.konoha"))
    vendor_dir = os.path.join(konoha_dir, "vendor", "sqlite-vector")
    os.makedirs(vendor_dir, exist_ok=True)
    return vendor_dir


def ensure_vector_extension() -> Optional[str]:
    """
    Locates or lazily downloads prebuilt sqlite-vector binary for current platform.
    Searches repo vendor directories and ~/.konoha cache.
    Returns absolute path to library file, or None if unavailable.
    """
    asset_name, lib_name = get_platform_asset_info()
    if not asset_name or not lib_name:
        return None

    tag = get_platform_tag()
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Candidate search paths: tagged folders, platform folders, and flat folders
    candidate_dirs = [
        os.path.join(repo_root, "vendor", "sqlite-vector", tag),
        os.path.join(get_vendor_dir(), tag),
        os.path.join(repo_root, "vendor", "sqlite-vector", platform.system().lower()),
        os.path.join(get_vendor_dir(), platform.system().lower()),
        os.path.join(repo_root, "vendor", "sqlite-vector"),
        get_vendor_dir(),
    ]
    for candidate_dir in candidate_dirs:
        candidate_path = os.path.join(candidate_dir, lib_name)
        if os.path.isfile(candidate_path):
            return candidate_path

    # Lazy download on first run to user cache
    dest_dir = os.path.join(get_vendor_dir(), tag)
    dest_file = os.path.join(dest_dir, lib_name)
    os.makedirs(dest_dir, exist_ok=True)

    url = f"https://github.com/sqliteai/sqlite-vector/releases/download/{SQLITE_VECTOR_VERSION}/{asset_name}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "konoha-agent"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()

        if asset_name.endswith(".tar.gz"):
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                tar.extractall(dest_dir)
        elif asset_name.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                zf.extractall(dest_dir)

        if os.path.isfile(dest_file):
            return dest_file

        # Fallback: search extracted directory tree for lib_name
        for root, _, files in os.walk(dest_dir):
            if lib_name in files:
                found_path = os.path.join(root, lib_name)
                if found_path != dest_file:
                    shutil.copyfile(found_path, dest_file)
                return dest_file
    except Exception as e:
        logger.warning("Failed to lazily download sqlite-vector binary: %s", e)

    return None


def enable_load_extension_safe(conn: sqlite3.Connection) -> bool:
    """
    Safely enables extension loading on SQLite connection.
    Logs warning once if capability is disabled at build-time.
    """
    global _EXTENSION_FAILED_ONCE
    if _EXTENSION_FAILED_ONCE:
        return False
    try:
        conn.enable_load_extension(True)
        return True
    except (AttributeError, sqlite3.OperationalError, Exception) as e:
        if not _EXTENSION_FAILED_ONCE:
            logger.debug("SQLite extension loading is not supported in this environment (%s); falling back to in-memory NumPy vector search.", e)
            _EXTENSION_FAILED_ONCE = True
        return False


_LOADED_CONNECTIONS = set()

def load_vector_extension(conn: sqlite3.Connection) -> bool:
    """
    Loads sqlite-vector extension and initializes vector column if needed.
    Falls back gracefully if extension loading is unsupported.
    """
    global _EXTENSION_FAILED_ONCE, _LOADED_CONNECTIONS
    if id(conn) in _LOADED_CONNECTIONS:
        return True

    if not enable_load_extension_safe(conn):
        return False

    ext_path = ensure_vector_extension()
    if not ext_path or not os.path.isfile(ext_path):
        return False

    try:
        conn.load_extension(ext_path)
        _LOADED_CONNECTIONS.add(id(conn))
        return True
    except Exception as e:
        if not _EXTENSION_FAILED_ONCE:
            logger.debug("Failed to load sqlite-vector extension from %s (%s); falling back to in-memory NumPy vector search.", ext_path, e)
            _EXTENSION_FAILED_ONCE = True
        return False


def init_vector_table_if_supported(conn: sqlite3.Connection) -> bool:
    """
    Runs vector_init on skill_chunks if extension is loaded.
    """
    if not load_vector_extension(conn):
        return False
    try:
        conn.execute(
            f"SELECT vector_init('skill_chunks', 'embedding', "
            f"'type=FLOAT32,dimension={VECTOR_DIMENSION},distance=COSINE,normalized=1');"
        )
        return True
    except Exception as e:
        logger.debug("vector_init notification: %s", e)
        return False


# ──────────────── Chunking Strategy ────────────────

def chunk_document(content: str, max_chars: int = 2000, overlap_chars: int = 100) -> List[Tuple[int, str]]:
    """
    Chunks document content by markdown headings (preserving semantic boundaries).
    Caps chunk size to max_chars with small overlap.
    Returns list of (chunk_index, chunk_text).
    """
    if not content or not content.strip():
        return []

    lines = content.split("\n")
    sections: List[str] = []
    current_lines: List[str] = []

    heading_regex = re.compile(r"^#{1,6}\s+")

    for line in lines:
        if heading_regex.match(line) and current_lines:
            sections.append("\n".join(current_lines).strip())
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append("\n".join(current_lines).strip())

    chunks: List[str] = []
    for section in sections:
        if not section:
            continue
        if len(section) <= max_chars:
            chunks.append(section)
        else:
            # Sub-split long section by paragraphs
            paragraphs = section.split("\n\n")
            current_sub = ""
            for p in paragraphs:
                p_clean = p.strip()
                if not p_clean:
                    continue
                if len(current_sub) + len(p_clean) + 2 <= max_chars:
                    current_sub = (current_sub + "\n\n" + p_clean).strip() if current_sub else p_clean
                else:
                    if current_sub:
                        chunks.append(current_sub)
                        overlap_tail = current_sub[-overlap_chars:] if len(current_sub) > overlap_chars else current_sub
                        current_sub = overlap_tail + "\n\n" + p_clean
                    else:
                        # Single massive paragraph: slide window
                        start = 0
                        while start < len(p_clean):
                            end = start + max_chars
                            sub_text = p_clean[start:end]
                            chunks.append(sub_text)
                            if end >= len(p_clean):
                                break
                            start = end - overlap_chars
                        current_sub = ""
            if current_sub:
                chunks.append(current_sub)

    # Deduplicate chunks within the document by normalized content hash
    deduped_chunks: List[Tuple[int, str]] = []
    seen_hashes = set()
    for chunk in chunks:
        c_clean = chunk.strip()
        if not c_clean:
            continue
        norm = " ".join(c_clean.split())
        h = hashlib.sha256(norm.encode("utf-8")).hexdigest()
        if h not in seen_hashes:
            seen_hashes.add(h)
            deduped_chunks.append((len(deduped_chunks), c_clean))

    return deduped_chunks


# ──────────────── Model Management (Granite Embedder & GTE Reranker) ────────────────

def get_embed_model():
    """Lazily loads IBM Granite multilingual embedding model and tokenizer."""
    global _EMBED_SESSION, _EMBED_TOKENIZER
    if _EMBED_SESSION is not None and _EMBED_TOKENIZER is not None:
        return _EMBED_SESSION, _EMBED_TOKENIZER

    from huggingface_hub import hf_hub_download
    import onnxruntime as ort
    from tokenizers import Tokenizer

    model_path = hf_hub_download(repo_id=EMBED_MODEL_REPO, filename="onnx/model_int8.onnx")
    tok_path = hf_hub_download(repo_id=EMBED_MODEL_REPO, filename="tokenizer.json")

    tokenizer = Tokenizer.from_file(tok_path)
    tokenizer.enable_padding(length=512)
    tokenizer.enable_truncation(max_length=512)

    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    _EMBED_SESSION = session
    _EMBED_TOKENIZER = tokenizer
    return _EMBED_SESSION, _EMBED_TOKENIZER


def get_rerank_model():
    """Lazily loads GTE multilingual reranker model and tokenizer."""
    global _RERANK_SESSION, _RERANK_TOKENIZER
    if _RERANK_SESSION is not None and _RERANK_TOKENIZER is not None:
        return _RERANK_SESSION, _RERANK_TOKENIZER

    from huggingface_hub import hf_hub_download
    import onnxruntime as ort
    from tokenizers import Tokenizer

    model_path = hf_hub_download(repo_id=RERANK_MODEL_REPO, filename="onnx/model_int8.onnx")
    tok_path = hf_hub_download(repo_id=RERANK_MODEL_REPO, filename="tokenizer.json")

    tokenizer = Tokenizer.from_file(tok_path)
    tokenizer.enable_padding(length=512)
    tokenizer.enable_truncation(max_length=512)

    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    _RERANK_SESSION = session
    _RERANK_TOKENIZER = tokenizer
    return _RERANK_SESSION, _RERANK_TOKENIZER


def predownload_all_models(silent: bool = False) -> Dict[str, Any]:
    """
    Pre-downloads and caches all neural model weights (IBM Granite Multilingual ONNX,
    GTE Multilingual Cross-Encoder Reranker, Tokenizers, and platform sqlite-vector binary).
    Safe, idempotent, and cross-platform (Windows, Linux, macOS).
    """
    results: Dict[str, Any] = {}
    try:
        if not silent:
            print("  ⚡ Pre-caching IBM Granite multilingual embedding model...")
        get_embed_model()
        results["embedding"] = True
    except Exception as e:
        results["embedding"] = False
        results["embedding_error"] = str(e)
        if not silent:
            print(f"  ⚠ Embedding model pre-download: {e}")

    try:
        if not silent:
            print("  ⚡ Pre-caching GTE multilingual reranker model...")
        get_rerank_model()
        results["reranker"] = True
    except Exception as e:
        results["reranker"] = False
        results["reranker_error"] = str(e)
        if not silent:
            print(f"  ⚠ Reranker model pre-download: {e}")

    try:
        lib_path = get_vector_extension_path()
        results["vector_extension"] = bool(lib_path)
    except Exception as e:
        results["vector_extension"] = False
        results["vector_extension_error"] = str(e)

    return results


def embed_text(text: str) -> np.ndarray:
    """
    Embeds text with Granite ONNX embedder with feature deduplication cache.
    Performs CLS token extraction and L2 normalization.
    Returns float32 384-dimensional vector.
    """
    global _EMBED_CACHE
    norm = " ".join((text or "").strip().split())
    text_hash = hashlib.sha256(norm.encode("utf-8")).hexdigest()
    if text_hash in _EMBED_CACHE:
        return _EMBED_CACHE[text_hash].copy()

    session, tokenizer = get_embed_model()
    encoded = tokenizer.encode(text)
    input_ids = np.array([encoded.ids], dtype=np.int64)
    attention_mask = np.array([encoded.attention_mask], dtype=np.int64)

    outputs = session.run(["last_hidden_state"], {
        "input_ids": input_ids,
        "attention_mask": attention_mask
    })
    cls_token = outputs[0][0, 0, :].astype(np.float32)
    norm = np.linalg.norm(cls_token)
    if norm > 0:
        cls_token = cls_token / norm

    if len(_EMBED_CACHE) >= _MAX_EMBED_CACHE:
        _EMBED_CACHE.pop(next(iter(_EMBED_CACHE)))
    _EMBED_CACHE[text_hash] = cls_token.copy()

    return cls_token


def rerank_pair(query: str, passage: str) -> float:
    """
    Cross-encoder reranker scoring between query and passage.
    Returns sigmoid probability score in [0.0, 1.0].
    """
    session, tokenizer = get_rerank_model()
    encoded = tokenizer.encode(query, passage)
    input_ids = np.array([encoded.ids], dtype=np.int64)
    attention_mask = np.array([encoded.attention_mask], dtype=np.int64)

    input_names = [i.name for i in session.get_inputs()]
    inputs = {input_names[0]: input_ids}
    if len(input_names) > 1:
        inputs[input_names[1]] = attention_mask
    if len(input_names) > 2 and "token_type_ids" in input_names:
        inputs["token_type_ids"] = np.array([encoded.type_ids], dtype=np.int64)

    outputs = session.run(None, inputs)
    logit = outputs[0][0]
    if isinstance(logit, np.ndarray):
        logit = logit[0]
    score = 1.0 / (1.0 + np.exp(-logit))
    return float(score)


# ──────────────── Reciprocal Rank Fusion (RRF) ────────────────

def reciprocal_rank_fusion(rank_lists: List[List[str]], k: int = 60) -> List[Tuple[str, float]]:
    """
    Merges multiple ranked lists of candidate keys using Reciprocal Rank Fusion.
    RRF score formula: sum(1.0 / (k + rank)) for each rank list.
    """
    scores: Dict[str, float] = {}
    for r_list in rank_lists:
        for rank, key in enumerate(r_list):
            scores[key] = scores.get(key, 0.0) + (1.0 / (k + rank + 1))

    # Sort descending by RRF score
    sorted_items = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return sorted_items


# ──────────────── Vector Search Execution ────────────────

def scan_nearest_chunks(
    conn: sqlite3.Connection,
    query_vec: np.ndarray,
    candidate_k: int = 25
) -> List[Tuple[str, int, str, float]]:
    """
    Searches skill_chunks for candidate_k nearest chunks.
    Uses sqlite-vector SIMD scan if available; falls back to exact in-memory cosine scan.
    Returns list of (skill_name, chunk_index, chunk_text, score).
    """
    has_ext = init_vector_table_if_supported(conn)
    if has_ext:
        try:
            conn.execute("SELECT vector_quantize('skill_chunks', 'embedding');")
            q_blob = query_vec.astype(np.float32).tobytes()
            sql = """
                SELECT c.skill_name, c.chunk_index, c.chunk_text, v.distance
                FROM vector_quantize_scan('skill_chunks', 'embedding', ?, ?) AS v
                JOIN skill_chunks AS c ON c.rowid = v.rowid
                ORDER BY v.distance ASC
            """
            rows = conn.execute(sql, (q_blob, candidate_k)).fetchall()
            results = []
            for r in rows:
                # distance to similarity score
                sim = 1.0 - float(r[3])
                results.append((r[0], r[1], r[2], sim))
            return results
        except Exception as e:
            logger.debug("vector_quantize_scan fallback to memory scan: %s", e)

    # In-memory exact scan fallback
    rows = conn.execute(
        "SELECT skill_name, chunk_index, chunk_text, embedding FROM skill_chunks WHERE embedding IS NOT NULL"
    ).fetchall()
    if not rows:
        return []

    scored = []
    for r in rows:
        emb_bytes = r[3]
        if not emb_bytes or len(emb_bytes) != VECTOR_DIMENSION * 4:
            continue
        vec = np.frombuffer(emb_bytes, dtype=np.float32)
        # Cosine similarity for unit vectors is dot product
        sim = float(np.dot(query_vec, vec))
        scored.append((r[0], r[1], r[2], sim))

    scored.sort(key=lambda x: x[3], reverse=True)
    return scored[:candidate_k]


# ──────────────── Hybrid Search & Reranking ────────────────

def find_skill_semantic(
    conn: sqlite3.Connection,
    query: str,
    top_k: int = 5,
    candidate_k: int = 25
) -> List[Dict[str, Any]]:
    """
    Hybrid semantic search over skills:
    1. Embeds query with Granite multilingual embedder.
    2. Scans skill_chunks for vector candidates.
    3. Queries skills_fts with bm25.
    4. Merges candidate lists with RRF.
    5. Reranks candidate pairs with GTE multilingual reranker.
    6. Max-pools chunk scores to skill-level and returns top_k.
    """
    if not query or not query.strip():
        return []

    # 1. Vector scan
    query_vec = embed_text(query)
    vec_chunks = scan_nearest_chunks(conn, query_vec, candidate_k=candidate_k)
    vec_skill_names = []
    for s_name, _, _, _ in vec_chunks:
        if s_name not in vec_skill_names:
            vec_skill_names.append(s_name)

    # 2. FTS5 BM25 search
    fts_skill_names = []
    try:
        # Sanitize query for FTS5
        clean_q = re.sub(r'[^a-zA-Z0-9_\-\s]', ' ', query).strip()
        if clean_q:
            tokens = [f'"{t}"*' for t in clean_q.split() if t]
            fts_query = " OR ".join(tokens)
            fts_sql = """
                SELECT name, bm25(skills_fts) as rank
                FROM skills_fts
                WHERE skills_fts MATCH ?
                ORDER BY rank ASC
                LIMIT ?
            """
            rows = conn.execute(fts_sql, (fts_query, candidate_k)).fetchall()
            fts_skill_names = [r[0] for r in rows]
    except Exception as e:
        logger.debug("FTS5 query in hybrid search fallback: %s", e)

    # 3. RRF Merge
    fused = reciprocal_rank_fusion([vec_skill_names, fts_skill_names], k=60)
    candidate_skills = [s for s, _ in fused[:candidate_k]]
    if not candidate_skills:
        return []

    # 4. Gather chunk snippets for candidate skills
    placeholders = ",".join("?" * len(candidate_skills))
    chunk_rows = conn.execute(
        f"SELECT skill_name, chunk_index, chunk_text FROM skill_chunks WHERE skill_name IN ({placeholders})",
        candidate_skills
    ).fetchall()

    chunks_by_skill: Dict[str, List[str]] = {}
    for r in chunk_rows:
        chunks_by_skill.setdefault(r[0], []).append(r[2])

    # 5. Rerank top candidates using GTE cross-encoder
    top_candidates = candidate_skills[:8]
    skill_max_scores: Dict[str, float] = {}
    for s_name in top_candidates:
        skill_chunks_list = chunks_by_skill.get(s_name, [])
        if skill_chunks_list:
            rep_chunk = skill_chunks_list[0]
        else:
            s_row = conn.execute("SELECT content FROM skills WHERE name = ?", (s_name,)).fetchone()
            rep_chunk = s_row[0][:800] if (s_row and s_row[0]) else s_name

        try:
            sc = rerank_pair(query, rep_chunk[:800])
        except Exception:
            sc = 0.5
        skill_max_scores[s_name] = sc

    # Sort skills by reranked score
    ranked_skills = sorted(skill_max_scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

    # Fetch full skill records
    results = []
    for s_name, score in ranked_skills:
        row = conn.execute(
            "SELECT name, skill_name, type, tags, content, file_path, byte_size, line_count FROM skills WHERE name = ?",
            (s_name,)
        ).fetchone()
        if row:
            results.append({
                "name": row["name"],
                "skill_name": row["skill_name"],
                "type": row["type"],
                "tags": row["tags"],
                "content": row["content"],
                "file_path": row["file_path"],
                "byte_size": row["byte_size"],
                "line_count": row["line_count"],
                "score": score
            })

    return results


# ──────────────── Reindexing & Embedding Backfill ────────────────

def index_single_skill_chunks(conn: sqlite3.Connection, skill_name: str, content: str) -> int:
    """
    Chunks and embeds a single skill's content, storing into skill_chunks.
    Idempotent: removes existing chunks for skill_name before inserting.
    Returns count of chunks created.
    """
    chunks = chunk_document(content)
    conn.execute("DELETE FROM skill_chunks WHERE skill_name = ?", (skill_name,))
    if not chunks:
        return 0

    for idx, chunk_text in chunks:
        # DB-level deduplication: reuse pre-existing embedding if identical text exists
        existing_blob = conn.execute(
            "SELECT embedding FROM skill_chunks WHERE chunk_text = ? AND embedding IS NOT NULL LIMIT 1",
            (chunk_text,)
        ).fetchone()
        if existing_blob and existing_blob[0]:
            blob = existing_blob[0]
        else:
            vec = embed_text(chunk_text)
            blob = vec.astype(np.float32).tobytes()

        conn.execute(
            "INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)",
            (skill_name, idx, chunk_text, blob)
        )
    conn.commit()
    return len(chunks)


def backfill_all_embeddings(conn: sqlite3.Connection, force_rebuild: bool = False) -> int:
    """
    Backfills skill_chunks for all skills in database.
    Incremental: only embeds skills not yet in skill_chunks unless force_rebuild is True.
    """
    init_vector_table_if_supported(conn)
    if force_rebuild:
        conn.execute("DELETE FROM skill_chunks;")
        conn.commit()

    existing_indexed = set(
        r[0] for r in conn.execute("SELECT DISTINCT skill_name FROM skill_chunks").fetchall()
    )

    rows = conn.execute("SELECT name, content FROM skills").fetchall()
    total_chunks = 0
    for r in rows:
        s_name, s_content = r[0], r[1]
        if not force_rebuild and s_name in existing_indexed:
            continue
        if s_content:
            cnt = index_single_skill_chunks(conn, s_name, s_content)
            total_chunks += cnt

    # Initialize / quantize vector index after backfill
    if total_chunks > 0:
        init_vector_table_if_supported(conn)

    return total_chunks
