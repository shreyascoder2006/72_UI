"""Bundle the twin for static hosting and for publishing as a single page.

    python3 tools/build_dist.py

Writes
  dist/index.html     standalone document: all CSS and JS inlined, MapLibre from cdnjs
  dist/artifact.html  the same page without the document wrapper (for hosts that add one)
  dist/data/...       the OpenStreetMap vector tiles and label glyphs the page fetches
"""
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
MAPLIBRE = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js"


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def block(html, name):
    m = re.search(r"<!--BUILD:%s-->(.*?)<!--/BUILD:%s-->" % (name, name), html, re.S)
    if not m:
        raise SystemExit("missing BUILD:" + name)
    return m


def main():
    html = read("index.html")

    head = block(html, "HEAD")
    fonts = re.findall(r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com[^"]+)">', head.group(1))
    css = "\n".join(read(href) for href in re.findall(r'<link rel="stylesheet" href="((?:src)/[^"]+\.css)">', head.group(1)))
    head_out = "".join(f'<link rel="stylesheet" href="{f}">\n' for f in fonts) + "<style>\n" + css + "\n</style>\n"

    scripts = block(html, "SCRIPTS")
    local = re.findall(r'<script src="((?:config\.js|src/js/[^"]+))"></script>', scripts.group(1))
    js = "\n;\n".join(read(src) for src in local).replace("</script", "<\\/script")
    scripts_out = f'<script src="{MAPLIBRE}"></script>\n<script>\n{js}\n</script>\n'

    full = html[:head.start()] + head_out + html[head.end():scripts.start()] + scripts_out + html[scripts.end():]

    os.makedirs(DIST, exist_ok=True)
    with open(os.path.join(DIST, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(full)

    # Page without its document wrapper: title first (hosts scan the first 8 KB),
    # then styles, body content and scripts.
    title = re.search(r"<title>.*?</title>", full, re.S).group(0)
    desc = re.search(r'<meta name="description"[^>]*>', full).group(0)
    body = re.search(r"<body>(.*)</body>", full, re.S).group(1)
    frag = f"{title}\n{desc}\n{head_out}{body}"
    with open(os.path.join(DIST, "artifact.html"), "w", encoding="utf-8") as fh:
        fh.write(frag)

    data_out = os.path.join(DIST, "data")
    if os.path.exists(data_out):
        shutil.rmtree(data_out)
    shutil.copytree(os.path.join(ROOT, "data"), data_out)
    n = sum(len(f) for _, _, f in os.walk(data_out))
    print(f"dist/index.html {len(full) / 1024:.0f} KB · dist/artifact.html {len(frag) / 1024:.0f} KB · {n} data files")


if __name__ == "__main__":
    main()
