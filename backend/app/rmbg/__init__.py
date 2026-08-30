"""
RMBG Background Removal Package with BRIA AI RMBG-1.4 & U2Net ONNX Engine.
"""

from .remover import remove_background, get_rembg_session, get_optimal_cpu_threads

__all__ = ["remove_background", "get_rembg_session", "get_optimal_cpu_threads"]
