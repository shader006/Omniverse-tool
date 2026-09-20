import os
import math
import random
import numpy as np
from PIL import Image, ImageDraw

def create_pixel_note(symbol_type=1, alpha=255):
  """Create pixel music notes ♪ and ♫ with dark outline and gold fill."""
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

  # Black outline
  for dy in [-1, 0, 1]:
    for dx in [-1, 0, 1]:
      if dx == 0 and dy == 0:
        continue
      for r in range(rows):
        for c in range(cols):
          if matrix[r][c]:
            draw.point((2 + c + dx, 2 + r + dy), fill=(0, 0, 0, int(alpha * 0.95)))

  # Warm golden yellow fill
  fill_color = (255, 225, 75, alpha) if symbol_type == 1 else (255, 245, 140, alpha)
  for r in range(rows):
    for c in range(cols):
      if matrix[r][c]:
        draw.point((2 + c, 2 + r), fill=fill_color)

  # Scale 1.5x for neat crisp visibility at 1024x636
  nw, nh = int(w * 1.5), int(h * 1.5)
  return img.resize((nw, nh), Image.Resampling.NEAREST)

def main():
  clean_src = r'C:\Users\Admin\.gemini\antigravity-ide\brain\8d031e31-1865-4fbf-a273-1135fbb939a1\clean_bliss.png'
  out_path = r'e:\casau\Omniverse-tool\frontend\public\assets\hero-bg.gif'

  orig = Image.open(clean_src).convert('RGB')
  w, h = orig.size

  # Generate master palette using MAXCOVERAGE on the clean artwork to preserve 100% true colors (umbrella, boat, Jake, treehouse)
  master_palette = orig.quantize(colors=256, method=Image.Quantize.MAXCOVERAGE)

  # Treehouse flag coords in 1024x636
  fx1, fy1, fx2, fy2 = 708, 205, 730, 222
  print(f"Red flag coords: ({fx1}, {fy1}) to ({fx2}, {fy2})")

  # Jake Viola coords in 1024x636
  jx, jy = 332, 420
  print(f"Jake Viola coords: ({jx}, {jy})")

  # Drifting pollen particles across meadow
  random.seed(999)
  particles = []
  for _ in range(25):
    p_x = random.uniform(0, w)
    p_y = random.uniform(380, h - 20)
    p_speed = random.uniform(40, 80)
    p_amp = random.uniform(2, 5)
    p_freq = random.uniform(1.5, 3.5)
    p_type = random.choice(['white', 'gold', 'soft_cyan'])
    p_size = random.choice([2, 3])
    particles.append({
      'x': p_x, 'y': p_y, 'speed': p_speed,
      'amp': p_amp, 'freq': p_freq, 'type': p_type, 'size': p_size
    })

  num_frames = 20
  frame_duration = 90  # ~11 fps
  frames = []

  print(f"Generating {num_frames} frames with master palette...")

  for f in range(num_frames):
    t_norm = f / float(num_frames)
    t_rad = t_norm * 2.0 * math.pi

    frame = orig.copy().convert('RGBA')

    # 1. Flapping red flag on Treehouse
    flag_crop = orig.crop((fx1, fy1, fx2, fy2))
    flag_arr = np.array(flag_crop)
    fh, fw, _ = flag_arr.shape
    deformed_flag = np.zeros_like(flag_arr)
    deformed_flag[:] = flag_arr[0, 0] # Sky background

    for col in range(fw):
      dist = col / float(fw)
      dy = int(round(dist * 2.2 * math.sin(t_rad * 2.0 + dist * 3.5)))
      for row in range(fh):
        sr = row - dy
        if 0 <= sr < fh:
          p = flag_arr[sr, col]
          if p[0] > 140 and p[1] < 110: # Red flag
            deformed_flag[row, col] = p
          elif p[0] > 100 and p[1] > 70 and p[2] < 70: # Pole
            deformed_flag[row, col] = flag_arr[row, col]
          else:
            deformed_flag[row, col] = flag_arr[row, col]

    frame.paste(Image.fromarray(deformed_flag), (fx1, fy1))

    # 2. Pixel Music Notes floating from Jake's Viola
    notes_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for i in range(2):
      phase = i / 2.0
      prog = (t_norm + phase) % 1.0
      nx = int(jx + prog * 30 + math.sin(prog * math.pi) * 6)
      ny = int(jy - 10 - prog * 55)
      n_alpha = int(255 * math.sin(prog * math.pi))
      if n_alpha > 35:
        sym = 1 if i == 0 else 2
        note_img = create_pixel_note(sym, n_alpha)
        notes_layer.paste(note_img, (nx, ny), note_img)

    frame.alpha_composite(notes_layer)

    # 3. Drifting dandelion/meadow pollen
    petal_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    p_draw = ImageDraw.Draw(petal_layer)

    for p in particles:
      cur_x = (p['x'] + t_norm * p['speed']) % w
      cur_y = p['y'] + math.sin(t_rad * p['freq'] + p['x']) * p['amp']

      if p['type'] == 'white':
        color = (255, 255, 255, 220)
      elif p['type'] == 'gold':
        color = (254, 240, 138, 220)
      else:
        color = (186, 230, 253, 200)

      sz = p['size']
      p_draw.rectangle([int(cur_x), int(cur_y), int(cur_x) + sz - 1, int(cur_y) + sz - 1], fill=color)
      # Pixel shadow
      p_draw.rectangle([int(cur_x), int(cur_y) + sz, int(cur_x) + sz - 1, int(cur_y) + sz], fill=(20, 45, 20, 80))

    frame.alpha_composite(petal_layer)

    # 4. Quantize strictly using the master palette
    frame_rgb = frame.convert('RGB')
    pal_f = frame_rgb.quantize(palette=master_palette, dither=Image.Dither.FLOYDSTEINBERG)
    frames.append(pal_f)

  print(f"Saving final pixel GIF to {out_path}...")
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
