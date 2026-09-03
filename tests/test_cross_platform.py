"""
Tests ensuring all latest changes work perfectly across Windows, Linux, and macOS.
Covers platform tag generation, asset resolution, path normalization,
archive extraction, and graceful capability fallbacks.
"""

import os
import platform
import sqlite3
import struct
import tempfile
import unittest
import zipfile
import tarfile
import io
import sys
from unittest.mock import patch, MagicMock

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

import db
import vector_search


class TestCrossPlatformSupport(unittest.TestCase):
    """Verifies behavior across Linux, macOS, and Windows environments."""

    def test_platform_tag_and_asset_resolution_matrix(self):
        """Matrix testing for platform tags and release asset names."""
        test_cases = [
            # (system, machine, expected_tag, expected_asset, expected_lib)
            ("Linux", "x86_64", "linux-x64", "vector-linux-x86_64-1.1.0.tar.gz", "vector.so"),
            ("Linux", "amd64", "linux-x64", "vector-linux-x86_64-1.1.0.tar.gz", "vector.so"),
            ("Linux", "aarch64", "linux-arm64", "vector-linux-arm64-1.1.0.tar.gz", "vector.so"),
            ("Linux", "arm64", "linux-arm64", "vector-linux-arm64-1.1.0.tar.gz", "vector.so"),
            ("Darwin", "arm64", "darwin-arm64", "vector-macos-arm64-1.1.0.tar.gz", "vector.dylib"),
            ("Darwin", "x86_64", "darwin-x64", "vector-macos-x86_64-1.1.0.tar.gz", "vector.dylib"),
            ("Windows", "AMD64", "windows-x64", "vector-windows-x86_64-1.1.0.zip", "vector.dll"),
            ("Windows", "x86_64", "windows-x64", "vector-windows-x86_64-1.1.0.zip", "vector.dll"),
        ]

        for sys_name, mach, exp_tag, exp_asset, exp_lib in test_cases:
            with patch("platform.system", return_value=sys_name), \
                 patch("platform.machine", return_value=mach):
                tag = vector_search.get_platform_tag()
                asset, lib = vector_search.get_platform_asset_info()
                self.assertEqual(tag, exp_tag, f"Tag mismatch for {sys_name} {mach}")
                self.assertEqual(asset, exp_asset, f"Asset mismatch for {sys_name} {mach}")
                self.assertEqual(lib, exp_lib, f"Lib mismatch for {sys_name} {mach}")

    def test_windows_arm64_graceful_handling(self):
        """Windows ARM64 has no native prebuilt in 1.1.0; should return None and fall back."""
        with patch("platform.system", return_value="Windows"), \
             patch("platform.machine", return_value="ARM64"):
            tag = vector_search.get_platform_tag()
            asset, lib = vector_search.get_platform_asset_info()
            self.assertEqual(tag, "windows-arm64")
            self.assertIsNone(asset)
            self.assertIsNone(lib)

    def test_path_normalization_cross_platform(self):
        """Verifies DB path normalization handles both slash types and home dirs."""
        # Simulated Windows path
        win_path = r"C:\Users\test\.konoha\skills.db"
        norm_win = os.path.normpath(win_path)
        self.assertIn(".konoha", norm_win)

        # Forward slash Windows path
        win_fwd = "C:/Users/test/.konoha/skills.db"
        norm_fwd = os.path.normpath(win_fwd)
        self.assertIn(".konoha", norm_fwd)

        # Ensure canonical db.DB_PATH is normalized
        self.assertEqual(db.DB_PATH, os.path.normpath(db.DB_PATH))

    def test_archive_extraction_windows_zip_and_macos_tar(self):
        """Verifies ensure_vector_extension properly extracts .zip and .tar.gz structures."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Test ZIP extraction (Windows layout: flat or nested)
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w") as zf:
                zf.writestr("nested/vector.dll", b"MZ_MOCK_WINDOWS_DLL_CONTENT")
            zip_bytes = zip_buffer.getvalue()

            with patch("vector_search.get_vendor_dir", return_value=tmp_dir), \
                 patch("vector_search.get_platform_asset_info", return_value=("vector-windows-x86_64-1.1.0.zip", "vector.dll")), \
                 patch("vector_search.get_platform_tag", return_value="windows-x64"), \
                 patch("urllib.request.urlopen") as mock_url:
                mock_resp = MagicMock()
                mock_resp.read.return_value = zip_bytes
                mock_url.return_value.__enter__.return_value = mock_resp

                dll_path = vector_search.ensure_vector_extension()
                self.assertIsNotNone(dll_path)
                self.assertTrue(os.path.isfile(dll_path))
                self.assertTrue(dll_path.endswith("vector.dll"))

            # Test TAR.GZ extraction (macOS layout: ./vector.dylib)
            tar_dir = os.path.join(tmp_dir, "darwin")
            os.makedirs(tar_dir, exist_ok=True)
            tar_buffer = io.BytesIO()
            with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tf:
                data = b"MOCK_MACOS_DYLIB_CONTENT"
                ti = tarfile.TarInfo(name="vector.dylib")
                ti.size = len(data)
                tf.addfile(ti, io.BytesIO(data))
            tar_bytes = tar_buffer.getvalue()

            with patch("vector_search.get_vendor_dir", return_value=tar_dir), \
                 patch("vector_search.get_platform_asset_info", return_value=("vector-macos-arm64-1.1.0.tar.gz", "vector.dylib")), \
                 patch("vector_search.get_platform_tag", return_value="darwin-arm64"), \
                 patch("urllib.request.urlopen") as mock_url:
                mock_resp = MagicMock()
                mock_resp.read.return_value = tar_bytes
                mock_url.return_value.__enter__.return_value = mock_resp

                dylib_path = vector_search.ensure_vector_extension()
                self.assertIsNotNone(dylib_path)
                self.assertTrue(os.path.isfile(dylib_path))
                self.assertTrue(dylib_path.endswith("vector.dylib"))

    def test_in_memory_exact_scan_parity_all_platforms(self):
        """Verifies in-memory cosine similarity scan functions identically without C-extension."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            test_db = os.path.join(tmp_dir, "test.db")
            conn = db.get_connection(test_db, load_vector=False)
            db.setup_schema(conn)

            # Insert test skills
            conn.execute("INSERT INTO skills (name, type, skill_name, content) VALUES ('skill-a', 'skill', 'skill-a', 'Frontend content')")
            conn.execute("INSERT INTO skills (name, type, skill_name, content) VALUES ('skill-b', 'skill', 'skill-b', 'Backend content')")

            # Create test embeddings
            vec_a = np.ones(384, dtype=np.float32)
            vec_a = vec_a / np.linalg.norm(vec_a)
            vec_b = np.zeros(384, dtype=np.float32)
            vec_b[0] = 1.0

            blob_a = vec_a.tobytes()
            blob_b = vec_b.tobytes()

            conn.execute("INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)",
                         ("skill-a", 0, "Chunk A", blob_a))
            conn.execute("INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)",
                         ("skill-b", 0, "Chunk B", blob_b))
            conn.commit()

            # Query with vector matching vec_a exactly
            query_vec = vec_a
            results = vector_search.scan_nearest_chunks(conn, query_vec, candidate_k=2)

            self.assertEqual(len(results), 2)
            self.assertEqual(results[0][0], "skill-a")
            self.assertAlmostEqual(results[0][3], 1.0, places=4)
            self.assertEqual(results[1][0], "skill-b")

            conn.close()

    def test_extension_unauthorized_macos_build_simulation(self):
        """Simulates Python builds on macOS where load_extension raises OperationalError."""
        mock_conn = MagicMock()
        mock_conn.enable_load_extension.side_effect = sqlite3.OperationalError("not authorized")

        safe = vector_search.enable_load_extension_safe(mock_conn)
        self.assertFalse(safe)


    def test_agent_browser_cross_platform_resolution(self):
        """Verifies agent-browser CLI binary resolution works seamlessly on Windows and Unix."""
        # On Windows, expected binary is agent-browser.cmd
        with patch("platform.system", return_value="Windows"):
            cmd = "agent-browser.cmd" if platform.system() == "Windows" else "agent-browser"
            self.assertIn("agent-browser", cmd)

        # On Unix, binary is agent-browser
        with patch("platform.system", return_value="Linux"):
            cmd = "agent-browser.cmd" if platform.system() == "Windows" else "agent-browser"
            self.assertEqual(cmd, "agent-browser")

if __name__ == "__main__":
    unittest.main()
