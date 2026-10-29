"""Erzeugt die Test-PDFs fuer tests/browser (nicht eingecheckt, jederzeit neu erzeugbar).

Braucht: reportlab, Pillow.   python3 tests/browser/make-fixtures.py
"""
import io
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(OUT, exist_ok=True)
W, H = A4


def path(name):
    return os.path.join(OUT, name)


# ---- Fliesstext-Dokumente mit Lesezeichen (Seitenleiste, Seitenoperationen)
def make(name, n, varied=False):
    random.seed(3)
    c = canvas.Canvas(path(name))
    for i in range(1, n + 1):
        size = A4 if not varied or i % 7 else landscape(A4)
        c.setPageSize(size)
        c.setFillColor(colors.HexColor("#f2e9d8" if i % 2 else "#e8eef7"))
        c.rect(0, 0, size[0], size[1], fill=1, stroke=0)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 48)
        c.drawString(60, size[1] - 120, f"Seite {i}")
        c.setFont("Helvetica", 14)
        for k in range(12):
            c.drawString(60, size[1] - 170 - k * 22, f"Zeile {k + 1}: Lorem ipsum dolor sit amet, Seite {i}. Tel 0251 123456 mail@example.org https://example.org")
        c.setFillColor(colors.HexColor("#%02x%02x%02x" % (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))))
        c.rect(60, 80, 200, 120, fill=1, stroke=0)
        if i in (1, 5, 12):
            c.bookmarkPage(f"p{i}")
            c.addOutlineEntry(f"Kapitel auf Seite {i}", f"p{i}", 0)
        c.showPage()
    c.save()


make("doc12.pdf", 12, varied=True)
make("doc60.pdf", 60)
make("doc3.pdf", 3)

# ---- Buch mit gedrucktem Inhaltsverzeichnis, Skript nur mit Ueberschriften
chapters = [("1 Einleitung", 1, 1), ("1.1 Hintergrund", 2, 2), ("1.2 Fragestellung", 4, 2), ("2 Methoden", 9, 1),
            ("2.1 Stichprobe", 10, 2), ("3 Ergebnisse", 15, 1), ("4 Diskussion", 22, 1)]


def body(c, i):
    c.setFont("Helvetica", 11)
    for k in range(20):
        c.drawString(72, H - 160 - k * 16, f"Fliesstext Zeile {k} auf Seite {i}: lorem ipsum dolor sit amet consetetur sadipscing.")
    c.setFont("Helvetica", 9)
    c.drawString(72, H - 40, "Zeitschrift fuer Tests")
    c.drawString(W / 2, 30, str(i - 3 if i > 3 else i))


c = canvas.Canvas(path("toc.pdf"), pagesize=A4)
for i in range(1, 31):
    if i == 1:
        c.setFont("Helvetica-Bold", 30)
        c.drawString(72, H - 200, "Titel des Buches")
    elif i == 2:
        c.setFont("Helvetica-Bold", 18)
        c.drawString(72, H - 90, "Inhaltsverzeichnis")
        c.setFont("Helvetica", 11)
        for k, (t, p, lvl) in enumerate(chapters):
            y = H - 140 - k * 20
            x = 72 + (lvl - 1) * 14
            c.drawString(x, y, t)
            c.drawRightString(W - 72, y, str(p))
            tw = c.stringWidth(t, "Helvetica", 11)
            dots = int((W - 72 - 30 - (x + tw + 8)) / c.stringWidth(".", "Helvetica", 11))
            c.drawString(x + tw + 6, y, "." * max(3, dots))
    else:
        body(c, i)
        for t, p, lvl in chapters:
            if p + 3 == i:
                c.setFont("Helvetica-Bold", 24 if lvl == 1 else 16)
                c.drawString(72, H - 100, t)
    c.showPage()
c.save()

