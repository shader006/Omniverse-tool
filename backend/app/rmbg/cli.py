#!/usr/bin/env python3
"""
CLI interface for Background Removal (BRIA RMBG-1.4 & U2Net).
Outputs structured JSON to stdout for easy consumption by Go Server.
"""

import sys
import json
import argparse
import os
from .remover import remove_background


def main():
    parser = argparse.ArgumentParser(description="CLI Tool for Background Removal")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Lệnh 'process'
    proc_parser = subparsers.add_parser("process", help="Tách nền ảnh")
    proc_parser.add_argument("--input", required=True, help="Đường dẫn file ảnh đầu vào")
    proc_parser.add_argument("--output", required=True, help="Đường dẫn lưu file ảnh kết quả (.png)")
    proc_parser.add_argument("--model", default="bria-rmbg", choices=["bria-rmbg", "u2net"], help="Mô hình AI sử dụng")
    proc_parser.add_argument("--bg-color", default=None, help="Màu nền: hex (#ffffff) hoặc 'transparent'")
    proc_parser.add_argument("--threads", type=int, default=None, help="Số luồng CPU")
    proc_parser.add_argument("--alpha-matting", action="store_true", help="Bật tinh chỉnh viền mịn")

    args = parser.parse_args()

    if args.command == "process":
        if not os.path.exists(args.input):
            result = {
                "success": False,
                "error": f"File đầu vào không tồn tại: {args.input}",
            }
            print(json.dumps(result))
            sys.exit(1)

        try:
            out_img, meta = remove_background(
                image_input=args.input,
                model_name=args.model,
                bg_color=args.bg_color,
                num_threads=args.threads,
                alpha_matting=args.alpha_matting,
            )

            # Đảm bảo thư mục lưu tồn tại
            os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
            out_img.save(args.output, "PNG")

            result = {
                "success": True,
                "output_path": args.output,
                "output_filename": os.path.basename(args.output),
                "metadata": meta,
            }
            print(json.dumps(result))
            sys.exit(0)
        except Exception as e:
            result = {
                "success": False,
                "error": f"Lỗi khi xử lý tách nền: {str(e)}",
            }
            print(json.dumps(result))
            sys.exit(1)


if __name__ == "__main__":
    main()
