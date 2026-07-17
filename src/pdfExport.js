import { jsPDF } from "jspdf";

// ── screenplay PDF export ──────────────────────────────────────────────────────
const SP = { PAGE_W: 612, PAGE_H: 792, MX: 108, MY: 72, MR: 72, MB: 72, LINE_H: 14.4, CHAR_X: 266, DIALOG_X: 180, DIALOG_W: 252, PAREN_X: 216 };

// Letter-format Courier doc with a numbered-page helper, shared by both
// screenplay exports.
function makeScreenplayDoc() {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFont("Courier", "normal");
  doc.setFontSize(12);
  const { MY, LINE_H, PAGE_W, MR } = SP;
  let pageNum = 1;
  function addPage() {
    doc.addPage(); pageNum++;
    doc.setFont("Courier", "normal"); doc.setFontSize(12);
    doc.text(`${pageNum}.`, PAGE_W - MR, MY - LINE_H);
    return MY;
  }
  return { doc, addPage };
}

function _drawScreenplay(doc, content, initY, addPageFn) {
  const { MX, LINE_H, CHAR_X, DIALOG_X, DIALOG_W, PAREN_X, PAGE_W, PAGE_H, MR, MB } = SP;
  const CW = PAGE_W - MX - MR;
  let y = initY;

  function ensureRoom(n) {
    if (y + n * LINE_H > PAGE_H - MB) y = addPageFn();
  }

  function writeWrapped(text, x, maxW) {
    for (const line of doc.splitTextToSize(text, maxW)) {
      if (y + LINE_H > PAGE_H - MB) y = addPageFn();
      doc.text(line, x, y);
      y += LINE_H;
    }
  }

  const rawLines = (content || "").split("\n");
  let prevBlank = true;
  let state = "action";

  for (const raw of rawLines) {
    const t = raw.trim();
    if (!t) { y += LINE_H; prevBlank = true; state = "action"; continue; }

    const allCaps = t === t.toUpperCase() && /[A-Z]/.test(t);
    const isScene = /^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/i.test(t);
    const isTransition = /^(FADE (IN|OUT)|CUT TO|SMASH CUT|DISSOLVE TO|MATCH CUT)\b/i.test(t);
    const isParen = t.startsWith("(") && t.endsWith(")");
    const isChar = allCaps && !isScene && !isTransition && t.length <= 40 && prevBlank;

    if (isScene) {
      if (!prevBlank) y += LINE_H;
      writeWrapped(t.toUpperCase(), MX, CW);
    } else if (isTransition) {
      ensureRoom(1);
      doc.text(t.toUpperCase(), PAGE_W - MR, y, { align: "right" });
      y += LINE_H * 2;
      state = "action";
    } else if (isChar) {
      ensureRoom(3);
      y += LINE_H;
      doc.text(t, CHAR_X, y);
      y += LINE_H;
      state = "dialogue";
    } else if (isParen && state === "dialogue") {
      ensureRoom(1);
      doc.text(t, PAREN_X, y);
      y += LINE_H;
    } else if (state === "dialogue") {
      writeWrapped(t, DIALOG_X, DIALOG_W);
    } else {
      writeWrapped(t, MX, CW);
      state = "action";
    }
    prevBlank = false;
  }
}

export function exportChapterAsPDF(chapter) {
  const { doc, addPage } = makeScreenplayDoc();
  const { MX, MY, LINE_H } = SP;
  let y = MY;
  doc.text((chapter.title || "UNTITLED").toUpperCase(), MX, y);
  y += LINE_H * 2;
  _drawScreenplay(doc, chapter.content, y, addPage);
  doc.save(`${(chapter.title || "chapter").replace(/[^a-zA-Z0-9\s-]/g, "")}.pdf`);
}

export function exportAllChaptersAsPDF(storyTitle, chapters) {
  const { doc, addPage } = makeScreenplayDoc();
  const { MX, LINE_H, PAGE_W, PAGE_H } = SP;

  // Title page
  doc.text((storyTitle || "UNTITLED").toUpperCase(), PAGE_W / 2, PAGE_H / 2 - LINE_H, { align: "center" });
  doc.setFontSize(11);
  doc.text("Written with Qwosid", PAGE_W / 2, PAGE_H / 2 + LINE_H, { align: "center" });
  doc.setFontSize(12);

  for (const ch of chapters) {
    let y = addPage();
    doc.text((ch.title || "UNTITLED CHAPTER").toUpperCase(), MX, y);
    y += LINE_H * 2;
    _drawScreenplay(doc, ch.content, y, addPage);
  }

  doc.save(`${(storyTitle || "screenplay").replace(/[^a-zA-Z0-9\s-]/g, "")}.pdf`);
}

