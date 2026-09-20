import os
import struct
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
from fontTools.ttLib.tables import ttProgram

def make_rect_contour(x1, y1, x2, y2):
  """Return 4 clockwise points for a pixel rectangle."""
  return [(x1, y1), (x1, y2), (x2, y2), (x2, y1)]

def clone_contours(glyf, base_name):
  """Extract all contours and points from an existing glyph."""
  g = glyf[base_name]
  coords, end_pts, flags = g.getCoordinates(glyf)
  all_coords = []
  contours = []
  prev = 0
  for ep in end_pts:
    pts = [(int(x), int(y)) for x, y in coords[prev:ep+1]]
    contours.append(pts)
    prev = ep + 1
  return contours

def build_glyph(contours):
  """Create a simple TrueType glyph from a list of point contours."""
  flat_coords = []
  end_pts = []
  for c in contours:
    flat_coords.extend(c)
    end_pts.append(len(flat_coords) - 1)
  
  g = Glyph()
  g.numberOfContours = len(contours)
  g.coordinates = GlyphCoordinates(flat_coords)
  g.endPtsOfContours = end_pts
  g.flags = bytearray([1] * len(flat_coords))
  g.program = ttProgram.Program()
  g.program.fromBytecode(b'')
  g.recalcBounds(None)
  return g

