"""Extract searchable prompt text from ComfyUI prompt graphs and PNG outputs.

This module has no ComfyUI imports, so it can be used and tested on its own.

How it works
------------
* Only the PNG ``prompt`` text chunk is read. Other chunks (notably the often
  multi-megabyte ``workflow`` chunk) are skipped with a seek, never parsed.
* From API-format prompt graphs (whether supplied by Queue or read from PNGs),
  collect only the strings that actually
  feed a text-encoder node (``CLIPTextEncode`` and friends), following links to
  upstream string/primitive/concat nodes. Model names, sampler names, file
  names and other string widgets are ignored.
* Extracted text is cached per file (keyed by mtime + size), so repeated
  searches only pay for files that are new or changed.
"""

import json
import os
import threading
import zlib
from collections import OrderedDict

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Input names that can carry prompt text (substring match, lower-case).
# Deliberately does not match plain "clip", "model", "vae", "image", etc.
_PROMPT_KEY_HINTS = (
    "text", "prompt", "positive", "negative", "caption",
    "string", "value", "t5xxl", "clip_l", "clip_g",
)
_MAX_LINK_DEPTH = 6
_MAX_PROMPT_CHUNK_BYTES = 16 * 1024 * 1024
_MAX_TEXT_CHARS_PER_FILE = 50_000

_CACHE_MAX_ENTRIES = 20_000
_cache = OrderedDict()  # path -> ((mtime_ns, size), lowercased prompt text)
_cache_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Prompt graph -> text
# --------------------------------------------------------------------------- #

def _is_prompt_key(name):
    lowered = str(name).lower()
    return any(hint in lowered for hint in _PROMPT_KEY_HINTS)


def _is_encoder(class_type):
    lowered = str(class_type or "").lower()
    return "textencode" in lowered or "prompt" in lowered


def _is_link(value):
    # API-format link: [source_node_id, output_slot]
    return isinstance(value, list) and len(value) == 2 and isinstance(value[1], int)


def extract_prompt_texts(prompt):
    """Return the prompt strings found in an API-format ComfyUI prompt dict."""
    if not isinstance(prompt, dict):
        return []

    texts = []
    seen = set()

    def visit(node_id, depth):
        key = str(node_id)
        if key in seen or depth > _MAX_LINK_DEPTH:
            return
        seen.add(key)
        node = prompt.get(key)
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if not isinstance(inputs, dict):
            return
        for name, value in inputs.items():
            if not _is_prompt_key(name):
                continue
            if isinstance(value, str):
                if value.strip():
                    texts.append(value)
            elif _is_link(value):
                visit(value[0], depth + 1)

    starts = [
        node_id for node_id, node in prompt.items()
        if isinstance(node, dict) and _is_encoder(node.get("class_type"))
    ]
    if not starts:
        # Unusual graph with no recognisable text-encoder node: fall back to
        # every node, still restricted to prompt-like input names.
        starts = list(prompt)
    for node_id in starts:
        visit(node_id, 0)
    return texts


def get_prompt_search_text_from_graph(prompt):
    """Return lower-cased text-encoder prompt text from an API-format graph."""
    return "\n".join(extract_prompt_texts(prompt)).lower()[:_MAX_TEXT_CHARS_PER_FILE]


# --------------------------------------------------------------------------- #
# PNG chunk reading
# --------------------------------------------------------------------------- #

def _inflate(data, limit=_MAX_PROMPT_CHUNK_BYTES):
    # Bounded decompress: refuses to expand beyond `limit` bytes.
    return zlib.decompressobj().decompress(data, limit)


def _decode_text_chunk(chunk_type, data, nul):
    """Decode tEXt / zTXt / iTXt chunk data (keyword already located at `nul`)."""
    if chunk_type == b"tEXt":
        return data[nul + 1:].decode("latin-1")

    if chunk_type == b"zTXt":
        if data[nul + 1] != 0:  # only compression method 0 (zlib) exists
            return None
        return _inflate(data[nul + 2:]).decode("latin-1")

    # iTXt: keyword\0 compression_flag compression_method language\0 translated\0 text
    flag = data[nul + 1]
    rest = data[nul + 3:]
    lang_end = rest.index(b"\x00")
    translated_end = rest.index(b"\x00", lang_end + 1)
    body = rest[translated_end + 1:]
    if flag == 1:
        body = _inflate(body)
    return body.decode("utf-8", errors="replace")


