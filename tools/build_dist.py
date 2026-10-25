"""Bundle the twin for static hosting and for publishing as a single page.

    python3 tools/build_dist.py

Writes
  dist/index.html     standalone document: all CSS and JS inlined, MapLibre from cdnjs
  dist/artifact.html  the same page without the document wrapper (for hosts that add one)
  dist/data/bundles/  the OpenStreetMap vector tiles and label glyphs, packed as base64 JSON
                      bundles (some hosts serve only text and web media types, not .pbf)
"""
import base64
import glob
import json
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
    js = 'window.TWIN_CONFIG = { tileBundles: "data/bundles/index.json" };\n' + js
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
    out = os.path.join(data_out, "bundles")
    os.makedirs(out)
    index = {"tiles": {}, "fonts": {}, "bundles": {}}
    groups = {}

    def bundle_of(z, x):
        if z < 14:
            return "tiles-z10-13"
        return "tiles-z14-" + ("a" if x <= 4610 else "b" if x <= 4612 else "c" if x <= 4614 else "d")

    for path in sorted(glob.glob(os.path.join(ROOT, "data", "tiles", "*", "*", "*.pbf"))):
        z, x, y = path.split(os.sep)[-3:]
        key = f"{z}/{x}/{y[:-4]}"
        name = bundle_of(int(z), int(x))
        groups.setdefault(name, {})[key] = base64.b64encode(open(path, "rb").read()).decode()
        index["tiles"][key] = name
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "fonts", "*", "*.pbf"))):
        stack, rng = path.split(os.sep)[-2:]
        key = f"{stack}/{rng[:-4]}"
        groups.setdefault("fonts", {})[key] = base64.b64encode(open(path, "rb").read()).decode()
        index["fonts"][key] = "fonts"
    for name, content in groups.items():
        rel = f"data/bundles/{name}.json"
        index["bundles"][name] = rel
        with open(os.path.join(DIST, rel), "w") as fh:
            json.dump(content, fh, separators=(",", ":"))
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(index, fh, separators=(",", ":"))
    sizes = ", ".join(f"{n} {os.path.getsize(os.path.join(out, n + '.json')) / 1e6:.1f} MB" for n in sorted(groups))
    print(f"dist/index.html {len(full) / 1024:.0f} KB · dist/artifact.html {len(frag) / 1024:.0f} KB")
    print(f"bundles: {sizes}")


if __name__ == "__main__":
    main()
