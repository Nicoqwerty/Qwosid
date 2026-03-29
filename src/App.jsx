import { useState, useRef, useEffect } from "react";

// ── tiny uid ──────────────────────────────────────────────────────────────────
let _id = 1;
const uid = () => String(_id++);

// ── local storage configuration ───────────────────────────────────────────────
const STORAGE_CONFIG = {
  // Local file path for saving data
  dataPath: "./data/database.json",
  // Syncthing API configuration
  syncthing: {
    baseUrl: "http://localhost:8384",
    apiKey: "", // You can set this if your Syncthing instance requires an API key
    deviceId: "", // Your Syncthing device ID
    folderId: "default" // Your Syncthing folder ID
  }
};

// ── local storage operations ──────────────────────────────────────────────────
const localDB = {
  // Save all stories to local file
  async saveStories(stories) {
    try {
      // In a real implementation, this would use Node.js fs module or similar
      // For browser-based apps, we'll use localStorage as a fallback
      localStorage.setItem('storyOrganizerData', JSON.stringify(stories));
      console.log("Stories saved locally");
      return true;
    } catch (error) {
      console.error("Error saving stories locally:", error);
      return false;
    }
  },

  // Load stories from local file
  async loadStories() {
    try {
      // Try to load from localStorage first
      const storedData = localStorage.getItem('storyOrganizerData');
      if (storedData) {
        return JSON.parse(storedData);
      }
      return null;
    } catch (error) {
      console.error("Error loading stories locally:", error);
      return null;
    }
  },

  // Clear local storage
  async clearStories() {
    try {
      localStorage.removeItem('storyOrganizerData');
      return true;
    } catch (error) {
      console.error("Error clearing stories:", error);
      return false;
    }
  }
};

