"""Rewrite exported GLBs so images reference the shared texture files by name.

    python3 tools/models/externalize.py data/models

GLTFExporter embeds every image; the build page swaps them for 1x1 placeholders and
keeps each texture's name. Here each image becomes `textures/<name>.jpg|png`, the
placeholder bytes are removed and the binary chunk is repacked.
"""
import json
import os
import struct
import sys


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2
    off, js, bin_ = 12, None, b""
    while off < length:
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            js = json.loads(chunk.decode())
        elif ctype == b"BIN\x00":
            bin_ = chunk
        off += 8 + clen
    return js, bin_


def write_glb(path, js, bin_):
    j = json.dumps(js, separators=(",", ":")).encode()
    j += b" " * ((4 - len(j) % 4) % 4)
    bin_ += b"\x00" * ((4 - len(bin_) % 4) % 4)
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(j) + 8 + len(bin_))
    out += struct.pack("<I4s", len(j), b"JSON") + j + struct.pack("<I4s", len(bin_), b"BIN\x00") + bin_
    open(path, "wb").write(out)


def externalize(path, tex_dir):
    js, bin_ = read_glb(path)
    names = {}
    for t in js.get("textures", []):
        names.setdefault(t["source"], t.get("name"))
    image_views = set()
    for i, img in enumerate(js.get("images", [])):
        name = names.get(i)
        if not name:
            raise SystemExit(f"{path}: image {i} has no texture name")
        ext = ".png" if name.startswith("gen_") else ".jpg"
        if not os.path.exists(os.path.join(tex_dir, name + ext)):
            raise SystemExit(f"{path}: missing texture file {name + ext}")
        if "bufferView" in img:
            image_views.add(img["bufferView"])
        js["images"][i] = {"uri": f"textures/{name}{ext}", "mimeType": "image/png" if ext == ".png" else "image/jpeg", "name": name}
    # Repack the binary chunk without the placeholder image views.
    views = js.get("bufferViews", [])
    keep = [k for k in range(len(views)) if k not in image_views]
    remap, new_bin = {}, bytearray()
    for new_idx, k in enumerate(keep):
        v = views[k]
        start = v.get("byteOffset", 0)
        chunk = bin_[start: start + v["byteLength"]]
        while len(new_bin) % 4:
            new_bin.append(0)
        v["byteOffset"] = len(new_bin)
        new_bin += chunk
        remap[k] = new_idx
    js["bufferViews"] = [views[k] for k in keep]
    for acc in js.get("accessors", []):
        if "bufferView" in acc:
            acc["bufferView"] = remap[acc["bufferView"]]
    js["buffers"] = [{"byteLength": len(new_bin)}]
    js.setdefault("asset", {})["copyright"] = "Model: Raleigh Digital Twin contributors. Textures: Poly Haven (CC0)."
    write_glb(path, js, bytes(new_bin))
    return len(js["images"]), len(new_bin)


if __name__ == "__main__":
    root = sys.argv[1]
    for f in sorted(os.listdir(root)):
        if f.endswith(".glb"):
            n, size = externalize(os.path.join(root, f), os.path.join(root, "textures"))
            print(f"{f}: {n} external textures, geometry {size / 1024:.0f} KB")
