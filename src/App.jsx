import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { parsePDFFile } from "./parsePDF.js";
import { uid, localDB } from "./storage.js";
import { exportChapterAsPDF, exportAllChaptersAsPDF, exportStoryAsPDF } from "./pdfExport.js";
import { SECTIONS, STATUS_CYCLE, STATUS_COLOR, ACT_CYCLE, TRASH_RETENTION_DAYS, styles } from "./constants.js";
import {
  LINK_RE, parseAndRenderLinks, renderRichPreview, ChapterEditor, PinIcon, FolderIcon,
  EditableText, EditableArea, CharBadge, Label, FormField, FormTextarea,
  OutlineEditor, ColorFieldWithHistory, HairstyleInput, TraitSelector,
} from "./components.jsx";

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
  const [charTabs, setCharTabs] = useState({}); // per-character Detail/Outline view, keyed by character id
  // Legacy navigation calls setCharTab("detail"); now a no-op so each character
  // keeps whichever sub-tab it was last on when you switch tabs/panes.
  const setCharTab = () => {};
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [storySearchQuery, setStorySearchQuery] = useState("");
  const [selectedSubNotes, setSelectedSubNotes] = useState({}); // open sub-note per note/outline group, keyed by group id
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
  const [draggingFolderId, setDraggingFolderId] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null); // folder id, or "root" for the section root
  const [dropZone, setDropZone] = useState(null); // { id, zone: 'before'|'after'|'inside' } during a folder-tree drag
  const [renamingItemFolderId, setRenamingItemFolderId] = useState(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null); // { format, fileName, items[] }
  const [pdfTab, setPdfTab] = useState("all");
  const [selectedPdfItems, setSelectedPdfItems] = useState(new Set());
  const pdfImportRef = useRef(null);
  const [lastBackupAt, setLastBackupAt] = useState(() => {
    const v = Number(localStorage.getItem('qwosid_lastBackupAt'));
    return v > 0 ? v : null;
  });
  const [focusChapterId, setFocusChapterId] = useState(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [searchTypeFilter, setSearchTypeFilter] = useState("All");
  const [searchStatusFilter, setSearchStatusFilter] = useState(null);

  // Load on mount (disk file first, localStorage fallback); purge expired trash
  useEffect(() => {
    localDB.load().then(({ stories: saved, currentStoryId: savedId, folders: savedFolders }) => {
      if (saved && saved.length > 0) {
        const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const purged = saved.map(s =>
          (s.trash || []).some(t => t.deletedAt <= cutoff)
            ? { ...s, trash: s.trash.filter(t => t.deletedAt > cutoff) }
            : s
        );
        setStories(purged);
        if (savedId && purged.find(s => s.id === savedId)) {
          setCurrentStoryId(savedId);
        }
      }
      if (savedFolders && savedFolders.length > 0) setFolders(savedFolders);
    });
  }, []);

  // Esc leaves focus mode
  useEffect(() => {
    if (!focusChapterId) return;
    const handler = e => { if (e.key === 'Escape') setFocusChapterId(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusChapterId]);

  // Reset sub-note selection when the selected note group changes
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
    window.electronAPI.onAutoBackup?.(() => exportBackup(true));
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
    OutlineTimeline: currentStory.outlines || [],
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

  // Soft delete: items move to the story's trash and stay restorable for
  // TRASH_RETENTION_DAYS (purged on app load).
  function deleteItem(collection, id) {
    const now = Date.now();
    setStories(stories.map(s => {
      if (s.id !== currentStoryId) return s;
      const item = (s[collection] || []).find(x => x.id === id);
      if (!item) return s;
      const trashed = [{ collection, item, deletedAt: now }];
      if (collection === "characters") {
        for (const r of s.relationships.filter(r => r.charA === id || r.charB === id)) {
          trashed.push({ collection: "relationships", item: r, deletedAt: now });
        }
      }
      return {
        ...s,
        [collection]: s[collection].filter(x => x.id !== id),
        ...(collection === "characters" ? {
          relationships: s.relationships.filter(r => r.charA !== id && r.charB !== id),
        } : {}),
        trash: [...(s.trash || []), ...trashed],
      };
    }));
    setSelected(null);
  }

  function restoreTrashItem(itemId) {
    setStories(stories.map(s => {
      if (s.id !== currentStoryId) return s;
      const entry = (s.trash || []).find(t => t.item.id === itemId);
      if (!entry) return s;
      return {
        ...s,
        [entry.collection]: [...(s[entry.collection] || []), entry.item],
        trash: s.trash.filter(t => t.item.id !== itemId),
      };
    }));
  }

  function purgeTrashItem(itemId) {
    setStories(stories.map(s =>
      s.id === currentStoryId ? { ...s, trash: (s.trash || []).filter(t => t.item.id !== itemId) } : s
    ));
  }

  function emptyTrash() {
    setStories(stories.map(s => s.id === currentStoryId ? { ...s, trash: [] } : s));
  }

  // ── chapter snapshots ──────────────────────────────────────────────────────
  const MAX_SNAPSHOTS = 20;

  function mutateChapter(chapterId, fn) {
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? { ...s, chapters: s.chapters.map(ch => ch.id === chapterId ? fn(ch) : ch) }
        : s
    ));
  }

  function snapOf(ch, label) {
    return { id: uid(), at: Date.now(), label: label || "", content: ch.content || "" };
  }

  function takeSnapshot(chapterId, label = "") {
    mutateChapter(chapterId, ch => ({ ...ch, snapshots: [...(ch.snapshots || []), snapOf(ch, label)].slice(-MAX_SNAPSHOTS) }));
  }

  // Restoring snapshots is itself reversible: current content is snapshotted first
  function restoreSnapshot(chapterId, snapId) {
    mutateChapter(chapterId, ch => {
      const snap = (ch.snapshots || []).find(x => x.id === snapId);
      if (!snap) return ch;
      return { ...ch, content: snap.content, snapshots: [...(ch.snapshots || []), snapOf(ch, "Before restore")].slice(-MAX_SNAPSHOTS) };
    });
  }

  function deleteSnapshot(chapterId, snapId) {
    mutateChapter(chapterId, ch => ({ ...ch, snapshots: (ch.snapshots || []).filter(x => x.id !== snapId) }));
  }

  // Status cycle; reaching Final auto-snapshots the chapter in the same update
  function cycleChapterStatus(chapterId) {
    mutateChapter(chapterId, ch => {
      const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(ch.status) + 1) % STATUS_CYCLE.length];
      const snaps = next === "Final" && (ch.content || "").trim()
        ? [...(ch.snapshots || []), snapOf(ch, "Marked Final")].slice(-MAX_SNAPSHOTS)
        : ch.snapshots;
      return { ...ch, status: next, ...(snaps !== ch.snapshots ? { snapshots: snaps } : {}) };
    });
  }

  function cycleChapterAct(chapterId) {
    mutateChapter(chapterId, ch => ({ ...ch, act: ACT_CYCLE[(ACT_CYCLE.indexOf(ch.act || "") + 1) % ACT_CYCLE.length] }));
  }

  // ── sub-note mutations ─────────────────────────────────────────────────────
  function addSubNote(noteId, collKey = "notes") {
    const sn = { id: uid(), title: "New Note", content: "" };
    setStories(stories.map(s =>
      s.id === currentStoryId
        ? { ...s, [collKey]: (s[collKey] || []).map(n => n.id === noteId ? { ...n, subnotes: [...(n.subnotes || []), sn] } : n) }
        : s
    ));
    setSelectedSubNotes(prev => ({ ...prev, [noteId]: sn.id }));
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
    setSelectedSubNotes(prev => ({ ...prev, [noteId]: null }));
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
        <div style={PROSE} dangerouslySetInnerHTML={{ __html: currentStory.homeContent || "" }} />
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
          <div style={PROSE} dangerouslySetInnerHTML={{ __html: ch.content || "" }} />
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
    const id = uid();
    setFolders(f => [...f, { id, name: "New Folder", collapsed: false }]);
    setRenamingFolderId(id);
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
  async function exportBackup(silent = false) {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), stories }, null, 2);
    try {
      if (window.electronAPI?.saveBackup) {
        const result = await window.electronAPI.saveBackup(payload);
        if (result?.ok) {
          const now = Date.now();
          setLastBackupAt(now);
          try { localStorage.setItem('qwosid_lastBackupAt', String(now)); } catch { /* indicator only */ }
        }
        if (!silent) {
          if (result?.ok) alert("Backup saved to:\n" + result.path);
          else alert("Backup failed: " + (result?.error || "unknown error"));
        }
        return !!result?.ok;
      } else if (!silent) {
        alert("Backup API not available — is the app running in Electron?");
      }
      return false;
    } catch (err) {
      if (!silent) alert("Backup error: " + err.message);
      return false;
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
    const keyMap = { Characters: "characters", Relationships: "relationships", Chapters: "chapters", Notes: "notes", Outline: "outlines", Timeline: "chapters", OutlineTimeline: "outlines" };
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

  // ── item folders (Characters / Notes / Outline; nestable) ───────────────────
  // Stored per-story in `itemFolders`: { id, name, section, parentId, collapsed }.
  // Items carry an optional `folderId`; missing/unknown folder = section root.
  const FOLDER_SECTIONS = ["Characters", "Notes", "Outline"];

  function itemFolders() { return currentStory?.itemFolders || []; }

  function mutateStory(fn) {
    setStories(stories.map(s => s.id === currentStoryId ? fn(s) : s));
  }

  function addItemFolder(sec, parentId = null) {
    const folder = { id: uid(), name: "New Folder", section: sec, parentId, collapsed: false };
    mutateStory(s => ({ ...s, itemFolders: [...(s.itemFolders || []), folder] }));
    setRenamingItemFolderId(folder.id);
  }

  function renameItemFolder(id, name) {
    if (!name.trim()) return;
    mutateStory(s => ({ ...s, itemFolders: (s.itemFolders || []).map(f => f.id === id ? { ...f, name: name.trim() } : f) }));
  }

  function toggleItemFolder(id) {
    mutateStory(s => ({ ...s, itemFolders: (s.itemFolders || []).map(f => f.id === id ? { ...f, collapsed: !f.collapsed } : f) }));
  }

  // Delete a folder; its child folders and items reparent to the folder's parent
  function deleteItemFolder(id, collKey) {
    mutateStory(s => {
      const folder = (s.itemFolders || []).find(f => f.id === id);
      if (!folder) return s;
      const up = folder.parentId || null;
      return {
        ...s,
        itemFolders: (s.itemFolders || []).filter(f => f.id !== id).map(f => f.parentId === id ? { ...f, parentId: up } : f),
        [collKey]: (s[collKey] || []).map(it => it.folderId === id ? { ...it, folderId: up } : it),
      };
    });
  }

  function moveItemToFolder(collKey, itemId, folderId) {
    mutateStory(s => ({ ...s, [collKey]: (s[collKey] || []).map(it => it.id === itemId ? { ...it, folderId: folderId || null } : it) }));
  }

  // Would moving `folderId` under `targetId` create a cycle?
  function isFolderDescendant(folders, folderId, targetId) {
    let cur = folders.find(f => f.id === targetId);
    while (cur) {
      if (cur.id === folderId) return true;
      cur = folders.find(f => f.id === cur.parentId);
    }
    return false;
  }

  function moveFolderToParent(folderId, parentId) {
    if (folderId === parentId) return;
    mutateStory(s => {
      const folders = s.itemFolders || [];
      if (parentId && isFolderDescendant(folders, folderId, parentId)) return s; // no cycles
      return { ...s, itemFolders: folders.map(f => f.id === folderId ? { ...f, parentId: parentId || null } : f) };
    });
  }

  // Unified drag-move for the folder tree: drop a folder or item before/after a
  // target (same level) or inside a folder. Reassigns level-scoped `order` to
  // both folders and items so they interleave; pinned items still float on top.
  function moveNode(dragId, dragKind, targetId, targetKind, zone, collKey) {
    mutateStory(s => {
      let folders = s.itemFolders || [];
      let coll = s[collKey] || [];
      const validF = () => new Set(folders.map(f => f.id));

      // resolve destination container (folder id, or null for section root)
      let container;
      if (zone === "inside" && targetKind === "folder") container = targetId;
      else if (targetId == null) container = null;
      else {
        const t = targetKind === "folder" ? folders.find(f => f.id === targetId) : coll.find(i => i.id === targetId);
        if (!t) return s;
        container = targetKind === "folder" ? (t.parentId || null) : (t.folderId || null);
      }

      if (dragKind === "folder") {
        if (dragId === container) return s;
        if (container && isFolderDescendant(folders, dragId, container)) return s; // no cycles
        folders = folders.map(f => f.id === dragId ? { ...f, parentId: container } : f);
      } else {
        coll = coll.map(i => i.id === dragId ? { ...i, folderId: container } : i);
      }

      // current ordering at the destination level, dragged removed
      const vf = validF();
      const containerOf = i => (i.folderId && vf.has(i.folderId)) ? i.folderId : null;
      const levelF = folders.filter(f => f.section === section && (f.parentId || null) === container);
      const levelI = coll.filter(i => containerOf(i) === container);
      let ordered = [...levelF, ...levelI]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(n => n.id)
        .filter(id => id !== dragId);

      if (zone === "inside" || targetId == null || zone === "end") {
        ordered.push(dragId);
      } else {
        const idx = ordered.indexOf(targetId);
        ordered.splice(idx < 0 ? ordered.length : (zone === "before" ? idx : idx + 1), 0, dragId);
      }

      const om = new Map(ordered.map((id, i) => [id, i]));
      folders = folders.map(f => om.has(f.id) ? { ...f, order: om.get(f.id) } : f);
      coll = coll.map(i => om.has(i.id) ? { ...i, order: om.get(i.id) } : i);
      return { ...s, itemFolders: folders, [collKey]: coll };
    });
  }

  // ── search ─────────────────────────────────────────────────────────────────
  function getSearchResults() {
    if (!currentStory || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const want = type => searchTypeFilter === "All" || searchTypeFilter === type;
    const results = [];
    if (want("Characters")) currentStory.characters.forEach(c => {
      if ([c.name, c.role, c.bio, c.ethnicity, ...(c.traits || [])].some(f => f?.toLowerCase().includes(q))) {
        results.push({ type: "Characters", id: c.id, label: c.name || "Unnamed", color: c.color });
      }
    });
    if (want("Relationships")) currentStory.relationships.forEach(r => {
      const cA = charMap[r.charA], cB = charMap[r.charB];
      const label = `${cA?.name || "?"} & ${cB?.name || "?"}`;
      if (label.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)) {
        results.push({ type: "Relationships", id: r.id, label });
      }
    });
    if (want("Chapters")) currentStory.chapters.forEach(c => {
      if (searchStatusFilter && c.status !== searchStatusFilter) return;
      if (c.title?.toLowerCase().includes(q) || c.content?.toLowerCase().includes(q)) {
        results.push({ type: "Chapters", id: c.id, label: c.title || "Untitled" });
      }
    });
    if (want("Notes")) currentStory.notes.forEach(n => {
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
  // section/selected are parameters so each split pane renders its own content
  // with the full editable view (params shadow the active-pane state inside here).
  function renderDetail(section, selected) {
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
    if (section === "Trash") {
      return <div style={styles.empty}>Deleted items are kept for {TRASH_RETENTION_DAYS} days, then removed automatically. Restore or remove them from the list on the left.</div>;
    }
    if (!selected) return <div style={styles.empty}>Select an item to view details.</div>;

    if (section === "Characters") {
      const c = currentStory.characters.find(x => x.id === selected);
      if (!c) return null;
      const rels = relsFor(c.id);
      const outline = c.outline || [];
      const charTab = charTabs[c.id] || "detail"; // this character's remembered sub-tab

      // Where this character appears: link chips ([[Name|Sec|id]]) or plain name mentions
      const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nameRe = c.name?.trim() ? new RegExp(`\\b${escapeRe(c.name.trim())}\\b`, "i") : null;
      const idTag = `|${c.id}]]`;
      const mentions = [];
      (currentStory.chapters || []).forEach(ch => {
        const txt = ch.content || "";
        if (txt.includes(idTag) || (nameRe && nameRe.test(txt))) mentions.push({ sec: "Chapters", id: ch.id, label: ch.title || "Untitled" });
      });
      [["Notes", "notes"], ["Outline", "outlines"]].forEach(([sec, key]) => {
        (currentStory[key] || []).forEach(g => {
          if (g.id === c.noteId) return; // the character's own super note doesn't count
          const txt = `${g.title || ""} ${(g.subnotes || []).map(sn => `${sn.title || ""} ${sn.content || ""}`).join(" ")}`;
          if (txt.includes(idTag) || (nameRe && nameRe.test(txt))) mentions.push({ sec, id: g.id, label: g.title || "Untitled" });
        });
      });
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", boxSizing: "border-box" }}>
          {/* Fixed header + tabs */}
          <div style={{ flexShrink: 0, padding: "28px 40px 0", maxWidth: 700 }}>
          {/* Always-visible header */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: c.color, flexShrink: 0, border: "3px solid #2a2a2a", boxShadow: "3px 3px 0 #0d0d0d" }} />
            <EditableText val={c.name} style={styles.detailTitle} onEdit={v => updateField("characters", c.id, "name", v)} />
          </div>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {["detail", "outline"].map(tab => (
              <button
                key={tab}
                onClick={() => setCharTabs(prev => ({ ...prev, [c.id]: tab }))}
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
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 40px 32px", boxSizing: "border-box" }}>
          <div style={styles.detail}>

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

            <div style={{ borderTop: "2px dashed #2a2a2a", paddingTop: 20, marginBottom: 4 }}>
              <div style={{ fontFamily: "'Bangers', cursive", fontSize: 20, letterSpacing: "0.05em", color: "#7dd3fc", marginBottom: 12, textShadow: "2px 2px 0 #0a203a" }}>Appears In</div>
              {mentions.length === 0
                ? <div style={{ color: "#555", fontStyle: "italic", fontSize: 13, marginBottom: 20 }}>Not mentioned in any chapters or notes yet.</div>
                : <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                    {mentions.map(m => (
                      <button key={`${m.sec}-${m.id}`} onClick={() => { setSection(m.sec); setSelected(m.id); }}
                        style={{ background: "#0d1428", border: "2px solid #1a2840", color: "#7dd3fc", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Fredoka', sans-serif" }}>
                        {m.sec === "Chapters" ? "📄" : "📝"} {m.label}
                      </button>
                    ))}
                  </div>
              }
            </div>

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
          </div>
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

    // Timeline strip shared by Timeline (chapters) and OutlineTimeline (outline
    // groups). Cards wrap onto new rows when they run past the right edge; the
    // connector arrow is grouped with the card that follows it, so it "follows"
    // that card down to the next row on wrap. Cards drag to reorder; a ghost
    // card at the end adds a new item.
    function renderTimelineStrip(list, { renderDot, renderBody, onOpen, addLabel, addModal, renderFlag }) {
      // Arrow connector, vertically aligned with the node-dot row above the cards
      const arrow = (key) => (
        <div key={key} style={{ width: 26, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ height: 16 }} />
          <div style={{ height: 20, display: "flex", alignItems: "center", color: "#3a3a3a", fontSize: 20, lineHeight: 1 }}>→</div>
        </div>
      );

      const card = (item, i) => {
        const isOver = dragOverId === item.id && draggingId !== item.id;
        const flag = renderFlag ? renderFlag(item, i, list) : null;
        return (
          <div style={{ width: 190, flexShrink: 0, position: "relative", opacity: draggingId === item.id ? 0.4 : 1 }}
            draggable
            onDragStart={() => setDraggingId(item.id)}
            onDragOver={e => { e.preventDefault(); setDragOverId(item.id); }}
            onDrop={e => { e.preventDefault(); reorderItems(draggingId, item.id); setDraggingId(null); setDragOverId(null); }}
            onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}>
            {isOver && <div style={{ position: "absolute", left: -14, top: 14, bottom: 0, width: 2, background: "#ff1d8e", borderRadius: 1 }} />}
            <div style={{ height: 16, lineHeight: "16px", textAlign: "center", fontFamily: "'Bangers', cursive", fontSize: 14, letterSpacing: "0.08em", color: "#c050a0", textShadow: "1px 1px 0 #3a0a2e", whiteSpace: "nowrap" }}>
              {flag || ""}
            </div>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: renderDot(item), border: "2px solid #111", margin: "4px auto 12px", position: "relative" }} />
            <div onClick={() => onOpen(item)}
              style={{ background: "#141414", border: "2px solid #2a2a2a", borderRadius: 12, padding: 16, cursor: "pointer", transition: "border-color 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#ff1d8e"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a2a"}>
              {renderBody(item, i)}
            </div>
          </div>
        );
      };

      const addCard = (
        <div style={{ width: 190, flexShrink: 0 }}>
          <div style={{ height: 16 }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px dashed #3a3a3a", margin: "4px auto 12px", boxSizing: "border-box", background: "#111" }} />
          <button onClick={() => setModal(addModal)}
            style={{ width: "100%", background: "none", border: "2px dashed #3a3a3a", borderRadius: 12, padding: 16, color: "#666", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }}>
            + {addLabel}
          </button>
        </div>
      );

      // Each [arrow + card] is one non-wrapping unit, so the arrow wraps down
      // with its card. The first card has no leading arrow.
      const unit = (children, key) => (
        <div key={key} style={{ display: "flex", alignItems: "flex-start", flexShrink: 0 }}>{children}</div>
      );

      return (
        <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box", padding: "24px 32px 32px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", rowGap: 20 }}>
            {list.map((item, i) =>
              i === 0
                ? <div key={item.id} style={{ display: "flex", flexShrink: 0 }}>{card(item, 0)}</div>
                : unit(<>{arrow(`a-${item.id}`)}{card(item, i)}</>, `u-${item.id}`)
            )}
            {list.length > 0
              ? unit(<>{arrow("a-add")}{addCard}</>, "u-add")
              : <div style={{ display: "flex", flexShrink: 0 }}>{addCard}</div>}
          </div>
        </div>
      );
    }

    if (section === "Timeline") {
      const stripLinks = t => (t || "").replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, "$1");
      return renderTimelineStrip(currentStory.chapters || [], {
        renderDot: ch => STATUS_COLOR[ch.status] || "#555",
        onOpen: ch => { setSection("Chapters"); setSelected(ch.id); openNewTab("Chapters", ch.id); },
        addLabel: "Add Chapter",
        addModal: "addChap",
        // Show the act label above the first chapter of each act
        renderFlag: (ch, i, list) => (ch.act && (i === 0 || (list[i - 1].act || "") !== ch.act)) ? ch.act : null,
        renderBody: (ch, i) => {
          const text = stripLinks(ch.content).trim();
          const wc = text ? text.split(/\s+/).length : 0;
          const color = STATUS_COLOR[ch.status] || "#555";
          return <>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Ch. {i + 1}</div>
            <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: "#c9b99a", fontSize: 14, marginBottom: 10, lineHeight: 1.3 }}>{ch.title || "Untitled"}</div>
            {ch.status && <div style={{ display: "inline-block", background: color + "22", border: `1px solid ${color}`, color, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{ch.status}</div>}
            {text && <div style={{ fontSize: 11, color: "#666", lineHeight: 1.5, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{text.slice(0, 140)}</div>}
            <div style={{ fontSize: 11, color: "#555" }}>{wc} words</div>
          </>;
        },
      });
    }

    if (section === "OutlineTimeline") {
      return renderTimelineStrip(currentStory.outlines || [], {
        renderDot: () => "#7dd3fc",
        onOpen: g => { setSection("Outline"); setSelected(g.id); openNewTab("Outline", g.id); },
        addLabel: "Add Group",
        addModal: "addOutline",
        renderBody: (g, i) => <>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Group {i + 1}</div>
          <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: "#c9b99a", fontSize: 14, marginBottom: 10, lineHeight: 1.3 }}>{g.title || "Untitled"}</div>
          {(g.subnotes || []).slice(0, 3).map(sn => (
            <div key={sn.id} style={{ fontSize: 11, color: "#555", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {sn.title}</div>
          ))}
          {(g.subnotes || []).length > 3 && <div style={{ fontSize: 10, color: "#3a3a3a", marginTop: 4 }}>+{g.subnotes.length - 3} more</div>}
          <div style={{ fontSize: 11, color: "#444", marginTop: 8 }}>{(g.subnotes || []).length} notes</div>
        </>,
      });
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
      const snapshots = item.snapshots || [];
      const CHIP = { padding: "4px 14px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", flexShrink: 0 };
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "28px 40px 24px", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginBottom: 16 }}>
            <EditableText val={item.title} style={{ ...styles.detailTitle, marginBottom: 0, flex: 1 }} onEdit={v => updateField("chapters", item.id, "title", v)} />
            <button onClick={() => cycleChapterAct(item.id)} title="Cycle act"
              style={{ ...CHIP, background: item.act ? "#28102a" : "none", border: `2px solid ${item.act ? "#c050a0" : "#2a2a2a"}`, color: item.act ? "#c050a0" : "#555" }}>
              {item.act || "No Act"}
            </button>
            <button onClick={() => cycleChapterStatus(item.id)} title="Cycle status"
              style={{ ...CHIP, background: statusColor + "22", border: `2px solid ${statusColor}`, color: statusColor }}>
              {item.status || "No Status"}
            </button>
            <button onClick={() => setShowSnapshots(v => !v)} title="Snapshots"
              style={{ ...CHIP, background: showSnapshots ? "#0a203a" : "none", border: "2px solid #7dd3fc", color: "#7dd3fc" }}>
              📸 {snapshots.length}
            </button>
            <button onClick={() => setFocusChapterId(item.id)} title="Focus mode (Esc to exit)"
              style={{ ...CHIP, background: "none", border: "2px solid #2a2a2a", color: "#888" }}>
              ⛶ Focus
            </button>
          </div>

          {showSnapshots && (
            <div style={{ flexShrink: 0, marginBottom: 16, background: "#0d0d0d", border: "1px solid #2a2a2a", borderRadius: 10, padding: "10px 14px", maxHeight: 200, overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555" }}>Snapshots — saved versions of this chapter</span>
                <button style={{ background: "#0a203a", border: "2px solid #7dd3fc", color: "#7dd3fc", padding: "3px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }}
                  onClick={() => takeSnapshot(item.id)}>+ Take Snapshot</button>
              </div>
              {snapshots.length === 0 && <div style={{ color: "#555", fontStyle: "italic", fontSize: 12 }}>No snapshots yet. One is taken automatically when a chapter is marked Final.</div>}
              {[...snapshots].reverse().map(sn => {
                const txt = (sn.content || "").replace(/<[^>]*>/g, " ").trim();
                const wc = txt ? txt.split(/\s+/).length : 0;
                return (
                  <div key={sn.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #1a1a1a" }}>
                    <span style={{ fontSize: 12, color: "#c9b99a", flexShrink: 0 }}>{new Date(sn.at).toLocaleString()}</span>
                    {sn.label && <span style={{ fontSize: 10, color: "#c050a0", border: "1px solid #c050a0", borderRadius: 10, padding: "1px 8px", flexShrink: 0 }}>{sn.label}</span>}
                    <span style={{ fontSize: 11, color: "#555", flex: 1 }}>{wc} words</span>
                    <button style={{ background: "none", border: "1px solid #7dd3fc", color: "#7dd3fc", padding: "2px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "'Fredoka', sans-serif", flexShrink: 0 }}
                      onClick={() => { restoreSnapshot(item.id, sn.id); }}>Restore</button>
                    <button style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                      onClick={() => deleteSnapshot(item.id, sn.id)}>×</button>
                  </div>
                );
              })}
            </div>
          )}

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
      const selectedSubNoteId = selectedSubNotes[item.id] || null; // this group's remembered sub-note
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
              <button key={sn.id} onClick={() => setSelectedSubNotes(prev => ({ ...prev, [item.id]: sn.id }))} style={{ background: selectedSubNoteId === sn.id ? "#ff1d8e" : "#1a1a1a", border: `2px solid ${selectedSubNoteId === sn.id ? "#ff1d8e" : "#2a2a2a"}`, color: selectedSubNoteId === sn.id ? "#0d0d0d" : "#b0a090", padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Fredoka', sans-serif", whiteSpace: "nowrap", flexShrink: 0, boxShadow: selectedSubNoteId === sn.id ? "2px 2px 0 #3a0a2e" : "none" }}>
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

  const addActions = { Characters: "addChar", Relationships: "addRel", Chapters: "addChap", Notes: "addNote", Outline: "addOutline", Timeline: "addChap", OutlineTimeline: "addOutline" };

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

  // ── close-app backup prompt ────────────────────────────────────────────────
  // Rendered on every top-level screen so the X-button prompt always appears
  function renderCloseModal() {
    if (!showCloseModal) return null;
    return (
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
              onClick={async () => {
                const ok = await exportBackup(true);
                if (ok) {
                  window.electronAPI.confirmClose();
                } else {
                  alert("Backup failed — your data was NOT saved to disk. The app will stay open.\nTry 'Download Backup' from the sidebar, or close without saving.");
                }
              }}
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
                    onDragStart={e => { e.stopPropagation(); setDraggingId(s.id); }}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverId(s.id); }}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); reorderStories(draggingId, s.id); setDraggingId(null); setDragOverId(null); }}
                    onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                    onClick={() => { if (!isEditingStories) setCurrentStoryId(s.id); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", paddingLeft: indent ? 28 : 10, borderRadius: 6, marginBottom: 2, cursor: "grab", opacity: isDragging ? 0.4 : 1, background: isOver ? "#2a1428" : "transparent", borderTop: isOver ? "2px solid #ff1d8e" : "2px solid transparent" }}
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
                        style={{ ...styles.formInput, fontSize: 13, padding: "3px 6px", flex: 1, minWidth: 0 }} />
                    ) : (
                      <span title={s.title} onDoubleClick={e => { e.stopPropagation(); setRenamingStoryId(s.id); }}
                        style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: "#b0a090", fontSize: 13, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: isEditingStories ? "text" : "pointer" }}>
                        {s.title}
                      </span>
                    )}
                    <button title={s.pinned ? "Unpin" : "Pin"} onClick={e => { e.stopPropagation(); toggleStoryPin(s.id); }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, display: "flex", flexShrink: 0 }}>
                      <PinIcon pinned={s.pinned} />
                    </button>
                  </div>
                );
              };

              return (
                <div style={{ maxHeight: 360, overflowY: "auto", paddingRight: 4 }}
                  onDragOver={e => { if (draggingId) { e.preventDefault(); setDragOverId("ungroup"); } }}
                  onDrop={e => { if (draggingId) { e.preventDefault(); setStoryFolder(draggingId, null); setDraggingId(null); setDragOverId(null); } }}
                >
                  {stories.length === 0 && <div style={{ padding: "16px 4px", color: "#555", fontStyle: "italic", fontSize: 12 }}>No stories yet — make one below.</div>}
                  {ungrouped.map(s => renderStoryRow(s, false))}
                  {folders.map(folder => {
                    const folderStories = pin(matched.filter(s => s.folderId === folder.id));
                    if (folderStories.length === 0 && q && !isEditingStories) return null;
                    const over = dragOverId === "f-" + folder.id;
                    return (
                      <div key={folder.id} style={{ marginTop: 4 }}>
                        <div
                          onClick={() => toggleFolder(folder.id)}
                          onDragOver={e => { if (draggingId) { e.preventDefault(); e.stopPropagation(); setDragOverId("f-" + folder.id); } }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); if (draggingId) { setStoryFolder(draggingId, folder.id); } setDraggingId(null); setDragOverId(null); }}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 6, background: over ? "#2a1428" : "#161616", cursor: "pointer", borderTop: over ? "2px solid #ff1d8e" : "2px solid transparent", marginBottom: 2 }}
                        >
                          <span style={{ fontSize: 9, color: "#666", flexShrink: 0, width: 10 }}>{folder.collapsed ? "▶" : "▼"}</span>
                          <FolderIcon />
                          {renamingFolderId === folder.id ? (
                            <input autoFocus defaultValue={folder.name}
                              onBlur={e => { renameFolder(folder.id, e.target.value); setRenamingFolderId(null); }}
                              onKeyDown={e => { if (e.key === "Enter") { renameFolder(folder.id, e.target.value); setRenamingFolderId(null); } if (e.key === "Escape") setRenamingFolderId(null); }}
                              onClick={e => e.stopPropagation()}
                              style={{ ...styles.formInput, fontSize: 12, padding: "2px 6px", flex: 1, minWidth: 0 }} />
                          ) : (
                            <span onDoubleClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); }}
                              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: "#c9b99a", fontSize: 13, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {folder.name} <span style={{ color: "#555", fontWeight: 400 }}>({folderStories.length})</span>
                            </span>
                          )}
                          <button title="Rename folder" onClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); }}
                            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>✎</button>
                          <button title="Delete folder (keeps stories)" onClick={e => { e.stopPropagation(); deleteFolder(folder.id); }}
                            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
                        </div>
                        {!folder.collapsed && folderStories.length === 0 && (
                          <div style={{ padding: "5px 0 5px 28px", fontSize: 11, color: "#444", fontStyle: "italic" }}>Drag a story here</div>
                        )}
                        {!folder.collapsed && folderStories.map(s => renderStoryRow(s, true))}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ flex: 1, background: "none", border: "2px solid #ff1d8e", color: "#ff1d8e", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }} onClick={() => setShowStoryModal(true)}>+ Story</button>
                <button style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: "none", border: "2px solid #2a2a2a", color: "#888", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Fredoka', sans-serif" }} onClick={createFolder}><FolderIcon /> Folder</button>
              </div>
              <button style={{ background: isEditingStories ? "#ff1d8e" : "none", border: `1px solid ${isEditingStories ? "#ff1d8e" : "#333"}`, color: isEditingStories ? "#0d0d0d" : "#888", padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", width: "100%", marginTop: 8 }} onClick={() => { setIsEditingStories(!isEditingStories); setSelectedStories(new Set()); }}>
                {isEditingStories ? "Done" : "Select to Delete"}
              </button>
              {isEditingStories && selectedStories.size > 0 && (
                <button style={{ background: "#ff1d8e", border: "2px solid #3a0a2e", color: "#0d0d0d", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", width: "100%", marginTop: 6 }} onClick={() => setShowDeleteConfirm(true)}>
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
        {renderCloseModal()}
      </div>
    );
  }

  // ── view toggle pill (List | Timeline, List | Map) ─────────────────────────
  function ViewToggle({ views }) {
    return (
      <div style={{ display: "inline-flex", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 14, padding: 2, gap: 2 }}>
        {views.map(v => {
          const active = section === v.sec;
          return (
            <button key={v.sec}
              onClick={() => { if (!active) { setSection(v.sec); setSelected(null); } }}
              style={{ background: active ? "#ff1d8e" : "none", color: active ? "#0d0d0d" : "#666", border: "none", borderRadius: 12, padding: "3px 12px", fontSize: 10, fontWeight: 700, cursor: active ? "default" : "pointer", fontFamily: "'Fredoka', sans-serif", letterSpacing: "0.04em" }}>
              {v.label}
            </button>
          );
        })}
      </div>
    );
  }

  // ── storage UI ─────────────────────────────────────────────────────────────
  function backupAge() {
    if (!lastBackupAt) return "never";
    const mins = Math.floor((Date.now() - lastBackupAt) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function renderStorageStatus() {
    return (
      <div style={{ margin: "16px 20px", paddingTop: 14, borderTop: "2px dashed #2a2a2a" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#555", marginBottom: 6 }}>Storage</div>
        <div style={{ fontSize: 12, color: isSaving ? "#ff1d8e" : saveStatus ? "#4caf50" : "#444", fontWeight: 600, minHeight: 18, transition: "color 0.3s" }}>
          {isSaving ? "Saving..." : saveStatus || "Auto-saved"}
        </div>
        <div style={{ fontSize: 11, color: lastBackupAt ? "#555" : "#a05a00", marginTop: 2 }}>
          Last backup: {backupAge()}
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
        {renderCloseModal()}
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {/* sidebar nav */}
      <div style={{ ...styles.sidebar, width: sidebarCollapsed ? 40 : sidebarWidth, position: "relative", overflowX: "hidden", overflowY: "auto", transition: "width 0.15s" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: 5, height: "100%", cursor: "ew-resize", zIndex: 10 }} onMouseDown={startSidebarResize} />
        {sidebarCollapsed ? (
          <button onClick={() => { setSidebarCollapsed(false); setSidebarWidth(lastSidebarWidth.current); }} style={{ width: 40, height: 40, background: "none", border: "none", color: "#ff1d8e", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
        ) : (<>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 0 0" }}>
            <div style={styles.brand}>QWOSID</div>
            <button onClick={() => { lastSidebarWidth.current = sidebarWidth; setSidebarCollapsed(true); setSidebarWidth(40); }} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>‹</button>
          </div>
          <div style={{ marginBottom: 16, padding: "0 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <button title="Back to stories" onClick={() => setCurrentStoryId(null)}
              style={{ background: "none", border: "2px solid #ff1d8e", color: "#ff1d8e", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 }}>
              ←
            </button>
            <span style={{ fontFamily: "'Bangers', cursive", color: "#7dd3fc", fontSize: 20, letterSpacing: "0.04em", textShadow: "2px 2px 0 #3a0a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentStory.title}</span>
          </div>
        </div>
        {SECTIONS.filter(s => s !== "Search" && s !== "Trash").map(s => (
          <button key={s} style={{ ...styles.navBtn, ...(s === "Home" ? { padding: "6px 20px", fontSize: 11, letterSpacing: "0.12em", color: s === section ? undefined : "#555" } : {}), ...(s === section ? styles.navActive : {}) }} onClick={() => { setSection(s); setSelected(null); }}>
            {s === "Home" ? "⌂ Home" : s}
          </button>
        ))}
        <div style={{ display: "flex", gap: 8, padding: "10px 20px 0" }}>
          {[{ sec: "Search", icon: "🔍" }, { sec: "Trash", icon: "🗑" }].map(({ sec, icon }) => {
            const active = section === sec;
            return (
              <button key={sec} title={sec} onClick={() => { setSection(sec); setSelected(null); }}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: active ? "#280820" : "none", border: `2px solid ${active ? "#ff1d8e" : "#2a2a2a"}`, color: active ? "#ff1d8e" : "#666", borderRadius: 8, padding: "8px 4px", cursor: "pointer", fontFamily: "'Fredoka', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", transition: "color 0.15s, border-color 0.15s" }}>
                <span style={{ fontSize: 15, lineHeight: 1 }}>{icon}</span>
                {sec}
              </button>
            );
          })}
        </div>
        {renderStorageStatus()}
        <div style={{ padding: "0 20px 20px" }}>
          <div>
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
        <div style={{ ...styles.listHeader, flexDirection: "column", alignItems: "stretch", gap: 0, padding: "14px 16px 10px" }}>
          {/* row 1: title + add button */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={styles.listTitle}>
              {section === "Map" ? "Relationships" : section === "Timeline" ? "Chapters" : section === "OutlineTimeline" ? "Outline" : section}
            </span>
            {section !== "Search" && section !== "Home" && section !== "Map" && section !== "Trash" && (
              <button style={styles.plusBtn} onClick={() => setModal(addActions[section])}>+</button>
            )}
          </div>
          {/* row 2: view toggles */}
          {(section === "Chapters" || section === "Timeline") && (
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
              <ViewToggle views={[{ label: "List", sec: "Chapters" }, { label: "Timeline", sec: "Timeline" }]} />
              {currentStory?.chapters?.length > 0 && (
                <button style={{ background: "none", border: "none", color: "#555", padding: 0, cursor: "pointer", fontSize: 11, fontFamily: "'Fredoka', sans-serif" }} onClick={() => exportAllChaptersAsPDF(currentStory.title, currentStory.chapters)}>Export PDF</button>
              )}
            </div>
          )}
          {(section === "Outline" || section === "OutlineTimeline") && (
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
              <ViewToggle views={[{ label: "List", sec: "Outline" }, { label: "Timeline", sec: "OutlineTimeline" }]} />
            </div>
          )}
          {(section === "Relationships" || section === "Map") && (
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
              <ViewToggle views={[{ label: "List", sec: "Relationships" }, { label: "Map", sec: "Map" }]} />
            </div>
          )}
          {FOLDER_SECTIONS.includes(section) && (
            <div style={{ display: "flex", marginTop: 8, alignItems: "center" }}>
              <button title="Add a folder" onClick={() => addItemFolder(section, null)}
                style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #2a2a2a", color: "#888", padding: "3px 10px", borderRadius: 12, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "'Fredoka', sans-serif", letterSpacing: "0.04em" }}>
                <FolderIcon /> New Folder
              </button>
            </div>
          )}
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
              <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                {["All", "Characters", "Relationships", "Chapters", "Notes"].map(t => (
                  <button key={t} onClick={() => setSearchTypeFilter(t)}
                    style={{ background: searchTypeFilter === t ? "#ff1d8e" : "none", color: searchTypeFilter === t ? "#0d0d0d" : "#666", border: `1px solid ${searchTypeFilter === t ? "#ff1d8e" : "#333"}`, borderRadius: 12, padding: "2px 9px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Fredoka', sans-serif" }}>
                    {t === "Relationships" ? "Rels" : t}
                  </button>
                ))}
              </div>
              {(searchTypeFilter === "All" || searchTypeFilter === "Chapters") && (
                <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                  {[null, "Draft", "Revising", "Final"].map(st => (
                    <button key={st || "any"} onClick={() => setSearchStatusFilter(st)}
                      style={{ background: searchStatusFilter === st ? "#0a203a" : "none", color: searchStatusFilter === st ? "#7dd3fc" : "#555", border: `1px solid ${searchStatusFilter === st ? "#7dd3fc" : "#2a2a2a"}`, borderRadius: 12, padding: "2px 9px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Fredoka', sans-serif" }}>
                      {st || "Any status"}
                    </button>
                  ))}
                </div>
              )}
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
        ) : section === "Trash" ? (
          <div style={{ overflowY: "auto", flex: 1 }}>
            {(currentStory.trash || []).length === 0 ? (
              <div style={{ padding: "24px 16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>Trash is empty.</div>
            ) : (
              <>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid #1e1e1e" }}>
                  <button style={{ background: "none", border: "2px solid #ff1d8e", color: "#ff1d8e", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, width: "100%", fontFamily: "'Fredoka', sans-serif" }} onClick={emptyTrash}>Empty Trash</button>
                </div>
                {[...(currentStory.trash || [])].reverse().map(t => {
                  const label = t.item.name || t.item.title || (t.collection === "relationships" ? `${charMap[t.item.charA]?.name || "?"} & ${charMap[t.item.charB]?.name || "?"}` : "Untitled");
                  const daysLeft = Math.max(0, TRASH_RETENTION_DAYS - Math.floor((Date.now() - t.deletedAt) / 86400000));
                  return (
                    <div key={t.item.id} style={{ ...styles.listItem, cursor: "default", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500, fontSize: 14, color: "#b0a090", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                        <div style={{ fontSize: 10, color: "#555", textTransform: "capitalize" }}>{t.collection.replace(/s$/, "")} · {daysLeft}d left</div>
                      </div>
                      <button onClick={() => restoreTrashItem(t.item.id)} style={{ background: "none", border: "1px solid #7dd3fc", color: "#7dd3fc", padding: "2px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "'Fredoka', sans-serif", flexShrink: 0 }}>Restore</button>
                      <button onClick={() => purgeTrashItem(t.item.id)} title="Delete forever" style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14, flexShrink: 0, padding: "0 2px" }}>×</button>
                    </div>
                  );
                })}
              </>
            )}
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
            <div style={{ overflowY: "auto", flex: 1 }}
              onDragOver={e => { if (FOLDER_SECTIONS.includes(section) && (draggingId || draggingFolderId)) e.preventDefault(); }}
              onDrop={e => {
                if (!FOLDER_SECTIONS.includes(section)) return;
                e.preventDefault();
                const k = { Characters: "characters", Notes: "notes", Outline: "outlines" }[section];
                const dId = draggingFolderId || draggingId;
                if (dId) moveNode(dId, draggingFolderId ? "folder" : "item", null, null, "end", k);
                setDraggingId(null); setDraggingFolderId(null); setDragOverId(null); setDragOverFolderId(null); setDropZone(null);
              }}
            >
              {(() => {
                const SECTION_KEY = { Characters: "characters", Chapters: "chapters", Notes: "notes", Outline: "outlines", Relationships: "relationships", Timeline: "chapters", OutlineTimeline: "outlines" };
                const collKey = SECTION_KEY[section];
                const q = listSearchQuery.trim().toLowerCase();
                const matches = item => {
                  if (section === "Relationships") {
                    return (charMap[item.charA]?.name || "").toLowerCase().includes(q) ||
                           (charMap[item.charB]?.name || "").toLowerCase().includes(q);
                  }
                  return (item.name || item.title || "").toLowerCase().includes(q);
                };
                const sortPinned = arr => [...arr].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

                const clearDrag = () => { setDraggingId(null); setDraggingFolderId(null); setDragOverId(null); setDragOverFolderId(null); setDropZone(null); };
                const dragId = () => draggingFolderId || draggingId;
                const dragKind = () => draggingFolderId ? "folder" : "item";

                // Single item row. In treeMode (Characters/Notes/Outline) it uses
                // before/after drop zones + order; otherwise plain array reorder.
                const itemRow = (item, depth, treeMode = false) => {
                  const isActive  = selected === item.id;
                  const isDragging = draggingId === item.id;
                  const dz = treeMode && dropZone?.id === item.id ? dropZone.zone : null;
                  const isOver = !treeMode && dragOverId === item.id && draggingId !== item.id;
                  let label = item.name || item.title || "Untitled";
                  if (section === "Relationships") {
                    const cA = charMap[item.charA], cB = charMap[item.charB];
                    label = `${cA?.name || "?"} & ${cB?.name || "?"}`;
                  }
                  const handlers = treeMode ? {
                    onDragOver: e => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setDropZone({ id: item.id, zone: (e.clientY - r.top) < r.height / 2 ? "before" : "after" }); },
                    onDrop: e => { e.preventDefault(); e.stopPropagation(); const z = dropZone?.id === item.id ? dropZone.zone : "after"; if (dragId()) moveNode(dragId(), dragKind(), item.id, "item", z, collKey); clearDrag(); },
                  } : {
                    onDragOver: e => { e.preventDefault(); e.stopPropagation(); setDragOverId(item.id); },
                    onDrop: e => { e.preventDefault(); e.stopPropagation(); reorderItems(draggingId, item.id); clearDrag(); },
                  };
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={e => { e.stopPropagation(); setDraggingId(item.id); setDraggingFolderId(null); }}
                      {...handlers}
                      onDragEnd={clearDrag}
                      onClick={e => { if (e.ctrlKey || e.metaKey) { openNewTab(section, item.id); } else { setSelected(item.id); setCharTab("detail"); } }}
                      style={{
                        ...styles.listItem,
                        ...(isActive ? styles.listItemActive : {}),
                        opacity: isDragging ? 0.4 : 1,
                        borderTop: (isOver || dz === "before") ? "2px solid #ff1d8e" : "2px solid transparent",
                        ...(dz === "after" ? { borderBottom: "2px solid #ff1d8e" } : {}),
                        cursor: "grab",
                        position: "relative",
                        paddingLeft: 16 + depth * 18,
                      }}
                    >
                      {section === "Characters" && <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color || "#888", marginRight: 10, flexShrink: 0 }} />}
                      {(section === "Chapters" || section === "Timeline") && item.status && <div title={item.status} style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[item.status] || "#555", marginRight: 10, flexShrink: 0 }} />}
                      <div style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: isActive ? 700 : 500, fontSize: 15, color: isActive ? "#7dd3fc" : "#b0a090", flex: 1 }}>{label}</div>
                      <button onClick={e => { e.stopPropagation(); if (collKey) updateField(collKey, item.id, "pinned", !item.pinned); }}
                        style={{ position: "absolute", top: 3, right: 5, background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, display: "flex" }}>
                        <PinIcon pinned={item.pinned} />
                      </button>
                    </div>
                  );
                };

                // ── flat mode: while searching, or sections without folders ──
                if (q || !FOLDER_SECTIONS.includes(section)) {
                  const filtered = q ? items.filter(matches) : items;
                  if (filtered.length === 0) return (
                    <div style={{ padding: "24px 16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>
                      {q ? `No results for "${listSearchQuery}".` : "Nothing here yet."}
                    </div>
                  );
                  return sortPinned(filtered).map(it => itemRow(it, 0));
                }

                // ── folder-tree mode (Characters / Notes / Outline) ──
                const folders = itemFolders().filter(f => f.section === section);
                const validIds = new Set(folders.map(f => f.id));
                const containerOf = it => (it.folderId && validIds.has(it.folderId)) ? it.folderId : null;

                if (items.length === 0 && folders.length === 0) return (
                  <div style={{ padding: "24px 16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>Nothing here yet.</div>
                );

                // Folders + items at one level: pinned items float to top, the rest
                // (folders and unpinned items) interleave by their `order`.
                const nodesUnder = container => {
                  const fs = folders.filter(f => (f.parentId || null) === container).map(f => ({ kind: "folder", ref: f, order: f.order ?? 0 }));
                  const its = items.filter(it => containerOf(it) === container).map(it => ({ kind: "item", ref: it, order: it.order ?? 0, pinned: !!it.pinned }));
                  const pinned = its.filter(n => n.pinned).sort((a, b) => a.order - b.order);
                  const rest = [...fs, ...its.filter(n => !n.pinned)].sort((a, b) => a.order - b.order);
                  return [...pinned, ...rest];
                };

                const folderRow = (f, depth) => {
                  const dz = dropZone?.id === f.id ? dropZone.zone : null;
                  const count = items.filter(it => it.folderId === f.id).length;
                  return (
                    <div key={"row-" + f.id}
                      draggable
                      onDragStart={e => { e.stopPropagation(); setDraggingFolderId(f.id); setDraggingId(null); }}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const y = e.clientY - r.top; setDropZone({ id: f.id, zone: y < r.height * 0.3 ? "before" : y > r.height * 0.7 ? "after" : "inside" }); }}
                      onDrop={e => { e.preventDefault(); e.stopPropagation(); const z = dropZone?.id === f.id ? dropZone.zone : "inside"; if (dragId()) moveNode(dragId(), dragKind(), f.id, "folder", z, collKey); clearDrag(); }}
                      onDragEnd={clearDrag}
                      onClick={() => toggleItemFolder(f.id)}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", paddingLeft: 12 + depth * 18, cursor: "pointer", borderBottom: dz === "after" ? "2px solid #ff1d8e" : "1px solid #1a1a1a", background: dz === "inside" ? "#2a1428" : "transparent", borderTop: dz === "before" ? "2px solid #ff1d8e" : "2px solid transparent", boxShadow: dz === "inside" ? "inset 0 0 0 2px #ff1d8e" : undefined }}
                    >
                      <span style={{ fontSize: 9, color: "#666", flexShrink: 0, width: 10 }}>{f.collapsed ? "▶" : "▼"}</span>
                      <FolderIcon />
                      {renamingItemFolderId === f.id ? (
                        <input autoFocus defaultValue={f.name}
                          onClick={e => e.stopPropagation()}
                          onBlur={e => { renameItemFolder(f.id, e.target.value); setRenamingItemFolderId(null); }}
                          onKeyDown={e => { if (e.key === "Enter") { renameItemFolder(f.id, e.target.value); setRenamingItemFolderId(null); } if (e.key === "Escape") setRenamingItemFolderId(null); }}
                          style={{ ...styles.formInput, fontSize: 12, padding: "2px 6px", flex: 1 }} />
                      ) : (
                        <span onDoubleClick={e => { e.stopPropagation(); setRenamingItemFolderId(f.id); }}
                          style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: "#c9b99a", fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {f.name} {count > 0 && <span style={{ color: "#555", fontWeight: 400 }}>({count})</span>}
                        </span>
                      )}
                      <button title="New subfolder" onClick={e => { e.stopPropagation(); addItemFolder(section, f.id); }}
                        style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>+</button>
                      <button title="Rename" onClick={e => { e.stopPropagation(); setRenamingItemFolderId(f.id); }}
                        style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>✎</button>
                      <button title="Delete folder (keeps items)" onClick={e => { e.stopPropagation(); deleteItemFolder(f.id, collKey); }}
                        style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
                    </div>
                  );
                };

                const renderLevel = (container, depth) => nodesUnder(container).map(n =>
                  n.kind === "folder" ? (
                    <div key={n.ref.id}>
                      {folderRow(n.ref, depth)}
                      {!n.ref.collapsed && renderLevel(n.ref.id, depth + 1)}
                    </div>
                  ) : itemRow(n.ref, depth, true)
                );

                return renderLevel(null, 0);
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
          const isFullDetail = (sec, sel) => ((['Chapters','Timeline','Notes','Outline','Characters'].includes(sec) && sel) || sec === 'Home' || sec === 'Timeline' || sec === 'OutlineTimeline' || sec === 'Map');
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
                    {/* pane content — every pane is the full editable view */}
                    <div
                      onMouseDown={() => { if (!isActive) activatePane(pos); }}
                      style={{ ...styles.detailPanel, flex: 1, ...(paneFullDetail ? { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" } : {}) }}
                    >
                      {renderDetail(paneSec, paneSel)}
                    </div>
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

      {/* focus mode — fullscreen distraction-free editor (Esc to exit) */}
      {focusChapterId && (() => {
        const ch = currentStory.chapters.find(x => x.id === focusChapterId);
        if (!ch) return null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "#0d0d0d", zIndex: 90, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: "min(860px, 92vw)", display: "flex", alignItems: "center", gap: 12, padding: "18px 0 10px", flexShrink: 0 }}>
              <span style={{ fontFamily: "'Bangers', cursive", fontSize: 26, color: "#ff1d8e", textShadow: "2px 2px 0 #3a0a2e", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.title || "Untitled"}</span>
              <span style={{ fontSize: 11, color: "#444" }}>Esc to exit</span>
              <button onClick={() => setFocusChapterId(null)} style={{ background: "none", border: "2px solid #2a2a2a", color: "#888", width: 30, height: 30, borderRadius: 6, cursor: "pointer", fontSize: 15, fontWeight: 700, flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ width: "min(860px, 92vw)", flex: 1, display: "flex", flexDirection: "column", minHeight: 0, paddingBottom: 24 }}>
              <ChapterEditor key={"focus-" + ch.id} content={ch.content}
                requestLink={cb => { setLinkPicker({ onInsert: cb }); setLinkPickerQuery(""); setLinkPickerSection("Characters"); }}
                onNavigate={(sec, id) => { setFocusChapterId(null); setSection(sec); setSelected(id); setCharTab("detail"); }}
                onSave={v => updateField("chapters", ch.id, "content", v)} />
            </div>
          </div>
        );
      })()}

      {renderCloseModal()}
    </div>
  );
}
