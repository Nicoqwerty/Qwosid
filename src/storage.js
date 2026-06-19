// ── tiny uid ──────────────────────────────────────────────────────────────────
export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ── persistence ───────────────────────────────────────────────────────────────
// Primary store is a JSON file on disk (via Electron IPC); localStorage is kept
// as a mirror so the browser dev mode still works and old data migrates forward.
export const localDB = {
  async save(stories, currentStoryId, folders) {
    let localOk = true;
    try {
      localStorage.setItem('qwosid_stories', JSON.stringify(stories));
      localStorage.setItem('qwosid_folders', JSON.stringify(folders || []));
      if (currentStoryId) {
        localStorage.setItem('qwosid_currentStoryId', currentStoryId);
      } else {
        localStorage.removeItem('qwosid_currentStoryId');
      }
    } catch (error) {
      console.error("Error saving to localStorage:", error);
      localOk = false;
    }

    if (window.electronAPI?.saveData) {
      try {
        const payload = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), stories, currentStoryId, folders: folders || [] });
        const res = await window.electronAPI.saveData(payload);
        if (!res?.ok) console.error("Error saving data file:", res?.error);
        return !!res?.ok; // file is the primary store in Electron
      } catch (error) {
        console.error("Error saving data file:", error);
        return false;
      }
    }
    return localOk;
  },

  async load() {
    // 1. Disk file (primary, Electron only)
    if (window.electronAPI?.loadData) {
      try {
        const res = await window.electronAPI.loadData();
        if (res?.ok && res.data) {
          const parsed = JSON.parse(res.data);
          if (Array.isArray(parsed.stories) && parsed.stories.length > 0) {
            return { stories: parsed.stories, currentStoryId: parsed.currentStoryId || null, folders: parsed.folders || [] };
          }
        }
      } catch (error) {
        console.error("Error loading data file, falling back to localStorage:", error);
      }
    }

    // 2. localStorage (fallback / pre-file-storage data — migrates to disk on next save)
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
