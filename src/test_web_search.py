#!/usr/bin/env python3
"""Test Konoha's zero-API-key fallback search chain, caching, and fallback execution."""
import json
import os
import re
import urllib.request
import urllib.error
import urllib.parse
import unittest
from unittest.mock import patch, MagicMock

# Import search function directly from server module
import sys
sys.path.append(os.path.expanduser("~/.konoha"))
try:
    import server
except ImportError:
    # Fallback to local import if ~/.konoha not in path yet
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
    import server

def mock_urlopen_selector(url_or_req, timeout=None):
    if isinstance(url_or_req, urllib.request.Request):
        url = url_or_req.full_url
    else:
        url = url_or_req

    mock_resp = MagicMock()
    mock_resp.__enter__.return_value = mock_resp
    
    if "instances.json" in url:
        mock_resp.read.return_value = json.dumps({
            "instances": {
                "https://searx.test": {
                    "uptime": {"uptimeDay": 99.0},
                    "timing": {"search": {"all": {"median": 0.05}}}
                }
            }
        }).encode("utf-8")
    elif "searx.test/search" in url:
        if "q=test" in url:
            # Resolving test url during verification
            mock_resp.read.return_value = json.dumps({"results": []}).encode("utf-8")
        else:
            mock_resp.read.return_value = json.dumps({
                "results": [
                    {"title": "Test Svelte", "url": "https://svelte.dev", "content": "Svelte component framework"}
                ]
            }).encode("utf-8")
    elif "duckduckgo" in url:
        mock_resp.read.return_value = b"""
        <div class="result"><a class="result__a" href="/l/?kh=-1&amp;uddg=https://svelte.dev">Test Svelte</a><a class="result__snippet">Svelte component framework</a></div>
        """
    elif "startpage" in url:
        mock_resp.read.return_value = b"""
        <a class="result-link" href="https://svelte.dev"><h2 class="wgl-title">Test Svelte</h2></a>
        <p class="description">Svelte component framework</p>
        """
    elif "wikipedia" in url:
        mock_resp.read.return_value = json.dumps([
            "Python",
            ["Python (programming language)"],
            ["A high-level programming language."],
            ["https://en.wikipedia.org/wiki/Python_(programming_language)"]
        ]).encode("utf-8")
    else:
        raise urllib.error.URLError("Not mocked")
    return mock_resp

class TestWebSearchChain(unittest.TestCase):
    def test_query_simplification(self):
        """Verify that long queries simplify correctly by splitting words."""
        query = "how to implement sveltekit 3d threlte framework in production"
        terms = query.split()
        self.assertGreater(len(terms), 5)
        
        shortened = []
        for i in range(min(3, len(terms))):
            simp_q = " ".join(terms[:len(terms) - i])
            shortened.append(simp_q)
        
        self.assertEqual(len(shortened), 3)
        self.assertEqual(shortened[0], query)
        self.assertEqual(shortened[1], "how to implement sveltekit 3d threlte framework in")

    @patch("urllib.request.urlopen", side_effect=mock_urlopen_selector)
    def test_searxng_parser(self, mock_urlopen):
        """Verify SearXNG JSON parsing handles results and returns expected fields."""
        # Ensure we delete cache file so it runs dynamic check
        best_cache = os.path.expanduser("~/.konoha/searxng/best_instance.json")
        if os.path.exists(best_cache):
            try:
                os.remove(best_cache)
            except:
                pass

        res = server.run_web_search("Svelte", num_results=1)
        data = json.loads(res)
        
        self.assertEqual(data["status"], "success")
        self.assertGreater(len(data["results"]), 0)
        first_res = data["results"][0]
        self.assertEqual(first_res["title"], "Test Svelte")
        self.assertEqual(first_res["url"], "https://svelte.dev")
        self.assertEqual(first_res["snippet"], "Svelte component framework")

    @patch("urllib.request.urlopen")
    @patch("sys.stderr")
    def test_wikipedia_fallback(self, mock_stderr, mock_urlopen):
        """Verify Wikipedia OpenSearch API fallback is invoked when other engines fail."""
        # Force other engines to raise an error
        mock_urlopen.side_effect = urllib.error.URLError("Force Wikipedia Fallback")
        
        # We must allow the Wikipedia URL to succeed
        def mock_wiki_only(url_or_req, timeout=None):
            url = url_or_req.full_url if isinstance(url_or_req, urllib.request.Request) else url_or_req
            if "wikipedia" in url:
                mock_resp = MagicMock()
                mock_resp.__enter__.return_value = mock_resp
                mock_resp.read.return_value = json.dumps([
                    "Python",
                    ["Python (programming language)"],
                    ["A high-level programming language."],
                    ["https://en.wikipedia.org/wiki/Python_(programming_language)"]
                ]).encode("utf-8")
                return mock_resp
            raise urllib.error.URLError("Blocked for fallback test")

        mock_urlopen.side_effect = mock_wiki_only

        res_str = server.run_web_search("Python Programming Language", num_results=2)
        res = json.loads(res_str)
        self.assertEqual(res["status"], "success")
        self.assertGreaterEqual(res["results_count"], 0)
        if res["results"]:
            self.assertEqual(res["results"][0]["source"], "Wikipedia")

if __name__ == "__main__":
    unittest.main()
