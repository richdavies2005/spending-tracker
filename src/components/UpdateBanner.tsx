import { useEffect, useState } from "react";
import { api, IS_TAURI } from "../lib/api";
import type { UpdateInfo } from "../lib/types";

/// Checks GitHub for a newer release on launch and, if one exists, shows a
/// dismissible banner linking to the download. Silent on any failure.
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api
      .checkForUpdate()
      .then((i) => setInfo(i))
      .catch(() => {}); // never bother the user if the check fails
  }, []);

  if (dismissed || !info?.available) return null;

  async function download() {
    if (!info) return;
    if (IS_TAURI) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(info.url);
    } else {
      window.open(info.url, "_blank");
    }
  }

  return (
    <div className="inbox-callout" style={{ marginBottom: 16 }}>
      <span>
        Version {info.latest} is available — you're on {info.current}.
      </span>
      <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn" onClick={download} style={{ padding: "4px 12px" }}>
          Download
        </button>
        <button
          onClick={() => setDismissed(true)}
          title="Dismiss until next launch"
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            opacity: 0.8,
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          ✕
        </button>
      </span>
    </div>
  );
}