// ── Syncthing integration ─────────────────────────────────────────────────────
const syncthing = {
  // Get Syncthing status
  async getStatus() {
    try {
      const response = await fetch(`${STORAGE_CONFIG.syncthing.baseUrl}/rest/db/status?folder=${STORAGE_CONFIG.syncthing.folderId}`, {
        headers: {
          'X-API-Key': STORAGE_CONFIG.syncthing.apiKey || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching Syncthing status:", error);
      return null;
    }
  },

  // Get folder status
  async getFolderStatus() {
    try {
      const response = await fetch(`${STORAGE_CONFIG.syncthing.baseUrl}/rest/db/status?folder=${STORAGE_CONFIG.syncthing.folderId}`, {
        headers: {
          'X-API-Key': STORAGE_CONFIG.syncthing.apiKey || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching Syncthing folder status:", error);
      return null;
    }
  },

  // Get device status
  async getDeviceStatus() {
    try {
      const response = await fetch(`${STORAGE_CONFIG.syncthing.baseUrl}/rest/stats/device`, {
        headers: {
          'X-API-Key': STORAGE_CONFIG.syncthing.apiKey || ''
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching Syncthing device status:", error);
      return null;
    }
  },

  // Check if Syncthing is reachable
  async isReachable() {
    try {
      const response = await fetch(`${STORAGE_CONFIG.syncthing.baseUrl}/rest/system/ping`, {
        headers: {
          'X-API-Key': STORAGE_CONFIG.syncthing.apiKey || ''
        }
      });
      return response.ok;
    } catch (error) {
      console.error("Syncthing not reachable:", error);
      return false;
    }
  }
};

// ── seed data ─────────────────────────────────────────────────────────────────
const SEED_STORY = {
  id: "s1",
  title: "The Cartographer's Archive",
  characters: [
    { id: "c1", name: "Elara Voss", role: "Protagonist", bio: "A cartographer who draws maps of places that don't exist yet.", color: "#c97b4b" },
    { id: "c2", name: "Soren Mal", role: "Antagonist", bio: "A historian obsessed with erasing inconvenient truths from the record.", color: "#6b7fa3" },
  ],
  relationships: [
    { id: "r1", charA: "c1", charB: "c2", description: "Childhood rivals turned uneasy collaborators. Elara distrusts Soren's motives but needs his archive access. Soren secretly fears Elara's maps reveal what he's hidden." },
  ],
  chapters: [
    { id: "ch1", title: "The Blank Meridian", content: "Elara receives a commission for a map with no borders…" },
  ],
  notes: [
    { id: "n1", title: "World Rules", content: "Maps drawn in blood cannot be erased, only amended." },
  ],
};

// ── helpers ───────────────────────────────────────────────────────────────────
const SECTIONS = ["Characters", "Relationships", "Chapters", "Notes"];

export default function StoryOrganizer() {
  const [stories, setStories] = useState([SEED_STORY]);
  const [currentStoryId, setCurrentStoryId] = useState(null);
  const [section, setSection] = useState("Characters");
  const [selected, setSelected] = useState("c1");
  const [editing, setEditing] = useState(null); // { type, id, field, value }
  const [modal, setModal] = useState(null); // { type: 'addChar'|'addRel'|'addChap'|'addNote' }
  const [newForm, setNewForm] = useState({});
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [isEditingStories, setIsEditingStories] = useState(false);
  const [selectedStories, setSelectedStories] = useState(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null); // { type, id, name }

  // ── derived ────────────────────────────────────────────────────────────────
  const currentStory = currentStoryId ? stories.find(s => s.id === currentStoryId) : null;
  
  // Ensure we have a valid currentStory before accessing its properties
  const items = currentStory ? {
    Characters: currentStory.characters || [],
    Relationships: currentStory.relationships || [],
    Chapters: currentStory.chapters || [],
    Notes: currentStory.notes || [],
  }[section] : [];

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

  function addItem() {
    const f = newForm;
    if (modal === "addChar") {
      if (!f.name?.trim()) return;
      const nc = { id: uid(), name: f.name, role: f.role || "", bio: f.bio || "", color: f.color || "#888" };
      setStories(stories.map(s => 
        s.id === currentStoryId 
          ? { ...s, characters: [...s.characters, nc] }
          : s
      ));
      setSelected(nc.id); setSection("Characters");
    } else if (modal === "addRel") {
      if (!f.charA || !f.charB || f.charA === f.charB || !f.description?.trim()) return;
      const nr = { id: uid(), charA: f.charA, charB: f.charB, description: f.description };
      setStories(stories.map(s => 
        s.id === currentStoryId 
          ? { ...s, relationships: [...s.relationships, nr] }
          : s
      ));
      setSelected(nr.id); setSection("Relationships");
    } else if (modal === "addChap") {
      if (!f.title?.trim()) return;
      const nc = { id: uid(), title: f.title, content: f.content || "" };
      setStories(stories.map(s => 
        s.id === currentStoryId 
          ? { ...s, chapters: [...s.chapters, nc] }
          : s
      ));
      setSelected(nc.id); setSection("Chapters");
    } else if (modal === "addNote") {
      if (!f.title?.trim()) return;
      const nn = { id: uid(), title: f.title, content: f.content || "" };
      setStories(stories.map(s => 
        s.id === currentStoryId 
          ? { ...s, notes: [...s.notes, nn] }
          : s
      ));
      setSelected(nn.id); setSection("Notes");
    }
    setModal(null); setNewForm({});
  }

  function createStory() {
    const title = newForm.storyTitle?.trim() || "Untitled Story";
    const newStory = {
      id: uid(),
      title: title,
      characters: [],
      relationships: [],
      chapters: [],
      notes: []
    };
    setStories([...stories, newStory]);
    setCurrentStoryId(newStory.id);
    setShowStoryModal(false);
    setNewForm({});
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

  // ── inline edit ────────────────────────────────────────────────────────────
  function startEdit(type, id, field, value) { setEditing({ type, id, field, value }); }
  function commitEdit() {
    if (!editing) return;
    updateField(editing.type, editing.id, editing.field, editing.value);
    setEditing(null);
  }

  // ── detail panel ───────────────────────────────────────────────────────────
  function renderDetail() {
    if (!selected) return <div style={styles.empty}>Select an item to view details.</div>;

    if (section === "Characters") {
      const c = currentStory.characters.find(x => x.id === selected);
      if (!c) return null;
      const rels = relsFor(c.id);
      return (
        <div style={styles.detail}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: c.color, flexShrink: 0, border: "3px solid #2a2a2a" }} />
            <EditableText val={c.name} style={styles.detailTitle} onEdit={v => updateField("characters", c.id, "name", v)} />
          </div>
          <Label>Bio</Label>
          <EditableArea val={c.bio || ""} style={styles.detailBody} onEdit={v => updateField("characters", c.id, "bio", v)} />
          <Label>Color</Label>
          <input type="color" value={c.color} onChange={e => updateField("characters", c.id, "color", e.target.value)} style={{ marginBottom: 20, cursor: "pointer", background: "none", border: "none" }} />

          {rels.length > 0 && <>
            <Label>Relationships</Label>
            {rels.map(r => {
              const other = charMap[r.charA === c.id ? r.charB : r.charA];
              return (
                <div key={r.id} style={styles.relCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: other?.color || "#888" }} />
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: "#c9b99a", fontStyle: "italic" }}>{other?.name || "Unknown"}</span>
                  </div>
                  <EditableArea val={r.description} style={{ ...styles.detailBody, marginBottom: 0 }} onEdit={v => updateField("relationships", r.id, "description", v)} />
                </div>
              );
            })}
          </>}

          <button style={styles.deleteBtn} onClick={() => { setItemToDelete({ type: "character", id: c.id, name: c.name }); }}>Delete Character</button>
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

    if (section === "Chapters" || section === "Notes") {
      const col = section === "Chapters" ? "chapters" : "notes";
      const item = currentStory[col].find(x => x.id === selected);
      if (!item) return null;
      return (
        <div style={styles.detail}>
          <EditableText val={item.title} style={styles.detailTitle} onEdit={v => updateField(col, item.id, "title", v)} />
          <Label>Content</Label>
          <EditableArea val={item.content} style={{ ...styles.detailBody, minHeight: 220 }} onEdit={v => updateField(col, item.id, "content", v)} />
          <button style={styles.deleteBtn} onClick={() => { setItemToDelete({ type: section.toLowerCase().slice(0, -1), id: item.id, name: item.title || item.name || "Untitled" }); }}>Delete {section === "Chapters" ? "Chapter" : "Note"}</button>
        </div>
      );
    }
  }

  // ── modal ──────────────────────────────────────────────────────────────────
  function renderModal() {
    if (!modal) return null;
    return (
      <div style={styles.overlay} onClick={e => { if (e.target === e.currentTarget) { setModal(null); setNewForm({}); } }}>
        <div style={styles.modalBox}>
          <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#e8d9c0", marginBottom: 20, borderBottom: "1px solid #333", paddingBottom: 12 }}>
            {modal === "addChar" ? "New Character" : modal === "addRel" ? "New Relationship" : modal === "addChap" ? "New Chapter" : "New Note"}
          </h3>
          {modal === "addChar" && <>
            <FormField label="Name *" value={newForm.name || ""} onChange={v => setNewForm(f => ({ ...f, name: v }))} />
            <FormField label="Role" value={newForm.role || ""} onChange={v => setNewForm(f => ({ ...f, role: v }))} />
            <FormTextarea label="Bio" value={newForm.bio || ""} onChange={v => setNewForm(f => ({ ...f, bio: v }))} />
            <div style={{ marginBottom: 16 }}>
              <label style={styles.formLabel}>Color</label>
              <input type="color" value={newForm.color || "#888888"} onChange={e => setNewForm(f => ({ ...f, color: e.target.value }))} style={{ display: "block", cursor: "pointer", background: "none", border: "none" }} />
            </div>
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
          {(modal === "addChap" || modal === "addNote") && <>
            <FormField label="Title *" value={newForm.title || ""} onChange={v => setNewForm(f => ({ ...f, title: v }))} />
            <FormTextarea label="Content" value={newForm.content || ""} onChange={v => setNewForm(f => ({ ...f, content: v }))} />
          </>}
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button style={styles.addBtn} onClick={addItem}>Create</button>
            <button style={{ ...styles.addBtn, background: "#2a2a2a", color: "#888" }} onClick={() => { setModal(null); setNewForm({}); }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const addActions = { Characters: "addChar", Relationships: "addRel", Chapters: "addChap", Notes: "addNote" };

  function renderStoryModal() {
    if (!showStoryModal) return null;
    return (
      <div style={styles.overlay} onClick={e => { if (e.target === e.currentTarget) { setShowStoryModal(false); setNewForm({}); } }}>
        <div style={styles.modalBox}>
          <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#e8d9c0", marginBottom: 20, borderBottom: "1px solid #333", paddingBottom: 12 }}>
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

  // ── story selection screen ─────────────────────────────────────────────────
  if (!currentStoryId) {
    return (
      <div style={styles.root}>
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Lato:wght@300;400&display=swap" rel="stylesheet" />
        {/* sidebar nav */}
        <div style={styles.sidebar}>
          <div style={styles.brand}>QWERTY</div>
          <div style={{ marginBottom: 16, padding: "0 20px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Stories</div>
            <div style={{ maxHeight: 200, overflowY: "auto", width: "100%", paddingRight: 20 }}>
              {stories.map(s => (
                <div key={s.id} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", borderRadius: 4, background: "transparent", cursor: "pointer" }} onClick={() => setCurrentStoryId(s.id)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {isEditingStories && (
                        <input type="checkbox" checked={selectedStories.has(s.id)} onChange={() => {
                          const newSet = new Set(selectedStories);
                          if (newSet.has(s.id)) newSet.delete(s.id);
                          else newSet.add(s.id);
                          setSelectedStories(newSet);
                        }} style={{ cursor: "pointer" }} />
                      )}
                      <span style={{ fontFamily: "'Cormorant Garamond', serif", color: "#b0a090", fontSize: 13 }}>{s.title}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <button style={{ background: "none", border: "1px solid #333", color: "#c97b4b", padding: "8px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, width: "100%" }} onClick={() => setShowStoryModal(true)}>New Story</button>
              <button style={{ background: isEditingStories ? "#7a3535" : "none", border: "1px solid #333", color: isEditingStories ? "#fff" : "#888", padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, width: "100%", marginTop: 8 }} onClick={() => setIsEditingStories(!isEditingStories)}>
                {isEditingStories ? "Done Editing" : "Edit Stories"}
              </button>
              {isEditingStories && selectedStories.size > 0 && (
                <button style={{ background: "#7a3535", border: "none", color: "#fff", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, width: "100%", marginTop: 8 }} onClick={() => setShowDeleteConfirm(true)}>
                  Delete Selected ({selectedStories.size})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* main content */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}>
          <div style={{ textAlign: "center", color: "#888" }}>
            <div style={{ fontSize: 32, fontFamily: "'Cormorant Garamond', serif", marginBottom: 16, color: "#c97b4b" }}>Story Organizer</div>
            <div style={{ fontSize: 14, marginBottom: 24, color: "#666" }}>Select a story to begin organizing your characters, relationships, chapters, and notes.</div>
            <div style={{ fontSize: 12, color: "#555" }}>Click "New Story" to create a fresh workspace for your next project.</div>
          </div>
        </div>

        {/* delete confirmation modal */}
        {showDeleteConfirm && (
          <div style={styles.overlay} onClick={() => setShowDeleteConfirm(false)}>
            <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#e8d9c0", marginBottom: 20, borderBottom: "1px solid #333", paddingBottom: 12 }}>
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
                <button style={{ background: "#7a3535", border: "none", color: "#fff", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12 }} onClick={() => {
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
      </div>
    );
  }

  // ── database integration ────────────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  // ── Syncthing integration ───────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState("Checking...");
  const [isSyncthingReachable, setIsSyncthingReachable] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  // Initialize local storage and Syncthing on component mount
  useEffect(() => {
    const initStorage = async () => {
      try {
        // Try to load data from local storage
        const savedStories = await localDB.loadStories();
        if (savedStories && savedStories.length > 0) {
          setStories(savedStories);
        }
      } catch (error) {
        console.error("Failed to load local data:", error);
      }

      // Check Syncthing connectivity
      const reachable = await syncthing.isReachable();
      setIsSyncthingReachable(reachable);
      
      if (reachable) {
        updateSyncStatus();
        // Poll Syncthing status every 5 seconds
        const interval = setInterval(updateSyncStatus, 5000);
        return () => clearInterval(interval);
      } else {
        setSyncStatus("Syncthing not reachable");
      }
    };

    initStorage();
  }, []);

  // Auto-save to local storage when stories change
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      setIsSaving(true);
      setSaveStatus("Saving...");
      const success = await localDB.saveStories(stories);
      if (success) {
        setSaveStatus("Saved ✓");
        setTimeout(() => setSaveStatus(""), 2000);
      } else {
        setSaveStatus("Save failed");
        setTimeout(() => setSaveStatus(""), 3000);
      }
      setIsSaving(false);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [stories]);

  // Update Syncthing sync status
  const updateSyncStatus = async () => {
    if (!isSyncthingReachable) return;

    try {
      const folderStatus = await syncthing.getFolderStatus();
      if (folderStatus) {
        // Check if there are any pending changes
        const globalState = folderStatus.globalState || {};
        const localState = folderStatus.localState || {};
        
        const globalFiles = globalState.files || 0;
        const localFiles = localState.files || 0;
        const needFiles = folderStatus.needFiles || 0;
        
        if (needFiles > 0) {
          setSyncStatus("Syncing...");
          setSyncProgress(Math.round(((globalFiles - needFiles) / globalFiles) * 100) || 0);
        } else {
          setSyncStatus("In Sync");
          setSyncProgress(100);
        }
      }
    } catch (error) {
      console.error("Failed to update Syncthing status:", error);
      setSyncStatus("Error checking status");
    }
  };

  // Manual sync trigger
  const triggerSync = async () => {
    if (!isSyncthingReachable) return;
    
    try {
      // Trigger a rescan of the folder
      const response = await fetch(`${STORAGE_CONFIG.syncthing.baseUrl}/rest/db/scan?folder=${STORAGE_CONFIG.syncthing.folderId}`, {
        method: 'POST',
        headers: {
          'X-API-Key': STORAGE_CONFIG.syncthing.apiKey || ''
        }
      });
      
      if (response.ok) {
        setSyncStatus("Syncing...");
        // Update status after a short delay
        setTimeout(updateSyncStatus, 1000);
      }
    } catch (error) {
      console.error("Failed to trigger sync:", error);
      setSyncStatus("Sync failed");
    }
  };

  // ── database UI components ──────────────────────────────────────────────────
  function renderDatabaseControls() {
    return (
      <div style={{ marginBottom: 16, padding: "0 20px" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Database</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Local Storage Section */}
          <div style={{ background: "#161616", border: "1px solid #252525", borderRadius: 6, padding: "12px", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Local Storage</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button 
                style={{ background: "#2a2a2a", border: "1px solid #333", color: "#c97b4b", padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, flex: 1 }}
                onClick={async () => {
                  const success = await localDB.saveStories(stories);
                  setSaveStatus(success ? "Local Save ✓" : "Local Save Failed");
                  setTimeout(() => setSaveStatus(""), 2000);
                }}
              >
                Save Local
              </button>
              <button 
                style={{ background: "#2a2a2a", border: "1px solid #333", color: "#c97b4b", padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, flex: 1 }}
                onClick={async () => {
                  const savedStories = await localDB.loadStories();
                  if (savedStories && savedStories.length > 0) {
                    setStories(savedStories);
                    setSaveStatus("Local Load ✓");
                    setTimeout(() => setSaveStatus(""), 2000);
                  } else {
                    setSaveStatus("No local data");
                    setTimeout(() => setSaveStatus(""), 2000);
                  }
                }}
              >
                Load Local
              </button>
            </div>
          </div>

          {/* Syncthing Section */}
          <div style={{ background: "#161616", border: "1px solid #252525", borderRadius: 6, padding: "12px" }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Syncthing Sync</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ 
                  width: 8, 
                  height: 8, 
                  borderRadius: "50%", 
                  background: isSyncthingReachable ? (syncStatus === "In Sync" ? "#4caf50" : "#ff9800") : "#f44336" 
                }} />
                <span style={{ fontSize: 12, color: isSyncthingReachable ? "#c9b99a" : "#666" }}>
                  {isSyncthingReachable ? syncStatus : "Not Connected"}
                </span>
              </div>
              <button 
                style={{ background: "#2a2a2a", border: "1px solid #333", color: "#c97b4b", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                onClick={triggerSync}
                disabled={!isSyncthingReachable}
              >
                Sync Now
              </button>
            </div>
            {syncProgress > 0 && syncProgress < 100 && (
              <div style={{ width: "100%", height: 4, background: "#333", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${syncProgress}%`, height: "100%", background: "#c97b4b", transition: "width 0.3s" }} />
              </div>
            )}
          </div>

          {/* Google Sheets Section (optional) */}
          {!isAuthenticated ? (
            <button 
              style={{ background: "#c97b4b", border: "none", color: "#0d0d0d", padding: "8px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, width: "100%" }}
              onClick={async () => {
                const success = await db.signIn();
                setIsAuthenticated(success);
                if (success) {
                  const savedStories = await db.loadStories();
                  if (savedStories && savedStories.length > 0) {
                    setStories(savedStories);
                  }
                }
              }}
            >
              Connect to Google Sheets
            </button>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Connected ✓</div>
              <button 
                style={{ background: "none", border: "1px solid #333", color: "#888", padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, width: "100%" }}
                onClick={async () => {
                  await db.signOut();
                  setIsAuthenticated(false);
                }}
              >
                Disconnect
              </button>
              <button 
                style={{ background: "none", border: "1px solid #333", color: "#c97b4b", padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, width: "100%" }}
                onClick={async () => {
                  setIsSaving(true);
                  setSaveStatus("Saving...");
                  const success = await db.saveStories(stories);
                  if (success) {
                    setSaveStatus("Saved ✓");
                    setTimeout(() => setSaveStatus(""), 2000);
                  } else {
                    setSaveStatus("Save failed");
                    setTimeout(() => setSaveStatus(""), 3000);
                  }
                  setIsSaving(false);
                }}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save Now"}
              </button>
              <button 
                style={{ background: "none", border: "1px solid #333", color: "#c97b4b", padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, width: "100%" }}
                onClick={async () => {
                  const savedStories = await db.loadStories();
                  if (savedStories && savedStories.length > 0) {
                    setStories(savedStories);
                    setSaveStatus("Loaded ✓");
                    setTimeout(() => setSaveStatus(""), 2000);
                  } else {
                    setSaveStatus("No data found");
                    setTimeout(() => setSaveStatus(""), 3000);
                  }
                }}
              >
                Load Data
              </button>
            </>
          )}
          {saveStatus && (
            <div style={{ 
              fontSize: 11, 
              color: saveStatus.includes("failed") ? "#7a3535" : "#c97b4b", 
              marginTop: 8,
              minHeight: 14
            }}>
              {saveStatus}
            </div>
          )}
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
            <div style={{ fontSize: 24, fontFamily: "'Cormorant Garamond', serif", marginBottom: 16, color: "#c97b4b" }}>Loading Story...</div>
            <div style={{ fontSize: 14, color: "#666" }}>Please wait while we load your story.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Lato:wght@300;400&display=swap" rel="stylesheet" />
      {/* sidebar nav */}
      <div style={styles.sidebar}>
        <div style={styles.brand}>QWERTY</div>
        <div style={{ marginBottom: 16, padding: "0 20px" }}>
          <div style={{ marginBottom: 12 }}>
            <button style={{ background: "none", border: "1px solid #333", color: "#c97b4b", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }} onClick={() => setCurrentStoryId(null)}>
              <span style={{ fontSize: 16 }}>&larr;</span> Back
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <span style={{ fontFamily: "'Cormorant Garamond', serif", color: "#e8d9c0", fontSize: 14 }}>{currentStory.title}</span>
          </div>
        </div>
        {SECTIONS.map(s => (
          <button key={s} style={{ ...styles.navBtn, ...(s === section ? styles.navActive : {}) }} onClick={() => { setSection(s); setSelected(null); }}>
            {s}
          </button>
        ))}
        {renderDatabaseControls()}
      </div>

      {/* list panel */}
      <div style={styles.list}>
        <div style={styles.listHeader}>
          <span style={styles.listTitle}>{section}</span>
          <button style={styles.plusBtn} onClick={() => setModal(addActions[section])}>+</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {items.map(item => {
            const isActive = selected === item.id;
            let label = item.name || item.title || "Untitled";
            if (section === "Relationships") {
              const cA = charMap[item.charA], cB = charMap[item.charB];
              label = `${cA?.name || "?"} & ${cB?.name || "?"}`;
            }
            return (
              <div key={item.id} style={{ ...styles.listItem, ...(isActive ? styles.listItemActive : {}) }} onClick={() => setSelected(item.id)}>
                {section === "Characters" && <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color || "#888", marginRight: 10, flexShrink: 0 }} />}
                <div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: isActive ? "#e8d9c0" : "#b0a090" }}>{label}</div>
                </div>
              </div>
            );
          })}
          {items.length === 0 && <div style={{ padding: "24px 16px", color: "#555", fontStyle: "italic", fontSize: 13 }}>Nothing here yet.</div>}
        </div>
      </div>

      {/* detail panel */}
      <div style={styles.detailPanel}>
        {renderDetail()}
      </div>

        {renderModal()}
      {renderStoryModal()}

      {/* character deletion confirmation modal */}
      {itemToDelete && (
        <div style={styles.overlay} onClick={() => setItemToDelete(null)}>
          <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#e8d9c0", marginBottom: 20, borderBottom: "1px solid #333", paddingBottom: 12 }}>
              Delete {itemToDelete.type.charAt(0).toUpperCase() + itemToDelete.type.slice(1)}
            </h3>
            <div style={{ fontSize: 14, color: "#c9b99a", marginBottom: 24 }}>
              Are you sure you want to delete "{itemToDelete.name}"?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={{ background: "none", border: "1px solid #333", color: "#888", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12 }} onClick={() => setItemToDelete(null)}>Keep</button>
              <button style={{ background: "#7a3535", border: "none", color: "#fff", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12 }} onClick={() => {
                if (itemToDelete.type === "character") {
                  deleteItem("characters", itemToDelete.id);
                } else if (itemToDelete.type === "relationship") {
                  deleteItem("relationships", itemToDelete.id);
                } else if (itemToDelete.type === "chapter") {
                  deleteItem("chapters", itemToDelete.id);
                } else if (itemToDelete.type === "note") {
                  deleteItem("notes", itemToDelete.id);
                }
                setItemToDelete(null);
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── sub-components ─────────────────────────────────────────────────────────────
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
    <span style={{ fontFamily: "'Cormorant Garamond', serif", color: "#c9b99a", fontSize: 16, fontStyle: "italic" }}>{c.name}</span>
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

// ── styles ─────────────────────────────────────────────────────────────────────
const styles = {
  root: { display: "flex", height: "100vh", background: "#111", fontFamily: "'Lato', sans-serif", color: "#c9b99a", overflow: "hidden" },
  sidebar: { width: 140, background: "#0d0d0d", borderRight: "1px solid #222", display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0 },
  brand: { fontFamily: "'Cormorant Garamond', serif", fontSize: 18, letterSpacing: "0.25em", color: "#c97b4b", padding: "0 20px 28px", borderBottom: "1px solid #1f1f1f", marginBottom: 16 },
  navBtn: { background: "none", border: "none", textAlign: "left", padding: "10px 20px", cursor: "pointer", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#555", transition: "color 0.2s" },
  navActive: { color: "#c97b4b", borderLeft: "2px solid #c97b4b" },
  list: { width: 220, background: "#141414", borderRight: "1px solid #1e1e1e", display: "flex", flexDirection: "column", flexShrink: 0 },
  listHeader: { padding: "20px 16px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e1e1e" },
  listTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 17, color: "#e8d9c0" },
  plusBtn: { background: "#1e1e1e", border: "1px solid #333", color: "#c97b4b", width: 26, height: 26, borderRadius: 4, cursor: "pointer", fontSize: 18, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  listItem: { display: "flex", alignItems: "center", padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #1a1a1a", transition: "background 0.15s" },
  listItemActive: { background: "#1d1d1d" },
  detailPanel: { flex: 1, overflowY: "auto", padding: "32px 40px" },
  detail: { maxWidth: 660 },
  detailTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#e8d9c0", marginBottom: 20, fontWeight: 600 },
  detailSub: { fontSize: 13, color: "#888", marginBottom: 20, letterSpacing: "0.05em" },
  detailBody: { fontSize: 14, color: "#b0a090", lineHeight: 1.75, marginBottom: 28, minHeight: 60 },
  relCard: { background: "#161616", border: "1px solid #252525", borderRadius: 6, padding: "14px 16px", marginBottom: 14 },
  empty: { color: "#444", fontStyle: "italic", fontSize: 14, marginTop: 48 },
  deleteBtn: { background: "none", border: "1px solid #3a1a1a", color: "#7a3535", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 12, letterSpacing: "0.05em", marginTop: 16 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modalBox: { background: "#161616", border: "1px solid #2a2a2a", borderRadius: 8, padding: 28, width: 440, maxWidth: "90vw", maxHeight: "90vh", overflowY: "auto" },
  formLabel: { display: "block", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#666", marginBottom: 5 },
  formInput: { width: "100%", background: "#1a1a1a", border: "1px solid #333", borderRadius: 4, padding: "8px 10px", color: "#c9b99a", fontSize: 14, fontFamily: "'Lato', sans-serif", outline: "none", boxSizing: "border-box" },
  select: { width: "100%", background: "#1a1a1a", border: "1px solid #333", borderRadius: 4, padding: "8px 10px", color: "#c9b99a", fontSize: 14, outline: "none", boxSizing: "border-box" },
  addBtn: { background: "#c97b4b", border: "none", color: "#0d0d0d", padding: "9px 20px", borderRadius: 4, cursor: "pointer", fontSize: 13, fontWeight: 600, letterSpacing: "0.05em" },
};
