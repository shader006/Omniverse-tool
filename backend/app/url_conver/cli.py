#!/usr/bin/env python3
"""
URL CONVERTER CLI INTERFACE
Giao tiếp trực tiếp giữa Golang API Gateway và Python yt-dlp Engine qua JSON
"""

import sys
import json
import argparse
from app.url_conver.metadata import get_media_info
from app.url_conver.downloader import run_download_task


def main():
    parser = argparse.ArgumentParser(description="URL Converter CLI Engine")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Lệnh lấy Metadata: info --url <URL>
    info_parser = subparsers.add_parser("info")
    info_parser.add_argument("--url", required=True, help="Media URL")

    # Lệnh tải: download --url <URL> --format <fmt> --quality <q> [--output <dir>]
    dl_parser = subparsers.add_parser("download")
    dl_parser.add_argument("--url", required=True, help="Media URL")
    dl_parser.add_argument("--format", default="mp3", help="Output format (mp3/mp4)")
    dl_parser.add_argument("--quality", default="320", help="Quality (320, 1080...)")
    dl_parser.add_argument("--output", default="/app/downloads", help="Output directory")

    args = parser.parse_args()

    if args.command == "info":
        info, err = get_media_info(args.url)
        if info:
            print(f"FINAL_RESULT:{json.dumps({'success': True, 'data': info})}", flush=True)
        else:
            err_msg = err if err else "Không thể trích xuất metadata từ liên kết này."
            print(f"FINAL_RESULT:{json.dumps({'success': False, 'error': err_msg})}", flush=True)
            sys.exit(1)

    elif args.command == "download":
        def progress_reporter(percent, message):
            progress_obj = {"percent": percent, "message": message}
            sys.stderr.write(f"PROGRESS:{json.dumps(progress_obj)}\n")
            sys.stderr.flush()

        filename = run_download_task(
            url=args.url,
            media_format=args.format,
            quality=args.quality,
            progress_callback=progress_reporter,
            output_dir=args.output,
        )

        if filename:
            print(f"FINAL_RESULT:{json.dumps({'success': True, 'filename': filename})}", flush=True)
        else:
            print(f"FINAL_RESULT:{json.dumps({'success': False, 'error': 'Lỗi khi tải file hoặc định dạng không khả dụng.'})}", flush=True)
            sys.exit(1)


if __name__ == "__main__":
    main()
