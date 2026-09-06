import sys
# Alias 'app' in sys.modules so any legacy 'from app...' imports work seamlessly
if "app" not in sys.modules:
    sys.modules["app"] = sys.modules[__name__]

# Package app exports
try:
    from .url_conver.utils import sanitize_filename, clean_url_key
    from .url_conver.metadata import get_media_info
    from .url_conver.downloader import run_download_task, get_base_ydl_opts, generate_cache_key, DEFAULT_DOWNLOAD_DIR
except ImportError:
    pass


