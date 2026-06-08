import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { jsPDF } from "jspdf";
import { parsePDFFile } from "./parsePDF.js";

// ── tiny uid ──────────────────────────────────────────────────────────────────
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ── local storage operations ──────────────────────────────────────────────────
const localDB = {
  async save(stories, currentStoryId, folders) {
    try {
      localStorage.setItem('qwosid_stories', JSON.stringify(stories));
      localStorage.setItem('qwosid_folders', JSON.stringify(folders || []));
      if (currentStoryId) {
        localStorage.setItem('qwosid_currentStoryId', currentStoryId);
      } else {
        localStorage.removeItem('qwosid_currentStoryId');
      }
      return true;
    } catch (error) {
      console.error("Error saving:", error);
      return false;
    }
  },

  async load() {
    try {
      let storiesData = localStorage.getItem('qwosid_stories');
      if (!storiesData) {
        const legacy = localStorage.getItem('storyOrganizerData');
        if (legacy) {
          storiesData = legacy;
          localStorage.setItem('qwosid_stories', legacy);
          localStorage.removeItem('storyOrganizerData');
        }
      }
      const currentStoryId = localStorage.getItem('qwosid_currentStoryId');
      const foldersData    = localStorage.getItem('qwosid_folders');
      return {
        stories:       storiesData  ? JSON.parse(storiesData)  : null,
        currentStoryId: currentStoryId || null,
        folders:       foldersData  ? JSON.parse(foldersData)  : [],
      };
    } catch (error) {
      console.error("Error loading:", error);
      return { stories: null, currentStoryId: null, folders: [] };
    }
  },
};


// ── helpers ───────────────────────────────────────────────────────────────────
const SECTIONS = ["Home", "Chapters", "Characters", "Outline", "Relationships", "Notes", "Search"];
const STATUS_CYCLE = [undefined, "Draft", "Revising", "Final"];
const STATUS_COLOR = { Draft: "#888", Revising: "#f59e0b", Final: "#22c55e" };


const CHARACTER_TRAITS = [
  "Brave", "Cowardly", "Honest", "Deceptive", "Kind", "Cruel",
  "Intelligent", "Naive", "Ambitious", "Lazy", "Loyal", "Treacherous",
  "Compassionate", "Selfish", "Humorous", "Serious", "Impulsive",
  "Calculated", "Charismatic", "Introverted", "Optimistic", "Pessimistic",
  "Stubborn", "Adaptable", "Creative", "Logical", "Empathetic", "Cold",
  "Generous", "Greedy", "Reckless", "Cautious", "Mysterious",
  "Open-minded", "Arrogant", "Humble",
];

// ── screenplay PDF export ──────────────────────────────────────────────────────
const SP = { PAGE_W: 612, PAGE_H: 792, MX: 108, MY: 72, MR: 72, MB: 72, LINE_H: 14.4, CHAR_X: 266, DIALOG_X: 180, DIALOG_W: 252, PAREN_X: 216 };

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

function exportChapterAsPDF(chapter) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFont("Courier", "normal");
  doc.setFontSize(12);
  const { MX, MY, LINE_H, PAGE_W, MR } = SP;
  let pageNum = 1;

  function addPage() {
    doc.addPage(); pageNum++;
    doc.setFont("Courier", "normal"); doc.setFontSize(12);
    doc.text(`${pageNum}.`, PAGE_W - MR, MY - LINE_H);
    return MY;
  }

  let y = MY;
  doc.text((chapter.title || "UNTITLED").toUpperCase(), MX, y);
  y += LINE_H * 2;
  _drawScreenplay(doc, chapter.content, y, addPage);
  doc.save(`${(chapter.title || "chapter").replace(/[^a-zA-Z0-9\s-]/g, "")}.pdf`);
}

function exportAllChaptersAsPDF(storyTitle, chapters) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFont("Courier", "normal");
  doc.setFontSize(12);
  const { MX, MY, LINE_H, PAGE_W, PAGE_H, MR } = SP;
  let pageNum = 1;

  function addPage() {
    doc.addPage(); pageNum++;
    doc.setFont("Courier", "normal"); doc.setFontSize(12);
    doc.text(`${pageNum}.`, PAGE_W - MR, MY - LINE_H);
    return MY;
  }

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

function exportStoryAsPDF(story) {
  const doc  = new jsPDF({ unit: "mm", format: "a4" });
  const PW   = doc.internal.pageSize.getWidth();
  const PH   = doc.internal.pageSize.getHeight();
  const ML = 20, MR = 20, MT = 22, MB = 18;
  const CW   = PW - ML - MR;
  let y = MT;

  const stripLinks = t => (t || "").replace(/\[\[([^\|]+)\|[^\]]+\]\]/g, "$1");

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
      const meta = [ch.status, `${wc} words`].filter(Boolean).join("  ·  ");
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
      const cA = charMap[r.charA]?.name || "?";
      const cB = charMap[r.charB]?.name || "?";
      itemTitle(`${cA}  ↔  ${cB}`, 13);
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

  doc.save(`${(story.title || "story").replace(/[^a-zA-Z0-9 \-]/g, "").trim()}.pdf`);
}