c = canvas.Canvas(path("heads.pdf"), pagesize=A4)
for i in range(1, 21):
    body(c, i)
    if i % 5 == 1:
        c.setFont("Helvetica-Bold", 24)
        c.drawString(72, H - 100, f"Teil {i // 5 + 1}")
    if i % 5 == 3:
        c.setFont("Helvetica-Bold", 16)
        c.drawString(72, H - 120, f"Abschnitt {i}")
    c.showPage()
c.save()

# ---- Scan: nur ein Bild, kein Text
im = Image.new("RGB", (1240, 1754), "white")
d = ImageDraw.Draw(im)
try:
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 44)
except OSError:
    f = ImageFont.load_default()
for i, t in enumerate(["Gescanntes Schreiben", "Uni Münster, Fachbereich 7", "Telefon 0251 83-22222", "mail@example.org", "https://example.org/info"]):
    d.text((140, 200 + i * 110), t, fill="black", font=f)
im.save(path("scan.png"))
c = canvas.Canvas(path("scan.pdf"), pagesize=A4)
for _ in range(2):
    c.drawImage(path("scan.png"), 0, 0, width=W, height=H)
    c.showPage()
c.save()


# ---- Fotos (Verkleinern/Schwarzweiss), Vektorfarben, Formular
def photo(w, h, seed):
    r = random.Random(seed)
    base = Image.linear_gradient("L").resize((w, h)).convert("RGB")
    noise = Image.effect_noise((w, h), 40).convert("RGB")
    im = Image.blend(base.rotate(r.randint(0, 90)), noise, 0.35)
    d = ImageDraw.Draw(im)
    for _ in range(30):
        x, y = r.randint(0, w), r.randint(0, h)
        d.ellipse((x, y, x + r.randint(40, 300), y + r.randint(40, 300)), fill=(r.randint(0, 255), r.randint(0, 255), r.randint(0, 255)))
    return im.filter(ImageFilter.GaussianBlur(1.2))


c = canvas.Canvas(path("photo.pdf"), pagesize=A4)
for i in range(3):
    buf = io.BytesIO()
    photo(2400, 1600, i).save(buf, "JPEG", quality=92)
    buf.seek(0)
    c.drawImage(ImageReader(buf), 50, 300, width=495, height=330)  # etwa 350 dpi
    c.setFont("Helvetica", 14)
    c.setFillColorRGB(0.8, 0.1, 0.1)
    c.drawString(50, 260, f"Foto Seite {i + 1}")
    c.showPage()
c.drawImage(ImageReader(photo(800, 800, 9)), 50, 600, width=80, height=80)
c.showPage()
c.save()

c = canvas.Canvas(path("color.pdf"), pagesize=A4)
c.setFillColorRGB(1, 0, 0); c.rect(50, 700, 100, 60, fill=1, stroke=0)
c.setFillColorCMYK(0, 1, 1, 0); c.rect(170, 700, 100, 60, fill=1, stroke=0)
c.setFillColorCMYK(1, 0, 0, 0.2); c.rect(290, 700, 100, 60, fill=1, stroke=0)
c.setStrokeColorRGB(0, 0.6, 0.2); c.setLineWidth(6); c.line(50, 650, 500, 650)
c.setFillColorRGB(0.1, 0.2, 0.9); c.setFont("Helvetica-Bold", 30); c.drawString(50, 590, "Blauer Text")
c.setFillColor(colors.HexColor("#ffcc00")); c.circle(300, 520, 40, fill=1, stroke=0)
c.showPage(); c.save()

c = canvas.Canvas(path("form.pdf"), pagesize=A4)
c.setFont("Helvetica", 14); c.drawString(50, 780, "Antrag")
c.acroForm.textfield(name="name", tooltip="Name", x=50, y=720, width=250, height=24, value="Erika Mustermann", borderStyle="solid", forceBorder=True)
c.acroForm.checkbox(name="agree", tooltip="ok", x=50, y=680, size=18, checked=True, buttonStyle="check", borderStyle="solid", forceBorder=True)
c.showPage(); c.save()
print("Testdateien in", OUT)
