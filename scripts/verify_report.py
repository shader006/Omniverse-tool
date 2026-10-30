#!/usr/bin/env python3
import docx

doc = docx.Document("SoffwareTesting-Mẫu báo cáo bài tập lớn.docx")
print("Total paragraphs:", len(doc.paragraphs))
print("Total tables:", len(doc.tables))
for i, t in enumerate(doc.tables):
    print(f"Table {i+1}: {len(t.rows)} rows, {len(t.columns)} cols")

print("\n--- Key Headings & Content Check ---")
for idx, p in enumerate(doc.paragraphs):
    txt = p.text.strip()
    if any(txt.startswith(prefix) for prefix in ["1.", "2", "3", "4", "5", "6", "7", "PHẦN", "KẾT LUẬN"]):
        print(f"[{idx}] {txt[:80]}")