def read_png_prompt(fileobj):
    """Return the parsed ``prompt`` JSON from an open PNG file, or None."""
    if fileobj.read(8) != _PNG_SIGNATURE:
        return None
    while True:
        header = fileobj.read(8)
        if len(header) < 8:
            return None
        length = int.from_bytes(header[:4], "big")
        chunk_type = header[4:]
        if chunk_type in (b"IDAT", b"IEND"):
            return None  # ComfyUI writes its text chunks before the image data

        if chunk_type in (b"tEXt", b"zTXt", b"iTXt"):
            head = fileobj.read(min(length, 80))  # keyword is at most 79 bytes
            nul = head.find(b"\x00")
            if nul != -1 and head[:nul] == b"prompt":
                if length > _MAX_PROMPT_CHUNK_BYTES:
                    return None
                data = head + fileobj.read(length - len(head))
                text = _decode_text_chunk(chunk_type, data, nul)
                return json.loads(text) if text else None
            fileobj.seek(length - len(head) + 4, 1)  # rest of data + CRC
        else:
            fileobj.seek(length + 4, 1)


# --------------------------------------------------------------------------- #
# Cached per-file text
# --------------------------------------------------------------------------- #

def get_prompt_search_text(path):
    """Lower-cased prompt text of a PNG ('' if none). Cached by mtime + size."""
    try:
        st = os.stat(path)
    except OSError:
        return ""
    signature = (st.st_mtime_ns, st.st_size)

    with _cache_lock:
        hit = _cache.get(path)
        if hit and hit[0] == signature:
            _cache.move_to_end(path)
            return hit[1]

    text = ""
    try:
        with open(path, "rb") as f:
            prompt = read_png_prompt(f)
        if prompt is not None:
            text = get_prompt_search_text_from_graph(prompt)
    except Exception:
        # Corrupt / truncated / non-ComfyUI PNG: treat as "no prompt".
        text = ""

    with _cache_lock:
        _cache[path] = (signature, text)
        _cache.move_to_end(path)
        while len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)
    return text


def clear_cache():
    with _cache_lock:
        _cache.clear()


# --------------------------------------------------------------------------- #
# Similar-prompt grouping
# --------------------------------------------------------------------------- #

def find_similar_prompt_groups(documents, threshold=0.55):
    """Group prompt documents by token-set Jaccard similarity.

    Documents are dictionaries containing an id and prompt text. Candidate
    pairs are generated through an inverted index, avoiding a full all-pairs
    comparison for unrelated prompts.
    """
    import re

    docs = []
    for item in documents:
        text = str(item.get("prompt") or "").lower()
        tokens = {
            token for token in re.findall(r"[a-z0-9_]+", text)
            if len(token) > 2
        }
        if tokens:
            docs.append({**item, "_tokens": tokens})

    if len(docs) < 2:
        return []

    # Remove very common tokens: they add little evidence of a duplicate.
    frequencies = {}
    for doc in docs:
        for token in doc["_tokens"]:
            frequencies[token] = frequencies.get(token, 0) + 1
    common_limit = max(3, int(len(docs) * 0.8))
    for doc in docs:
        doc["_tokens"] = {
            token for token in doc["_tokens"]
            if frequencies[token] <= common_limit
        }

    inverted = {}
    for index, doc in enumerate(docs):
        for token in doc["_tokens"]:
            inverted.setdefault(token, []).append(index)

    candidates = set()
    for indices in inverted.values():
        if len(indices) > 500:
            continue
        for offset, left in enumerate(indices):
            for right in indices[offset + 1:]:
                candidates.add((left, right))

    parent = list(range(len(docs)))
    rank = [0] * len(docs)

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        left_root, right_root = find(left), find(right)
        if left_root == right_root:
            return
        if rank[left_root] < rank[right_root]:
            left_root, right_root = right_root, left_root
        parent[right_root] = left_root
        if rank[left_root] == rank[right_root]:
            rank[left_root] += 1

    scores = {}
    for left, right in candidates:
        a, b = docs[left]["_tokens"], docs[right]["_tokens"]
        if not a or not b:
            continue
        score = len(a & b) / len(a | b)
        if score >= threshold:
            scores[(left, right)] = score
            union(left, right)

    groups = {}
    for index in range(len(docs)):
        root = find(index)
        groups.setdefault(root, []).append(index)

    group_scores = {}
    for (left, _right), score in scores.items():
        group_scores.setdefault(find(left), []).append(score)

    result = []
    for root, indices in groups.items():
        if len(indices) < 2:
            continue
        items = []
        for index in indices:
            item = {key: value for key, value in docs[index].items() if key != "_tokens"}
            items.append(item)
        items.sort(key=lambda item: item.get("mtime", 0), reverse=True)
        matched_scores = group_scores.get(root, [])
        average_score = sum(matched_scores) / len(matched_scores) if matched_scores else 0
        result.append({
            "similarity": round(average_score * 100),
            "items": items
        })

    result.sort(key=lambda group: (group["similarity"], len(group["items"])), reverse=True)
    return result
