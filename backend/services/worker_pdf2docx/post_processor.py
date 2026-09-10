import os
import time
import zipfile
import logging
import xml.etree.ElementTree as ET
from typing import Optional

logger = logging.getLogger("worker_pdf2docx.post_processor")

STANDARD_FONTS = {
    "times new roman", "arial", "calibri", "cambria", "georgia",
    "courier new", "consolas", "tahoma", "verdana", "trebuchet ms",
    "segoe ui", "helvetica", "garamond", "palatino linotype", "roboto", "open sans"
}


def is_tex_or_uncommon_font(font_name: str) -> bool:
    """Kiểm tra xem tên font có phải là font nội bộ TeX/LaTeX hoặc font không chuẩn hệ thống hay không."""
    if not font_name:
        return False
    fn_lower = font_name.lower().strip()
    if fn_lower in STANDARD_FONTS:
        return False
    if any(fn_lower.startswith(prefix) for prefix in (
        "cmr", "cmmi", "cmsy", "cmex", "nimbus", "linlibertine", "msam", "msbm", "eufm"
    )):
        return True
    return True


def map_font_name(font_name: str, target_font: Optional[str] = None) -> str:
    """Ánh xạ font TeX/lạ sang font phổ biến cross-platform để Word và Google Docs không bị lỗi render."""
    if target_font and target_font.strip():
        return target_font.strip()

    if not font_name:
        return "Times New Roman"

    fn_lower = font_name.lower()
    if any(m in fn_lower for m in ("mono", "courier", "typewriter", "nimbusmon")):
        return "Courier New"
    if any(s in fn_lower for s in ("sans", "arial", "helvetica")):
        return "Arial"
    if any(r in fn_lower for r in ("roman", "times", "cmr", "cmmi", "cmsy", "cmex", "nimbusrom")):
        return "Times New Roman"

    return "Times New Roman" if is_tex_or_uncommon_font(font_name) else font_name


