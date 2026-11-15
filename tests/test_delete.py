import os
import sys
import types
import unittest

from support import Env

DELETE = "/comfy-sidebar/delete-file"


def fake_send2trash(fail_with=None):
    calls = []
    mod = types.ModuleType("send2trash")

    def send2trash(path):
        calls.append(path)
        if fail_with is not None:
            raise fail_with
        os.remove(path)  # emulate "moved away"

    mod.send2trash = send2trash
    mod.calls = calls
    return mod


class DeleteHandlerTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.file = self.env.write("output", "sub/a.png")
        self._saved = sys.modules.get("send2trash", "absent")

    def tearDown(self):
        if self._saved == "absent":
            sys.modules.pop("send2trash", None)
        else:
            sys.modules["send2trash"] = self._saved
        self.env.close()

    def body(self, **extra):
        return {"filename": "a.png", "subfolder": "sub", "type": "output", **extra}

    def test_moves_to_trash(self):
        mod = fake_send2trash()
        sys.modules["send2trash"] = mod
        status, data = self.env.post(DELETE, self.body())
        self.assertEqual((status, data["action"]), (200, "trashed"))
        self.assertEqual(mod.calls, [self.file])
        self.assertFalse(os.path.exists(self.file))

    def test_missing_send2trash_does_not_delete(self):
        sys.modules["send2trash"] = None  # makes `import send2trash` raise ImportError
        status, data = self.env.post(DELETE, self.body())
        self.assertEqual(status, 409)
        self.assertEqual(data["code"], "trash_unavailable")
        self.assertEqual(data["python"], sys.executable)
        self.assertTrue(os.path.exists(self.file), "file must survive when the trash is unavailable")

    def test_trash_error_does_not_delete(self):
        sys.modules["send2trash"] = fake_send2trash(OSError("no trash on this volume"))
        status, data = self.env.post(DELETE, self.body())
        self.assertEqual(status, 409)
        self.assertEqual(data["code"], "trash_failed")
        self.assertIn("no trash on this volume", data["error"])
        self.assertTrue(os.path.exists(self.file))

    def test_permanent_skips_trash(self):
        mod = fake_send2trash()
        sys.modules["send2trash"] = mod
        status, data = self.env.post(DELETE, self.body(permanent=True))
        self.assertEqual((status, data["action"]), (200, "deleted"))
        self.assertEqual(mod.calls, [])
        self.assertFalse(os.path.exists(self.file))

    def test_permanent_must_be_a_real_boolean(self):
        # "false" / 1 / "yes" are truthy in Python; none of them may trigger a permanent delete.
        sys.modules["send2trash"] = fake_send2trash(OSError("boom"))
        for value in ("false", "true", 1, "yes"):
            status, data = self.env.post(DELETE, self.body(permanent=value))
            self.assertEqual(status, 409, value)
            self.assertTrue(os.path.exists(self.file), value)

    def test_rejects_traversal_and_other_roots(self):
        sys.modules["send2trash"] = fake_send2trash()
        outside = self.env.write("input", "keep.png")
        for body in (
            {"filename": "../input/keep.png", "subfolder": "", "type": "output"},
            {"filename": "keep.png", "subfolder": "", "type": "output"},   # exists only in input/
            {"filename": "keep.png", "subfolder": "", "type": "input"},    # input is not deletable
        ):
            status, _ = self.env.post(DELETE, body)
            self.assertEqual(status, 404, body)
        self.assertTrue(os.path.exists(outside))


if __name__ == "__main__":
    unittest.main()
