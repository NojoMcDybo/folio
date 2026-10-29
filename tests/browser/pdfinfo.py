import sys, json, re, pypdf
r = pypdf.PdfReader(sys.argv[1])
out = []
for p in r.pages:
    t = p.extract_text() or ""
    m = re.search(r"Seite (\d+)", t)
    out.append({"n": int(m.group(1)) if m else None, "rot": int(p.get("/Rotate", 0) or 0), "crop": [round(float(x)) for x in p.cropbox], "media": [round(float(x)) for x in p.mediabox]})
print(json.dumps(out))
