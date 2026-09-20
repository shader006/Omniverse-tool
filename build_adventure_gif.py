import os
import math
import random
import numpy as np
from PIL import Image, ImageDraw

def create_pixel_z(size, alpha=255):
  """Create a pixelated letter 'Z' with a dark border and white fill."""
  s = max(7, int(size))
  img = Image.new('RGBA', (s + 4, s + 4), (0, 0, 0, 0))
  draw = ImageDraw.Draw(img)
  
  # Grid representation of 'Z' (5x5 matrix scaled to s)
  matrix = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [1, 1, 1, 1, 1]
  ]
  
  cell_w = max(1, s // 5)
  pad = 2
  
  # First draw black outline (offset by 1 in 4 directions)
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
              fill=(10, 20, 30, int(alpha * 0.9))
            )
            
  # Draw white fill
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
  src_path = r'C:\Users\Admin\.gemini\antigravity-ide\brain\8d031e31-1865-4fbf-a273-1135fbb939a1\adventure_time_pixel_bliss_1789026548452.jpg'
  out_path = r'e:\casau\Omniverse-tool\frontend\public\assets\hero-bg.gif'
  
  orig = Image.open(src_path).convert('RGBA')
  w, h = orig.size
  
  # 1. Clean the static Z text
  base_im = orig.copy()
  grass_patch = orig.crop((1165, 455, 1195, 565))
  base_im.paste(grass_patch, (1110, 455))
  base_im.paste(grass_patch, (1135, 455))
  
  # Precompute random particles for drifting petals/spores
  random.seed(42)
  num_particles = 32
  particles = []
  for _ in range(num_particles):
    p_x = random.uniform(0, w)
    p_y = random.uniform(350, h - 30)
    speed_x = random.uniform(80, 140)
    amp_y = random.uniform(4, 10)
    freq_y = random.uniform(1, 3)
    p_type = random.choice(['white', 'yellow', 'pink'])
    p_size = random.choice([2, 3])
    particles.append({
      'x': p_x, 'y': p_y, 'speed': speed_x, 
      'amp': amp_y, 'freq': freq_y, 'type': p_type, 'size': p_size
    })
    
  num_frames = 20
  frame_duration = 90  # 90ms per frame -> ~11 fps, 1.8s loop
  frames = []
  
  print(f"Generating {num_frames} frames for pixel GIF...")
  
  for f in range(num_frames):
    t_norm = f / float(num_frames)
    t_rad = t_norm * 2.0 * math.pi
    
    frame = base_im.copy()
    
    # -------------------------------------------------------------
    # 1. Flapping Red Flag on Treehouse (x: [1185, 1236], y: [130, 195])
    # -------------------------------------------------------------
    flag_x1, flag_y1, flag_x2, flag_y2 = 1186, 130, 1238, 195
    flag_crop = base_im.crop((flag_x1, flag_y1, flag_x2, flag_y2))
    flag_arr = np.array(flag_crop)
    
    flag_h, flag_w, _ = flag_arr.shape
    deformed_flag = np.zeros_like(flag_arr)
    # Background fill with sky color behind flag
    sky_bg = np.array([125, 195, 245, 255], dtype=np.uint8)
    deformed_flag[:] = sky_bg
    
    for col in range(flag_w):
      dist_from_pole = col / float(flag_w)
      # Sine wave flapping: amplitude increases towards tip of flag
      dy = int(round(dist_from_pole * 3.5 * math.sin(t_rad * 2.0 + dist_from_pole * 3.8)))
      for row in range(flag_h):
        src_r = row - dy
        if 0 <= src_r < flag_h:
          # Only shift red/wood flag pixels, leave non-flag as sky
          p = flag_arr[src_r, col]
          if p[0] > 140 and p[1] < 110:  # Red flag pixel
            deformed_flag[row, col] = p
          elif p[0] > 100 and p[1] > 70 and p[2] < 50: # wood flagpole
            deformed_flag[row, col] = flag_arr[row, col]
          else:
            deformed_flag[row, col] = flag_arr[row, col]
            
    frame.paste(Image.fromarray(deformed_flag), (flag_x1, flag_y1))
    
    # -------------------------------------------------------------
    # 2. Flapping Top Green Flag (x: [1136, 1176], y: [42, 95])
    # -------------------------------------------------------------
    gf_x1, gf_y1, gf_x2, gf_y2 = 1136, 42, 1176, 95
    gf_crop = base_im.crop((gf_x1, gf_y1, gf_x2, gf_y2))
    gf_arr = np.array(gf_crop)
    gf_h, gf_w, _ = gf_arr.shape
    deformed_gf = np.zeros_like(gf_arr)
    deformed_gf[:] = np.array([80, 160, 235, 255], dtype=np.uint8) # sky color
    
    for col in range(gf_w):
      dist = col / float(gf_w)
      dy = int(round(dist * 2.5 * math.sin(t_rad * 2.0 + dist * 3.5 + 1.2)))
      for row in range(gf_h):
        src_r = row - dy
        if 0 <= src_r < gf_h:
          p = gf_arr[src_r, col]
          if p[1] > 130 and p[0] < 120 and p[2] < 120: # Green flag
            deformed_gf[row, col] = p
          else:
            deformed_gf[row, col] = gf_arr[row, col]
            
    frame.paste(Image.fromarray(deformed_gf), (gf_x1, gf_y1))
    
    # -------------------------------------------------------------
    # 3. Sun Warmth Pulse (Center: 783, 111)
    # -------------------------------------------------------------
    draw = ImageDraw.Draw(frame)
    sun_cx, sun_cy = 783, 111
    pulse = math.sin(t_rad) * 3.0
    r_aura = 63 + pulse
    # Subtle warm yellow glow ring
    aura_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    aura_draw = ImageDraw.Draw(aura_layer)
    alpha_pulse = int(45 + 25 * math.sin(t_rad))
    aura_draw.ellipse(
      [sun_cx - r_aura, sun_cy - r_aura, sun_cx + r_aura, sun_cy + r_aura],
      fill=(255, 240, 180, alpha_pulse)
    )
    frame.alpha_composite(aura_layer)
    
    # -------------------------------------------------------------
    # 4. Floating Jake Sleeping "Z Z Z"
    # -------------------------------------------------------------
    z_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    # 3 Zs staggered by 1/3 phase
    for i in range(3):
      phase = i / 3.0
      z_prog = (t_norm + phase) % 1.0
      
      # Z floats up from Jake's face and slightly right
      cur_x = int(1095 + z_prog * 45 + math.sin(z_prog * math.pi) * 6)
      cur_y = int(550 - z_prog * 90)
      
      # Size scales from 8 to 18
      z_size = int(8 + z_prog * 10)
      # Alpha fades in, stays bright, then fades out
      z_alpha = int(255 * math.sin(z_prog * math.pi))
      if z_alpha > 30:
        z_img = create_pixel_z(z_size, z_alpha)
        z_layer.paste(z_img, (cur_x, cur_y), z_img)
        
    frame.alpha_composite(z_layer)
    
    # -------------------------------------------------------------
    # 5. Drifting Dandelion & Petal Spores across the Meadow
    # -------------------------------------------------------------
    petal_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    p_draw = ImageDraw.Draw(petal_layer)
    
    for p in particles:
      cur_px = (p['x'] + t_norm * p['speed']) % w
      cur_py = p['y'] + math.sin(t_rad * p['freq'] + p['x']) * p['amp']
      
      if p['type'] == 'white':
        color = (255, 255, 255, 220)
      elif p['type'] == 'yellow':
        color = (254, 240, 138, 230)
      else:
        color = (251, 207, 232, 220)
        
      sz = p['size']
      p_draw.rectangle([int(cur_px), int(cur_py), int(cur_px) + sz - 1, int(cur_py) + sz - 1], fill=color)
      # Add pixel shadow
      p_draw.rectangle([int(cur_px), int(cur_py) + sz, int(cur_px) + sz - 1, int(cur_py) + sz], fill=(10, 40, 10, 100))
      
    frame.alpha_composite(petal_layer)
    
    # Convert frame to palette (indexed color for ultra-crisp pixels and small file size)
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
