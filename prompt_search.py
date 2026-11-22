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
import re
import struct
import sys
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
_cache = OrderedDict()  # path -> ((mtime_ns, size), lowercased prompt text, segments, (width, height))
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


def get_prompt_segments_from_graph(prompt):
    """Return the individual lower-cased prompt strings (one per text input).

    Kept separate (not joined) so callers can tell apart text that is shared
    verbatim by many images, such as an LLM enhancer's meta-prompt, from the
    text that is unique to one image. Strings are interned so identical
    boilerplate is stored once across the whole cache.
    """
    segments = []
    budget = _MAX_TEXT_CHARS_PER_FILE
    for text in extract_prompt_texts(prompt):
        if budget <= 0:
            break
        text = text.lower()[:budget]
        budget -= len(text)
        segments.append(sys.intern(text))
    return tuple(segments)


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


def read_png_size(fileobj):
    """Return (width, height) from the IHDR chunk of an open PNG, or (0, 0)."""
    try:
        fileobj.seek(0)
        head = fileobj.read(24)
        if len(head) == 24 and head[:8] == _PNG_SIGNATURE and head[12:16] == b"IHDR":
            return struct.unpack(">II", head[16:24])
    except Exception:
        pass
    return (0, 0)


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

def _load_entry(path):
    """Return (text, segments, (width, height)) for a PNG, cached by mtime + size."""
    try:
        st = os.stat(path)
    except OSError:
        return "", (), (0, 0)
    signature = (st.st_mtime_ns, st.st_size)

    with _cache_lock:
        hit = _cache.get(path)
        if hit and hit[0] == signature:
            _cache.move_to_end(path)
            return hit[1], hit[2], hit[3]

    text, segments, dims = "", (), (0, 0)
    try:
        with open(path, "rb") as f:
            dims = read_png_size(f)
            f.seek(0)
            prompt = read_png_prompt(f)
        if prompt is not None:
            text = get_prompt_search_text_from_graph(prompt)
            segments = get_prompt_segments_from_graph(prompt)
    except Exception:
        # Corrupt / truncated / non-ComfyUI PNG: treat as "no prompt".
        text, segments = "", ()

    with _cache_lock:
        _cache[path] = (signature, text, segments, dims)
        _cache.move_to_end(path)
        while len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)
    return text, segments, dims


def get_prompt_search_text(path):
    """Lower-cased prompt text of a PNG ('' if none). Cached by mtime + size."""
    return _load_entry(path)[0]


def get_png_dimensions(path):
    """(width, height) of a PNG as read from its header, (0, 0) if unknown."""
    return _load_entry(path)[2]


def get_prompt_segments(path):
    """Lower-cased prompt strings of a PNG, one per text input (() if none)."""
    return _load_entry(path)[1]


def clear_cache():
    with _cache_lock:
        _cache.clear()


# --------------------------------------------------------------------------- #
# Similar-prompt grouping
# --------------------------------------------------------------------------- #

_BOILERPLATE_MIN_DOCS = 3
_BOILERPLATE_DISTINCT_RATIO = 0.5


def _strip_shared_boilerplate(documents):
    """Drop text that many *different* images share verbatim.

    Typical case: an LLM prompt-enhancer node whose long meta-prompt is stored
    in every image made with it. Counting such a string as evidence would put
    all of those images in one 100% group.

    A string is boilerplate when at least a few images contain it and those
    images are otherwise different from each other. If they are also identical
    in all their other text (a plain seed sweep of one prompt), the string is
    real content and is kept, so true duplicates are still found.

    Documents may carry a "segments" list (one entry per text input); documents
    without it are left untouched. Returns new dicts with "prompt" rebuilt.
    """
    seg_sets = []
    holders = {}
    for index, item in enumerate(documents):
        segments = item.get("segments")
        normalized = None
        if segments:
            normalized = frozenset(
                " ".join(str(seg).split()) for seg in segments if str(seg).strip()
            )
        seg_sets.append(normalized)
        for seg in normalized or ():
            holders.setdefault(seg, []).append(index)

    boilerplate = set()
    for seg, indices in holders.items():
        if len(indices) < _BOILERPLATE_MIN_DOCS:
            continue
        rests = {seg_sets[i] - {seg} for i in indices}
        if len(rests) / len(indices) >= _BOILERPLATE_DISTINCT_RATIO:
            boilerplate.add(seg)

    if not boilerplate:
        return documents

    cleaned = []
    for item, segs in zip(documents, seg_sets):
        if segs is None:
            cleaned.append(item)
            continue
        kept = sorted(seg for seg in segs if seg not in boilerplate)
        cleaned.append({**item, "prompt": "\n".join(kept)})
    return cleaned


def find_similar_prompt_groups(documents, threshold=0.55):
    """Group prompt documents by token-set Jaccard similarity.

    Documents are dictionaries containing an id and prompt text. Candidate
    pairs are generated through an inverted index, avoiding a full all-pairs
    comparison for unrelated prompts.
    """
    documents = _strip_shared_boilerplate(documents)

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

    # Count shared tokens per candidate pair straight from the inverted index.
    # Jaccard then needs no set intersection/union: |A∪B| = |A| + |B| - shared.
    overlaps = {}
    for indices in inverted.values():
        if len(indices) > 500:
            continue
        for offset, left in enumerate(indices):
            for right in indices[offset + 1:]:
                key = (left, right)
                overlaps[key] = overlaps.get(key, 0) + 1

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
    sizes = [len(doc["_tokens"]) for doc in docs]
    for (left, right), shared in overlaps.items():
        size_a, size_b = sizes[left], sizes[right]
        if not size_a or not size_b:
            continue
        # Jaccard can never exceed min/max of the set sizes: cheap early exit.
        if min(size_a, size_b) / max(size_a, size_b) < threshold:
            continue
        score = shared / (size_a + size_b - shared)
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
