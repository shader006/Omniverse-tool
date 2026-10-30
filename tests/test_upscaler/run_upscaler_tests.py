#!/usr/bin/env python3
import os
import sys
import unittest

if __name__ == "__main__":
    start_dir = os.path.dirname(os.path.abspath(__file__))
    suite = unittest.TestLoader().discover(start_dir=start_dir, pattern="test_*.py")
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)

