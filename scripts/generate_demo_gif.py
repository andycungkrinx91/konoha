#!/usr/bin/env python3
"""Legacy redirect to 100% authentic demo GIF generator."""
import os
import sys

target = os.path.join(os.path.dirname(__file__), "generate_real_demo_gifs.py")
os.execv(sys.executable, [sys.executable, target] + sys.argv[1:])\n