def post_process_docx(
    docx_path: str,
    target_font: Optional[str] = None,
    remove_empty_paragraphs: bool = True,
    optimize_tables: bool = True,
    stitch_paragraphs: bool = True,
) -> None:
    """
    Hậu xử lý toàn diện file DOCX sau khi convert từ pdf2docx:
    1. Sửa triệt để lỗi Word hiển thị 'trắng tinh':
       - Chuyển toàn bộ w:lineRule='exact' thành 'atLeast'.
         Khi dùng 'exact', Microsoft Word trên Windows/Mac sẽ clip (ẩn cụt) 100% dòng chữ nếu font hệ thống
         có kích thước lớn hơn chiều cao exact line do pdf2docx đặt quá nhỏ (5-11pt).
       - Chuẩn hóa toàn bộ font lạ / font TeX (CMR, NimbusRom...) sang Times New Roman / Calibri / target_font.
       - Giới hạn các khoảng thụt lề cực đoan (w:ind left+right > 7000 dxa) làm co cụm hoặc đẩy chữ ra khỏi lề trang.
    2. Tối ưu bảng biểu (cantSplit chống xé đôi dòng qua trang).
    3. Dọn sạch các đoạn văn rỗng thừa (empty paragraphs).
    4. Nối từ bị ngắt dòng có dấu gạch nối (de-hyphenation).
    """
    if not os.path.exists(docx_path):
        logger.warning(f"File DOCX không tồn tại để hậu xử lý: {docx_path}")
        return

    start_t = time.perf_counter()
    try:
        with zipfile.ZipFile(docx_path, "r") as zin:
            file_map = {item.filename: zin.read(item.filename) for item in zin.infolist()}

        if "word/document.xml" not in file_map:
            logger.warning("Không tìm thấy word/document.xml trong file DOCX.")
            return

        doc_xml = file_map["word/document.xml"].decode("utf-8")
        root = ET.fromstring(doc_xml)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        w_ns = f"{{{ns['w']}}}"

        # 1. Sửa lineRule="exact" -> "atLeast" (Nguyên nhân cốt lõi gây trang trắng trong Word)
        exact_fixed = 0
        for spacing in root.findall(".//w:spacing", ns):
            lr = spacing.get(f"{w_ns}lineRule")
            if lr == "exact":
                spacing.set(f"{w_ns}lineRule", "atLeast")
                exact_fixed += 1

        # 2. Giới hạn thụt lề cực đoan (w:ind)
        indents_fixed = 0
        for ind in root.findall(".//w:ind", ns):
            left_str = ind.get(f"{w_ns}left", "0")
            right_str = ind.get(f"{w_ns}right", "0")
            try:
                left = int(left_str)
                right = int(right_str)
                if left + right > 7000:
                    ind.set(f"{w_ns}left", str(min(left, 1440)))
                    ind.set(f"{w_ns}right", str(min(right, 1440)))
                    indents_fixed += 1
            except (ValueError, TypeError):
                pass

        # 3. Chuẩn hóa Font chữ (w:rFonts)
        fonts_mapped = 0
        for rFonts in root.findall(".//w:rFonts", ns):
            ascii_font = rFonts.get(f"{w_ns}ascii") or ""
            resolved = map_font_name(ascii_font, target_font)
            if resolved != ascii_font or target_font:
                rFonts.set(f"{w_ns}ascii", resolved)
                rFonts.set(f"{w_ns}hAnsi", resolved)
                rFonts.set(f"{w_ns}cs", resolved)
                rFonts.set(f"{w_ns}eastAsia", resolved)
                fonts_mapped += 1

        # 3b. Đảm bảo 100% Nền Trắng - Chữ Đen (#000000):
        # - Khử triệt để nguy cơ chữ trắng (FFFFFF) hoặc màu chữ ẩn tàng hình
        # - Gán màu chữ đen #000000 rõ nét cho mọi run văn bản
        colors_enforced = 0
        for r in root.iter(f"{w_ns}r"):
            rPr = r.find(f"{w_ns}rPr")
            if rPr is None:
                rPr = ET.Element(f"{w_ns}rPr")
                r.insert(0, rPr)

            color_elem = rPr.find(f"{w_ns}color")
            if color_elem is None:
                color_elem = ET.Element(f"{w_ns}color")
                color_elem.set(f"{w_ns}val", "000000")
                rPr.append(color_elem)
                colors_enforced += 1
            else:
                cval = (color_elem.get(f"{w_ns}val") or "").lower()
                # Nếu màu là trắng, gần trắng, hoặc không hợp lệ -> ép thành đen thuần #000000
                if cval in ("ffffff", "white", "fff", "fdfdfd", "fafafa", "auto", ""):
                    color_elem.set(f"{w_ns}val", "000000")
                    colors_enforced += 1

            # Khử highlight màu trắng che mờ chữ
            hl = rPr.find(f"{w_ns}highlight")
            if hl is not None:
                hval = (hl.get(f"{w_ns}val") or "").lower()
                if hval in ("white", "none"):
                    rPr.remove(hl)

        # 4. Tối ưu bảng biểu: thêm cantSplit vào trPr
        cant_split_added = 0
        if optimize_tables:
            for tr in root.findall(".//w:tr", ns):
                trPr = tr.find("w:trPr", ns)
                if trPr is None:
                    trPr = ET.Element(f"{w_ns}trPr")
                    tr.insert(0, trPr)
                if trPr.find("w:cantSplit", ns) is None:
                    cant_split = ET.Element(f"{w_ns}cantSplit")
                    trPr.append(cant_split)
                    cant_split_added += 1

        # 5. Xóa các đoạn paragraph rỗng thừa và de-hyphenation
        body = root.find("w:body", ns)
        empty_p_removed = 0
        if body is not None:
            prev_p_texts = None
            p_to_remove = []

            for p in list(body):
                if p.tag != f"{w_ns}p":
                    prev_p_texts = None
                    continue

                t_elements = p.findall(".//w:t", ns)
                text_content = "".join([t.text for t in t_elements if t.text])
                has_drawing = (p.find(".//w:drawing", ns) is not None) or (p.find(".//w:pict", ns) is not None)

                # Kiểm tra paragraph rỗng
                if remove_empty_paragraphs and not text_content.strip() and not has_drawing:
                    p_to_remove.append(p)
                    continue

                # De-hyphenation
                if stitch_paragraphs and prev_p_texts and text_content:
                    last_t = prev_p_texts[-1]
                    if last_t.text and last_t.text.endswith("-") and len(last_t.text) > 1 and last_t.text[-2].isalpha():
                        last_t.text = last_t.text[:-1]

                if t_elements:
                    prev_p_texts = t_elements
                else:
                    prev_p_texts = None

            for p in p_to_remove:
                body.remove(p)
                empty_p_removed += 1

        # 6. Đóng gói lưu lại DOCX
        file_map["word/document.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for name, data in file_map.items():
                zout.writestr(name, data)

        elapsed_ms = (time.perf_counter() - start_t) * 1000.0
        logger.info(
            f"Hậu xử lý DOCX thành công ({elapsed_ms:.1f}ms): "
            f"exact_fixed={exact_fixed}, indents_fixed={indents_fixed}, "
            f"fonts_mapped={fonts_mapped}, cant_split_added={cant_split_added}, "
            f"empty_p_removed={empty_p_removed}"
        )
    except Exception as e:
        logger.exception(f"Lỗi khi hậu xử lý DOCX ({docx_path}): {e}")
