import os
import math
import random
import numpy as np
from PIL import Image, ImageDraw

def create_pixel_z(size, alpha=255):
  """Create a pixelated letter 'Z' with a dark border and white fill."""
  s = max(6, int(size))
  img = Image.new('RGBA', (s + 4, s + 4), (0, 0, 0, 0))
  draw = ImageDraw.Draw(img)
  
  matrix = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [1, 1, 1, 1, 1]
  ]
  
  cell_w = max(1, s // 5)
  pad = 2
  
  # Black outline
  for dy in [-1, 0, 1]:
    for dx in [-1, 0, 1]:
      if dx == 0 and dy == 0:
        continue
      for r in range(5):
        for c in range(5):
          if matrix[r][c]:
            draw.rectangle(
              [pad + c * cell_w + dx, pad + r * cell_w + dy, 
               pad + (c + 1) * cell_w - 1 + dx, pad + (r + 1) * cell_w - 1 + dy],
              fill=(10, 25, 35, int(alpha * 0.9))
            )
            
  # White fill
  for r in range(5):
    for c in range(5):
      if matrix[r][c]:
        draw.rectangle(
          [pad + c * cell_w, pad + r * cell_w, 
           pad + (c + 1) * cell_w - 1, pad + (r + 1) * cell_w - 1],
          fill=(255, 255, 255, alpha)
        )
        
  return img

def main():
  src_path = r'C:\Users\Admin\.gemini\antigravity-ide\brain\8d031e31-1865-4fbf-a273-1135fbb939a1\pixel_bliss_wide_1789028450039.jpg'
  out_path = r'e:\casau\Omniverse-tool\frontend\public\assets\hero-bg.gif'
  
  orig = Image.open(src_path).convert('RGBA')
  w, h = orig.size
  
  base_im = orig.copy()
  
  # Precompute random particles for drifting petals / dandelion spores
  random.seed(1337)
  num_particles = 36
  particles = []
  for _ in range(num_particles):
    p_x = random.uniform(0, w)
    p_y = random.uniform(430, h - 20)
    speed_x = random.uniform(60, 120)
    amp_y = random.uniform(3, 8)
    freq_y = random.uniform(1, 3)
    p_type = random.choice(['white', 'yellow', 'cyan_sparkle'])
    p_size = random.choice([2, 3])
    particles.append({
      'x': p_x, 'y': p_y, 'speed': speed_x, 
      'amp': amp_y, 'freq': freq_y, 'type': p_type, 'size': p_size
    })
    
  num_frames = 20
  frame_duration = 90  # 90ms per frame -> ~11 fps, 1.8s loop
  frames = []
  
  print(f"Generating {num_frames} frames for wide panoramic Bliss pixel GIF...")
  
  for f in range(num_frames):
    t_norm = f / float(num_frames)
    t_rad = t_norm * 2.0 * math.pi
    
    frame = base_im.copy()
    
    # -------------------------------------------------------------
    # 1. Flapping Red Flag on Treehouse (x: [988, 1012], y: [330, 356])
    # -------------------------------------------------------------
    flag_x1, flag_y1, flag_x2, flag_y2 = 988, 330, 1012, 356
    flag_crop = base_im.crop((flag_x1, flag_y1, flag_x2, flag_y2))
    flag_arr = np.array(flag_crop)
    flag_h, flag_w, _ = flag_arr.shape
    deformed_flag = np.zeros_like(flag_arr)
    # Sky background color behind flag
    sky_bg = np.array([115, 175, 245, 255], dtype=np.uint8)
    deformed_flag[:] = sky_bg
    
    for col in range(flag_w):
      dist_from_pole = col / float(flag_w)
      # Sine wave flapping: amplitude increases towards tip of flag
      dy = int(round(dist_from_pole * 2.2 * math.sin(t_rad * 2.0 + dist_from_pole * 3.5)))
      for row in range(flag_h):
        src_r = row - dy
        if 0 <= src_r < flag_h:
          p = flag_arr[src_r, col]
          if p[0] > 150 and p[1] < 100:  # Red flag pixel
            deformed_flag[row, col] = p
          else:
            deformed_flag[row, col] = flag_arr[row, col]
            
    frame.paste(Image.fromarray(deformed_flag), (flag_x1, flag_y1))
    
    # -------------------------------------------------------------
    # 2. Jake Floating "z z Z" (Jake is at x ~455, y ~510)
    # -------------------------------------------------------------
    z_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for i in range(3):
      phase = i / 3.0
      z_prog = (t_norm + phase) % 1.0
      
      cur_x = int(455 + z_prog * 30 + math.sin(z_prog * math.pi) * 4)
      cur_y = int(505 - z_prog * 65)
      
      z_size = int(6 + z_prog * 8)
      z_alpha = int(255 * math.sin(z_prog * math.pi))
      if z_alpha > 35:
        z_img = create_pixel_z(z_size, z_alpha)
        z_layer.paste(z_img, (cur_x, cur_y), z_img)
        
    frame.alpha_composite(z_layer)
    
    # -------------------------------------------------------------
    # 3. Drifting Dandelion & Petal Spores across the Wide Meadow
    # -------------------------------------------------------------
    petal_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    p_draw = ImageDraw.Draw(petal_layer)
    
    for p in particles:
      cur_px = (p['x'] + t_norm * p['speed']) % w
      cur_py = p['y'] + math.sin(t_rad * p['freq'] + p['x']) * p['amp']
      
      if p['type'] == 'white':
        color = (255, 255, 255, 230)
      elif p['type'] == 'yellow':
        color = (253, 224, 71, 230)
      else:
        color = (186, 230, 253, 210)
        
      sz = p['size']
      p_draw.rectangle([int(cur_px), int(cur_py), int(cur_px) + sz - 1, int(cur_py) + sz - 1], fill=color)
      # Pixel shadow
      p_draw.rectangle([int(cur_px), int(cur_py) + sz, int(cur_px) + sz - 1, int(cur_py) + sz], fill=(15, 35, 15, 90))
      
    frame.alpha_composite(petal_layer)
    
    # Convert frame to palette (256 indexed colors)
    rgb_frame = frame.convert('RGB')
    palette_frame = rgb_frame.quantize(colors=256, method=Image.Resampling.NEAREST, dither=Image.Dither.NONE)
    frames.append(palette_frame)
    
  print(f"Saving animated GIF to {out_path}...")
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