export default function StoryOrganizer() {
  const [stories, setStories] = useState([]);
  const [currentStoryId, setCurrentStoryId] = useState(null);
  const [section, setSection] = useState("Home");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null); // { type, id, field, value }
  const [modal, setModal] = useState(null); // { type: 'addChar'|'addRel'|'addChap'|'addNote' }
  const [newForm, setNewForm] = useState({});
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [isEditingStories, setIsEditingStories] = useState(false);
  const [selectedStories, setSelectedStories] = useState(new Set());
  const [renamingStoryId, setRenamingStoryId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  // ── tabs ──
  const [tabs, setTabs] = useState(() => [{ id: 'tab-home', section: 'Home', itemId: null, label: 'Home' }]);
  const [activeTabId, setActiveTabId] = useState('tab-home');
  const skipTabSync = useRef(false);
  // ── panes ──
  const [paneLayout, setPaneLayout] = useState('single'); // 'single'|'h2'|'v2'|'quad'
  const [paneContents, setPaneContents] = useState({ tl: { section:'Home', itemId:null }, tr: { section:'Home', itemId:null }, bl: { section:'Home', itemId:null }, br: { section:'Home', itemId:null } });
  const [activePanePos, setActivePanePos] = useState('tl');
  const [draggingPane, setDraggingPane] = useState(null);
  // ── sidebar ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const lastSidebarWidth = useRef(200);
  // ── undo/redo ──
  const storyHistory = useRef([]);
  const historyIndex = useRef(-1);
  const skipHistory = useRef(false);
  const [linkPicker, setLinkPicker] = useState(null); // { onInsert: fn }
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [linkPickerSection, setLinkPickerSection] = useState("Characters");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null); // { type, id, name }
  const [showTraitsModal, setShowTraitsModal] = useState(false);
  const [charTab, setCharTab] = useState("detail");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [storySearchQuery, setStorySearchQuery] = useState("");
  const [selectedSubNoteId, setSelectedSubNoteId] = useState(null);
  const [importData, setImportData] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const importInputRef = useRef(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const sidebarDragging = useRef(false);
  const [listWidth, setListWidth] = useState(230);
  const listDragging = useRef(false);
  const [listSearchQuery, setListSearchQuery] = useState("");
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null); // { format, fileName, items[] }
  const [pdfTab, setPdfTab] = useState("all");
  const [selectedPdfItems, setSelectedPdfItems] = useState(new Set());
  const pdfImportRef = useRef(null);

  // Load from localStorage on mount
  useEffect(() => {
    localDB.load().then(({ stories: saved, currentStoryId: savedId, folders: savedFolders }) => {
      if (saved && saved.length > 0) {
        setStories(saved);
        if (savedId && saved.find(s => s.id === savedId)) {
          setCurrentStoryId(savedId);
        }
      }
      if (savedFolders && savedFolders.length > 0) setFolders(savedFolders);
    });
  }, []);

  // Reset sub-note selection when the selected note group changes
  useEffect(() => { setSelectedSubNoteId(null); }, [selected]);
  // Reset list search when switching sections
  useEffect(() => { setListSearchQuery(""); }, [section]);

  // Undo/redo history — push snapshot after each stories change
  const historyInitialized = useRef(false);
  useEffect(() => {
    if (!historyInitialized.current) { historyInitialized.current = true; return; }
    if (skipHistory.current) { skipHistory.current = false; return; }
    const snap = JSON.stringify(stories);
    const sliced = storyHistory.current.slice(0, historyIndex.current + 1);
    sliced.push(snap);
    if (sliced.length > 60) sliced.shift();
    storyHistory.current = sliced;
    historyIndex.current = sliced.length - 1;
  }, [stories]);

  // Keyboard: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
  useEffect(() => {
    const handler = e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Sync active tab + active pane content when section/selected change
  useEffect(() => {
    if (skipTabSync.current) { skipTabSync.current = false; return; }
    const label = getTabLabel(section, selected);
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, section, itemId: selected, label } : t));
    setPaneContents(prev => ({ ...prev, [activePanePos]: { section, itemId: selected } }));
  }, [section, selected]);

  // Show backup modal when Electron sends before-close; silent auto-backup every 30 min
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onBeforeClose(() => flushSync(() => setShowCloseModal(true)));
    window.electronAPI.onAutoBackup?.(() => exportBackup());
  }, []);

  // Auto-save to localStorage 1s after any change
  useEffect(() => {
    const id = setTimeout(async () => {
      setIsSaving(true);
      const ok = await localDB.save(stories, currentStoryId, folders);
      setSaveStatus(ok ? "Saved" : "Save failed");
      setIsSaving(false);
      setTimeout(() => setSaveStatus(""), 2000);
    }, 1000);
    return () => clearTimeout(id);
  }, [stories, currentStoryId, folders]);

  function startListResize(e) {
    e.preventDefault();
    listDragging.current = true;
    const onMove = (ev) => {
      if (!listDragging.current) return;
      setListWidth(w => Math.max(160, Math.min(480, ev.clientX - sidebarWidth)));
    };
    const onUp = () => {
      listDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startSidebarResize(e) {
    e.preventDefault();
    sidebarDragging.current = true;
    const onMove = (ev) => {
      if (!sidebarDragging.current) return;
      const w = Math.max(40, Math.min(480, ev.clientX));
      setSidebarWidth(w);
      if (w > 60) { lastSidebarWidth.current = w; setSidebarCollapsed(false); }
      else setSidebarCollapsed(true);
    };
    const onUp = () => {
      sidebarDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const currentStory = currentStoryId ? stories.find(s => s.id === currentStoryId) : null;
  
  // Ensure we have a valid currentStory before accessing its properties
  const items = currentStory ? ({
    Characters: currentStory.characters || [],
    Relationships: currentStory.relationships || [],
    Chapters: currentStory.chapters || [],
    Timeline: currentStory.chapters || [],
    Notes: currentStory.notes || [],
    Outline: currentStory.outlines || [],
    Map: [],
  })[section] || [] : [];

  const charMap = currentStory ? Object.fromEntries(currentStory.characters.map(c => [c.id, c])) : {};

  function relsFor(charId) {
    return currentStory ? currentStory.relationships.filter(r => r.charA === charId || r.charB === charId) : [];
  }

  // ── mutations ──────────────────────────────────────────────────────────────
  function updateField(collection, id, field, value) {
    setStories(stories.map(s => 
      s.id === currentStoryId 
        ? { ...s, [collection]: s[collection].map(x => x.id === id ? { ...x, [field]: value } : x) }
        : s
    ));
  }

  function deleteItem(collection, id) {
    setStories(stories.map(s => 
      s.id === currentStoryId 
        ? {
            ...s,
            [collection]: s[collection].filter(x => x.id !== id),
            // Also remove rels that reference a deleted character
            ...(collection === "characters" ? {
              relationships: s.relationships.filter(r => r.charA !== id && r.charB !== id),
            } : {}),
          }
        : s
    ));
    setSelected(null);
  }

  // ── sub-note mutations ─────────────────────────────────────────────────────
  function addSubNote(noteId, collKey = "notes") {
    const sn = { id: uid(), title: "New Note", content: "" };
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? { ...s, [collKey]: (s[collKey] || []).map(n => n.id === noteId ? { ...n, subnotes: [...(n.subnotes || []), sn] } : n) }
        : s
    ));
    setSelectedSubNoteId(sn.id);
  }

  function updateSubNote(noteId, subNoteId, field, value, collKey = "notes") {
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? { ...s, [collKey]: (s[collKey] || []).map(n => n.id === noteId ? { ...n, subnotes: (n.subnotes || []).map(sn => sn.id === subNoteId ? { ...sn, [field]: value } : sn) } : n) }
        : s
    ));
  }

  function deleteSubNote(noteId, subNoteId, collKey = "notes") {
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? { ...s, [collKey]: (s[collKey] || []).map(n => n.id === noteId ? { ...n, subnotes: (n.subnotes || []).filter(sn => sn.id !== subNoteId) } : n) }
        : s
    ));
    setSelectedSubNoteId(null);
  }

  function addItem() {
    const f = newForm;
    if (modal === "addChar") {
      if (!f.name?.trim()) return;
      const noteId = uid();
      const nc = { id: uid(), name: f.name, role: f.role || "", bio: f.bio || "", color: f.color || "#888", skinColor: "", eyeColor: "", hairColor: "", hairstyles: [], ethnicity: "", traits: [], outline: [], noteId, pinned: false };
      const nn = { id: noteId, title: f.name, subnotes: [] };
      setStories(stories.map(s =>
        s.id === currentStoryId
          ? { ...s, characters: [...s.characters, nc], notes: [...s.notes, nn] }
          : s
      ));
      setSelected(nc.id); setSection("Characters");
    } else if (modal === "addRel") {
      if (!f.charA || !f.charB || f.charA === f.charB || !f.description?.trim()) return;
      const nr = { id: uid(), charA: f.charA, charB: f.charB, description: f.description, pinned: false };
      setStories(stories.map(s => 
        s.id === currentStoryId 
          ? { ...s, relationships: [...s.relationships, nr] }
          : s
      ));
      setSelected(nr.id); setSection("Relationships");
    } else if (modal === "addChap") {
      if (!f.title?.trim()) return;
      const nc = { id: uid(), title: f.title, content: f.content || "", status: "Draft", pinned: false };
      setStories(stories.map(s => 
        s.id === currentStoryId 
          ? { ...s, chapters: [...s.chapters, nc] }
          : s
      ));
      setSelected(nc.id); setSection("Chapters");
    } else if (modal === "addNote") {
      if (!f.title?.trim()) return;
      const nn = { id: uid(), title: f.title, subnotes: [], pinned: false };
      setStories(stories.map(s =>
        s.id === currentStoryId
          ? { ...s, notes: [...s.notes, nn] }
          : s
      ));
      setSelected(nn.id); setSection("Notes");
    } else if (modal === "addOutline") {
      if (!f.title?.trim()) return;
      const nn = { id: uid(), title: f.title, subnotes: [], pinned: false };
      setStories(stories.map(s =>
        s.id === currentStoryId
          ? { ...s, outlines: [...(s.outlines || []), nn] }
          : s
      ));
      setSelected(nn.id); setSection("Outline");
    }
    setModal(null); setNewForm({});
  }

  function createStory() {
    const title = newForm.storyTitle?.trim() || "Untitled Story";
    const newStory = {
      id: uid(),
      title: title,
      homeContent: "",
      characters: [],
      relationships: [],
      chapters: [],
      notes: [],
      outlines: []
    };
    setStories([...stories, newStory]);
    setCurrentStoryId(newStory.id);
    setShowStoryModal(false);
    setNewForm({});
  }

  // ── undo / redo ────────────────────────────────────────────────────────────
  function undo() {
    if (historyIndex.current <= 0) return;
    historyIndex.current--;
    skipHistory.current = true;
    setStories(JSON.parse(storyHistory.current[historyIndex.current]));
  }
  function redo() {
    if (historyIndex.current >= storyHistory.current.length - 1) return;
    historyIndex.current++;
    skipHistory.current = true;
    setStories(JSON.parse(storyHistory.current[historyIndex.current]));
  }

  // ── tabs ───────────────────────────────────────────────────────────────────
  function getTabLabel(sec, itemId) {
    if (!itemId || !currentStory) return sec;
    const pool = { Characters: currentStory.characters, Chapters: currentStory.chapters, Notes: currentStory.notes, Outline: currentStory.outlines, Relationships: currentStory.relationships };
    const item = (pool[sec] || []).find(i => i.id === itemId);
    if (!item) return sec;
    if (sec === "Relationships") {
      const cA = currentStory.characters.find(c => c.id === item.charA);
      const cB = currentStory.characters.find(c => c.id === item.charB);
      return `${cA?.name || "?"} ↔ ${cB?.name || "?"}`;
    }
    return item.name || item.title || sec;
  }
  function switchTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    skipTabSync.current = true;
    setActiveTabId(tabId);
    setSection(tab.section);
    setSelected(tab.itemId);
    setCharTab("detail");
  }
  function openNewTab(sec = "Home", itemId = null) {
    const label = itemId ? getTabLabel(sec, itemId) : sec;
    const newTab = { id: uid(), section: sec, itemId, label };
    skipTabSync.current = true;
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setSection(sec);
    setSelected(itemId);
    setCharTab("detail");
  }
  function closeTab(tabId, e) {
    e?.stopPropagation();
    const idx = tabs.findIndex(t => t.id === tabId);
    const next = tabs.filter(t => t.id !== tabId);
    if (next.length === 0) {
      const home = { id: uid(), section: "Home", itemId: null, label: "Home" };
      setTabs([home]); setActiveTabId(home.id);
      skipTabSync.current = true; setSection("Home"); setSelected(null);
    } else {
      setTabs(next);
      if (tabId === activeTabId) {
        const fallback = next[Math.max(0, Math.min(idx, next.length - 1))];
        skipTabSync.current = true;
        setActiveTabId(fallback.id); setSection(fallback.section); setSelected(fallback.itemId);
      }
    }
  }

  // ── pane management ────────────────────────────────────────────────────────
  const PANE_POSITIONS = { single: ['tl'], h2: ['tl','tr'], v2: ['tl','bl'], quad: ['tl','tr','bl','br'] };

  function activatePane(pos) {
    if (pos === activePanePos) return;
    const c = paneContents[pos];
    skipTabSync.current = true;
    setActivePanePos(pos);
    setSection(c.section);
    setSelected(c.itemId);
    setCharTab('detail');
  }

  function swapPanes(posA, posB) {
    setPaneContents(prev => ({ ...prev, [posA]: prev[posB], [posB]: prev[posA] }));
    if (activePanePos === posA) setActivePanePos(posB);
    else if (activePanePos === posB) setActivePanePos(posA);
  }

  function changePaneLayout(layout) {
    setPaneLayout(layout);
    // Ensure the active pane is in the new layout; if not, move to tl
    if (!PANE_POSITIONS[layout].includes(activePanePos)) {
      activatePane('tl');
    }
  }

  function paneLabel(pos) {
    const c = pos === activePanePos ? { section, itemId: selected } : paneContents[pos];
    return getTabLabel(c.section, c.itemId) || c.section;
  }

  function renderReadOnly(pos) {
    const c = paneContents[pos];
    if (!currentStory) return null;
    const { section: sec, itemId } = c;
    const PROSE = { fontFamily: "'Fredoka', sans-serif", fontSize: 15, color: "#c9b99a", lineHeight: 1.8, whiteSpace: "pre-wrap" };
    const SCROLL = { flex: 1, overflowY: "auto", padding: "28px 36px", boxSizing: "border-box" };

    if (sec === "Home") return (
      <div style={SCROLL}>
        <div style={{ fontFamily: "'Bangers', cursive", fontSize: 36, color: "#ff1d8e", textShadow: "3px 3px 0 #3a0a2e", marginBottom: 20 }}>{currentStory.title}</div>
        <div style={PROSE}>{parseAndRenderLinks(currentStory.homeContent || "", null)}</div>
      </div>
    );

    if (sec === "Characters" && itemId) {
      const ch = (currentStory.characters || []).find(x => x.id === itemId);
      if (!ch) return <div style={{ ...SCROLL, color: "#555", fontStyle: "italic" }}>Character not found.</div>;
      return (
        <div style={SCROLL}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: ch.color, flexShrink: 0, border: "3px solid #2a2a2a" }} />
            <div style={{ fontFamily: "'Bangers', cursive", fontSize: 34, color: "#ff1d8e", textShadow: "2px 2px 0 #3a0a2e" }}>{ch.name}</div>
          </div>
          {ch.role && <div style={{ color: "#888", marginBottom: 12, fontSize: 14 }}>{ch.role}</div>}
          {ch.bio  && <div style={PROSE}>{ch.bio}</div>}
          {ch.traits?.length > 0 && <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ch.traits.map(t => <span key={t} style={{ background: "#1a0828", border: "2px solid #ff1d8e", color: "#ff1d8e", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>{t}</span>)}
          </div>}
        </div>
      );
    }

    if ((sec === "Chapters" || sec === "Timeline") && itemId) {
      const ch = (currentStory.chapters || []).find(x => x.id === itemId);
      if (!ch) return <div style={{ ...SCROLL, color: "#555", fontStyle: "italic" }}>Chapter not found.</div>;
      const statusColor = STATUS_COLOR[ch.status] || "#555";
      return (
        <div style={SCROLL}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ fontFamily: "'Bangers', cursive", fontSize: 34, color: "#ff1d8e", flex: 1, textShadow: "2px 2px 0 #3a0a2e" }}>{ch.title}</div>
            {ch.status && <span style={{ background: statusColor + "22", border: `1px solid ${statusColor}`, color: statusColor, borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{ch.status}</span>}
          </div>
          <div style={PROSE}>{parseAndRenderLinks(ch.content || "", null)}</div>
        </div>
      );
    }

    if ((sec === "Notes" || sec === "Outline") && itemId) {
      const coll = sec === "Outline" ? currentStory.outlines : currentStory.notes;
      const note = (coll || []).find(x => x.id === itemId);
      if (!note) return <div style={{ ...SCROLL, color: "#555", fontStyle: "italic" }}>Note not found.</div>;
      return (
        <div style={SCROLL}>
          <div style={{ fontFamily: "'Bangers', cursive", fontSize: 30, color: "#ff1d8e", marginBottom: 18, textShadow: "2px 2px 0 #3a0a2e" }}>{note.title}</div>
          {(note.subnotes || []).map(sn => (
            <div key={sn.id} style={{ marginBottom: 16, background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, padding: "12px 16px" }}>
              <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: "#7dd3fc", marginBottom: 6, fontSize: 14 }}>{sn.title}</div>
              {sn.content && <div style={{ ...PROSE, fontSize: 13 }}>{sn.content}</div>}
            </div>
          ))}
        </div>
      );
    }

    if (sec === "Relationships" && itemId) {
      const rel = (currentStory.relationships || []).find(x => x.id === itemId);
      if (!rel) return <div style={{ ...SCROLL, color: "#555", fontStyle: "italic" }}>Relationship not found.</div>;
      const cA = currentStory.characters.find(c => c.id === rel.charA);
      const cB = currentStory.characters.find(c => c.id === rel.charB);
      return (
        <div style={SCROLL}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: cA?.color || "#888" }} /><span style={{ fontFamily: "'Fredoka'", fontWeight: 700, color: "#7dd3fc", fontSize: 18 }}>{cA?.name || "?"}</span></div>
            <span style={{ color: "#555", fontSize: 20 }}>↔</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: cB?.color || "#888" }} /><span style={{ fontFamily: "'Fredoka'", fontWeight: 700, color: "#7dd3fc", fontSize: 18 }}>{cB?.name || "?"}</span></div>
          </div>
          <div style={PROSE}>{rel.description}</div>
        </div>
      );
    }

    // No item selected — show section label
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "'Bangers', cursive", fontSize: 28, color: "#2a2a2a", letterSpacing: "0.05em" }}>{sec}</div>
      </div>
    );
  }

  function createFolder() {
    setFolders(f => [...f, { id: uid(), name: "New Folder", collapsed: false }]);
  }
  function deleteFolder(id) {
    setFolders(f => f.filter(x => x.id !== id));
    setStories(s => s.map(x => x.folderId === id ? { ...x, folderId: null } : x));
  }
  function renameFolder(id, name) {
    if (name.trim()) setFolders(f => f.map(x => x.id === id ? { ...x, name: name.trim() } : x));
  }
  function toggleFolder(id) {
    setFolders(f => f.map(x => x.id === id ? { ...x, collapsed: !x.collapsed } : x));
  }
  function setStoryFolder(storyId, folderId) {
    setStories(s => s.map(x => x.id === storyId ? { ...x, folderId: folderId || null } : x));
  }

  function toggleStoryPin(id) {
    setStories(prev => prev.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s));
  }

  function renameStory(id, newTitle) {
    const t = newTitle.trim();
    if (t) setStories(stories.map(s => s.id === id ? { ...s, title: t } : s));
  }

  function reorderStories(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const arr = [...stories];
    const from = arr.findIndex(s => s.id === fromId);
    const to   = arr.findIndex(s => s.id === toId);
    if (from === -1 || to === -1) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setStories(arr);
  }

  // ── backup / restore ───────────────────────────────────────────────────────
  async function exportBackup() {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), stories }, null, 2);
    try {
      if (window.electronAPI?.saveBackup) {
        const result = await window.electronAPI.saveBackup(payload);
        if (result?.ok) {
          alert("Backup saved to:\n" + result.path);
        } else {
          alert("Backup failed: " + (result?.error || "unknown error"));
        }
      } else {
        alert("Backup API not available — is the app running in Electron?");
      }
    } catch (err) {
      alert("Backup error: " + err.message);
    }
  }

  const BLANK_CHAR_FIELDS = { color: "#888", skinColor: "", eyeColor: "", hairColor: "", hairstyles: [], ethnicity: "", traits: [], outline: [] };
  const PDF_TYPE_CYCLE = ["chapter", "character", "note", "relationship", "skip"];

  async function handlePDFImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPdfParsing(true);
    try {
      const result = await parsePDFFile(file);
      const items = [
        ...(result.chapters || []).map(c => ({ ...BLANK_CHAR_FIELDS, id: c.id, type: "chapter", title: c.title, name: c.title, content: c.content || "", role: "", subnotes: [] })),
        ...(result.characters || []).map(c => ({ ...BLANK_CHAR_FIELDS, ...c, type: "character", title: c.name, name: c.name, content: c.bio || "", subnotes: [] })),
        ...(result.notes || []).map(n => ({ ...BLANK_CHAR_FIELDS, id: n.id, type: "note", title: n.title, name: n.title, content: "", role: "", subnotes: n.subnotes || [] })),
        ...(result.relationships || []).map(r => ({ ...BLANK_CHAR_FIELDS, id: r.id, type: "relationship", title: r.title, name: r.title, nameA: r.nameA, nameB: r.nameB, content: r.content || "", role: "", subnotes: [] })),
      ];
      setPdfPreview({ format: result.format, fileName: file.name.replace(/\.pdf$/i, ""), items });
      setSelectedPdfItems(new Set());
      setPdfTab("all");
    } catch (err) {
      alert("Could not parse PDF: " + err.message);
    } finally {
      setPdfParsing(false);
    }
  }

  function reclassifyPdfItems(ids, newType) {
    setPdfPreview(prev => ({
      ...prev,
      items: prev.items.map(it => ids.has(it.id) ? { ...it, type: newType } : it),
    }));
    setSelectedPdfItems(new Set());
  }

  function cyclePdfItemType(id) {
    setPdfPreview(prev => ({
      ...prev,
      items: prev.items.map(it => {
        if (it.id !== id) return it;
        const next = PDF_TYPE_CYCLE[(PDF_TYPE_CYCLE.indexOf(it.type) + 1) % PDF_TYPE_CYCLE.length];
        return { ...it, type: next };
      }),
    }));
  }

  function applyPDFImport(asNewStory) {
    if (!pdfPreview) return;
    const active = pdfPreview.items.filter(it => it.type !== "skip");
    const chapters   = active.filter(it => it.type === "chapter").map(it => ({ id: it.id, title: it.title, content: it.content }));
    const characters = active.filter(it => it.type === "character").map(it => ({ ...BLANK_CHAR_FIELDS, id: it.id, name: it.name || it.title, role: it.role, bio: it.content, color: it.color, skinColor: it.skinColor, eyeColor: it.eyeColor, hairColor: it.hairColor, hairstyles: it.hairstyles, ethnicity: it.ethnicity, traits: it.traits, outline: it.outline, noteId: null }));
    const notes      = active.filter(it => it.type === "note").map(it => ({ id: it.id, title: it.title, subnotes: it.subnotes || [] }));

    // Link each character to an existing note by name, or create one
    for (const char of characters) {
      const linked = notes.find(n => n.title === char.name);
      if (linked) {
        char.noteId = linked.id;
      } else {
        const newNote = { id: uid(), title: char.name, subnotes: [] };
        char.noteId = newNote.id;
        notes.push(newNote);
      }
    }

    // Resolve relationship name pairs → character IDs
    const charByName = {};
    for (const c of characters) charByName[c.name.toUpperCase()] = c.id;
    const relationships = active
      .filter(it => it.type === "relationship")
      .map(it => {
        const charA = charByName[it.nameA?.toUpperCase()];
        const charB = charByName[it.nameB?.toUpperCase()];
        if (!charA || !charB || charA === charB) return null;
        return { id: it.id, charA, charB, description: it.content || "" };
      })
      .filter(Boolean);

    if (asNewStory) {
      const newStory = { id: uid(), title: pdfPreview.fileName || "Imported Story", characters, relationships, chapters, notes };
      setStories([...stories, newStory]);
      setCurrentStoryId(newStory.id);
    } else {
      setStories(stories.map(s =>
        s.id === currentStoryId
          ? { ...s, chapters: [...s.chapters, ...chapters], characters: [...s.characters, ...characters], notes: [...s.notes, ...notes], relationships: [...(s.relationships || []), ...relationships] }
          : s
      ));
    }
    setPdfPreview(null);
    setSelectedPdfItems(new Set());
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const imported = parsed.stories || (Array.isArray(parsed) ? parsed : null);
        if (!imported || !Array.isArray(imported) || imported.length === 0) {
          alert("Invalid backup file — no stories found.");
          return;
        }
        setImportData(imported);
        setShowImportModal(true);
      } catch {
        alert("Could not read file. Is it a valid Qwosid backup?");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  function applyImportMerge() {
    const merged = [...stories];
    for (const s of importData) {
      const idx = merged.findIndex(x => x.id === s.id);
      if (idx >= 0) merged[idx] = s;
      else merged.push(s);
    }
    setStories(merged);
    setImportData(null);
    setShowImportModal(false);
  }

  function applyImportReplace() {
    setStories(importData);
    setCurrentStoryId(null);
    setImportData(null);
    setShowImportModal(false);
  }

  function deleteStory(storyId) {
    if (stories.length <= 1) return; // Don't delete the last story
    const newStories = stories.filter(s => s.id !== storyId);
    setStories(newStories);
    if (currentStoryId === storyId) {
      setCurrentStoryId(newStories[0].id);
    }
    setSelected(null);
  }

  // ── outline mutations ──────────────────────────────────────────────────────
  function addOutlineBlock(charId) {
    const block = { id: uid(), text: "" };
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? { ...s, characters: s.characters.map(c => c.id === charId ? { ...c, outline: [...(c.outline || []), block] } : c) }
        : s
    ));
  }

  function updateOutlineBlock(charId, blockId, text) {
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? { ...s, characters: s.characters.map(c => c.id === charId ? { ...c, outline: (c.outline || []).map(b => b.id === blockId ? { ...b, text } : b) } : c) }
        : s
    ));
  }

  function deleteOutlineBlock(charId, blockId) {
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? { ...s, characters: s.characters.map(c => c.id === charId ? { ...c, outline: (c.outline || []).filter(b => b.id !== blockId) } : c) }
        : s
    ));
  }

  function reorderOutlineBlock(charId, fromIdx, toIdx) {
    setStories(stories.map(s => {
      if (s.id !== currentStoryId) return s;
      return {
        ...s,
        characters: s.characters.map(c => {
          if (c.id !== charId) return c;
          const blocks = [...(c.outline || [])];
          const [moved] = blocks.splice(fromIdx, 1);
          blocks.splice(toIdx, 0, moved);
          return { ...c, outline: blocks };
        }),
      };
    }));
  }

  // Updates a colour field and stores the previous value alongside it
  function updateCharColor(charId, colorField, newColor) {
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? {
            ...s,
            characters: s.characters.map(ch =>
              ch.id === charId
                ? { ...ch, [colorField]: newColor, [`${colorField}Prev`]: ch[colorField] }
                : ch
            ),
          }
        : s
    ));
  }

  function reorderItems(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const keyMap = { Characters: "characters", Relationships: "relationships", Chapters: "chapters", Notes: "notes", Outline: "outlines" };
    const key = keyMap[section];
    if (!key) return;
    setStories(stories.map(s => {
      if (s.id !== currentStoryId) return s;
      const arr = [...s[key]];
      const from = arr.findIndex(i => i.id === fromId);
      const to   = arr.findIndex(i => i.id === toId);
      if (from === -1 || to === -1) return s;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return { ...s, [key]: arr };
    }));
  }

  // ── search ─────────────────────────────────────────────────────────────────
  function getSearchResults() {
    if (!currentStory || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results = [];
    currentStory.characters.forEach(c => {
      if ([c.name, c.role, c.bio, c.ethnicity, ...(c.traits || [])].some(f => f?.toLowerCase().includes(q))) {
        results.push({ type: "Characters", id: c.id, label: c.name || "Unnamed", color: c.color });
      }
    });
    currentStory.relationships.forEach(r => {
      const cA = charMap[r.charA], cB = charMap[r.charB];
      const label = `${cA?.name || "?"} & ${cB?.name || "?"}`;
      if (label.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)) {
        results.push({ type: "Relationships", id: r.id, label });
      }
    });
    currentStory.chapters.forEach(c => {
      if (c.title?.toLowerCase().includes(q) || c.content?.toLowerCase().includes(q)) {
        results.push({ type: "Chapters", id: c.id, label: c.title || "Untitled" });
      }
    });
    currentStory.notes.forEach(n => {
      if (n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q)) {
        results.push({ type: "Notes", id: n.id, label: n.title || "Untitled" });
      }
    });
    return results;
  }

  // ── inline edit ────────────────────────────────────────────────────────────
  function startEdit(type, id, field, value) { setEditing({ type, id, field, value }); }
  function commitEdit() {
    if (!editing) return;
    updateField(editing.type, editing.id, editing.field, editing.value);
    setEditing(null);
  }

  // ── detail panel ───────────────────────────────────────────────────────────
  function renderDetail() {
    if (section === "Home") {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "28px 40px 24px", boxSizing: "border-box" }}>
          <EditableText
            val={currentStory.title}
            style={{ fontFamily: "'Bangers', cursive", fontSize: 42, letterSpacing: "0.03em", color: "#ff1d8e", marginBottom: 20, textShadow: "3px 3px 0 #3a0a2e", flexShrink: 0 }}
            onEdit={v => { if (v.trim()) setStories(stories.map(s => s.id === currentStoryId ? { ...s, title: v.trim() } : s)); }}
          />
          <ChapterEditor
            key={currentStory.id + "-home"}
            content={currentStory.homeContent || ""}
            requestLink={cb => { setLinkPicker({ onInsert: cb }); setLinkPickerQuery(""); setLinkPickerSection("Characters"); }}
            onNavigate={(sec, id) => { setSection(sec); setSelected(id); setCharTab("detail"); }}
            onSave={v => setStories(stories.map(s => s.id === currentStoryId ? { ...s, homeContent: v } : s))}
          />
        </div>
      );
    }
    if (!selected) return <div style={styles.empty}>Select an item to view details.</div>;

    if (section === "Characters") {
      const c = currentStory.characters.find(x => x.id === selected);
      if (!c) return null;
      const rels = relsFor(c.id);
      const outline = c.outline || [];
      return (
        <div style={styles.detail}>
          {/* Always-visible header */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: c.color, flexShrink: 0, border: "3px solid #2a2a2a", boxShadow: "3px 3px 0 #0d0d0d" }} />
            <EditableText val={c.name} style={styles.detailTitle} onEdit={v => updateField("characters", c.id, "name", v)} />
          </div>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
            {["detail", "outline"].map(tab => (
              <button
                key={tab}
                onClick={() => setCharTab(tab)}
                style={{
                  background: charTab === tab ? "#ff1d8e" : "none",
                  border: `2px solid ${charTab === tab ? "#ff1d8e" : "#2a2a2a"}`,
                  color: charTab === tab ? "#0d0d0d" : "#777",
                  padding: "7px 20px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "'Fredoka', sans-serif",
                  boxShadow: charTab === tab ? "2px 2px 0 #3a0a2e" : "none",
                  textTransform: "capitalize",
                }}
              >
                {tab === "detail" ? "Character Detail" : "Character Outline"}
              </button>
            ))}
          </div>

          {/* ── Detail tab ── */}
          {charTab === "detail" && <>
            <Label>Role</Label>
            <EditableText val={c.role || ""} style={{ ...styles.detailBody, marginBottom: 20 }} onEdit={v => updateField("characters", c.id, "role", v)} />

            <Label>Bio</Label>
            <EditableArea val={c.bio || ""} style={styles.detailBody} onEdit={v => updateField("characters", c.id, "bio", v)} />

            <div style={{ borderTop: "2px dashed #2a2a2a", paddingTop: 20, marginBottom: 4 }}>
              <div style={{ fontFamily: "'Bangers', cursive", fontSize: 20, letterSpacing: "0.05em", color: "#7dd3fc", marginBottom: 16, textShadow: "2px 2px 0 #0a203a" }}>Appearance</div>
              <ColorFieldWithHistory label="Skin Colour" value={c.skinColor} prevValue={c.skinColorPrev} onEdit={v => updateCharColor(c.id, "skinColor", v)} />
              <ColorFieldWithHistory label="Eye Colour" value={c.eyeColor} prevValue={c.eyeColorPrev} onEdit={v => updateCharColor(c.id, "eyeColor", v)} />
              <ColorFieldWithHistory label="Hair Colour" value={c.hairColor} prevValue={c.hairColorPrev} onEdit={v => updateCharColor(c.id, "hairColor", v)} />
              <Label>Hairstyles</Label>
              <HairstyleInput hairstyles={c.hairstyles || []} onEdit={v => updateField("characters", c.id, "hairstyles", v)} />
              <Label>Ethnicity</Label>
              <EditableText val={c.ethnicity || ""} style={{ ...styles.detailBody, marginBottom: 20 }} onEdit={v => updateField("characters", c.id, "ethnicity", v)} />
            </div>

            <div style={{ borderTop: "2px dashed #2a2a2a", paddingTop: 20, marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontFamily: "'Bangers', cursive", fontSize: 20, letterSpacing: "0.05em", color: "#7dd3fc", textShadow: "2px 2px 0 #0a203a" }}>Character Traits</div>
                <button style={{ ...styles.addBtn, padding: "5px 14px", fontSize: 12 }} onClick={() => setShowTraitsModal(true)}>Edit Traits</button>
              </div>
              {(c.traits || []).length === 0
                ? <div style={{ color: "#555", fontStyle: "italic", fontSize: 13, marginBottom: 20 }}>No traits selected yet.</div>
                : <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                    {c.traits.map(trait => (
                      <div key={trait} style={{ display: "flex", alignItems: "center", gap: 6, background: "#1a0828", border: "2px solid #ff1d8e", borderRadius: 20, padding: "4px 8px 4px 12px", boxShadow: "2px 2px 0 #3a0a2e" }}>
                        <span style={{ fontSize: 12, color: "#ff1d8e", fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }}>{trait}</span>
                        <button onClick={() => updateField("characters", c.id, "traits", c.traits.filter(t => t !== trait))} style={{ background: "none", border: "none", color: "#c050a0", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px", fontWeight: 700 }}>×</button>
                      </div>
                    ))}
                  </div>
              }
            </div>

            {rels.length > 0 && <div style={{ borderTop: "2px dashed #2a2a2a", paddingTop: 20, marginBottom: 4 }}>
              <div style={{ fontFamily: "'Bangers', cursive", fontSize: 20, letterSpacing: "0.05em", color: "#7dd3fc", marginBottom: 12, textShadow: "2px 2px 0 #0a203a" }}>Relationships</div>
              {rels.map(r => {
                const other = charMap[r.charA === c.id ? r.charB : r.charA];
                return (
                  <div key={r.id} style={styles.relCard}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: other?.color || "#888" }} />
                      <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 15, color: "#7dd3fc" }}>{other?.name || "Unknown"}</span>
                    </div>
                    <EditableArea val={r.description} style={{ ...styles.detailBody, marginBottom: 0 }} onEdit={v => updateField("relationships", r.id, "description", v)} />
                  </div>
                );
              })}
            </div>}

            {/* Super Note */}
            {(() => {
              const linkedNote = currentStory.notes.find(n => n.id === c.noteId);
              if (!linkedNote) return null;
              return (
                <div style={{ borderTop: "2px dashed #2a2a2a", paddingTop: 20, marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontFamily: "'Bangers', cursive", fontSize: 20, letterSpacing: "0.05em", color: "#c050a0", textShadow: "2px 2px 0 #3a0a2e" }}>Super Note</div>
                    <button style={{ background: "none", border: "2px solid #c050a0", color: "#c050a0", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }} onClick={() => { setSection("Notes"); setSelected(linkedNote.id); }}>Open Note →</button>
                  </div>
                  {linkedNote.subnotes?.length > 0
                    ? <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderRadius: 8, padding: "6px 12px" }}>
                        {linkedNote.subnotes.map(sn => (
                          <div key={sn.id} style={{ fontSize: 13, color: "#b0a090", padding: "5px 0", borderBottom: "1px solid #1a1a1a" }}>• {sn.title}</div>
                        ))}
                      </div>
                    : <div style={{ color: "#555", fontStyle: "italic", fontSize: 13 }}>No notes yet — open the note to add some.</div>
                  }
                </div>
              );
            })()}

            <button style={styles.deleteBtn} onClick={() => setItemToDelete({ type: "character", id: c.id, name: c.name })}>Delete Character</button>
          </>}

          {/* ── Outline tab ── */}
          {charTab === "outline" && (
            <OutlineEditor
              outline={outline}
              charId={c.id}
              onUpdate={updateOutlineBlock}
              onAdd={addOutlineBlock}
              onReorder={reorderOutlineBlock}
              onRequestDelete={(block) => setItemToDelete({ type: "outline block", id: block.id, charId: c.id, name: block.text.trim().slice(0, 50) || "Empty block" })}
            />
          )}
        </div>
      );
    }

    if (section === "Relationships") {
      const r = currentStory.relationships.find(x => x.id === selected);
      if (!r) return null;
      const cA = charMap[r.charA], cB = charMap[r.charB];
      return (
        <div style={styles.detail}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <CharBadge c={cA} /> <span style={{ color: "#888", fontSize: 20 }}>↔</span> <CharBadge c={cB} />
          </div>
          <Label>Relationship</Label>
          <EditableArea val={r.description} style={styles.detailBody} onEdit={v => updateField("relationships", r.id, "description", v)} />
          <button style={styles.deleteBtn} onClick={() => { setItemToDelete({ type: "relationship", id: r.id, name: `${charMap[r.charA]?.name || "?"} & ${charMap[r.charB]?.name || "?"}` }); }}>Delete Relationship</button>
        </div>
      );
    }

    if (section === "Timeline") {
      const chapters = currentStory.chapters || [];
      if (chapters.length === 0) return <div style={styles.empty}>No chapters yet — add one with +</div>;
      return (
        <div style={{ height: "100%", overflowX: "auto", overflowY: "hidden", display: "flex", alignItems: "flex-start", padding: "32px 40px", gap: 16, boxSizing: "border-box" }}>
          {chapters.map((ch, i) => {
            const wc = ch.content?.trim() ? ch.content.trim().split(/\s+/).length : 0;
            const color = STATUS_COLOR[ch.status] || "#555";
            return (
              <div key={ch.id} onClick={() => { setSection("Chapters"); setSelected(ch.id); openNewTab("Chapters", ch.id); }}
                style={{ width: 180, flexShrink: 0, background: "#141414", border: "2px solid #2a2a2a", borderRadius: 12, padding: 16, cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#ff1d8e"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a2a"}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Ch. {i + 1}</div>
                <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: "#c9b99a", fontSize: 14, marginBottom: 10, lineHeight: 1.3 }}>{ch.title || "Untitled"}</div>
                {ch.status && <div style={{ display: "inline-block", background: color + "22", border: `1px solid ${color}`, color, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{ch.status}</div>}
                <div style={{ fontSize: 11, color: "#555" }}>{wc} words</div>
              </div>
            );
          })}
        </div>
      );
    }

    if (section === "Map") {
      const chars = currentStory.characters || [];
      const rels  = currentStory.relationships || [];
      const W = 560, H = 420, CX = W / 2, CY = H / 2, R = 160;
      const positions = chars.map((c, i) => ({
        c, x: CX + R * Math.cos(2 * Math.PI * i / Math.max(chars.length, 1) - Math.PI / 2),
        y: CY + R * Math.sin(2 * Math.PI * i / Math.max(chars.length, 1) - Math.PI / 2),
      }));
      const posMap = Object.fromEntries(positions.map(p => [p.c.id, p]));
      if (chars.length === 0) return <div style={styles.empty}>No characters yet.</div>;
      return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: 24 }}>
          <svg width={W} height={H} style={{ overflow: "visible" }}>
            {rels.map(r => {
              const a = posMap[r.charA], b = posMap[r.charB];
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return (
                <g key={r.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2a2a2a" strokeWidth={2} />
                  <text x={mx} y={my - 4} textAnchor="middle" fontSize={10} fill="#555" fontFamily="Fredoka">{r.description?.slice(0, 20)}</text>
                </g>
              );
            })}
            {positions.map(({ c, x, y }) => (
              <g key={c.id} style={{ cursor: "pointer" }} onClick={() => { setSection("Characters"); setSelected(c.id); setCharTab("detail"); openNewTab("Characters", c.id); }}>
                <circle cx={x} cy={y} r={28} fill={c.color || "#888"} stroke="#2a2a2a" strokeWidth={3} />
                <text x={x} y={y + 44} textAnchor="middle" fontSize={12} fill="#c9b99a" fontFamily="Fredoka" fontWeight={600}>{c.name}</text>
              </g>
            ))}
          </svg>
        </div>
      );
    }

    if (section === "Chapters" || (section === "Timeline" && selected)) {
      const item = currentStory.chapters.find(x => x.id === selected);
      if (!item) return null;
      const statusColor = STATUS_COLOR[item.status] || "#555";
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "28px 40px 24px", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, marginBottom: 16 }}>
            <EditableText val={item.title} style={{ ...styles.detailTitle, marginBottom: 0, flex: 1 }} onEdit={v => updateField("chapters", item.id, "title", v)} />
            <button onClick={() => { const i = (STATUS_CYCLE.indexOf(item.status) + 1) % STATUS_CYCLE.length; updateField("chapters", item.id, "status", STATUS_CYCLE[i]); }}
              style={{ background: statusColor + "22", border: `2px solid ${statusColor}`, color: statusColor, padding: "4px 14px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", flexShrink: 0 }}>
              {item.status || "No Status"}
            </button>
          </div>
          <ChapterEditor key={item.id} content={item.content}
            requestLink={cb => { setLinkPicker({ onInsert: cb }); setLinkPickerQuery(""); setLinkPickerSection("Characters"); }}
            onNavigate={(sec, id) => { setSection(sec); setSelected(id); setCharTab("detail"); }}
            onSave={v => updateField("chapters", item.id, "content", v)} />
          <div style={{ display: "flex", gap: 10, flexShrink: 0, marginTop: 16 }}>
            <button style={styles.pdfBtn} onClick={() => exportChapterAsPDF(item)}>Export as PDF</button>
            <button style={styles.deleteBtn} onClick={() => setItemToDelete({ type: "chapter", id: item.id, name: item.title || "Untitled" })}>Delete Chapter</button>
          </div>
        </div>
      );
    }

    if (section === "Notes" || section === "Outline") {
      const collKey = section === "Outline" ? "outlines" : "notes";
      const item = (currentStory[collKey] || []).find(x => x.id === selected);
      if (!item) return null;
      const subnotes = item.subnotes || [];
      const currentSub = subnotes.find(sn => sn.id === selectedSubNoteId);
      const linkedChar = currentStory.characters.find(ch => ch.noteId === item.id);
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "28px 40px 24px", boxSizing: "border-box" }}>

          {/* header row */}
          <div style={{ flexShrink: 0, marginBottom: 16 }}>
            <EditableText val={item.title} style={styles.detailTitle} onEdit={v => updateField(collKey, item.id, "title", v)} />
            {linkedChar && (
              <button style={{ background: "none", border: "2px solid #ff1d8e", color: "#ff1d8e", padding: "4px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", marginTop: 8 }} onClick={() => { setSection("Characters"); setSelected(linkedChar.id); setCharTab("detail"); }}>
                ← {linkedChar.name}
              </button>
            )}
          </div>

          {/* subnote tabs */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 10, marginBottom: 16, borderBottom: "2px dashed #2a2a2a", scrollbarWidth: "thin", scrollbarColor: "#333 transparent", flexShrink: 0 }}>
            {subnotes.map(sn => (
              <button key={sn.id} onClick={() => setSelectedSubNoteId(sn.id)} style={{ background: selectedSubNoteId === sn.id ? "#ff1d8e" : "#1a1a1a", border: `2px solid ${selectedSubNoteId === sn.id ? "#ff1d8e" : "#2a2a2a"}`, color: selectedSubNoteId === sn.id ? "#0d0d0d" : "#b0a090", padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Fredoka', sans-serif", whiteSpace: "nowrap", flexShrink: 0, boxShadow: selectedSubNoteId === sn.id ? "2px 2px 0 #3a0a2e" : "none" }}>
                {sn.title || "Untitled"}
              </button>
            ))}
            <button onClick={() => addSubNote(item.id, collKey)} style={{ background: "none", border: "2px dashed #3a3a3a", color: "#666", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>+</button>
          </div>

          {currentSub ? (
            <>
              {/* subnote title */}
              <EditableText val={currentSub.title} style={{ ...styles.detailBody, marginBottom: 12, flexShrink: 0 }} onEdit={v => updateSubNote(item.id, currentSub.id, "title", v, collKey)} />
              {/* subnote content — full-height scrollable editor */}
              <ChapterEditor key={currentSub.id} content={currentSub.content || ""}
                requestLink={cb => { setLinkPicker({ onInsert: cb }); setLinkPickerQuery(""); setLinkPickerSection("Characters"); }}
                onNavigate={(sec, id) => { setSection(sec); setSelected(id); setCharTab("detail"); }}
                onSave={v => updateSubNote(item.id, currentSub.id, "content", v, collKey)} />
              <div style={{ display: "flex", gap: 10, flexShrink: 0, marginTop: 16 }}>
                <button style={styles.deleteBtn} onClick={() => setItemToDelete({ type: "sub-note", noteId: item.id, id: currentSub.id, name: currentSub.title || "Untitled", collKey })}>Delete Note</button>
                <button style={{ ...styles.deleteBtn, marginTop: 0 }} onClick={() => setItemToDelete({ type: "note", id: item.id, name: item.title || "Untitled", collKey })}>Delete Group</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ color: "#555", fontStyle: "italic", fontSize: 14, flex: 1 }}>
                {subnotes.length === 0 ? "No notes yet — hit + to add one." : "Select a note above to view it."}
              </div>
              <button style={{ ...styles.deleteBtn, flexShrink: 0 }} onClick={() => setItemToDelete({ type: "note", id: item.id, name: item.title || "Untitled", collKey })}>Delete Note Group</button>
            </>
          )}
        </div>
      );
    }
  }

  // ── modal ──────────────────────────────────────────────────────────────────
  function renderModal() {
    if (!modal) return null;
    return (
      <div style={styles.overlay} onClick={e => { if (e.target === e.currentTarget) { setModal(null); setNewForm({}); } }}>
        <div style={styles.modalBox} onKeyDown={e => { if (e.key === "Enter" && e.target.tagName === "INPUT") addItem(); }}>
          <h3 style={{ fontFamily: "'Bangers', cursive", fontSize: 28, letterSpacing: "0.04em", color: "#ff1d8e", marginBottom: 20, borderBottom: "2px dashed #3a0a2e", paddingBottom: 12 }}>
            {modal === "addChar" ? "New Character" : modal === "addRel" ? "New Relationship" : modal === "addChap" ? "New Chapter" : modal === "addOutline" ? "New Outline Group" : "New Note"}
          </h3>
          {modal === "addChar" && <>
            <FormField label="Name *" value={newForm.name || ""} onChange={v => setNewForm(f => ({ ...f, name: v }))} />
          </>}
          {modal === "addRel" && <>
            <div style={{ marginBottom: 12 }}>
              <label style={styles.formLabel}>Character A *</label>
              <select style={styles.select} value={newForm.charA || ""} onChange={e => setNewForm(f => ({ ...f, charA: e.target.value }))}>
                <option value="">— select —</option>
                {currentStory.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={styles.formLabel}>Character B *</label>
              <select style={styles.select} value={newForm.charB || ""} onChange={e => setNewForm(f => ({ ...f, charB: e.target.value }))}>
                <option value="">— select —</option>
                {currentStory.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <FormTextarea label="Description *" value={newForm.description || ""} onChange={v => setNewForm(f => ({ ...f, description: v }))} />
          </>}
          {modal === "addChap" && <>
            <FormField label="Title *" value={newForm.title || ""} onChange={v => setNewForm(f => ({ ...f, title: v }))} />
            <FormTextarea label="Content" value={newForm.content || ""} onChange={v => setNewForm(f => ({ ...f, content: v }))} />
          </>}
          {(modal === "addNote" || modal === "addOutline") && <>
            <FormField label="Group Name *" value={newForm.title || ""} onChange={v => setNewForm(f => ({ ...f, title: v }))} />
          </>}
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button style={styles.addBtn} onClick={addItem}>Create</button>
            <button style={{ ...styles.addBtn, background: "#2a2a2a", color: "#888" }} onClick={() => { setModal(null); setNewForm({}); }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const addActions = { Characters: "addChar", Relationships: "addRel", Chapters: "addChap", Notes: "addNote", Outline: "addOutline", Timeline: "addChap" };

  function renderStoryModal() {
    if (!showStoryModal) return null;
    return (
      <div style={styles.overlay} onClick={e => { if (e.target === e.currentTarget) { setShowStoryModal(false); setNewForm({}); } }}>
        <div style={styles.modalBox} onKeyDown={e => { if (e.key === "Enter" && e.target.tagName === "INPUT") createStory(); }}>
          <h3 style={{ fontFamily: "'Bangers', cursive", fontSize: 28, letterSpacing: "0.04em", color: "#ff1d8e", marginBottom: 20, borderBottom: "2px dashed #3a0a2e", paddingBottom: 12 }}>
            New Story
          </h3>
          <FormField label="Story Title" value={newForm.storyTitle || ""} onChange={v => setNewForm(f => ({ ...f, storyTitle: v }))} />
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button style={styles.addBtn} onClick={createStory}>Create Story</button>
            <button style={{ ...styles.addBtn, background: "#2a2a2a", color: "#888" }} onClick={() => { setShowStoryModal(false); setNewForm({}); }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── import modal ───────────────────────────────────────────────────────────
  function renderImportModal() {
    if (!showImportModal || !importData) return null;
    return (
      <div style={styles.overlay} onClick={() => { setShowImportModal(false); setImportData(null); }}>
        <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
          <h3 style={{ fontFamily: "'Bangers', cursive", fontSize: 28, letterSpacing: "0.04em", color: "#ff1d8e", marginBottom: 16, borderBottom: "2px dashed #3a0a2e", paddingBottom: 12 }}>Import Backup</h3>
          <div style={{ fontSize: 14, color: "#c9b99a", marginBottom: 12 }}>
            Found <strong style={{ color: "#7dd3fc" }}>{importData.length}</strong> stor{importData.length === 1 ? "y" : "ies"} in this backup file.
          </div>
          <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}>
            {importData.map(s => (
              <div key={s.id} style={{ fontSize: 13, color: "#b0a090", marginBottom: 4 }}>• {s.title || "Untitled"}</div>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 24, lineHeight: 1.6 }}>
            <span style={{ color: "#7dd3fc", fontWeight: 700 }}>Merge</span> — adds/updates stories from the backup, keeps anything not in the file.<br />
            <span style={{ color: "#ff1d8e", fontWeight: 700 }}>Replace All</span> — wipes your current data and loads only the backup.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={{ background: "none", border: "1px solid #333", color: "#888", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "'Fredoka', sans-serif" }} onClick={() => { setShowImportModal(false); setImportData(null); }}>Cancel</button>
            <button style={{ ...styles.pdfBtn, marginTop: 0 }} onClick={applyImportMerge}>Merge</button>
            <button style={styles.addBtn} onClick={applyImportReplace}>Replace All</button>
          </div>
        </div>
      </div>
    );
  }

  // ── story selection screen ─────────────────────────────────────────────────
  if (!currentStoryId) {
    return (
      <div style={styles.root}>
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* sidebar nav */}
        <div style={{ ...styles.sidebar, width: sidebarCollapsed ? 40 : sidebarWidth, position: "relative", overflow: "hidden", transition: "width 0.15s" }}>
          <div style={{ position: "absolute", top: 0, right: 0, width: 5, height: "100%", cursor: "ew-resize", zIndex: 10 }} onMouseDown={startSidebarResize} />
          {sidebarCollapsed ? (
            <button onClick={() => { setSidebarCollapsed(false); setSidebarWidth(lastSidebarWidth.current); }} style={{ width: 40, height: 40, background: "none", border: "none", color: "#ff1d8e", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 0 20px" }}>
              <div style={styles.brand}>QWOSID</div>
              <button onClick={() => { lastSidebarWidth.current = sidebarWidth; setSidebarCollapsed(true); setSidebarWidth(40); }} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>‹</button>
            </div>
          )}
          {!sidebarCollapsed && <>
          <div style={{ marginBottom: 16, padding: "0 20px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Stories</div>
            <input
              value={storySearchQuery}
              onChange={e => setStorySearchQuery(e.target.value)}
              placeholder="Search stories…"
              style={{ ...styles.formInput, fontSize: 12, marginBottom: 8, padding: "6px 10px" }}
            />
            {(() => {
              const q = storySearchQuery.toLowerCase();
              const matched = stories.filter(s => s.title.toLowerCase().includes(q));
              const pin = arr => [...arr].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
              const ungrouped = pin(matched.filter(s => !s.folderId || !folders.find(f => f.id === s.folderId)));

              const renderStoryRow = (s, indent = false) => {
                const isOver     = dragOverId === s.id && draggingId !== s.id;
                const isDragging = draggingId === s.id;
                return (
                  <div key={s.id}
                    draggable
                    onDragStart={() => setDraggingId(s.id)}
                    onDragOver={e => { e.preventDefault(); setDragOverId(s.id); }}
                    onDrop={e => { e.preventDefault(); reorderStories(draggingId, s.id); setDraggingId(null); setDragOverId(null); }}
                    onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                    onClick={() => { if (!isEditingStories) setCurrentStoryId(s.id); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", paddingLeft: indent ? 20 : 8, borderRadius: 4, marginBottom: 2, cursor: "grab", opacity: isDragging ? 0.4 : 1, borderTop: isOver ? "2px solid #ff1d8e" : "2px solid transparent" }}
                  >
                    {isEditingStories && (
                      <input type="checkbox" checked={selectedStories.has(s.id)} onChange={() => {
                        const n = new Set(selectedStories);
                        n.has(s.id) ? n.delete(s.id) : n.add(s.id);
                        setSelectedStories(n);
                      }} onClick={e => e.stopPropagation()} style={{ cursor: "pointer", flexShrink: 0 }} />
                    )}
                    {renamingStoryId === s.id ? (
                      <input autoFocus defaultValue={s.title}
                        onBlur={e => { renameStory(s.id, e.target.value); setRenamingStoryId(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { renameStory(s.id, e.target.value); setRenamingStoryId(null); } if (e.key === "Escape") setRenamingStoryId(null); }}
                        onClick={e => e.stopPropagation()}
                        style={{ ...styles.formInput, fontSize: 12, padding: "2px 6px", flex: 1 }} />
                    ) : (
                      <span onClick={e => { if (isEditingStories) { e.stopPropagation(); setRenamingStoryId(s.id); } }}
                        style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: "#b0a090", fontSize: 13, flex: 1, cursor: isEditingStories ? "text" : "pointer" }}>
                        {s.title}
                      </span>
                    )}
                    {isEditingStories && (
                      <select value={s.folderId || ""} onChange={e => { setStoryFolder(s.id, e.target.value || null); }} onClick={e => e.stopPropagation()}
                        style={{ fontSize: 10, background: "#1a1a1a", border: "1px solid #333", color: "#666", borderRadius: 3, padding: "1px 2px", cursor: "pointer", flexShrink: 0, maxWidth: 70 }}>
                        <option value="">No folder</option>
                        {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    )}
                    <button onClick={e => { e.stopPropagation(); toggleStoryPin(s.id); }} style={{ background: "none", border: "none", color: s.pinned ? "#ff1d8e" : "#2a2a2a", cursor: "pointer", fontSize: 13, padding: 0, flexShrink: 0, lineHeight: 1 }}>●</button>
                  </div>
                );
              };

              return (
                <div style={{ maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
                  {ungrouped.map(s => renderStoryRow(s, false))}
                  {folders.map(folder => {
                    const folderStories = pin(matched.filter(s => s.folderId === folder.id));
                    if (folderStories.length === 0 && q && !isEditingStories) return null;
                    return (
                      <div key={folder.id} style={{ marginBottom: 2 }}>
                        <div
                          onClick={() => toggleFolder(folder.id)}
                          onDragOver={isEditingStories ? e => { e.preventDefault(); setDragOverId("f-" + folder.id); } : undefined}
                          onDrop={isEditingStories ? e => { e.preventDefault(); if (draggingId) { setStoryFolder(draggingId, folder.id); } setDragOverId(null); } : undefined}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 4, background: dragOverId === "f-" + folder.id ? "#2a1428" : "#1a1a1a", cursor: "pointer", borderTop: dragOverId === "f-" + folder.id ? "2px solid #ff1d8e" : "2px solid transparent" }}
                        >
                          <span style={{ fontSize: 10, color: "#666", flexShrink: 0 }}>{folder.collapsed ? "▶" : "▼"}</span>
                          <span style={{ fontSize: 13, flexShrink: 0 }}>📁</span>
                          {renamingFolderId === folder.id ? (
                            <input autoFocus defaultValue={folder.name}
                              onBlur={e => { renameFolder(folder.id, e.target.value); setRenamingFolderId(null); }}
                              onKeyDown={e => { if (e.key === "Enter") { renameFolder(folder.id, e.target.value); setRenamingFolderId(null); } if (e.key === "Escape") setRenamingFolderId(null); }}
                              onClick={e => e.stopPropagation()}
                              style={{ ...styles.formInput, fontSize: 12, padding: "1px 6px", flex: 1 }} />
                          ) : (
                            <span onClick={e => { if (isEditingStories) { e.stopPropagation(); setRenamingFolderId(folder.id); } }}
                              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: "#c9b99a", fontSize: 13, flex: 1, cursor: isEditingStories ? "text" : "pointer" }}>
                              {folder.name} <span style={{ color: "#555", fontWeight: 400 }}>({folderStories.length})</span>
                            </span>
                          )}
                          {isEditingStories && (
                            <button onClick={e => { e.stopPropagation(); if (window.confirm(`Delete folder "${folder.name}"? Stories inside will become ungrouped.`)) deleteFolder(folder.id); }}
                              style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
                          )}
                        </div>
                        {!folder.collapsed && folderStories.map(s => renderStoryRow(s, true))}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ marginTop: 10 }}>
              <button style={{ background: "none", border: "1px solid #333", color: "#c050a0", padding: "8px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, width: "100%" }} onClick={() => setShowStoryModal(true)}>New Story</button>
              {isEditingStories && (
                <button style={{ background: "none", border: "1px solid #333", color: "#7dd3fc", padding: "6px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, width: "100%", marginTop: 6 }} onClick={createFolder}>New Folder</button>
              )}
              <button style={{ background: isEditingStories ? "#ff1d8e" : "none", border: "1px solid #333", color: isEditingStories ? "#0d0d0d" : "#888", padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, width: "100%", marginTop: 6 }} onClick={() => setIsEditingStories(!isEditingStories)}>
                {isEditingStories ? "Done Editing" : "Edit Stories"}
              </button>
              {isEditingStories && selectedStories.size > 0 && (
                <button style={{ background: "#ff1d8e", border: "2px solid #3a0a2e", color: "#0d0d0d", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, width: "100%", marginTop: 6 }} onClick={() => setShowDeleteConfirm(true)}>
                  Delete Selected ({selectedStories.size})
                </button>
              )}
            </div>
          </div>
          <div style={{ marginTop: "auto", padding: "16px 20px", borderTop: "2px dashed #2a2a2a" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555", marginBottom: 8 }}>Backup</div>
            <button style={{ background: "none", border: "2px solid #7dd3fc", color: "#7dd3fc", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, width: "100%", fontFamily: "'Fredoka', sans-serif", marginBottom: 6 }} onClick={exportBackup}>Download Backup</button>
            <button style={{ background: "none", border: "2px dashed #7dd3fc", color: "#7dd3fc", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, width: "100%", fontFamily: "'Fredoka', sans-serif" }} onClick={() => importInputRef.current?.click()}>Import Backup</button>
            <input ref={importInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
          </div>
          </>}
        </div>

        {/* main content */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}>
          <div style={{ textAlign: "center", color: "#888" }}>
            <div style={{ fontSize: 72, fontFamily: "'Bangers', cursive", letterSpacing: "0.04em", color: "#ff1d8e", textShadow: "4px 4px 0 #3a0a2e, 8px 8px 0 rgba(0,0,0,0.4)" }}>QWOSID</div>
          </div>
        </div>

        {/* delete confirmation modal */}
        {showDeleteConfirm && (
          <div style={styles.overlay} onClick={() => setShowDeleteConfirm(false)}>
            <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
              <h3 style={{ fontFamily: "'Bangers', cursive", fontSize: 28, letterSpacing: "0.04em", color: "#ff1d8e", marginBottom: 20, borderBottom: "2px dashed #3a0a2e", paddingBottom: 12 }}>
                Delete Stories
              </h3>
              <div style={{ fontSize: 14, color: "#c9b99a", marginBottom: 24 }}>
                Are you sure you want to delete the following story{selectedStories.size > 1 ? 's' : ''}?
              </div>
              <div style={{ background: "#161616", border: "1px solid #252525", borderRadius: 6, padding: "14px 16px", marginBottom: 24 }}>
                {Array.from(selectedStories).map(storyId => {
                  const story = stories.find(s => s.id === storyId);
                  return (
                    <div key={storyId} style={{ marginBottom: 8, fontSize: 14, color: "#b0a090" }}>
                      • {story?.title || "Untitled Story"}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button style={{ background: "none", border: "1px solid #333", color: "#888", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12 }} onClick={() => setShowDeleteConfirm(false)}>Keep</button>
                <button style={{ background: "#ff1d8e", border: "2px solid #3a0a2e", color: "#0d0d0d", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12 }} onClick={() => {
                  const newStories = stories.filter(s => !selectedStories.has(s.id));
                  setStories(newStories);
                  setSelectedStories(new Set());
                  setShowDeleteConfirm(false);
                  if (newStories.length === 0) {
                    // If no stories left, create a default one
                    const defaultStory = {
                      id: uid(),
                      title: "Untitled Story",
                      characters: [],
                      relationships: [],
                      chapters: [],
                      notes: []
                    };
                    setStories([defaultStory]);
                  } else if (currentStoryId && !newStories.find(s => s.id === currentStoryId)) {
                    // If current story was deleted, switch to first remaining story
                    setCurrentStoryId(newStories[0].id);
                  }
                  setIsEditingStories(false);
                }}>Delete</button>
              </div>
            </div>
          </div>
        )}

        {renderStoryModal()}
        {renderImportModal()}
      </div>
    );
  }

  // ── storage UI ─────────────────────────────────────────────────────────────
  function renderStorageStatus() {
    return (
      <div style={{ padding: "0 20px", marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555", marginBottom: 6 }}>Storage</div>
        <div style={{ fontSize: 12, color: isSaving ? "#ff1d8e" : saveStatus ? "#4caf50" : "#444", fontWeight: 600, minHeight: 18, transition: "color 0.3s" }}>
          {isSaving ? "Saving..." : saveStatus || "Auto-saved"}
        </div>
      </div>
    );
  }

  // ── main application screen ────────────────────────────────────────────────
  // Ensure we have a valid currentStory before rendering the main interface
  if (!currentStory) {
    return (
      <div style={styles.root}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}>
          <div style={{ textAlign: "center", color: "#888" }}>
            <div style={{ fontSize: 48, fontFamily: "'Bangers', cursive", letterSpacing: "0.04em", color: "#ff1d8e", textShadow: "3px 3px 0 #3a0a2e" }}>QWOSID</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {/* sidebar nav */}
      <div style={{ ...styles.sidebar, width: sidebarCollapsed ? 40 : sidebarWidth, position: "relative", overflow: "hidden", transition: "width 0.15s" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: 5, height: "100%", cursor: "ew-resize", zIndex: 10 }} onMouseDown={startSidebarResize} />
        {sidebarCollapsed ? (
          <button onClick={() => { setSidebarCollapsed(false); setSidebarWidth(lastSidebarWidth.current); }} style={{ width: 40, height: 40, background: "none", border: "none", color: "#ff1d8e", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
        ) : (<>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 0 0" }}>
            <div style={styles.brand}>QWOSID</div>
            <button onClick={() => { lastSidebarWidth.current = sidebarWidth; setSidebarCollapsed(true); setSidebarWidth(40); }} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>‹</button>
          </div>
          <div style={{ marginBottom: 16, padding: "0 20px" }}>
          <div style={{ marginBottom: 12 }}>
            <button style={{ background: "none", border: "2px solid #ff1d8e", color: "#ff1d8e", padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.04em" }} onClick={() => setCurrentStoryId(null)}>
              ← Back
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <span style={{ fontFamily: "'Bangers', cursive", color: "#7dd3fc", fontSize: 20, letterSpacing: "0.04em", textShadow: "2px 2px 0 #3a0a2e" }}>{currentStory.title}</span>
          </div>
        </div>
        {SECTIONS.map(s => (
          <button key={s} style={{ ...styles.navBtn, ...(s === "Home" ? { padding: "6px 20px", fontSize: 11, letterSpacing: "0.12em", color: s === section ? undefined : "#555" } : {}), ...(s === section ? styles.navActive : {}) }} onClick={() => { setSection(s); setSelected(null); }}>
            {s === "Home" ? "⌂ Home" : s}
          </button>
        ))}
        {renderStorageStatus()}
        <div style={{ padding: "0 20px 20px" }}>
          <div style={{ borderTop: "2px dashed #2a2a2a", paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555", marginBottom: 8 }}>Export</div>
            <button style={{ background: "none", border: "2px solid #ff1d8e", color: "#ff1d8e", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, width: "100%", fontFamily: "'Fredoka', sans-serif", marginBottom: 14 }} onClick={() => exportStoryAsPDF(currentStory)}>Export Story PDF</button>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555", marginBottom: 8 }}>Backup</div>
            <button style={{ background: "none", border: "2px solid #7dd3fc", color: "#7dd3fc", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, width: "100%", fontFamily: "'Fredoka', sans-serif", marginBottom: 6 }} onClick={exportBackup}>Download Backup</button>
            <button style={{ background: "none", border: "2px dashed #7dd3fc", color: "#7dd3fc", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, width: "100%", fontFamily: "'Fredoka', sans-serif" }} onClick={() => importInputRef.current?.click()}>Import Backup</button>
            <input ref={importInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555", marginBottom: 8, marginTop: 14 }}>Import PDF</div>
            <button style={{ background: "none", border: "2px dashed #c050a0", color: "#c050a0", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, width: "100%", fontFamily: "'Fredoka', sans-serif" }} onClick={() => pdfImportRef.current?.click()}>{pdfParsing ? "Parsing…" : "Import PDF"}</button>
            <input ref={pdfImportRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handlePDFImport} />
          </div>
        </div>
        </>)}
      </div>

      {/* list panel */}
      <div style={{ ...styles.list, width: listWidth, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: 5, height: "100%", cursor: "ew-resize", zIndex: 10 }} onMouseDown={startListResize} />
        <div style={styles.listHeader}>
          <span style={styles.listTitle}>
            {section === "Map" ? "Map" : section === "Timeline" ? "Timeline" : section}
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {section === "Relationships" && (
              <button style={{ background: "none", border: "none", color: "#555", padding: "0 4px", cursor: "pointer", fontSize: 12, fontFamily: "'Fredoka', sans-serif", fontWeight: 600, letterSpacing: "0.03em" }} onClick={() => { setSection("Map"); setSelected(null); }}>Map</button>
            )}
            {section === "Map" && (
              <button style={{ background: "none", border: "none", color: "#555", padding: "0 4px", cursor: "pointer", fontSize: 12, fontFamily: "'Fredoka', sans-serif" }} onClick={() => { setSection("Relationships"); setSelected(null); }}>← Back</button>
            )}
            {section === "Chapters" && (
              <button style={{ background: "none", border: "none", color: "#555", padding: "0 4px", cursor: "pointer", fontSize: 12, fontFamily: "'Fredoka', sans-serif", fontWeight: 600, letterSpacing: "0.03em" }} onClick={() => { setSection("Timeline"); setSelected(null); }}>Timeline</button>
            )}
            {section === "Timeline" && (
              <button style={{ background: "none", border: "none", color: "#555", padding: "0 4px", cursor: "pointer", fontSize: 12, fontFamily: "'Fredoka', sans-serif" }} onClick={() => { setSection("Chapters"); setSelected(null); }}>← Back</button>
            )}
            {section === "Chapters" && currentStory?.chapters?.length > 0 && (
              <button style={{ ...styles.pdfBtn, marginTop: 0, padding: "5px 12px", fontSize: 12 }} onClick={() => exportAllChaptersAsPDF(currentStory.title, currentStory.chapters)} title="Export all chapters as PDF">PDF</button>
            )}
            {section !== "Search" && section !== "Home" && section !== "Map" && section !== "Timeline" && <button style={styles.plusBtn} onClick={() => setModal(addActions[section])}>+</button>}
          </div>
        </div>
        {section === "Home" ? (
          <div style={{ overflowY: "auto", flex: 1 }}>
            {[
              { label: "Characters", items: currentStory.characters, color: "#ff1d8e", dot: true },
              { label: "Chapters",   items: currentStory.chapters,   color: "#7dd3fc", dot: false },
              { label: "Notes",      items: currentStory.notes,      color: "#c9b99a", dot: false },
            ].map(({ label, items: grpItems, color, dot }) => grpItems.length === 0 ? null : (
              <div key={label}>
                <div style={{ padding: "10px 16px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555", borderBottom: "1px solid #1e1e1e" }}>{label}</div>
                {grpItems.map(item => (
                  <div key={item.id} style={{ ...styles.listItem, cursor: "pointer" }} onClick={() => { setSection(label); setSelected(item.id); setCharTab("detail"); }}>
                    {dot && <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color || "#888", marginRight: 10, flexShrink: 0 }} />}
                    <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500, fontSize: 14, color: "#b0a090" }}>{item.name || item.title || "Untitled"}</div>
                  </div>
                ))}
              </div>
            ))}
            {currentStory.characters.length === 0 && currentStory.chapters.length === 0 && currentStory.notes.length === 0 && (
              <div style={{ padding: "24px 16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>Nothing in this story yet.</div>
            )}
          </div>
        ) : section === "Search" ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "2px dashed #2a2a2a" }}>
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search everything…"
                style={{ ...styles.formInput, fontSize: 13 }}
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {!searchQuery.trim() && (
                <div style={{ padding: "24px 16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>Start typing to search…</div>
              )}
              {searchQuery.trim() && (() => {
                const results = getSearchResults();
                if (results.length === 0) return (
                  <div style={{ padding: "24px 16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>No results for "{searchQuery}".</div>
                );
                return ["Characters", "Relationships", "Chapters", "Notes"].map(group => {
                  const gr = results.filter(r => r.type === group);
                  if (gr.length === 0) return null;
                  return (
                    <div key={group}>
                      <div style={{ padding: "10px 16px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555", borderBottom: "1px solid #1e1e1e" }}>{group}</div>
                      {gr.map(r => (
                        <div
                          key={r.id}
                          style={{ ...styles.listItem, ...(selected === r.id ? styles.listItemActive : {}) }}
                          onClick={() => { setSection(r.type); setSelected(r.id); setCharTab("detail"); }}
                        >
                          {r.type === "Characters" && <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.color || "#888", marginRight: 10, flexShrink: 0 }} />}
                          <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500, fontSize: 14, color: selected === r.id ? "#7dd3fc" : "#b0a090" }}>{r.label}</div>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        ) : (
          <>
            {/* per-section search */}
            <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e1e1e" }}>
              <input
                value={listSearchQuery}
                onChange={e => setListSearchQuery(e.target.value)}
                placeholder={`Search ${section.toLowerCase()}…`}
                style={{ ...styles.formInput, fontSize: 12, padding: "5px 10px" }}
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {(() => {
                const q = listSearchQuery.trim().toLowerCase();
                const filtered = q ? items.filter(item => {
                  if (section === "Relationships") {
                    return (charMap[item.charA]?.name || "").toLowerCase().includes(q) ||
                           (charMap[item.charB]?.name || "").toLowerCase().includes(q);
                  }
                  return (item.name || item.title || "").toLowerCase().includes(q);
                }) : items;

                if (filtered.length === 0) return (
                  <div style={{ padding: "24px 16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>
                    {q ? `No results for "${listSearchQuery}".` : "Nothing here yet."}
                  </div>
                );

                const SECTION_KEY = { Characters: "characters", Chapters: "chapters", Notes: "notes", Outline: "outlines", Relationships: "relationships", Timeline: "chapters" };
                const sorted = [...filtered].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
                return sorted.map(item => {
                  const isActive  = selected === item.id;
                  const isDragging = draggingId === item.id;
                  const isOver    = dragOverId === item.id && draggingId !== item.id;
                  let label = item.name || item.title || "Untitled";
                  if (section === "Relationships") {
                    const cA = charMap[item.charA], cB = charMap[item.charB];
                    label = `${cA?.name || "?"} & ${cB?.name || "?"}`;
                  }
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => setDraggingId(item.id)}
                      onDragOver={e => { e.preventDefault(); setDragOverId(item.id); }}
                      onDrop={e => { e.preventDefault(); reorderItems(draggingId, item.id); setDraggingId(null); setDragOverId(null); }}
                      onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                      onClick={e => { if (e.ctrlKey || e.metaKey) { openNewTab(section, item.id); } else { setSelected(item.id); setCharTab("detail"); } }}
                      style={{
                        ...styles.listItem,
                        ...(isActive ? styles.listItemActive : {}),
                        opacity: isDragging ? 0.4 : 1,
                        borderTop: isOver ? "2px solid #ff1d8e" : undefined,
                        cursor: "grab",
                      }}
                    >
                      {section === "Characters" && <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color || "#888", marginRight: 10, flexShrink: 0 }} />}
                      <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: isActive ? 700 : 500, fontSize: 15, color: isActive ? "#7dd3fc" : "#b0a090", flex: 1 }}>{label}</div>
                      {(section === "Chapters" || section === "Timeline") && item.status && <div style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLOR[item.status] || "#555", flexShrink: 0 }} />}
                      <button onClick={e => { e.stopPropagation(); const k = SECTION_KEY[section]; if (k) updateField(k, item.id, "pinned", !item.pinned); }} style={{ background: "none", border: "none", color: item.pinned ? "#ff1d8e" : "#2a2a2a", cursor: "pointer", fontSize: 12, padding: "0 2px", flexShrink: 0, lineHeight: 1 }}>●</button>
                    </div>
                  );
                });
              })()}
            </div>
          </>
        )}
      </div>

      {/* detail panel + tab bar + pane grid */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* global bar: tabs + undo + pane layout */}
        <div style={{ display: "flex", alignItems: "center", background: "#0d0d0d", borderBottom: "2px solid #1e1e1e", overflowX: "auto", flexShrink: 0, minHeight: 38 }}>
          {tabs.map(tab => (
            <div key={tab.id} onClick={() => switchTab(tab.id)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px", height: 38, cursor: "pointer", flexShrink: 0, maxWidth: 180, background: tab.id === activeTabId ? "#141414" : "transparent", borderBottom: tab.id === activeTabId ? "2px solid #ff1d8e" : "2px solid transparent", borderRight: "1px solid #1e1e1e" }}>
              <span style={{ fontSize: 12, color: tab.id === activeTabId ? "#c9b99a" : "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{tab.label}</span>
              <button onClick={e => closeTab(tab.id, e)} style={{ background: "none", border: "none", color: tab.id === activeTabId ? "#888" : "#333", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
            </div>
          ))}
          <button onClick={() => openNewTab()} title="New tab" style={{ padding: "0 14px", height: 38, background: "none", border: "none", borderRight: "1px solid #1e1e1e", color: "#555", cursor: "pointer", fontSize: 20, lineHeight: 1, flexShrink: 0 }}>+</button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4, padding: "0 10px", flexShrink: 0, alignItems: "center" }}>
            <button onClick={undo} title="Undo (Ctrl+Z)" style={{ background: "none", border: "1px solid #2a2a2a", color: "#555", cursor: "pointer", fontSize: 12, padding: "2px 8px", borderRadius: 4, fontFamily: "'Fredoka', sans-serif" }}>↩ Undo</button>
            <button onClick={redo} title="Redo (Ctrl+Y)" style={{ background: "none", border: "1px solid #2a2a2a", color: "#555", cursor: "pointer", fontSize: 12, padding: "2px 8px", borderRadius: 4, fontFamily: "'Fredoka', sans-serif" }}>↪ Redo</button>
            <div style={{ width: 1, height: 20, background: "#2a2a2a", margin: "0 4px" }} />
            {[['single','□'],['h2','⬜⬜'],['v2','▬▬'],['quad','⊞']].map(([layout, icon]) => (
              <button key={layout} onClick={() => changePaneLayout(layout)} title={layout}
                style={{ background: paneLayout === layout ? "#1a1a1a" : "none", border: `1px solid ${paneLayout === layout ? "#ff1d8e" : "#2a2a2a"}`, color: paneLayout === layout ? "#ff1d8e" : "#555", cursor: "pointer", fontSize: 11, padding: "2px 7px", borderRadius: 4 }}>
                {icon}
              </button>
            ))}
          </div>
        </div>
        {/* pane grid */}
        {(() => {
          const positions = PANE_POSITIONS[paneLayout] || ['tl'];
          const gridStyle = {
            single: { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' },
            h2:     { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' },
            v2:     { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' },
            quad:   { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' },
          }[paneLayout] || {};
          const isFullDetail = (sec, sel) => ((['Chapters','Timeline','Notes','Outline'].includes(sec) && sel) || sec === 'Home' || sec === 'Timeline' || sec === 'Map');
          return (
            <div style={{ flex: 1, display: "grid", overflow: "hidden", ...gridStyle }}>
              {positions.map(pos => {
                const isActive = pos === activePanePos;
                const paneSec = isActive ? section : paneContents[pos].section;
                const paneSel = isActive ? selected : paneContents[pos].itemId;
                const paneFullDetail = isFullDetail(paneSec, paneSel);
                return (
                  <div key={pos} style={{ display: "flex", flexDirection: "column", overflow: "hidden", border: isActive && paneLayout !== 'single' ? "2px solid #3a0a2e" : "1px solid #1e1e1e", position: "relative" }}>
                    {/* pane header bar (only in multi-pane) */}
                    {paneLayout !== 'single' && (
                      <div
                        draggable
                        onDragStart={() => setDraggingPane(pos)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => { if (draggingPane && draggingPane !== pos) swapPanes(draggingPane, pos); setDraggingPane(null); }}
                        onDragEnd={() => setDraggingPane(null)}
                        onClick={() => activatePane(pos)}
                        style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", background: isActive ? "#1a0a2e" : "#0d0d0d", borderBottom: "1px solid #1e1e1e", cursor: isActive ? "grab" : "pointer", flexShrink: 0 }}>
                        {isActive && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff1d8e", flexShrink: 0 }} />}
                        <span style={{ fontSize: 11, color: isActive ? "#c9b99a" : "#444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontFamily: "'Fredoka', sans-serif" }}>{paneLabel(pos)}</span>
                      </div>
                    )}
                    {/* pane content */}
                    {isActive ? (
                      <div style={{ ...styles.detailPanel, flex: 1, ...(paneFullDetail ? { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" } : {}) }}>
                        {renderDetail()}
                      </div>
                    ) : (
                      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", cursor: "default" }} onClick={() => activatePane(pos)}>
                        {renderReadOnly(pos)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

        {renderModal()}
      {renderStoryModal()}

      {/* traits modal */}
      {showTraitsModal && currentStory && (() => {
        const c = currentStory.characters.find(x => x.id === selected);
        if (!c) return null;
        return (
          <div style={styles.overlay} onClick={() => setShowTraitsModal(false)}>
            <div style={{ ...styles.modalBox, width: 560 }} onClick={e => e.stopPropagation()}>
              <h3 style={{ fontFamily: "'Bangers', cursive", fontSize: 28, letterSpacing: "0.04em", color: "#ff1d8e", marginBottom: 8, borderBottom: "2px dashed #3a0a2e", paddingBottom: 12 }}>
                Character Traits
              </h3>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>Click to toggle. Selected traits show in orange.</div>
              <TraitSelector
                traits={c.traits || []}
                onEdit={v => updateField("characters", c.id, "traits", v)}
              />
              <div style={{ borderTop: "1px solid #2a2a2a", paddingTop: 16 }}>
                <button style={styles.addBtn} onClick={() => setShowTraitsModal(false)}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* character deletion confirmation modal */}
      {itemToDelete && (
        <div style={styles.overlay} onClick={() => setItemToDelete(null)}>
          <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Bangers', cursive", fontSize: 28, letterSpacing: "0.04em", color: "#ff1d8e", marginBottom: 20, borderBottom: "2px dashed #3a0a2e", paddingBottom: 12 }}>
              Delete {itemToDelete.type.charAt(0).toUpperCase() + itemToDelete.type.slice(1)}
            </h3>
            <div style={{ fontSize: 14, color: "#c9b99a", marginBottom: 24 }}>
              Are you sure you want to delete "{itemToDelete.name}"?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={{ background: "none", border: "1px solid #333", color: "#888", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12 }} onClick={() => setItemToDelete(null)}>Keep</button>
              <button style={{ background: "#ff1d8e", border: "2px solid #3a0a2e", color: "#0d0d0d", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12 }} onClick={() => {
                if (itemToDelete.type === "character") {
                  deleteItem("characters", itemToDelete.id);
                } else if (itemToDelete.type === "relationship") {
                  deleteItem("relationships", itemToDelete.id);
                } else if (itemToDelete.type === "chapter") {
                  deleteItem("chapters", itemToDelete.id);
                } else if (itemToDelete.type === "note") {
                  deleteItem(itemToDelete.collKey || "notes", itemToDelete.id);
                } else if (itemToDelete.type === "sub-note") {
                  deleteSubNote(itemToDelete.noteId, itemToDelete.id, itemToDelete.collKey || "notes");
                } else if (itemToDelete.type === "outline block") {
                  deleteOutlineBlock(itemToDelete.charId, itemToDelete.id);
                }
                setItemToDelete(null);
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {renderImportModal()}

      {/* PDF import preview */}
      {pdfPreview && (() => {
        const TYPE_META = {
          chapter:      { label: "Chapter",   color: "#7dd3fc", icon: "📄" },
          character:    { label: "Character", color: "#ff1d8e", icon: "👤" },
          note:         { label: "Note",      color: "#c9b99a", icon: "📝" },
          relationship: { label: "Relation",  color: "#a78bfa", icon: "↔"  },
          skip:         { label: "Skip",      color: "#444",    icon: "—"  },
        };
        const allItems = pdfPreview.items;
        const tabCounts = PDF_TYPE_CYCLE.reduce((acc, t) => { acc[t] = allItems.filter(i => i.type === t).length; return acc; }, {});
        const visible = pdfTab === "all" ? allItems : allItems.filter(i => i.type === pdfTab);
        const allVisibleSelected = visible.length > 0 && visible.every(i => selectedPdfItems.has(i.id));
        const toggleAll = () => {
          if (allVisibleSelected) {
            setSelectedPdfItems(prev => { const n = new Set(prev); visible.forEach(i => n.delete(i.id)); return n; });
          } else {
            setSelectedPdfItems(prev => { const n = new Set(prev); visible.forEach(i => n.add(i.id)); return n; });
          }
        };
        const importCount = allItems.filter(i => i.type !== "skip").length;
        return (
          <div style={styles.overlay} onClick={() => { setPdfPreview(null); setSelectedPdfItems(new Set()); }}>
            <div style={{ ...styles.modalBox, width: 580, maxHeight: "85vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>

              {/* header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, borderBottom: "2px dashed #3a0a2e", paddingBottom: 12, flexShrink: 0 }}>
                <h3 style={{ fontFamily: "'Bangers', cursive", fontSize: 26, letterSpacing: "0.04em", color: "#ff1d8e", margin: 0 }}>PDF Import</h3>
                <span style={{ background: "#3a0a2e", color: "#c050a0", border: "1px solid #c050a0", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{pdfPreview.format}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>{pdfPreview.fileName}</span>
              </div>

              {/* tab filter */}
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexShrink: 0, flexWrap: "wrap" }}>
                {[["all", "All", "#888"], ...PDF_TYPE_CYCLE.map(t => [t, TYPE_META[t].label, TYPE_META[t].color])].map(([key, label, color]) => {
                  const count = key === "all" ? allItems.length : tabCounts[key];
                  const active = pdfTab === key;
                  return (
                    <button key={key} onClick={() => { setPdfTab(key); setSelectedPdfItems(new Set()); }}
                      style={{ background: active ? color + "22" : "none", border: `2px solid ${active ? color : "#333"}`, color: active ? color : "#666", padding: "4px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }}>
                      {label} <span style={{ opacity: 0.7 }}>{count}</span>
                    </button>
                  );
                })}
              </div>

              {/* select-all row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 2px", marginBottom: 6, flexShrink: 0 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "#888" }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} style={{ cursor: "pointer" }} />
                  Select all ({visible.length})
                </label>
                {selectedPdfItems.size > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#888" }}>{selectedPdfItems.size} selected →</span>
                    {PDF_TYPE_CYCLE.map(t => (
                      <button key={t} onClick={() => reclassifyPdfItems(selectedPdfItems, t)}
                        style={{ background: TYPE_META[t].color + "22", border: `1px solid ${TYPE_META[t].color}`, color: TYPE_META[t].color, padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }}>
                        {TYPE_META[t].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* item list */}
              <div style={{ flex: 1, overflowY: "auto", background: "#0d0d0d", border: "1px solid #2a2a2a", borderRadius: 8, padding: "6px 10px", marginBottom: 16 }}>
                {visible.length === 0 && <div style={{ color: "#555", fontSize: 13, padding: "12px 4px" }}>Nothing here.</div>}
                {visible.map(item => {
                  const meta = TYPE_META[item.type];
                  const label = item.name || item.title;
                  const checked = selectedPdfItems.has(item.id);
                  return (
                    <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderBottom: "1px solid #1a1a1a" }}>
                      <input type="checkbox" checked={checked} onChange={() => {
                        setSelectedPdfItems(prev => { const n = new Set(prev); checked ? n.delete(item.id) : n.add(item.id); return n; });
                      }} style={{ cursor: "pointer", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{meta.icon}</span>
                      <span style={{ fontSize: 13, color: "#c9b99a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                      <button onClick={() => cyclePdfItemType(item.id)}
                        style={{ background: meta.color + "22", border: `1px solid ${meta.color}`, color: meta.color, padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", flexShrink: 0 }}>
                        {meta.label}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* footer */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", flexShrink: 0 }}>
                <button style={{ background: "none", border: "1px solid #333", color: "#888", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "'Fredoka', sans-serif" }} onClick={() => { setPdfPreview(null); setSelectedPdfItems(new Set()); }}>Cancel</button>
                <button style={{ ...styles.addBtn, background: "#1a0a2e", border: "2px solid #c050a0", color: "#c050a0" }} onClick={() => applyPDFImport(false)}>Add to "{currentStory?.title}" ({importCount})</button>
                <button style={styles.addBtn} onClick={() => applyPDFImport(true)}>New Story ({importCount})</button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* link picker modal */}
      {linkPicker && currentStory && (() => {
        const LINK_SECTIONS = ["Characters", "Chapters", "Notes", "Outline", "Relationships"];
        const sectionItems = {
          Characters:    currentStory.characters || [],
          Chapters:      currentStory.chapters || [],
          Notes:         currentStory.notes || [],
          Outline:       currentStory.outlines || [],
          Relationships: currentStory.relationships || [],
        };
        const q = linkPickerQuery.toLowerCase();
        const raw = sectionItems[linkPickerSection] || [];
        const filtered = raw.filter(item => {
          if (linkPickerSection === "Relationships") {
            const cA = (currentStory.characters || []).find(c => c.id === item.charA);
            const cB = (currentStory.characters || []).find(c => c.id === item.charB);
            return !q || (cA?.name || "").toLowerCase().includes(q) || (cB?.name || "").toLowerCase().includes(q);
          }
          return !q || (item.name || item.title || "").toLowerCase().includes(q);
        });
        return (
          <div style={styles.overlay} onClick={() => setLinkPicker(null)}>
            <div style={{ ...styles.modalBox, width: 480 }} onClick={e => e.stopPropagation()}>
              <div style={{ fontFamily: "'Bangers', cursive", fontSize: 24, letterSpacing: "0.05em", color: "#7dd3fc", marginBottom: 14, borderBottom: "2px dashed #2a2a2a", paddingBottom: 12 }}>Insert Link</div>
              <input autoFocus value={linkPickerQuery} onChange={e => setLinkPickerQuery(e.target.value)} placeholder="Search…"
                style={{ ...styles.formInput, fontSize: 13, marginBottom: 12 }} />
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {LINK_SECTIONS.map(s => (
                  <button key={s} onClick={() => setLinkPickerSection(s)}
                    style={{ background: linkPickerSection === s ? "#7dd3fc22" : "none", border: `1px solid ${linkPickerSection === s ? "#7dd3fc" : "#333"}`, color: linkPickerSection === s ? "#7dd3fc" : "#666", padding: "3px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>
                    {s}
                  </button>
                ))}
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto", background: "#0d0d0d", border: "1px solid #2a2a2a", borderRadius: 8 }}>
                {filtered.length === 0 && <div style={{ padding: "16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>Nothing found.</div>}
                {filtered.map(item => {
                  let label = item.name || item.title || "Untitled";
                  if (linkPickerSection === "Relationships") {
                    const cA = (currentStory.characters || []).find(c => c.id === item.charA);
                    const cB = (currentStory.characters || []).find(c => c.id === item.charB);
                    label = `${cA?.name || "?"} & ${cB?.name || "?"}`;
                  }
                  return (
                    <div key={item.id} onClick={() => { linkPicker.onInsert(`[[${label}|${linkPickerSection}|${item.id}]]`); setLinkPicker(null); }}
                      style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #1a1a1a", fontFamily: "'Fredoka', sans-serif", fontSize: 14, color: "#c9b99a", display: "flex", alignItems: "center", gap: 8 }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1a1a2e"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      {linkPickerSection === "Characters" && <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color || "#888", flexShrink: 0 }} />}
                      {label}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 14, textAlign: "right" }}>
                <button style={{ background: "none", border: "1px solid #333", color: "#888", padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "'Fredoka', sans-serif" }} onClick={() => setLinkPicker(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* close-app backup prompt */}
      {showCloseModal && (
        <div style={{ ...styles.overlay, zIndex: 9999 }}>
          <div style={{ ...styles.modalBox, textAlign: "center", maxWidth: 360 }}>
            <h3 style={{ fontFamily: "'Bangers', cursive", fontSize: 30, letterSpacing: "0.06em", color: "#ff1d8e", marginBottom: 12, borderBottom: "2px dashed #3a0a2e", paddingBottom: 12 }}>
              Before You Go
            </h3>
            <p style={{ fontSize: 14, color: "#c9b99a", marginBottom: 24, lineHeight: 1.6 }}>
              Save a backup before closing?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                style={{ background: "#7dd3fc", border: "2px solid #3a6a8a", color: "#0d0d0d", padding: "10px 16px", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }}
                onClick={async () => { await exportBackup(); window.electronAPI.confirmClose(); }}
              >
                Save Backup &amp; Close
              </button>
              <button
                style={{ background: "none", border: "1px solid #333", color: "#888", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "'Fredoka', sans-serif" }}
                onClick={() => window.electronAPI.confirmClose()}
              >
                Close Without Saving
              </button>
              <button
                style={{ background: "none", border: "none", color: "#555", padding: "4px", cursor: "pointer", fontSize: 12, fontFamily: "'Fredoka', sans-serif" }}
                onClick={() => setShowCloseModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── sub-components ─────────────────────────────────────────────────────────────

const LINK_RE = /\[\[([^\|\]]+)\|([^\|\]]+)\|([^\]]+)\]\]/g;

function parseAndRenderLinks(text, onNavigate) {
  const parts = [];
  let last = 0, key = 0;
  const re = new RegExp(LINK_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const [, name, sec, id] = m;
    parts.push(
      <button key={key++} onClick={() => onNavigate?.(sec, id)}
        style={{ background: "#0d1428", border: "2px solid #7dd3fc", color: "#7dd3fc", padding: "1px 9px", borderRadius: 5, cursor: "pointer", fontSize: 13, fontFamily: "'Fredoka', sans-serif", fontWeight: 600, margin: "0 3px", verticalAlign: "middle" }}>
        🔗 {name}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

function ChapterEditor({ content, onSave, requestLink, onNavigate }) {
  const [v, setV] = useState(content);
  const [preview, setPreview] = useState(false);
  const taRef = useRef(null);
  useEffect(() => { setV(content); }, [content]);

  const hasLinks = LINK_RE.test(v);
  LINK_RE.lastIndex = 0;
  const wordCount = v.trim() ? v.trim().split(/\s+/).length : 0;

  function handleInsertLink() {
    const pos = taRef.current?.selectionStart ?? v.length;
    requestLink(linkText => {
      const next = v.slice(0, pos) + linkText + v.slice(pos);
      setV(next);
      onSave(next);
      setTimeout(() => {
        taRef.current?.focus();
        const end = pos + linkText.length;
        taRef.current?.setSelectionRange(end, end);
      }, 30);
    });
  }

  const showToolbar = requestLink || hasLinks;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {showToolbar && (
        <div style={{ display: "flex", gap: 8, padding: "5px 10px", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
          {requestLink && !preview && (
            <button onClick={handleInsertLink}
              style={{ background: "none", border: "1px solid #3a3a3a", color: "#7dd3fc", padding: "2px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }}>
              🔗 Link
            </button>
          )}
          <span style={{ fontSize: 11, color: "#444", marginLeft: "auto" }}>{wordCount.toLocaleString()} words</span>
          {(hasLinks || preview) && (
            <button onClick={() => setPreview(p => !p)}
              style={{ background: preview ? "#7dd3fc22" : "none", border: "1px solid #3a3a3a", color: "#7dd3fc", padding: "2px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }}>
              {preview ? "Edit" : "Preview"}
            </button>
          )}
        </div>
      )}
      {preview ? (
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "#111", border: "2px solid #2a2a2a", borderRadius: 10, color: "#c9b99a", fontSize: 15, fontFamily: "'Fredoka', sans-serif", lineHeight: 1.8, whiteSpace: "pre-wrap", boxSizing: "border-box" }}>
          {parseAndRenderLinks(v, onNavigate)}
        </div>
      ) : (
        <textarea
          ref={taRef}
          value={v}
          onChange={e => setV(e.target.value)}
          onBlur={() => onSave(v)}
          placeholder="Start writing…"
          style={{ flex: 1, background: "#111", border: "2px solid #2a2a2a", borderRadius: 10, padding: "20px 24px", color: "#c9b99a", fontSize: 15, fontFamily: "'Fredoka', sans-serif", lineHeight: 1.8, resize: "none", outline: "none", width: "100%", boxSizing: "border-box" }}
        />
      )}
    </div>
  );
}

function EditableText({ val, style, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(val);
  if (editing) return (
    <input autoFocus value={v} onChange={e => setV(e.target.value)}
      onBlur={() => { onEdit(v); setEditing(false); }}
      onKeyDown={e => { if (e.key === "Enter") { onEdit(v); setEditing(false); } }}
      style={{ ...style, background: "#1a1a1a", border: "1px solid #444", borderRadius: 4, padding: "2px 6px", color: "#e8d9c0", width: "100%", outline: "none" }} />
  );
  return <div style={{ ...style, cursor: "text" }} onClick={() => { setV(val); setEditing(true); }} title="Click to edit">{val}</div>;
}

function EditableArea({ val, style, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(val);
  if (editing) return (
    <textarea autoFocus value={v} onChange={e => setV(e.target.value)}
      onBlur={() => { onEdit(v); setEditing(false); }}
      style={{ ...style, background: "#1a1a1a", border: "1px solid #444", borderRadius: 4, padding: "8px", color: "#c9b99a", width: "100%", resize: "vertical", outline: "none", fontFamily: "inherit", lineHeight: 1.6 }} />
  );
  return <div style={{ ...style, cursor: "text", whiteSpace: "pre-wrap" }} onClick={() => { setV(val); setEditing(true); }} title="Click to edit">{val || <span style={{ color: "#555", fontStyle: "italic" }}>Click to add…</span>}</div>;
}

function CharBadge({ c }) {
  if (!c) return <span style={{ color: "#555" }}>Unknown</span>;
  return <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div style={{ width: 10, height: 10, borderRadius: "50%", background: c.color }} />
    <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: "#7dd3fc", fontSize: 16 }}>{c.name}</span>
  </span>;
}

function Label({ children }) {
  return <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#666", marginBottom: 6 }}>{children}</div>;
}

function FormField({ label, value, onChange }) {
  return <div style={{ marginBottom: 12 }}>
    <label style={styles.formLabel}>{label}</label>
    <input value={value} onChange={e => onChange(e.target.value)} style={styles.formInput} />
  </div>;
}

function FormTextarea({ label, value, onChange }) {
  return <div style={{ marginBottom: 12 }}>
    <label style={styles.formLabel}>{label}</label>
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={4} style={{ ...styles.formInput, resize: "vertical" }} />
  </div>;
}

function OutlineEditor({ outline, charId, onUpdate, onAdd, onReorder, onRequestDelete }) {
  const dragFrom = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  return (
    <div>
      {outline.length === 0 && (
        <div style={{ color: "#555", fontStyle: "italic", fontSize: 14, marginBottom: 24 }}>No blocks yet — add one below.</div>
      )}
      {outline.map((block, idx) => (
        <div
          key={block.id}
          draggable
          onDragStart={e => {
            dragFrom.current = idx;
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOverIdx !== idx) setDragOverIdx(idx);
          }}
          onDragLeave={() => setDragOverIdx(null)}
          onDrop={e => {
            e.preventDefault();
            const from = dragFrom.current;
            setDragOverIdx(null);
            dragFrom.current = null;
            if (from === null || from === idx) return;
            onReorder(charId, from, idx);
          }}
          onDragEnd={() => { setDragOverIdx(null); dragFrom.current = null; }}
          style={{
            background: "#161616",
            border: `2px solid ${dragOverIdx === idx ? "#ff1d8e" : "#2a2a2a"}`,
            borderRadius: 10,
            padding: "12px 14px 12px",
            marginBottom: 12,
            boxShadow: dragOverIdx === idx ? "0 0 0 2px #ff1d8e40" : "2px 2px 0 #0d0d0d",
            transition: "border-color 0.1s, box-shadow 0.1s",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div
              title="Drag to reorder"
              style={{ cursor: "grab", color: "#444", fontSize: 18, lineHeight: 1, userSelect: "none", paddingRight: 8 }}
            >⠿</div>
            <button
              onClick={() => onRequestDelete(block)}
              style={{ background: "#1a0828", border: "2px solid #ff1d8e", color: "#ff1d8e", width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}
            >×</button>
          </div>
          <EditableArea
            val={block.text}
            style={{ ...styles.detailBody, minHeight: 80, marginBottom: 0 }}
            onEdit={v => onUpdate(charId, block.id, v)}
          />
        </div>
      ))}
      <button style={{ ...styles.addBtn, marginTop: 8 }} onClick={() => onAdd(charId)}>+ Add Block</button>
    </div>
  );
}

function ColorFieldWithHistory({ label, value, prevValue, onEdit }) {
  const current = value || "#888888";
  const showPrev = prevValue && prevValue !== current;
  return (
    <div style={{ marginBottom: 20 }}>
      <Label>{label}</Label>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <input
          type="color"
          value={current}
          onChange={e => onEdit(e.target.value)}
          style={{ width: 44, height: 36, padding: 0, cursor: "pointer", background: "none", border: "none" }}
        />
        <div style={{ width: 32, height: 32, borderRadius: 8, background: current, border: "2px solid #333", boxShadow: "2px 2px 0 #0a0a0a", flexShrink: 0 }} title="Current" />
        {showPrev && <>
          <span style={{ color: "#555", fontSize: 18, fontWeight: 700, lineHeight: 1 }}>←</span>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: prevValue, border: "1px solid #444", opacity: 0.55, flexShrink: 0 }} title="Previous colour" />
        </>}
        <span style={{ fontSize: 11, color: "#666", fontFamily: "monospace", letterSpacing: "0.04em" }}>{current}</span>
      </div>
    </div>
  );
}

function HairstyleInput({ hairstyles, onEdit }) {
  const [draft, setDraft] = useState("");

  function confirm() {
    const trimmed = draft.trim();
    if (!trimmed || hairstyles.includes(trimmed)) return;
    onEdit([...hairstyles, trimmed]);
    setDraft("");
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {hairstyles.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {hairstyles.map(h => (
            <div key={h} style={{ display: "flex", alignItems: "center", gap: 6, background: "#1a1a1a", border: "2px solid #2a2a2a", borderRadius: 20, padding: "4px 8px 4px 12px" }}>
              <span style={{ fontSize: 13, color: "#c9b99a", fontWeight: 500, fontFamily: "'Fredoka', sans-serif" }}>{h}</span>
              <button onClick={() => onEdit(hairstyles.filter(x => x !== h))} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px", fontWeight: 700 }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }}
          placeholder="Type a hairstyle and press Enter…"
          style={{ ...styles.formInput, flex: 1 }}
        />
        <button onClick={confirm} style={{ ...styles.addBtn, padding: "8px 16px" }}>Add</button>
      </div>
    </div>
  );
}

function TraitSelector({ traits, onEdit }) {
  function toggle(trait) {
    const next = traits.includes(trait)
      ? traits.filter(t => t !== trait)
      : [...traits, trait];
    onEdit(next);
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
      {CHARACTER_TRAITS.map(trait => {
        const active = traits.includes(trait);
        return (
          <button
            key={trait}
            onClick={() => toggle(trait)}
            style={{
              background: active ? "#ff1d8e" : "#1a1a1a",
              border: `2px solid ${active ? "#ff1d8e" : "#2a2a2a"}`,
              color: active ? "#0d0d0d" : "#777",
              padding: "5px 13px",
              borderRadius: 20,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              fontFamily: "'Fredoka', sans-serif",
              boxShadow: active ? "2px 2px 0 #3a0a2e" : "none",
              transition: "all 0.12s",
            }}
          >
            {trait}
          </button>
        );
      })}
    </div>
  );
}

// ── styles ─────────────────────────────────────────────────────────────────────
const styles = {
  root: { display: "flex", height: "100vh", background: "#111", fontFamily: "'Fredoka', sans-serif", color: "#c9b99a", overflow: "hidden" },
  sidebar: { width: 200, background: "#0d0d0d", borderRight: "3px solid #2a2a2a", display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0 },
  brand: { fontFamily: "'Bangers', cursive", fontSize: 34, letterSpacing: "0.08em", color: "#ff1d8e", padding: "0 20px 20px", borderBottom: "3px dashed #3a0a2e", marginBottom: 18, textAlign: "center", textShadow: "3px 3px 0 #3a0a2e" },
  navBtn: { background: "none", border: "none", textAlign: "left", padding: "12px 20px", cursor: "pointer", fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", fontFamily: "'Fredoka', sans-serif", transition: "color 0.2s, transform 0.15s" },
  navActive: { color: "#ff1d8e", borderLeft: "4px solid #ff1d8e", background: "#280820" },
  list: { width: 230, background: "#141414", borderRight: "3px solid #1e1e1e", display: "flex", flexDirection: "column", flexShrink: 0 },
  listHeader: { padding: "20px 16px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px dashed #2a2a2a" },
  listTitle: { fontFamily: "'Bangers', cursive", fontSize: 24, letterSpacing: "0.05em", color: "#7dd3fc", textShadow: "2px 2px 0 #0a203a" },
  plusBtn: { background: "#ff1d8e", border: "2px solid #3a0a2e", color: "#0d0d0d", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 20, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "2px 2px 0 #3a0a2e", transition: "transform 0.1s" },
  listItem: { display: "flex", alignItems: "center", padding: "14px 16px", cursor: "pointer", borderBottom: "2px solid #1a1a1a", transition: "background 0.15s, transform 0.1s" },
  listItemActive: { background: "#0d1028", borderLeft: "4px solid #ff1d8e" },
  detailPanel: { flex: 1, overflowY: "auto", padding: "32px 40px" },
  detail: { maxWidth: 660 },
  detailTitle: { fontFamily: "'Bangers', cursive", fontSize: 44, letterSpacing: "0.03em", color: "#ff1d8e", marginBottom: 20, textShadow: "3px 3px 0 #3a0a2e" },
  detailSub: { fontSize: 13, color: "#888", marginBottom: 20, letterSpacing: "0.05em" },
  detailBody: { fontSize: 15, color: "#c9b99a", lineHeight: 1.7, marginBottom: 28, minHeight: 60, fontWeight: 400 },
  relCard: { background: "#0a1428", border: "2px solid #1a2840", borderRadius: 12, padding: "14px 16px", marginBottom: 14, boxShadow: "3px 3px 0 #0d0d0d" },
  empty: { color: "#555", fontStyle: "italic", fontSize: 15, marginTop: 48, fontWeight: 500 },
  deleteBtn: { background: "#1a0a2e", border: "2px solid #ff1d8e", color: "#ff1d8e", padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, letterSpacing: "0.05em", marginTop: 16, boxShadow: "3px 3px 0 #3a0a2e", fontFamily: "'Fredoka', sans-serif" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modalBox: { background: "#161616", border: "3px solid #3a0a2e", borderRadius: 16, padding: 28, width: 460, maxWidth: "90vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "6px 6px 0 rgba(255,29,142,0.2)" },
  formLabel: { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 6 },
  formInput: { width: "100%", background: "#0d0d0d", border: "2px solid #333", borderRadius: 8, padding: "10px 12px", color: "#7dd3fc", fontSize: 15, fontFamily: "'Fredoka', sans-serif", fontWeight: 500, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", background: "#0d0d0d", border: "2px solid #333", borderRadius: 8, padding: "10px 12px", color: "#7dd3fc", fontSize: 15, fontFamily: "'Fredoka', sans-serif", fontWeight: 500, outline: "none", boxSizing: "border-box" },
  addBtn: { background: "#ff1d8e", border: "2px solid #3a0a2e", color: "#0d0d0d", padding: "10px 22px", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 700, letterSpacing: "0.05em", fontFamily: "'Fredoka', sans-serif", boxShadow: "3px 3px 0 #3a0a2e" },
  pdfBtn: { background: "#0a203a", border: "2px solid #7dd3fc", color: "#7dd3fc", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", fontFamily: "'Fredoka', sans-serif", boxShadow: "2px 2px 0 #0a1428", marginTop: 16 },
};
