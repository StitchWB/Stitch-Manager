#!/usr/bin/env python3
"""
Browser Worker Runner Script

This script is a fallback entry point for running the browser worker
when the module import doesn't work (e.g., when PYTHONPATH isn't set).

Usage:
    python run_browser_worker.py

Or from Rust:
    python python/run_browser_worker.py
"""

import os
import sys

# Add the python directory to the path so imports work
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

# Now import and run the browser worker
from autoreg.browser_worker import main

if __name__ == '__main__':
    main()
