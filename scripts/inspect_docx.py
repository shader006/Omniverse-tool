import docx

doc = docx.Document("SoffwareTesting-Mẫu báo cáo bài tập lớn.docx")
print(f"Total Paragraphs: {len(doc.paragraphs)}")

for idx, p in enumerate(doc.paragraphs):
    text = p.text.strip()
    if text:
        print(f"[{idx}] (Style: {p.style.name}) {text[:100]}")