export function exportStoryAsPDF(story) {
  const doc  = new jsPDF({ unit: "mm", format: "a4" });
  const PW   = doc.internal.pageSize.getWidth();
  const PH   = doc.internal.pageSize.getHeight();
  const ML = 20, MR = 20, MT = 22, MB = 18;
  const CW   = PW - ML - MR;
  let y = MT;

  const stripLinks = t => (t || "").replace(/\[\[([^|]+)\|[^\]]+\]\]/g, "$1");

  function newPage() { doc.addPage(); y = MT; }

  function need(h) { if (y + h > PH - MB) newPage(); }

  function setStyle(size, style = "normal", r = 201, g = 185, b = 154) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(r, g, b);
  }

  function txt(raw, size = 11, style = "normal", color = [201, 185, 154]) {
    if (!raw?.trim()) return;
    setStyle(size, style, ...color);
    const lines = doc.splitTextToSize(stripLinks(raw), CW);
    for (const line of lines) {
      need(size * 0.45 + 1);
      doc.text(line, ML, y);
      y += size * 0.45;
    }
    y += 2;
  }

  function label(lbl) {
    need(7);
    setStyle(8, "bold", 120, 100, 80);
    doc.text(lbl.toUpperCase(), ML, y);
    y += 5;
  }

  function itemTitle(t, size = 15) {
    need(size * 0.5 + 6);
    setStyle(size, "bold", 255, 29, 142);
    doc.text(t || "Untitled", ML, y);
    y += size * 0.5 + 4;
  }

  function divider() {
    need(6);
    doc.setDrawColor(60, 20, 60);
    doc.setLineWidth(0.3);
    doc.line(ML, y, ML + CW, y);
    y += 5;
  }

  function sectionPage(title) {
    newPage();
    doc.setFillColor(20, 6, 40);
    doc.rect(0, 0, PW, PH, "F");
    setStyle(36, "bold", 255, 29, 142);
    doc.text(title.toUpperCase(), PW / 2, PH / 2 - 6, { align: "center" });
    setStyle(11, "normal", 100, 90, 80);
    doc.text(story.title || "Story", PW / 2, PH / 2 + 10, { align: "center" });
    newPage();
  }

  // ── Cover ──────────────────────────────────────────────────────────────────
  doc.setFillColor(13, 13, 13);
  doc.rect(0, 0, PW, PH, "F");
  setStyle(42, "bold", 255, 29, 142);
  const titleLines = doc.splitTextToSize(story.title || "Untitled", CW - 10);
  doc.text(titleLines, PW / 2, PH / 2 - titleLines.length * 10, { align: "center" });
  setStyle(10, "normal", 100, 90, 80);
  doc.text("Exported from Qwosid", PW / 2, PH - 20, { align: "center" });

  const charMap = Object.fromEntries((story.characters || []).map(c => [c.id, c]));

  // ── Home / Story Notes ──────────────────────────────────────────────────────
  if (story.homeContent?.trim()) {
    sectionPage("Story Notes");
    txt(story.homeContent);
  }

  // ── Chapters ────────────────────────────────────────────────────────────────
  if (story.chapters?.length) {
    sectionPage("Chapters");
    story.chapters.forEach((ch, i) => {
      need(24);
      itemTitle(`${i + 1}. ${ch.title || "Untitled"}`);
      const wc = ch.content?.trim() ? ch.content.trim().split(/\s+/).length : 0;
      const meta = [ch.act, ch.status, `${wc} words`].filter(Boolean).join("  ·  ");
      if (meta) { setStyle(9, "italic", 120, 120, 120); doc.text(meta, ML, y); y += 6; }
      txt(ch.content);
      divider();
    });
  }

  // ── Characters ─────────────────────────────────────────────────────────────
  if (story.characters?.length) {
    sectionPage("Characters");
    story.characters.forEach(c => {
      need(20);
      itemTitle(c.name || "Unnamed");
      if (c.role)   { label("Role");       txt(c.role, 11); }
      if (c.bio)    { label("Bio");        txt(c.bio,  11); }
      const app = [
        c.ethnicity  && `Ethnicity: ${c.ethnicity}`,
        c.skinColor  && `Skin: ${c.skinColor}`,
        c.eyeColor   && `Eyes: ${c.eyeColor}`,
        c.hairColor  && `Hair: ${c.hairColor}`,
        c.hairstyles?.length && `Hairstyles: ${c.hairstyles.join(", ")}`,
      ].filter(Boolean);
      if (app.length) { label("Appearance"); txt(app.join("  ·  "), 10, "italic"); }
      if (c.traits?.length) { label("Traits"); txt(c.traits.join("  ·  "), 10); }
      divider();
    });
  }

  // ── Outline ─────────────────────────────────────────────────────────────────
  if (story.outlines?.length) {
    sectionPage("Outline");
    story.outlines.forEach(group => {
      need(14);
      itemTitle(group.title || "Untitled", 13);
      (group.subnotes || []).forEach(sn => {
        need(10);
        setStyle(10, "bold", 125, 211, 252);
        doc.text(`• ${sn.title || ""}`, ML + 3, y); y += 5;
        if (sn.content) txt(sn.content, 10);
      });
      y += 3;
    });
  }

  // ── Relationships ───────────────────────────────────────────────────────────
  if (story.relationships?.length) {
    sectionPage("Relationships");
    story.relationships.forEach(r => {
      need(16);
      const members = (r.members && r.members.length ? r.members : [r.charA, r.charB].filter(Boolean));
      const names = members.map(id => charMap[id]?.name || "?").join("  ↔  ");
      itemTitle(names || "Relationship", 13);
      if (r.description) txt(r.description, 11);
      divider();
    });
  }

  // ── Notes ───────────────────────────────────────────────────────────────────
  if (story.notes?.length) {
    sectionPage("Notes");
    story.notes.forEach(group => {
      need(14);
      itemTitle(group.title || "Untitled", 13);
      (group.subnotes || []).forEach(sn => {
        need(10);
        setStyle(10, "bold", 125, 211, 252);
        doc.text(`• ${sn.title || ""}`, ML + 3, y); y += 5;
        if (sn.content) txt(sn.content, 10);
      });
      y += 3;
    });
  }

  // ── Page footers ────────────────────────────────────────────────────────────
  const total = doc.internal.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    setStyle(7, "normal", 80, 70, 60);
    doc.text(story.title || "Story", ML, PH - 8);
    doc.text(`${p - 1}`, PW - MR, PH - 8, { align: "right" });
  }

  doc.save(`${(story.title || "story").replace(/[^a-zA-Z0-9 -]/g, "").trim()}.pdf`);
}
