#!/usr/bin/env python3
"""Wrapper to run server.py from tests directory."""
import sys
import os

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

# Import and run the main server
from server import main
main()
