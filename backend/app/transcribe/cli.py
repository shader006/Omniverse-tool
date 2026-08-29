"""
CLI Interface for faster-whisper media transcription.
Executed by Go Backend to transcribe MP3/MP4 files.
"""

import os
import sys
import json
import argparse
import traceback
from app.transcribe.engine import get_transcribe_engine


def main():
    parser = argparse.ArgumentParser(description="Media Transcription CLI (faster-whisper CPU)")
    parser.add_argument("--input", required=True, help="Đường dẫn file media (mp3, mp4, wav, m4a, v.v.)")
    parser.add_argument("--language", default="auto", help="Ngôn ngữ (vi, en, ja, auto...)")
    parser.add_argument("--format", default="txt", help="Định dạng xuất (txt, srt, vtt, json)")
    parser.add_argument("--task", default="transcribe", choices=["transcribe", "translate"], help="Tác vụ")
    parser.add_argument("--output-dir", default="/app/downloads", help="Thư mục lưu file kết quả")

    args = parser.parse_args()

    try:
        engine = get_transcribe_engine()
        result = engine.transcribe_file(
            file_path=args.input,
            language=args.language,
            task=args.task,
        )

        # Tạo file kết quả trong output-dir
        os.makedirs(args.output_dir, exist_ok=True)
        base_name = os.path.splitext(os.path.basename(args.input))[0]
        out_fmt = args.format.strip().lower().replace(".", "")
        if not out_fmt:
            out_fmt = "txt"

        out_filename = f"{base_name}_transcript.{out_fmt}"
        out_filepath = os.path.join(args.output_dir, out_filename)

        formatted_content = engine.export_content(result, out_fmt)
        with open(out_filepath, "w", encoding="utf-8") as f:
            f.write(formatted_content)

        result["filename"] = out_filename
        result["file_path"] = out_filepath
        result["download_url"] = f"/api/file/{out_filename}"
        result["export_format"] = out_fmt

        print("FINAL_RESULT:" + json.dumps(result, ensure_ascii=False))
        sys.exit(0)

    except Exception as e:
        err_res = {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }
        print("FINAL_RESULT:" + json.dumps(err_res, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
