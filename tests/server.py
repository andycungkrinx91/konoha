#!/usr/bin/env python3
"""Wrapper to run server.py from tests directory."""
import sys
import os

# Drop cwd ('' or tests dir) from sys.path so `import server` resolves to
# src/server.py instead of this shim (avoids circular self-import).
_tests_dir = os.path.dirname(os.path.abspath(__file__))
sys.path = [p for p in sys.path if p not in ('', '.', _tests_dir)]

# Add src to path
sys.path.insert(0, os.path.join(_tests_dir, '..', 'src'))

# Import and run the main server
from server import main
main()