def main():
  font_path = r'E:\casau\Omniverse-tool\frontend\public\fonts\PressStart2P-Regular.ttf'
  out_path = r'E:\casau\Omniverse-tool\frontend\public\fonts\PressStart2P-Regular.ttf'

  font = TTFont(font_path)
  glyf = font['glyf']
  hmtx = font['hmtx']
  
  # Standard pixel dimensions (multiple of 125)
  P = 125
  
  # 1. Base accent definitions in 125 grid:
  # Dot below (dấu nặng) for normal letters (x: 375..500, y: 0..125)
  dotbelow = [make_rect_contour(3 * P, 0, 4 * P, P)]
  # Dot below for descender 'y' (y: -125..0)
  dotbelow_desc = [make_rect_contour(3 * P, -P, 4 * P, 0)]
  
  # Hook above (dấu hỏi): at y: 750..1000
  # Top bar: (375..625, 875..1000), right hook: (500..625, 750..875), stem: (375..500, 750..875)
  hookabove = [
    make_rect_contour(3 * P, 7 * P, 5 * P, 8 * P),
    make_rect_contour(4 * P, 6 * P, 5 * P, 7 * P),
  ]
  # Hook above for uppercase / tall letters (y: 1000..1250)
  hookabove_high = [
    make_rect_contour(3 * P, 9 * P, 5 * P, 10 * P),
    make_rect_contour(4 * P, 8 * P, 5 * P, 9 * P),
  ]

  # Horn (dấu móc) for o, u: on the top right
  horn_lower = [
    make_rect_contour(6 * P, 6 * P, 7 * P, 7 * P),
    make_rect_contour(6 * P, 5 * P, 7 * P, 6 * P)
  ]
  horn_upper = [
    make_rect_contour(6 * P, 8 * P, 7 * P, 9 * P),
    make_rect_contour(6 * P, 7 * P, 7 * P, 8 * P)
  ]

  # Tone marks above circumflex (y: 1000..1125):
  acute_top = [make_rect_contour(5 * P, 8 * P, 6 * P, 9 * P)]
  grave_top = [make_rect_contour(2 * P, 8 * P, 3 * P, 9 * P)]
  hook_top = [make_rect_contour(4 * P, 8 * P, 5 * P, 9 * P), make_rect_contour(5 * P, 7 * P, 6 * P, 8 * P)]
  tilde_top = [make_rect_contour(3 * P, 8 * P, 5 * P, 9 * P)]

  # Standalone accents from font if needed:
  acute_contours = clone_contours(glyf, 'acute')
  grave_contours = clone_contours(glyf, 'grave')
  tilde_contours = clone_contours(glyf, 'tilde')

  # Mapping of Vietnamese characters to construct:
  # code: (glyph_name, base_glyph, [extra_contours])
  recipes = {
    # a variants
    0x1EA3: ('uni1EA3', 'a', hookabove), # ả
    0x1EA1: ('uni1EA1', 'a', dotbelow),  # ạ
    # ă variants
    0x1EAF: ('uni1EAF', 'abreve', acute_top), # ắ
    0x1EB1: ('uni1EB1', 'abreve', grave_top), # ằ
    0x1EB3: ('uni1EB3', 'abreve', hook_top),  # ẳ
    0x1EB5: ('uni1EB5', 'abreve', tilde_top), # ẵ
    0x1EB7: ('uni1EB7', 'abreve', dotbelow),  # ặ
    # â variants
    0x1EA5: ('uni1EA5', 'acircumflex', acute_top), # ấ
    0x1EA7: ('uni1EA7', 'acircumflex', grave_top), # ầ
    0x1EA9: ('uni1EA9', 'acircumflex', hook_top),  # ẩ
    0x1EAB: ('uni1EAB', 'acircumflex', tilde_top), # ẫ
    0x1EAD: ('uni1EAD', 'acircumflex', dotbelow),  # ậ
    # e variants
    0x1EBB: ('uni1EBB', 'e', hookabove), # ẻ
    0x1EBD: ('uni1EBD', 'e', tilde_contours), # ẽ
    0x1EB9: ('uni1EB9', 'e', dotbelow),  # ẹ
    # ê variants
    0x1EBF: ('uni1EBF', 'ecircumflex', acute_top), # ế
    0x1EC1: ('uni1EC1', 'ecircumflex', grave_top), # ề
    0x1EC3: ('uni1EC3', 'ecircumflex', hook_top),  # ể
    0x1EC5: ('uni1EC5', 'ecircumflex', tilde_top), # ễ
    0x1EC7: ('uni1EC7', 'ecircumflex', dotbelow),  # ệ
    # i variants
    0x1EC9: ('uni1EC9', 'dotlessi' if 'dotlessi' in glyf else 'i', hookabove), # ỉ
    0x0129: ('itilde', 'dotlessi' if 'dotlessi' in glyf else 'i', tilde_contours), # ĩ
    0x1ECB: ('uni1ECB', 'i', dotbelow),  # ị
    # o variants
    0x1ECF: ('uni1ECF', 'o', hookabove), # ỏ
    0x1ECD: ('uni1ECD', 'o', dotbelow),  # ọ
    # ô variants
    0x1ED1: ('uni1ED1', 'ocircumflex', acute_top), # ố
    0x1ED3: ('uni1ED3', 'ocircumflex', grave_top), # ồ
    0x1ED5: ('uni1ED5', 'ocircumflex', hook_top),  # ổ
    0x1ED7: ('uni1ED7', 'ocircumflex', tilde_top), # ỗ
    0x1ED9: ('uni1ED9', 'ocircumflex', dotbelow),  # ộ
    # ơ variants
    0x01A1: ('ohorn', 'o', horn_lower), # ơ
    0x1EDB: ('uni1EDB', 'o', horn_lower + acute_top), # ớ
    0x1EDD: ('uni1EDD', 'o', horn_lower + grave_top), # ờ
    0x1EDF: ('uni1EDF', 'o', horn_lower + hook_top),  # ở
    0x1EE1: ('uni1EE1', 'o', horn_lower + tilde_top), # ỡ
    0x1EE3: ('uni1EE3', 'o', horn_lower + dotbelow),  # ợ
    # u variants
    0x1EE7: ('uni1EE7', 'u', hookabove), # ủ
    0x0169: ('utilde', 'u', tilde_contours), # ũ
    0x1EE5: ('uni1EE5', 'u', dotbelow),  # ụ
    # ư variants
    0x01B0: ('uhorn', 'u', horn_lower), # ư
    0x1EE9: ('uni1EE9', 'u', horn_lower + acute_top), # ứ
    0x1EEB: ('uni1EEB', 'u', horn_lower + grave_top), # ừ
    0x1EED: ('uni1EED', 'u', horn_lower + hook_top),  # ử
    0x1EEF: ('uni1EEF', 'u', horn_lower + tilde_top), # ữ
    0x1EF1: ('uni1EF1', 'u', horn_lower + dotbelow),  # ự
    # y variants
    0x1EF3: ('uni1EF3', 'y', grave_contours), # ỳ
    0x1EF7: ('uni1EF7', 'y', hookabove),      # ỷ
    0x1EF9: ('uni1EF9', 'y', tilde_contours), # ỹ
    0x1EF5: ('uni1EF5', 'y', dotbelow_desc),  # ỵ

    # ------------------ UPPERCASE ------------------
    # A variants
    0x1EA2: ('uni1EA2', 'A', hookabove_high), # Ả
    0x1EA0: ('uni1EA0', 'A', dotbelow),      # Ạ
    # Ă variants
    0x1EAE: ('uni1EAE', 'Abreve', acute_top), # Ắ
    0x1EB0: ('uni1EB0', 'Abreve', grave_top), # Ằ
    0x1EB2: ('uni1EB2', 'Abreve', hook_top),  # Ẳ
    0x1EB4: ('uni1EB4', 'Abreve', tilde_top), # Ẵ
    0x1EB6: ('uni1EB6', 'Abreve', dotbelow),  # Ặ
    # Â variants
    0x1EA4: ('uni1EA4', 'Acircumflex', acute_top), # Ấ
    0x1EA6: ('uni1EA6', 'Acircumflex', grave_top), # Ầ
    0x1EA8: ('uni1EA8', 'Acircumflex', hook_top),  # Ẩ
    0x1EAA: ('uni1EAA', 'Acircumflex', tilde_top), # Ẫ
    0x1EAC: ('uni1EAC', 'Acircumflex', dotbelow),  # Ậ
    # E variants
    0x1EBA: ('uni1EBA', 'E', hookabove_high), # Ẻ
    0x1EBC: ('uni1EBC', 'E', tilde_contours), # Ẽ
    0x1EB8: ('uni1EB8', 'E', dotbelow),      # Ẹ
    # Ê variants
    0x1EBE: ('uni1EBE', 'Ecircumflex', acute_top), # Ế
    0x1EC0: ('uni1EC0', 'Ecircumflex', grave_top), # Ề
    0x1EC2: ('uni1EC2', 'Ecircumflex', hook_top),  # Ể
    0x1EC4: ('uni1EC4', 'Ecircumflex', tilde_top), # Ễ
    0x1EC6: ('uni1EC6', 'Ecircumflex', dotbelow),  # Ệ
    # I variants
    0x1EC8: ('uni1EC8', 'I', hookabove_high), # Ỉ
    0x0128: ('Itilde', 'I', tilde_contours),  # Ĩ
    0x1ECA: ('uni1ECA', 'I', dotbelow),      # Ị
    # O variants
    0x1ECD: ('uni1ECD', 'O', hookabove_high), # Ỏ
    0x1ECC: ('uni1ECC', 'O', dotbelow),      # Ọ
    # Ô variants
    0x1ED0: ('uni1ED0', 'Ocircumflex', acute_top), # Ố
    0x1ED2: ('uni1ED2', 'Ocircumflex', grave_top), # Ồ
    0x1ED4: ('uni1ED4', 'Ocircumflex', hook_top),  # Ổ
    0x1ED6: ('uni1ED6', 'Ocircumflex', tilde_top), # Ỗ
    0x1ED8: ('uni1ED8', 'Ocircumflex', dotbelow),  # Ộ
    # Ơ variants
    0x01A0: ('Ohorn', 'O', horn_upper), # Ơ
    0x1EDA: ('uni1EDA', 'O', horn_upper + acute_top), # Ớ
    0x1EDC: ('uni1EDC', 'O', horn_upper + grave_top), # Ờ
    0x1EDE: ('uni1EDE', 'O', horn_upper + hook_top),  # Ở
    0x1EE0: ('uni1EE0', 'O', horn_upper + tilde_top), # Ỡ
    0x1EE2: ('uni1EE2', 'O', horn_upper + dotbelow),  # Ợ
    # U variants
    0x1EE6: ('uni1EE6', 'U', hookabove_high), # Ủ
    0x0168: ('Utilde', 'U', tilde_contours),  # Ũ
    0x1EE4: ('uni1EE4', 'U', dotbelow),      # Ụ
    # Ư variants
    0x01AF: ('Uhorn', 'U', horn_upper), # Ư
    0x1EE8: ('uni1EE8', 'U', horn_upper + acute_top), # Ứ
    0x1EEA: ('uni1EEA', 'U', horn_upper + grave_top), # Ừ
    0x1EEC: ('uni1EEC', 'U', horn_upper + hook_top),  # Tử
    0x1EEE: ('uni1EEE', 'U', horn_upper + tilde_top), # Ữ
    0x1EF0: ('uni1EF0', 'U', horn_upper + dotbelow),  # Ự
    # Y variants
    0x1EF2: ('uni1EF2', 'Y', grave_contours), # Ỳ
    0x1EF6: ('uni1EF6', 'Y', hookabove_high), # Ỷ
    0x1EF8: ('uni1EF8', 'Y', tilde_contours), # Ỹ
    0x1EF4: ('uni1EF4', 'Y', dotbelow),      # Ỵ
  }

  print(f"Synthesizing {len(recipes)} Vietnamese glyphs...")
  
  for code, (gname, base_name, extra_contours) in recipes.items():
    if base_name not in glyf:
      # Fallback to uppercase or lowercase
      if base_name.lower() in glyf:
        base_name = base_name.lower()
      elif base_name.upper() in glyf:
        base_name = base_name.upper()
      else:
        print(f"Warning: base {base_name} missing for {hex(code)}")
        continue
        
    base_contours = clone_contours(glyf, base_name)
    all_contours = base_contours + extra_contours
    
    new_glyph = build_glyph(all_contours)
    glyf[gname] = new_glyph
    
    # Copy metrics from base glyph
    adv_w, lsb = hmtx[base_name]
    hmtx[gname] = (adv_w, lsb)
    
    # Map to all cmap tables
    for table in font['cmap'].tables:
      table.cmap[code] = gname

  # Also ensure Dcroat and dcroat are mapped to U+0110 and U+0111
  for table in font['cmap'].tables:
    table.cmap[0x0110] = 'Dcroat'
    table.cmap[0x0111] = 'dcroat'

  # Save updated font
  font.save(out_path)
  print(f"Successfully saved updated font to {out_path}!")

if __name__ == '__main__':
  main()
