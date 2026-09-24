import os
import math
import random
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

def create_pixel_note(symbol_type=1, alpha=255):
  """Create pixel music notes ♪ and ♫ with dark outline and gold/white fill."""
  if symbol_type == 1:
    # Single note ♪ (7x9)
    matrix = [
      [0, 0, 0, 1, 1, 1, 0],
      [0, 0, 0, 1, 0, 0, 1],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 1, 1, 1, 0, 0, 0],
      [1, 1, 1, 1, 0, 0, 0],
      [1, 1, 1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0],
    ]
  else:
    # Double note ♫ (11x8)
    matrix = [
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      [0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0],
      [1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0],
      [1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    ]

  rows = len(matrix)
  cols = len(matrix[0])
  w, h = cols + 4, rows + 4
  img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
  draw = ImageDraw.Draw(img)

  # Black border
  for dy in [-1, 0, 1]:
    for dx in [-1, 0, 1]:
      if dx == 0 and dy == 0:
        continue
      for r in range(rows):
        for c in range(cols):
          if matrix[r][c]:
            draw.point((2 + c + dx, 2 + r + dy), fill=(0, 0, 0, int(alpha * 0.95)))

  # Vibrant golden fill
  fill_color = (255, 230, 90, alpha) if symbol_type == 1 else (255, 255, 255, alpha)
  for r in range(rows):
    for c in range(cols):
      if matrix[r][c]:
        draw.point((2 + c, 2 + r), fill=fill_color)

  # Scale note 2x for sharp pixel art display
  return img.resize((w * 2, h * 2), Image.Resampling.NEAREST)

def main():
  clean_src = r'C:\Users\Admin\.gemini\antigravity-ide\brain\8d031e31-1865-4fbf-a273-1135fbb939a1\clean_bliss.png'
  out_path = r'e:\casau\Omniverse-tool\frontend\public\assets\hero-bg.gif'

  orig = Image.open(clean_src).convert('RGB')
  orig_w, orig_h = orig.size

  target_w, target_h = 1280, 795
  grid_w, grid_h = 640, 398

  # Base pixel art: downscale to 640x398, enhance saturation, nearest upscale to 1280x795
  enhanced_orig = ImageEnhance.Color(orig).enhance(1.15)
  small_pixel = enhanced_orig.resize((grid_w, grid_h), Image.Resampling.BILINEAR)
  base_hd = small_pixel.resize((target_w, target_h), Image.Resampling.NEAREST).convert('RGBA')

  sx = target_w / float(orig_w)
  sy = target_h / float(orig_h)

  # Treehouse red flag coords in target_w x target_h
  fx1, fy1, fx2, fy2 = int(710 * sx) - 2, int(206 * sy) - 2, int(732 * sx) + 4, int(220 * sy) + 4
  print(f"Red flag coords: ({fx1}, {fy1}) to ({fx2}, {fy2})")

  # Jake Viola coords in target_w x target_h
  jx, jy = int(330 * sx), int(424 * sy)
  print(f"Jake coords: ({jx}, {jy})")

  # Precompute particles
  random.seed(42)
  particles = []
  for _ in range(28):
    p_x = random.uniform(0, target_w)
    p_y = random.uniform(int(390 * sy), target_h - 20)
    p_speed = random.uniform(55, 110)
    p_amp = random.uniform(3, 7)
    p_freq = random.uniform(1.5, 3.5)
    p_type = random.choice(['white', 'yellow', 'cyan_sparkle'])
    p_size = random.choice([2, 3])
    particles.append({
      'x': p_x, 'y': p_y, 'speed': p_speed,
      'amp': p_amp, 'freq': p_freq, 'type': p_type, 'size': p_size
    })

  num_frames = 20
  frame_duration = 90  # ~11 fps
  frames = []

  print(f"Rendering {num_frames} frames of authentic pixel art GIF...")

  for f in range(num_frames):
    t_norm = f / float(num_frames)
    t_rad = t_norm * 2.0 * math.pi

    frame = base_hd.copy()

    # 1. Flapping red flag on Treehouse
    flag_crop = base_hd.crop((fx1, fy1, fx2, fy2))
    flag_arr = np.array(flag_crop)
    fh, fw, _ = flag_arr.shape
    deformed_flag = np.zeros_like(flag_arr)
    # Sky color behind flag
    sky_sample = flag_arr[0, 0]
    deformed_flag[:] = sky_sample

    for col in range(fw):
      dist = col / float(fw)
      dy = int(round(dist * 2.2 * math.sin(t_rad * 2.0 + dist * 3.8)))
      for row in range(fh):
        sr = row - dy
        if 0 <= sr < fh:
          p = flag_arr[sr, col]
          # Red flag pixel (high red, low green/blue)
          if p[0] > 140 and p[1] < 110:
            deformed_flag[row, col] = p
          elif p[0] > 100 and p[1] > 70 and p[2] < 70: # flag pole
            deformed_flag[row, col] = flag_arr[row, col]
          else:
            deformed_flag[row, col] = flag_arr[row, col]

    frame.paste(Image.fromarray(deformed_flag), (fx1, fy1))

    # 2. Pixel Music Notes floating from Jake's Viola
    notes_layer = Image.new('RGBA', (target_w, target_h), (0, 0, 0, 0))
    for i in range(2):
      phase = i / 2.0
      prog = (t_norm + phase) % 1.0
      nx = int(jx + prog * 40 + math.sin(prog * math.pi) * 8)
      ny = int(jy - 15 - prog * 75)
      n_alpha = int(255 * math.sin(prog * math.pi))
      if n_alpha > 35:
        sym = 1 if i == 0 else 2
        note_img = create_pixel_note(sym, n_alpha)
        notes_layer.paste(note_img, (nx, ny), note_img)

    frame.alpha_composite(notes_layer)

    # 3. Drifting dandelion/meadow pollen
    petal_layer = Image.new('RGBA', (target_w, target_h), (0, 0, 0, 0))
    p_draw = ImageDraw.Draw(petal_layer)

    for p in particles:
      cur_x = (p['x'] + t_norm * p['speed']) % target_w
      cur_y = p['y'] + math.sin(t_rad * p['freq'] + p['x']) * p['amp']

      if p['type'] == 'white':
        color = (255, 255, 255, 230)
      elif p['type'] == 'yellow':
        color = (254, 240, 138, 230)
      else:
        color = (186, 230, 253, 210)

      sz = p['size']
      p_draw.rectangle([int(cur_x), int(cur_y), int(cur_x) + sz - 1, int(cur_y) + sz - 1], fill=color)
      # Pixel shadow
      p_draw.rectangle([int(cur_x), int(cur_y) + sz, int(cur_x) + sz - 1, int(cur_y) + sz], fill=(15, 40, 15, 100))

    frame.alpha_composite(petal_layer)

    # Quantize to 256 colors palette with nearest neighbor for crisp pixels
    rgb_f = frame.convert('RGB')
    pal_f = rgb_f.quantize(colors=256, method=Image.Resampling.NEAREST, dither=Image.Dither.NONE)
    frames.append(pal_f)

  print(f"Saving authentic pixel GIF to {out_path}...")
  frames[0].save(
    out_path,
    save_all=True,
    append_images=frames[1:],
    duration=frame_duration,
    loop=0,
    optimize=False
  )
  gif_size = os.path.getsize(out_path)
  print(f"Done! Saved {out_path} ({gif_size / 1024 / 1024:.2f} MB)")

if __name__ == '__main__':
  main()
