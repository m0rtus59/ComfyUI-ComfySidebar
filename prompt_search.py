"""Find the text prompts embedded in ComfyUI PNG outputs.

This module has no ComfyUI imports so it can be unit-tested on its own
(``python -m unittest discover tests``).

How it works
------------
* Only the PNG ``prompt`` text chunk is read. Other chunks (notably the often
  multi-megabyte ``workflow`` chunk) are skipped with a seek, never parsed.
* From the API-format prompt graph we collect only the strings that actually
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
# Cached per-file text + directory scan
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
            text = "\n".join(extract_prompt_texts(prompt)).lower()[:_MAX_TEXT_CHARS_PER_FILE]
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


def iter_prompt_matches(target_dir, needle, cancel=None):
    """Yield ``(path, os.stat_result)`` for PNGs under `target_dir` whose prompt
    text contains `needle` (case-insensitive). Hidden files/folders are skipped.

    `cancel` may be a ``threading.Event``; the scan stops soon after it is set.
    """
    needle = needle.lower()
    if not needle:
        return
    for root, dirs, fnames in os.walk(target_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fname in fnames:
            if cancel is not None and cancel.is_set():
                return
            if fname.startswith(".") or not fname.lower().endswith(".png"):
                continue
            path = os.path.join(root, fname)
            if needle in get_prompt_search_text(path):
                try:
                    yield path, os.stat(path)
                except OSError:
                    continue
