# macOS desktop launcher

The launcher opens the local IboView web preview in your default browser. It
reuses an existing IboView server at `http://127.0.0.1:5173`, or starts one in
the background when needed. No Terminal window needs to stay open.

From the repository root, with Python 3 and Node.js 20.19+ or 22.12+ installed:

```sh
npm --prefix webapp ci
npm --prefix webapp run build
python3 webapp/scripts/macos-launcher/install.py
```

Double-click `IboView.app` on your Desktop. The installer uses IboView's original
orbital icon and discovers your Node executable; it does not install login items.
It refuses to overwrite an existing file or app. To choose another destination:

```sh
python3 webapp/scripts/macos-launcher/install.py --output "$HOME/Applications/IboView.app"
```

The destination's parent folder must already exist. The generated app depends on
this checkout, its `node_modules`, its `dist` build, and the discovered Node path.
Keep those in place; recreate the launcher if you move the project or Node.
Run `npm --prefix webapp run build` after source changes to update the preview.

The server listens only on `127.0.0.1`. Closing the browser leaves it available
for the next launch; it does not start automatically after a reboot. Startup
errors appear in a dialog, and server output is saved in
`~/Library/Logs/IboView/server.log`. An occupied port belonging to another app
produces an error without stopping that app.
