import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@dataform-dag/ui";
import { BrowserBridge } from "./BrowserBridge.js";
import { FileSystemAccessSource, isFsAccessSupported } from "./fileSystemAccessSource.js";
import "./web.css";

/**
 * Browser host root. A page has no preselected project, so it gates on a directory pick: once the
 * user chooses a Dataform folder, we build a {@link FileSource} over it and hand the shared UI a
 * {@link BrowserBridge}. The App drives everything from there via the same HostBridge contract.
 */
function Web(): JSX.Element {
  const [bridge, setBridge] = useState<BrowserBridge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = isFsAccessSupported();

  async function pick(): Promise<void> {
    setError(null);
    try {
      const source = await FileSystemAccessSource.pick();
      setBridge(new BrowserBridge(source));
    } catch (err) {
      // The user cancelling the picker is not an error.
      if ((err as DOMException | undefined)?.name !== "AbortError") setError(String(err));
    }
  }

  if (bridge) return <App bridge={bridge} />;

  return (
    <div className="web-landing">
      <div className="web-landing__card">
        <h1 className="web-landing__title">dataform-dag</h1>
        <p className="web-landing__lede">
          Open a Dataform project to view its <code>.sqlx</code> dependency graph. Parsing runs
          entirely in your browser — nothing leaves your machine.
        </p>
        <button
          type="button"
          className="web-landing__btn"
          onClick={() => void pick()}
          disabled={!supported}
        >
          Open Dataform project…
        </button>
        {!supported && (
          <p className="web-landing__note">
            This browser doesn&rsquo;t support the File System Access API. Use a Chromium-based
            browser (Chrome, Edge) to open a local folder.
          </p>
        )}
        {error && <p className="web-landing__error">{error}</p>}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Web />
  </StrictMode>,
);
