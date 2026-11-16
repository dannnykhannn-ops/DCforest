"""Build every app icon from one square source image.

Usage:  python3 tools/make-icons.py path/to/your-icon.png
With no argument it builds a stand-in icon from assets/majid-dcf-2026.webp.
"""
import sys, os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'icons')
os.makedirs(OUT, exist_ok=True)
GREEN = (7, 26, 13, 255)

def standin(size=1024):
    bg = Image.new('RGBA', (size, size), GREEN)
    # radial green glow
    glow = Image.new('L', (size, size), 0)
    ImageDraw.Draw(glow).ellipse((size*.05, -size*.15, size*1.1, size*.9), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(size*.12))
    bg = Image.composite(Image.new('RGBA', (size, size), (40, 110, 52, 255)), bg, glow)
    off = Image.open(os.path.join(HERE, '..', 'assets', 'officer.webp')).convert('RGBA')
    w = int(size*1.02); h = int(off.height*w/off.width)
    off = off.resize((w, h), Image.LANCZOS)
    bg.alpha_composite(off, ((size-w)//2, size-int(h*.86)))
    # gold frame
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((size*.02, size*.02, size*.98, size*.98), radius=size*.2, outline=(224, 187, 75, 255), width=int(size*.035))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((size*.005, size*.005, size*.995, size*.995), radius=size*.21, fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); out.paste(bg, (0, 0), mask)
    return out, bg

def square(im):
    s = min(im.size); l = (im.width-s)//2; t = (im.height-s)//2
    return im.crop((l, t, l+s, t+s))

if len(sys.argv) > 1:
    src = square(Image.open(sys.argv[1]).convert('RGBA'))
    # maskable: full-bleed, so trim the frame/transparent corners and fill
    s = src.width; c = int(s*.07)
    full = Image.new('RGBA', (s-2*c, s-2*c), GREEN); full.alpha_composite(src.crop((c, c, s-c, s-c)))
else:
    full = square(Image.open(os.path.join(HERE, '..', 'assets', 'majid-dcf-2026.webp')).convert('RGBA').crop((0, 0, 760, 760)))
    src = full

def save(im, name, px, flat=False):
    im = im.resize((px, px), Image.LANCZOS)
    if flat:
        b = Image.new('RGBA', im.size, GREEN); b.alpha_composite(im); im = b.convert('RGB')
    im.save(os.path.join(OUT, name), optimize=True)

save(src, 'icon-192.png', 192)
save(src, 'icon-512.png', 512)
save(full, 'icon-maskable-512.png', 512, flat=True)
save(full, 'apple-touch-icon.png', 180, flat=True)
save(src, 'favicon-32.png', 32)
print('icons written to', os.path.normpath(OUT))
