// ── shared constants ──────────────────────────────────────────────────────────
export const SECTIONS = ["Home", "Chapters", "Characters", "Outline", "Relationships", "Notes", "Search", "Trash"];
export const STATUS_CYCLE = [undefined, "Draft", "Revising", "Final"];
export const STATUS_COLOR = { Draft: "#888", Revising: "#f59e0b", Final: "#22c55e" };
export const ACT_CYCLE = ["", "Act I", "Act II", "Act III"];
export const TRASH_RETENTION_DAYS = 30;

export const CHARACTER_TRAITS = [
  "Brave", "Cowardly", "Honest", "Deceptive", "Kind", "Cruel",
  "Intelligent", "Naive", "Ambitious", "Lazy", "Loyal", "Treacherous",
  "Compassionate", "Selfish", "Humorous", "Serious", "Impulsive",
  "Calculated", "Charismatic", "Introverted", "Optimistic", "Pessimistic",
  "Stubborn", "Adaptable", "Creative", "Logical", "Empathetic", "Cold",
  "Generous", "Greedy", "Reckless", "Cautious", "Mysterious",
  "Open-minded", "Arrogant", "Humble",
];

// ── styles ─────────────────────────────────────────────────────────────────────
export const styles = {
  root: { display: "flex", height: "100vh", background: "var(--c-111)", fontFamily: "'Fredoka', sans-serif", color: "var(--c-c9b99a)", overflow: "hidden" },
  sidebar: { width: 200, background: "var(--c-0d0d0d)", borderRight: "3px solid var(--c-2a2a2a)", display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0 },
  brand: { fontFamily: "'Bangers', cursive", fontSize: 34, letterSpacing: "0.08em", color: "var(--c-ff1d8e)", padding: "0 20px 20px", borderBottom: "3px dashed var(--c-3a0a2e)", marginBottom: 18, textAlign: "center", textShadow: "3px 3px 0 var(--c-3a0a2e)" },
  navBtn: { background: "none", border: "none", textAlign: "left", padding: "12px 20px", cursor: "pointer", fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", fontFamily: "'Fredoka', sans-serif", transition: "color 0.2s, transform 0.15s" },
  navActive: { color: "var(--c-ff1d8e)", borderLeft: "4px solid var(--c-ff1d8e)", background: "var(--c-280820)" },
  list: { width: 230, background: "var(--c-141414)", borderRight: "3px solid var(--c-1e1e1e)", display: "flex", flexDirection: "column", flexShrink: 0 },
  listHeader: { padding: "20px 16px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px dashed var(--c-2a2a2a)" },
  listTitle: { fontFamily: "'Bangers', cursive", fontSize: 24, letterSpacing: "0.05em", color: "var(--c-7dd3fc)", textShadow: "2px 2px 0 var(--c-0a203a)" },
  plusBtn: { background: "var(--c-ff1d8e)", border: "2px solid var(--c-3a0a2e)", color: "var(--c-0d0d0d)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 20, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "2px 2px 0 var(--c-3a0a2e)", transition: "transform 0.1s" },
  listItem: { display: "flex", alignItems: "center", padding: "14px 16px", cursor: "pointer", borderBottom: "2px solid var(--c-1a1a1a)", transition: "background 0.15s, transform 0.1s" },
  listItemActive: { background: "var(--c-0d1028)", borderLeft: "4px solid var(--c-ff1d8e)" },
  detailPanel: { flex: 1, overflowY: "auto", padding: "32px 40px" },
  detail: { maxWidth: 660 },
  detailTitle: { fontFamily: "'Bangers', cursive", fontSize: 30, letterSpacing: "0.03em", color: "var(--c-ff1d8e)", marginBottom: 10, textShadow: "3px 3px 0 var(--c-3a0a2e)" },
  detailSub: { fontSize: 13, color: "#888", marginBottom: 20, letterSpacing: "0.05em" },
  detailBody: { fontSize: 15, color: "var(--c-c9b99a)", lineHeight: 1.7, marginBottom: 28, minHeight: 60, fontWeight: 400 },
  relCard: { background: "var(--c-0a1428)", border: "2px solid var(--c-1a2840)", borderRadius: 12, padding: "14px 16px", marginBottom: 14, boxShadow: "3px 3px 0 var(--c-0d0d0d)" },
  empty: { color: "#555", fontStyle: "italic", fontSize: 15, marginTop: 48, fontWeight: 500 },
  deleteBtn: { background: "var(--c-1a0a2e)", border: "2px solid var(--c-ff1d8e)", color: "var(--c-ff1d8e)", padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, letterSpacing: "0.05em", marginTop: 16, boxShadow: "3px 3px 0 var(--c-3a0a2e)", fontFamily: "'Fredoka', sans-serif" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modalBox: { background: "var(--c-161616)", border: "3px solid var(--c-3a0a2e)", borderRadius: 16, padding: 28, width: 460, maxWidth: "90vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "6px 6px 0 var(--c-shadowpink)" },
  formLabel: { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 6 },
  formInput: { width: "100%", background: "var(--c-0d0d0d)", border: "2px solid #333", borderRadius: 8, padding: "10px 12px", color: "var(--c-7dd3fc)", fontSize: 15, fontFamily: "'Fredoka', sans-serif", fontWeight: 500, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", background: "var(--c-0d0d0d)", border: "2px solid #333", borderRadius: 8, padding: "10px 12px", color: "var(--c-7dd3fc)", fontSize: 15, fontFamily: "'Fredoka', sans-serif", fontWeight: 500, outline: "none", boxSizing: "border-box" },
  addBtn: { background: "var(--c-ff1d8e)", border: "2px solid var(--c-3a0a2e)", color: "var(--c-0d0d0d)", padding: "10px 22px", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 700, letterSpacing: "0.05em", fontFamily: "'Fredoka', sans-serif", boxShadow: "3px 3px 0 var(--c-3a0a2e)" },
  pdfBtn: { background: "var(--c-0a203a)", border: "2px solid var(--c-7dd3fc)", color: "var(--c-7dd3fc)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", fontFamily: "'Fredoka', sans-serif", boxShadow: "2px 2px 0 var(--c-0a1428)", marginTop: 16 },
};
