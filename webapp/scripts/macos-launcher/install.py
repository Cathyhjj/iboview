#!/usr/bin/env python3
"""Create a macOS application that opens this checkout's web preview."""

import argparse
import json
from pathlib import Path
import plistlib
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile


def install(output):
    if sys.platform != "darwin":
        raise RuntimeError("This installer requires macOS.")
    if output.exists() or output.is_symlink():
        raise RuntimeError(f"Already exists; left untouched: {output}")
    if not output.parent.is_dir() or output.suffix != ".app":
        raise RuntimeError("Choose an .app path in an existing directory.")

    source = Path(__file__).resolve().parent
    webapp = source.parents[1]
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Install Node.js 20.19+ or 22.12+ first.")
    version = subprocess.check_output([node, "-p", "process.versions.node"], text=True).strip()
    major, minor, _ = map(int, version.split("."))
    if not (major == 20 and minor >= 19 or major == 22 and minor >= 12 or major >= 23):
        raise RuntimeError(f"Node.js {version} is unsupported; use 20.19+ or 22.12+.")
    if not (webapp / "node_modules/vite/bin/vite.js").is_file():
        raise RuntimeError(f"Run npm ci in {webapp} first.")
    if not (webapp / "dist/index.html").is_file():
        raise RuntimeError(f"Run npm run build in {webapp} first.")

    with tempfile.TemporaryDirectory(prefix="iboview-launcher-") as temporary:
        work = Path(temporary)
        app = work / "IboView.app"
        subprocess.run([
            "/usr/bin/osacompile", "-o", str(app),
            str(source / "launcher.applescript"),
        ], check=True)
        resources = app / "Contents/Resources"
        shutil.copy2(source / "launcher.mjs", resources / "launcher.mjs")
        (resources / "config.json").write_text(json.dumps({
            "projectPath": str(webapp), "port": 5173,
        }, indent=2), encoding="utf-8")
        entrypoint = resources / "launch.sh"
        entrypoint.write_text(
            '#!/bin/sh\nexec ' + shlex.quote(node)
            + ' "$(dirname "$0")/launcher.mjs" "$@"\n', encoding="utf-8",
        )
        entrypoint.chmod(0o755)

        # The repository's ICO contains a PNG image.
        icon = (webapp.parent / "resources/d_lobe3.ico").read_bytes()
        length, offset = struct.unpack_from("<II", icon, 14)
        png = work / "original-icon.png"
        png.write_bytes(icon[offset:offset + length])
        iconset = work / "IboView.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                suffix = "@2x" if scale == 2 else ""
                target = iconset / f"icon_{size}x{size}{suffix}.png"
                subprocess.run([
                    "/usr/bin/sips", "-z", str(size * scale), str(size * scale),
                    str(png), "--out", str(target),
                ], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([
            "/usr/bin/iconutil", "-c", "icns", str(iconset),
            "-o", str(resources / "IboView.icns"),
        ], check=True)

        info = app / "Contents/Info.plist"
        with info.open("rb") as stream:
            metadata = plistlib.load(stream)
        for key in list(metadata):
            if key.startswith("NS") and key.endswith("UsageDescription"):
                del metadata[key]
        metadata.update(
            CFBundleDisplayName="IboView", CFBundleName="IboView",
            CFBundleIdentifier="local.iboview.launcher", CFBundleIconFile="IboView",
            CFBundleShortVersionString="1.0", CFBundleVersion="1",
            LSUIElement=True, NSHighResolutionCapable=True,
        )
        with info.open("wb") as stream:
            plistlib.dump(metadata, stream)
        subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(app)], check=True)
        subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], check=True)
        shutil.copytree(app, output)
    print(f"Created {output}. Double-click it to open IboView.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path.home() / "Desktop/IboView.app")
    args = parser.parse_args()
    try:
        install(args.output.expanduser().absolute())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")
