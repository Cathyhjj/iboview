#!/usr/bin/env python3
"""Compile production function bodies without the full OpenGL/scientific application."""

import argparse
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
CPP_TOKENS = re.compile(r'''//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}]''')


def source_block(relative_path, signature):
    source = (ROOT / relative_path).read_text()
    start = source.index(signature)
    opening = source.index("{", start)
    depth = 0
    for match in CPP_TOKENS.finditer(source, opening):
        if match.group() == "{":
            depth += 1
        elif match.group() == "}":
            depth -= 1
            if depth == 0:
                return source[start:match.end()]
    raise RuntimeError(f"Unclosed source block: {signature}")


def generate(build):
    frame_source = "src/IboView/IvEditFramesForm.cpp"
    (build / "frame_functions.inc").write_text("\n\n".join(
        source_block(frame_source, signature)
        for signature in ("static void InvertOrder(", "static void MoveSelectedUp(")
    ))
    blocks = [
        source_block("src/IboView/IvEditVolumeSurface.h", "class FIsoSliceDecl {") + ";",
        source_block("src/IboView/IvEditVolumeSurface.cpp", "FIsoSliceDecl FIsoSliceDecl::fromString("),
        source_block("src/IboView/IvMain.cpp", "static std::string ScriptStringLiteral("),
        source_block("src/IboView/IvScript.cpp", "static FVec3d FromVariant("),
        "class FScriptGlobals {\npublic:\nQJSEngine *m_pEngine;\n" +
        source_block("src/IboView/IvScript.cpp", "Q_INVOKABLE QJSValue freeline_impl(") + "\n};",
        source_block("src/IboView/IvDocument.cpp", "QString RemoveExt("),
        source_block("src/IboView/IvDocument.cpp", "QString ReplaceExt("),
        source_block("src/IboView/IvMain.cpp", "QString FMainWindow::MakeStateScript("),
        source_block("src/IboView/IvMain.cpp", "void FMainWindow::WriteStateScript("),
    ]
    (build / "qt_functions.inc").write_text("\n\n".join(blocks))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-qt", action="store_true", help="Fail if the Qt tests cannot run")
    parser.add_argument("--qmake", help="Path to a Qt 6 qmake executable")
    parser.add_argument("--no-sanitizers", action="store_true")
    args = parser.parse_args()
    compiler = shlex.split(os.environ.get("CXX", "")) or [shutil.which("clang++") or shutil.which("c++")]
    if not compiler[0]:
        parser.error("A C++ compiler is required")

    with tempfile.TemporaryDirectory(prefix="iboview-native-tests-") as directory:
        build = Path(directory)
        generate(build)
        executable = build / "frame_regressions"
        flags = ["-std=c++20", "-g", "-O1", "-UNDEBUG"]
        if not args.no_sanitizers:
            flags += ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
        subprocess.run(compiler + flags + ["-I", str(build), str(ROOT / "tests/native_frame_regressions.cpp"),
                       "-o", str(executable)], check=True)
        subprocess.run([str(executable)], check=True)

        qmake = args.qmake or shutil.which("qmake6") or shutil.which("qmake")
        if not qmake:
            print("SKIP: Qt parser, JavaScript, and atomic-save regressions (Qt 6 qmake unavailable)", flush=True)
            return 1 if args.require_qt else 0
        version = subprocess.check_output([qmake, "-query", "QT_VERSION"], text=True).strip()
        if not version.startswith("6."):
            parser.error(f"Qt 6 is required; {qmake} reports {version}")
        shutil.copy(ROOT / "tests/native_qt_regressions.cpp", build)
        (build / "regressions.pro").write_text(
            "QT += core gui widgets qml\nCONFIG += console c++20\nCONFIG -= app_bundle\n"
            "TARGET = qt_regressions\nSOURCES += native_qt_regressions.cpp\n"
            "QMAKE_CXXFLAGS += -UNDEBUG\n"
            f'INCLUDEPATH += "{ROOT / "src/Common"}"\n'
            f'INCLUDEPATH += "{ROOT / "src/MicroScf"}"\n'
            f'SOURCES += "{ROOT / "src/MicroScf/format.cpp"}"\n'
        )
        subprocess.run([qmake, "regressions.pro"], cwd=build, check=True)
        subprocess.run(["make", "-j2"], cwd=build, check=True)
        subprocess.run([str(build / "qt_regressions")], cwd=build, check=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
