import { Component } from "react";

// Top-level crash screen: data lives in the disk file / localStorage, so a
// render crash never loses work — this screen says so and offers an export.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Qwosid crashed:", error, info);
  }

  exportData = async () => {
    try {
      let json = null;
      if (window.electronAPI?.loadData) {
        const res = await window.electronAPI.loadData();
        if (res?.ok && res.data) json = res.data;
      }
      if (!json) {
        const stories = localStorage.getItem("qwosid_stories");
        if (stories) json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), stories: JSON.parse(stories) }, null, 2);
      }
      if (!json) { alert("No saved data found to export."); return; }
      if (window.electronAPI?.saveBackup) {
        const res = await window.electronAPI.saveBackup(json);
        alert(res?.ok ? "Backup saved to:\n" + res.path : "Backup failed: " + (res?.error || "unknown error"));
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        a.download = "qwosid-backup.json";
        a.click();
      }
    } catch (err) {
      alert("Export failed: " + err.message);
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const btn = { padding: "10px 22px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" };
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--c-111)", color: "var(--c-c9b99a)", fontFamily: "'Fredoka', sans-serif", padding: 24, textAlign: "center" }}>
        <div style={{ fontFamily: "'Bangers', cursive", fontSize: 48, color: "var(--c-ff1d8e)", textShadow: "3px 3px 0 var(--c-3a0a2e)", marginBottom: 12 }}>Oops!</div>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Qwosid hit an unexpected error.</div>
        <div style={{ fontSize: 14, color: "#888", marginBottom: 24, maxWidth: 520 }}>
          Your stories are safe — they're saved on disk, not in this window.
          You can save an extra backup now, then reload.
        </div>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 24, maxWidth: 560, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {String(this.state.error?.message || this.state.error)}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button style={{ ...btn, background: "none", border: "2px solid var(--c-7dd3fc)", color: "var(--c-7dd3fc)" }} onClick={this.exportData}>Save Backup</button>
          <button style={{ ...btn, background: "var(--c-ff1d8e)", border: "2px solid var(--c-3a0a2e)", color: "var(--c-0d0d0d)" }} onClick={() => window.location.reload()}>Reload App</button>
        </div>
      </div>
    );
  }
}
