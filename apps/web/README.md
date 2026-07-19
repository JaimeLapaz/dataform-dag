# @dataform-dag/web

Browser host for the dataform-dag viewer. Renders the shared `@dataform-dag/ui` canvas as a plain web
page; the graph is parsed **in the browser** from a local folder via the File System Access API — no
server, no upload, no `dataform compile`.

Backing the `HostBridge` contract:

- **graph** — the picked directory is walked for `.sqlx` (preferring `definitions/`), each file
  parsed with the core regex parser, and the graph built in-page.
- **openFile / liveWatch / focusOnActive** — all off. A page can't open an editor, watch the disk, or
  track an active editor, so the UI hides "Go to file" and shows its manual Refresh button (which
  re-reads the same picked folder).

## Run it

```bash
# from the workspace root
npm install && npm run build:core
npm run dev -w @dataform-dag/web
```

Open the printed URL in a Chromium-based browser (Chrome/Edge — Firefox/Safari lack the File System
Access API), click **Open Dataform project…**, and pick a Dataform repo root (e.g. `airfare-drift`).

`npm run build -w @dataform-dag/web` produces a static bundle in `dist/` (elkjs stays a lazy chunk —
no webview CSP here, unlike the extension host).
