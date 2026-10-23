# Native regression checks

Run `python3 tests/run_native_regressions.py` from the repository root. The runner
copies the current production function bodies into temporary translation units;
the tests do not maintain a second implementation of the algorithms.

Frame movement runs under AddressSanitizer and UndefinedBehaviorSanitizer, with
assertions enabled. It covers top/bottom boundaries, a single frame, all selected
frames, valid moves into index zero, and separated selection blocks.

When Qt 6 is available, the runner also builds and executes checks using the real
Qt parser, QJSEngine, and QSaveFile. They cover optional parse-status arguments,
invalid iso declarations, single/multiple-file state-script round trips,
two/three-argument FreeLine calls, atomic replacement, and failed saves without
success messages. Small application-boundary substitutes supply document/view
state and capture line properties and notifications; these checks do not exercise
the full UI or OpenGL renderer.

Use `--require-qt` in a Qt-enabled build environment to fail rather than skip the
Qt checks. `--qmake /path/to/qmake6` selects an SDK not on PATH. A C++20 compiler,
Qt Core/Gui/Widgets/Qml development libraries, and `make` are required for the
complete suite. `--no-sanitizers` is available for compilers without sanitizer
support. Build products are created in a temporary directory and removed on exit.
