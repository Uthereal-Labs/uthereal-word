"""The explicit DOM mode must never wait for optional WebGPU discovery."""

from __future__ import annotations

import io
import os
import socket
import subprocess
import time
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]

# Installed before application modules run. A call to requestAdapter never
# resolves, so a missing DOM opt-out blocks the existing startup await.
STALL_ADAPTER = """(() => {
    window.__adapterRequested = 0;
    Object.defineProperty(navigator, 'gpu', {
        configurable: true,
        value: { requestAdapter: () => { window.__adapterRequested++; return new Promise(() => {}); } }
    });
})();"""


class StartupWithoutGPU(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        cls.url = f"http://127.0.0.1:{port}"
        env = os.environ.copy()
        env["PORT"] = str(port)
        cls.server = subprocess.Popen(
            ["node", "server.mjs"], cwd=ROOT, env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        try:
            for _ in range(50):
                if cls.server.poll() is not None:
                    raise RuntimeError("Quire static server exited during startup")
                try:
                    with urllib.request.urlopen(cls.url, timeout=0.2):
                        return
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(0.1)
            raise RuntimeError("Quire static server did not become ready")
        except BaseException:
            cls._stop_server()
            raise

    @classmethod
    def _stop_server(cls) -> None:
        if cls.server.poll() is None:
            cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=5)
        cls.server.stderr.close()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._stop_server()

    def test_dom_mode_skips_adapter_and_preserves_edit_save_export(self) -> None:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
            try:
                context = browser.new_context()
                page = context.new_page()
                page.add_init_script(STALL_ADAPTER)
                page.goto(f"{self.url}/?renderer=dom", wait_until="commit")
                page.wait_for_function("window.quire?.ready === true", timeout=10000)
                self.assertEqual(page.evaluate("window.__adapterRequested"), 0)
                self.assertEqual(page.evaluate("quire.renderer.stats.backend"), "DOM")
                self.assertEqual(page.evaluate("quire.renderer.stats.lastError"), "DOM renderer selected")

                page.locator("#page-stack .page-content").first.click()
                page.keyboard.insert_text("DOM mode keeps editing available. ")
                page.wait_for_function(
                    "quire.store.document.pages.some(page => page.html.includes('DOM mode keeps editing available.'))"
                )
                saved = page.evaluate("async () => { await quire.actions.save(); return quire.store.document.pages.map(page => page.html).join(''); }")
                self.assertIn("DOM mode keeps editing available.", saved)

                data = bytes(page.evaluate("async () => Array.from(new Uint8Array(await quire.exportDocx().arrayBuffer()))"))
                with zipfile.ZipFile(io.BytesIO(data)) as docx:
                    self.assertIn("word/document.xml", docx.namelist())
                    self.assertIn("DOM mode keeps editing available.", docx.read("word/document.xml").decode())

                self.assertEqual(page.evaluate("window.__adapterRequested"), 0)
                self.assertIn("DOM mode keeps editing available.", page.evaluate("quire.store.document.pages.map(page => page.html).join('')"))
                context.close()
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
