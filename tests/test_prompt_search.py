import json
import os
import struct
import sys
import tempfile
import threading
import unittest
import zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import prompt_search as ps  # noqa: E402


def chunk(ctype, data):
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)


def png_bytes(text_chunks=(), after_idat=()):
    """Minimal valid 1x1 PNG. text_chunks go before IDAT, after_idat after it."""
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00"))
    return (ps._PNG_SIGNATURE + ihdr + b"".join(text_chunks) + idat
            + b"".join(after_idat) + chunk(b"IEND", b""))


def text_chunk(key, value):
    return chunk(b"tEXt", key.encode("latin-1") + b"\x00" + value.encode("latin-1"))


def itxt_chunk(key, value, compressed=False):
    body = value.encode("utf-8")
    if compressed:
        body = zlib.compress(body)
    return chunk(b"iTXt", key.encode() + b"\x00" + bytes([1 if compressed else 0, 0]) + b"\x00\x00" + body)


def ztxt_chunk(key, value):
    return chunk(b"zTXt", key.encode() + b"\x00\x00" + zlib.compress(value.encode("latin-1")))


def comfy_prompt(positive="a red fox", negative="blurry"):
    return {
        "3": {"class_type": "KSampler", "inputs": {
            "seed": 1, "steps": 20, "cfg": 8, "sampler_name": "euler", "scheduler": "normal",
            "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "decoycheckpoint.safetensors"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "decoyprefix", "images": ["8", 0]}},
    }


class ExtractTests(unittest.TestCase):
    def test_only_encoder_text(self):
        texts = ps.extract_prompt_texts(comfy_prompt("a red fox", "blurry"))
        self.assertEqual(sorted(texts), ["a red fox", "blurry"])

    def test_ignores_model_sampler_and_filename_strings(self):
        joined = "\n".join(ps.extract_prompt_texts(comfy_prompt())).lower()
        for decoy in ("euler", "decoycheckpoint", "decoyprefix", "normal"):
            self.assertNotIn(decoy, joined)

    def test_follows_links_to_string_nodes_and_concat(self):
        prompt = comfy_prompt()
        prompt["6"]["inputs"]["text"] = ["10", 0]
        prompt["10"] = {"class_type": "StringConcatenate", "inputs": {
            "text_a": ["11", 0], "text_b": "wearing a hat", "delimiter": " ZZDELIM "}}
        prompt["11"] = {"class_type": "PrimitiveStringMultiline", "inputs": {"value": "a snowy owl"}}
        texts = ps.extract_prompt_texts(prompt)
        self.assertIn("a snowy owl", texts)
        self.assertIn("wearing a hat", texts)
        self.assertNotIn(" ZZDELIM ", texts)

    def test_does_not_follow_clip_link_to_loader(self):
        prompt = comfy_prompt()
        prompt["4"]["inputs"]["clip_name"] = "decoyclipmodel.safetensors"
        self.assertNotIn("decoyclipmodel", "\n".join(ps.extract_prompt_texts(prompt)))

    def test_link_cycle_terminates(self):
        prompt = {
            "1": {"class_type": "CLIPTextEncode", "inputs": {"text": ["2", 0]}},
            "2": {"class_type": "Whatever", "inputs": {"text": ["1", 0], "value": "loop text"}},
        }
        self.assertEqual(ps.extract_prompt_texts(prompt), ["loop text"])

    def test_fallback_without_encoder_nodes(self):
        prompt = {"1": {"class_type": "easy positive", "inputs": {"positive": "fallback words", "mode": "fixed"}}}
        self.assertEqual(ps.extract_prompt_texts(prompt), ["fallback words"])

    def test_garbage_input(self):
        self.assertEqual(ps.extract_prompt_texts(None), [])
        self.assertEqual(ps.extract_prompt_texts({"1": "x", "2": {"inputs": 5}}), [])


class FileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        ps.clear_cache()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, data):
        path = os.path.join(self.dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def search(self, needle, **kw):
        return sorted(os.path.relpath(p, self.dir).replace("\\", "/")
                      for p, _ in ps.iter_prompt_matches(self.dir, needle, **kw))

    def comfy_png(self, positive="a red fox", workflow_note="workflowonlyword"):
        return png_bytes([
            text_chunk("prompt", json.dumps(comfy_prompt(positive))),
            text_chunk("workflow", json.dumps({"nodes": [{"inputs": [], "note": workflow_note}]})),
        ])

    def test_matches_prompt_not_workflow_not_filename(self):
        self.write("sub/ComfyUI_00001_.png", self.comfy_png("A Red Fox in snow"))
        self.assertEqual(self.search("red fox"), ["sub/ComfyUI_00001_.png"])   # case-insensitive, recursive
        self.assertEqual(self.search("workflowonlyword"), [])                  # workflow chunk ignored
        self.assertEqual(self.search("comfyui_00001"), [])                     # filename ignored
        self.assertEqual(self.search("euler"), [])                             # non-prompt metadata ignored

    def test_non_ascii_json_escaped_text_chunk(self):
        # ComfyUI uses json.dumps (ensure_ascii=True) -> latin-1-safe tEXt chunk
        self.write("a.png", self.comfy_png("Красная лиса"))
        self.assertEqual(self.search("красная лиса"), ["a.png"])

    def test_itxt_and_ztxt_variants(self):
        raw = json.dumps(comfy_prompt("Серый волк"), ensure_ascii=False)
        self.write("i.png", png_bytes([itxt_chunk("prompt", raw)]))
        self.write("ic.png", png_bytes([itxt_chunk("prompt", raw, compressed=True)]))
        self.write("z.png", png_bytes([ztxt_chunk("prompt", json.dumps(comfy_prompt("grey wolf")))]))
        self.assertEqual(self.search("серый волк"), ["i.png", "ic.png"])
        self.assertEqual(self.search("grey wolf"), ["z.png"])

    def test_prompt_after_other_chunks_and_idat_boundary(self):
        self.write("ok.png", png_bytes([text_chunk("workflow", "{}"), text_chunk("prompt", json.dumps(comfy_prompt("late fox")))]))
        self.write("late.png", png_bytes(after_idat=[text_chunk("prompt", json.dumps(comfy_prompt("too late fox")))]))
        self.assertEqual(self.search("fox"), ["ok.png"])

    def test_skips_bad_files_hidden_and_non_png(self):
        self.write("bad.png", b"not a png at all")
        self.write("trunc.png", self.comfy_png()[:40])
        self.write("badjson.png", png_bytes([text_chunk("prompt", "{not json")]))
        self.write(".hidden/h.png", self.comfy_png("hidden fox"))
        self.write(".dot.png", self.comfy_png("dot fox"))
        self.write("a.jpg", self.comfy_png("jpg fox"))
        self.write("good.png", self.comfy_png("good fox"))
        self.assertEqual(self.search("fox"), ["good.png"])

    def test_cache_invalidated_on_change(self):
        path = self.write("a.png", self.comfy_png("first prompt"))
        self.assertEqual(self.search("first"), ["a.png"])
        self.assertEqual(self.search("second"), [])
        with open(path, "wb") as f:
            f.write(self.comfy_png("second prompt, longer so size differs"))
        os.utime(path, ns=(10**18, 10**18))
        self.assertEqual(self.search("second"), ["a.png"])
        self.assertEqual(self.search("first"), [])

    def test_cancel_stops_scan(self):
        for i in range(5):
            self.write(f"{i}.png", self.comfy_png("fox"))
        cancel = threading.Event()
        cancel.set()
        self.assertEqual(self.search("fox", cancel=cancel), [])

    def test_empty_needle(self):
        self.write("a.png", self.comfy_png())
        self.assertEqual(self.search(""), [])


if __name__ == "__main__":
    unittest.main()
