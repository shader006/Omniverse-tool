"""
RMBG Background Removal Package with BiRefNet-Lite & Intel OpenVINO.
"""

from .remover import remove_background, get_birefnet_engine, get_optimal_cpu_threads

__all__ = ["remove_background", "get_birefnet_engine", "get_optimal_cpu_threads"]
