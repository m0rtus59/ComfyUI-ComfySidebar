import os
import sys
import types
import unittest
from unittest import mock

from support import Env, FakeRequest

PROMOTE = "/comfy-sidebar/promote-output"
MOVE = "/comfy-sidebar/move-temp-to-output"
DELETE = "/comfy-sidebar/delete-file"
OPEN = "/comfy-sidebar/open-folder"
GALLERY = "/comfy-sidebar/gallery/list"


def read(path):
    with open(path, "rb") as f:
        return f.read()


class PromoteTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def promote(self, filename="a.png", subfolder="", type="output"):
        return self.env.post(PROMOTE, {"filename": filename, "subfolder": subfolder, "type": type})

    def test_copies_into_input(self):
        self.env.write("output", "sub/a.png", b"one")
        status, data = self.promote(subfolder="sub")
        self.assertEqual((status, data["name"]), (200, "a.png"))
        self.assertEqual(read(os.path.join(self.env.dirs["input"], "a.png")), b"one")

    def test_same_image_twice_reuses_input_file(self):
        self.env.write("output", "a.png", b"one")
        self.promote()
        status, data = self.promote()
        self.assertEqual(data["name"], "a.png")
        self.assertEqual(os.listdir(self.env.dirs["input"]), ["a.png"])

    def test_different_image_with_same_name_never_overwrites(self):
        self.env.write("input", "a.png", b"precious original")
        self.env.write("output", "a.png", b"new image")
        status, data = self.promote()
        self.assertEqual((status, data["name"]), (200, "a (1).png"))
        self.assertEqual(read(os.path.join(self.env.dirs["input"], "a.png")), b"precious original")
        self.assertEqual(read(os.path.join(self.env.dirs["input"], "a (1).png")), b"new image")
        # and a third distinct image keeps counting
        self.env.write("output", "sub/a.png", b"third")
        self.assertEqual(self.promote(subfolder="sub")[1]["name"], "a (2).png")

    def test_exact_source_only(self):
        # Same filename lives in a *different* subfolder / root: must not be picked up instead.
        self.env.write("output", "other/a.png", b"wrong image")
        self.env.write("temp", "a.png", b"wrong root")
        self.assertEqual(self.promote(subfolder="missing")[0], 404)
        self.assertEqual(self.promote(subfolder="")[0], 404)
        self.assertEqual(os.listdir(self.env.dirs["input"]), [])

    def test_traversal_rejected(self):
        self.env.write("input", "secret.png", b"s")
        self.assertEqual(self.promote(filename="../input/secret.png")[0], 404)
        self.assertEqual(self.promote(subfolder="..")[0], 404)


class MoveTempTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.src = self.env.write("temp", "preview.png", b"tmp")

    def tearDown(self):
        self.env.close()

    def move(self):
        return self.env.post(MOVE, {"filename": "preview.png", "subfolder": "", "type": "temp"})

    def test_moves_and_removes_source(self):
        status, data = self.move()
        self.assertEqual(status, 200)
        self.assertEqual(read(os.path.join(self.env.dirs["output"], data["filename"])), b"tmp")
        self.assertFalse(os.path.exists(self.src))

    def test_never_overwrites_existing_output(self):
        self.env.write("output", "preview.png", b"existing")
        status, data = self.move()
        self.assertEqual((data["filename"], data["type"]), ("preview (1).png", "output"))
        self.assertEqual(read(os.path.join(self.env.dirs["output"], "preview.png")), b"existing")

    def test_locked_source_does_not_undo_the_copy(self):
        real_remove = os.remove

        def remove(path, *a, **kw):
            if path == self.src:
                raise PermissionError("file is in use")  # e.g. Windows + open in a browser tab
            return real_remove(path, *a, **kw)

        with mock.patch.object(self.env.module.os, "remove", side_effect=remove):
            status, data = self.move()
        self.assertEqual(status, 200)
        self.assertEqual(read(os.path.join(self.env.dirs["output"], data["filename"])), b"tmp")


class GalleryTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def list(self, **query):
        return self.env.call("GET", GALLERY, FakeRequest(query={k: str(v) for k, v in query.items()}))

    def test_symlinked_output_dir_gives_clean_subfolders(self):
        real = os.path.join(self.env.base, "big_drive_output")
        os.makedirs(os.path.join(real, "sub"))
        with open(os.path.join(real, "sub", "a.png"), "wb") as f:
            f.write(b"x")
        os.rmdir(self.env.dirs["output"])
        try:
            os.symlink(real, self.env.dirs["output"], target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks not available")

        status, data = self.list()
        self.assertEqual(status, 200, data)
        folders = [f["subfolder"] for f in data["folders"]]
        self.assertEqual(folders, ["sub"])
        self.assertFalse(any(".." in f for f in folders))

        status, data = self.list(subfolder="sub")
        self.assertEqual([(f["filename"], f["subfolder"]) for f in data["files"]], [("a.png", "sub")])


class JsonGuardTests(unittest.TestCase):
    """Cross-site 'simple' requests (text/plain) must not be able to change files."""

    def setUp(self):
        self.env = Env()
        self.out = self.env.write("output", "a.png", b"x")
        self.tmp = self.env.write("temp", "t.png", b"t")
        sys.modules["send2trash"] = types.SimpleNamespace(send2trash=lambda p: os.remove(p))

    def tearDown(self):
        sys.modules.pop("send2trash", None)
        self.env.close()

    def test_non_json_content_type_is_rejected_everywhere(self):
        bodies = {
            DELETE: {"filename": "a.png", "subfolder": "", "type": "output", "permanent": True},
            PROMOTE: {"filename": "a.png", "subfolder": "", "type": "output"},
            MOVE: {"filename": "t.png", "subfolder": "", "type": "temp"},
            OPEN: {"filename": "a.png", "subfolder": "", "type": "output"},
            "/comfy-sidebar/queue/prompt-search": {"prompts": []},
        }
        for path, body in bodies.items():
            self.assertIn(("POST", path), self.env.routes.handlers)
            status, _ = self.env.post(path, body, content_type="text/plain")
            self.assertEqual(status, 415, path)
        self.assertTrue(os.path.exists(self.out) and os.path.exists(self.tmp))
        self.assertEqual(os.listdir(self.env.dirs["input"]), [])

    def test_json_must_be_an_object(self):
        for payload in ([], "x", 5, None):
            status, _ = self.env.post(DELETE, payload)
            self.assertEqual(status, 400, repr(payload))


if __name__ == "__main__":
    unittest.main()
