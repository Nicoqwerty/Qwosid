import { useState, useRef, useEffect } from "react";
import { styles, CHARACTER_TRAITS } from "./constants.js";

// ── link chips ─────────────────────────────────────────────────────────────────

// Clean pasted HTML: turn list items into plain lines that keep a literal
// bullet (no list indentation), and strip indent-related inline styles, while
// preserving inline formatting (bold/italic/colour). Falls back to plain text.
function sanitizePaste(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  body.querySelectorAll("script, style, meta, link, title").forEach(el => el.remove());
  body.querySelectorAll("ul, ol").forEach(list => {
    const frag = doc.createDocumentFragment();
    list.querySelectorAll(":scope > li").forEach(li => {
      const div = doc.createElement("div");
      div.appendChild(doc.createTextNode("• "));
      while (li.firstChild) div.appendChild(li.firstChild);
      frag.appendChild(div);
    });
    list.replaceWith(frag);
  });
  body.querySelectorAll("[style]").forEach(el => {
    for (const prop of ["margin", "margin-left", "padding", "padding-left", "text-indent"]) {
      el.style.removeProperty(prop);
    }
  });
  return body.innerHTML;
}

// Tab inserts a tab character in a textarea instead of moving focus away
function textareaTab(e, value, setValue) {
  if (e.key !== "Tab" || e.shiftKey) return;
  e.preventDefault();
  const ta = e.target;
  const start = ta.selectionStart, end = ta.selectionEnd;
  setValue(value.slice(0, start) + "\t" + value.slice(end));
  requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
}

export const LINK_RE = /\[\[([^|\]]+)\|([^|\]]+)\|([^\]]+)\]\]/g;

export function parseAndRenderLinks(text, onNavigate) {
  const parts = [];
  let last = 0, key = 0;
  const re = new RegExp(LINK_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const [, name, sec, id] = m;
    parts.push(
      <button key={key++} onClick={() => onNavigate?.(sec, id)}
        style={{ background: "var(--c-0d1428)", border: "2px solid var(--c-7dd3fc)", color: "var(--c-7dd3fc)", padding: "1px 9px", borderRadius: 5, cursor: "pointer", fontSize: 13, fontFamily: "'Fredoka', sans-serif", fontWeight: 600, margin: "0 3px", verticalAlign: "middle" }}>
        🔗 {name}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

// Renders stored HTML + [[link]] markers as React with clickable link buttons
export function renderRichPreview(html, onNavigate) {
  const processed = (html || '')
    .replace(/\[\[([^|\]]+)\|([^|\]]+)\|([^\]]+)\]\]/g,
      (_, name, sec, id) =>
        `<button data-sec="${sec}" data-id="${id}" style="background:var(--c-0d1428);border:2px solid var(--c-7dd3fc);color:var(--c-7dd3fc);padding:1px 9px;border-radius:5px;cursor:pointer;font-size:13px;font-family:'Fredoka',sans-serif;font-weight:600;margin:0 3px;vertical-align:middle">🔗 ${name}</button>`
    );
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "var(--c-111)", border: "2px solid var(--c-2a2a2a)", borderRadius: 10, color: "var(--c-c9b99a)", fontSize: 15, fontFamily: "'Fredoka', sans-serif", lineHeight: 1.8, boxSizing: "border-box" }}
      dangerouslySetInnerHTML={{ __html: processed }}
      onClick={e => { const b = e.target.closest('[data-sec]'); if (b) { e.preventDefault(); onNavigate?.(b.dataset.sec, b.dataset.id); } }}
    />
  );
}

const QLINK_SPAN = name => `<span contenteditable="false" data-qlink="1" style="display:inline-flex;align-items:center;background:var(--c-0d1428);border:2px solid var(--c-7dd3fc);color:var(--c-7dd3fc);padding:2px 10px;border-radius:20px;font-size:0.88em;font-family:'Fredoka',sans-serif;font-weight:600;margin:0 3px;user-select:none;cursor:pointer;vertical-align:middle">🔗 ${name}</span>`;

// ── chapter editor ─────────────────────────────────────────────────────────────

const SCENE_RE = /^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/i;

export function ChapterEditor({ content, onSave, requestLink, onNavigate }) {
  const editorRef  = useRef(null);
  const timerRef   = useRef(null);
  const menuRef    = useRef(null);
  const sceneMenuRef = useRef(null);
  const [wordCount, setWordCount] = useState(0);
  const [scenes, setScenes] = useState([]);
  const [sceneMenu, setSceneMenu] = useState(false);
  const [linkMenu,  setLinkMenu]  = useState(null); // { x, y, el }

  useEffect(() => {
    if (editorRef.current && !editorRef.current.matches(':focus')) {
      editorRef.current.innerHTML = content || '';
      updateStats();
    }
  }, [content]);

  // Close menus on outside click
  useEffect(() => {
    if (!linkMenu && !sceneMenu) return;
    const close = e => {
      if (linkMenu && !menuRef.current?.contains(e.target)) setLinkMenu(null);
      if (sceneMenu && !sceneMenuRef.current?.contains(e.target)) setSceneMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [linkMenu, sceneMenu]);

  function updateStats() {
    const t = editorRef.current?.innerText || '';
    setWordCount(t.trim() ? t.trim().split(/\s+/).length : 0);
    setScenes(t.split('\n').map(l => l.trim()).filter(l => SCENE_RE.test(l)));
  }

  // Scene headings live in text nodes; find the nth one in DOM order and scroll to it
  function jumpToScene(idx) {
    setSceneMenu(false);
    const root = editorRef.current;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (SCENE_RE.test(node.textContent.trim())) {
        if (n === idx) {
          (node.parentElement || root).scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        n++;
      }
    }
  }

  function renderLinks() {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    // Match raw [[Name|Section|id]] text that hasn't been rendered yet
    const next = html.replace(/\[\[([^|\]]+)\|([^|\]]+)\|([^\]]+)\]\]/g,
      (_, name, sec, id) => {
        const span = QLINK_SPAN(name);
        // Embed sec/id in a way we can recover later — wrap in a data div
        return span.replace('data-qlink="1"', `data-qlink="1" data-sec="${sec}" data-id="${id}" data-name="${name}"`);
      }
    );
    if (next !== html) {
      const sel = window.getSelection();
      const focused = document.activeElement === editorRef.current;
      editorRef.current.innerHTML = next;
      if (focused) { sel.selectAllChildren(editorRef.current); sel.collapseToEnd(); }
      onSave(editorRef.current.innerHTML);
    }
  }

  function save() {
    if (editorRef.current) onSave(editorRef.current.innerHTML);
  }

  function onInput() {
    updateStats();
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(renderLinks, 3000);
  }

  function onBlur() {
    clearTimeout(timerRef.current);
    renderLinks();
    save();
  }

  function cmd(command) {
    document.execCommand(command, false, null);
    editorRef.current?.focus();
  }

  function handleInsertLink() {
    const sel = window.getSelection();
    const saved = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    requestLink(linkText => {
      editorRef.current?.focus();
      if (saved) { sel.removeAllRanges(); sel.addRange(saved); }
      document.execCommand('insertText', false, linkText);
      save();
    });
  }

  function onContextMenu(e) {
    const span = e.target.closest('[data-qlink]');
    if (!span) return;
    e.preventDefault();
    setLinkMenu({ x: e.clientX, y: e.clientY, el: span });
  }

  function onEditorClick(e) {
    const span = e.target.closest('[data-qlink]');
    if (span && onNavigate && !window.getSelection()?.toString()) {
      onNavigate(span.dataset.sec, span.dataset.id);
    }
  }

  function changeLink() {
    const span = linkMenu?.el;
    setLinkMenu(null);
    if (!span || !requestLink) return;
    requestLink(linkText => {
      span.replaceWith(document.createTextNode(linkText));
      renderLinks();
    });
  }

  function removeLink() {
    const span = linkMenu?.el;
    setLinkMenu(null);
    if (!span) return;
    span.remove();
    save();
  }

  // Font colour — picking from the swatch moves focus out of the editor, so we
  // save the selection on mousedown and restore it before applying the colour.
  const colorRange = useRef(null);
  function saveSelection() {
    const s = window.getSelection();
    colorRange.current = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  }
  function applyColor(color) {
    editorRef.current?.focus();
    if (colorRange.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(colorRange.current);
    }
    document.execCommand('foreColor', false, color);
    save();
  }

  // Tab inserts an indent instead of moving focus (nbsp so it always renders)
  function onKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '    ');
    }
  }

  // Paste: keep bullets as literal chars but drop list indentation
  function onPaste(e) {
    const data = e.clipboardData;
    if (!data) return;
    const html = data.getData('text/html');
    e.preventDefault();
    if (html) document.execCommand('insertHTML', false, sanitizePaste(html));
    else document.execCommand('insertText', false, data.getData('text/plain'));
    updateStats();
    save();
  }

  const TB = { background: "none", border: "1px solid var(--c-2a2a2a)", color: "#888", cursor: "pointer", borderRadius: 4, padding: "2px 9px", fontFamily: "'Fredoka', sans-serif", fontSize: 12 };
  const SWATCHES = ["var(--c-c9b99a)", "var(--c-ff1d8e)", "var(--c-7dd3fc)", "#22c55e", "#f59e0b", "#ffffff"];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 4, padding: "4px 10px", borderBottom: "1px solid var(--c-1e1e1e)", flexShrink: 0, alignItems: "center", background: "var(--c-0d0d0d)", position: "relative" }}>
        <button title="Bold"         onMouseDown={e => { e.preventDefault(); cmd('bold'); }}          style={{ ...TB, fontWeight: 900 }}>B</button>
        <button title="Italic"       onMouseDown={e => { e.preventDefault(); cmd('italic'); }}        style={{ ...TB, fontStyle: "italic" }}>I</button>
        <div style={{ width: 1, height: 14, background: "var(--c-2a2a2a)", margin: "0 2px" }} />
        <button title="Align left"   onMouseDown={e => { e.preventDefault(); cmd('justifyLeft'); }}  style={{ ...TB, letterSpacing: 1 }}>≡L</button>
        <button title="Align center" onMouseDown={e => { e.preventDefault(); cmd('justifyCenter'); }}style={{ ...TB, letterSpacing: 1 }}>≡C</button>
        <div style={{ width: 1, height: 14, background: "var(--c-2a2a2a)", margin: "0 2px" }} />
        {/* font colour: quick swatches + custom picker */}
        {SWATCHES.map(c => (
          <button key={c} title={`Text colour ${c}`} onMouseDown={e => { e.preventDefault(); saveSelection(); applyColor(c); }}
            style={{ width: 15, height: 15, borderRadius: "50%", background: c, border: "1px solid var(--c-2a2a2a)", cursor: "pointer", padding: 0, flexShrink: 0 }} />
        ))}
        <label title="Custom text colour" style={{ position: "relative", width: 16, height: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 13, fontWeight: 900, border: "1px solid var(--c-2a2a2a)", borderRadius: 4 }}
          onMouseDown={saveSelection}>
          🎨
          <input type="color" defaultValue="var(--c-c9b99a)" onChange={e => applyColor(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
        </label>
        {requestLink && <>
          <div style={{ width: 1, height: 14, background: "var(--c-2a2a2a)", margin: "0 2px" }} />
          <button onClick={handleInsertLink} style={{ ...TB, color: "var(--c-7dd3fc)", borderColor: "#3a3a3a" }}>🔗 Link</button>
        </>}
        {scenes.length > 0 && (
          <div ref={sceneMenuRef} style={{ position: "relative" }}>
            <button onClick={() => setSceneMenu(v => !v)} style={{ ...TB, color: "var(--c-c050a0)", borderColor: "#3a3a3a" }}>🎬 Scenes ({scenes.length})</button>
            {sceneMenu && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: "var(--c-1a1a1a)", border: "1px solid var(--c-2a2a2a)", borderRadius: 8, zIndex: 50, padding: "4px 0", boxShadow: "0 4px 20px rgba(0,0,0,0.7)", minWidth: 260, maxHeight: 320, overflowY: "auto" }}>
                {scenes.map((s, i) => (
                  <div key={i} onMouseDown={e => { e.preventDefault(); jumpToScene(i); }}
                    style={{ padding: "7px 14px", cursor: "pointer", color: "var(--c-c9b99a)", fontSize: 12, fontFamily: "'Fredoka', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360 }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--c-28102a)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ color: "#555", marginRight: 8 }}>{i + 1}</span>{s.toUpperCase()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <span style={{ fontSize: 11, color: "#444", marginLeft: "auto" }}>{wordCount.toLocaleString()} words</span>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={onBlur}
        onClick={onEditorClick}
        onContextMenu={onContextMenu}
        style={{ flex: 1, outline: "none", padding: "20px 24px", color: "var(--c-c9b99a)", fontSize: 15, fontFamily: "'Fredoka', sans-serif", lineHeight: 1.8, overflowY: "auto", background: "var(--c-111)", border: "2px solid var(--c-2a2a2a)", borderRadius: 10, boxSizing: "border-box" }}
      />
      {linkMenu && (
        <div ref={menuRef} style={{ position: "fixed", top: linkMenu.y, left: linkMenu.x, background: "var(--c-1a1a1a)", border: "1px solid var(--c-2a2a2a)", borderRadius: 8, zIndex: 9999, padding: "4px 0", boxShadow: "0 4px 20px rgba(0,0,0,0.7)", minWidth: 150 }}>
          <div onMouseDown={e => { e.stopPropagation(); changeLink(); }} style={{ padding: "8px 16px", cursor: "pointer", color: "var(--c-7dd3fc)", fontSize: 13, fontFamily: "'Fredoka', sans-serif" }}>Change link…</div>
          <div onMouseDown={e => { e.stopPropagation(); removeLink(); }} style={{ padding: "8px 16px", cursor: "pointer", color: "var(--c-ff1d8e)", fontSize: 13, fontFamily: "'Fredoka', sans-serif" }}>Remove link</div>
        </div>
      )}
    </div>
  );
}

// ── small shared components ────────────────────────────────────────────────────

export function PinIcon({ pinned }) {
  // Pushpin: flat head, tapered body, needle — tilted 35° when pinned (stuck in)
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ transform: pinned ? "rotate(35deg)" : "none", transition: "transform 0.15s ease" }}>
      <path
        d="M16 3H8V5H9V11L6.5 13.5V15H11V21L12 22.5L13 21V15H17.5V13.5L15 11V5H16V3Z"
        fill={pinned ? "var(--c-ff1d8e)" : "none"}
        stroke={pinned ? "var(--c-ff1d8e)" : "#555"}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Hollow, pink-outlined folder
export function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path
        d="M3 6.5C3 5.67 3.67 5 4.5 5H9L11 7.5H19.5C20.33 7.5 21 8.17 21 9V17.5C21 18.33 20.33 19 19.5 19H4.5C3.67 19 3 18.33 3 17.5V6.5Z"
        fill="none"
        stroke="var(--c-ff1d8e)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EditableText({ val, style, onEdit, display }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(val);
  // display: show this text instead of the real value, non-editable (disguise mode)
  if (display != null) return <div style={{ ...style, cursor: "default" }}>{display}</div>;
  if (editing) return (
    <input autoFocus value={v} onChange={e => setV(e.target.value)}
      onBlur={() => { onEdit(v); setEditing(false); }}
      onKeyDown={e => { if (e.key === "Enter") { onEdit(v); setEditing(false); } }}
      style={{ ...style, background: "var(--c-1a1a1a)", border: "1px solid #444", borderRadius: 4, padding: "2px 6px", color: "var(--c-e8d9c0)", width: "100%", outline: "none" }} />
  );
  return <div style={{ ...style, cursor: "text" }} onClick={() => { setV(val); setEditing(true); }} title="Click to edit">{val}</div>;
}

export function EditableArea({ val, style, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(val);
  if (editing) return (
    <textarea autoFocus value={v} onChange={e => setV(e.target.value)}
      onKeyDown={e => textareaTab(e, v, setV)}
      onBlur={() => { onEdit(v); setEditing(false); }}
      style={{ ...style, background: "var(--c-1a1a1a)", border: "1px solid #444", borderRadius: 4, padding: "8px", color: "var(--c-c9b99a)", width: "100%", resize: "vertical", outline: "none", fontFamily: "inherit", lineHeight: 1.6, tabSize: 4 }} />
  );
  return <div style={{ ...style, cursor: "text", whiteSpace: "pre-wrap" }} onClick={() => { setV(val); setEditing(true); }} title="Click to edit">{val || <span style={{ color: "#555", fontStyle: "italic" }}>Click to add…</span>}</div>;
}

export function CharBadge({ c }) {
  if (!c) return <span style={{ color: "#555" }}>Unknown</span>;
  return <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div style={{ width: 10, height: 10, borderRadius: "50%", background: c.color }} />
    <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: "var(--c-7dd3fc)", fontSize: 16 }}>{c.name}</span>
  </span>;
}

export function Label({ children }) {
  return <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#666", marginBottom: 6 }}>{children}</div>;
}

export function FormField({ label, value, onChange }) {
  return <div style={{ marginBottom: 12 }}>
    <label style={styles.formLabel}>{label}</label>
    <input value={value} onChange={e => onChange(e.target.value)} style={styles.formInput} />
  </div>;
}

export function FormTextarea({ label, value, onChange }) {
  return <div style={{ marginBottom: 12 }}>
    <label style={styles.formLabel}>{label}</label>
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={4} onKeyDown={e => textareaTab(e, value, onChange)} style={{ ...styles.formInput, resize: "vertical", tabSize: 4 }} />
  </div>;
}

export function OutlineEditor({ outline, charId, onUpdate, onAdd, onReorder, onRequestDelete }) {
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
            background: "var(--c-161616)",
            border: `2px solid ${dragOverIdx === idx ? "var(--c-ff1d8e)" : "var(--c-2a2a2a)"}`,
            borderRadius: 10,
            padding: "12px 14px 12px",
            marginBottom: 12,
            boxShadow: dragOverIdx === idx ? "0 0 0 2px var(--c-ff1d8e40)" : "2px 2px 0 var(--c-0d0d0d)",
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
              style={{ background: "var(--c-1a0828)", border: "2px solid var(--c-ff1d8e)", color: "var(--c-ff1d8e)", width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}
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

export function ColorFieldWithHistory({ label, value, prevValue, onEdit }) {
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
        <div style={{ width: 32, height: 32, borderRadius: 8, background: current, border: "2px solid #333", boxShadow: "2px 2px 0 var(--c-0a0a0a)", flexShrink: 0 }} title="Current" />
        {showPrev && <>
          <span style={{ color: "#555", fontSize: 18, fontWeight: 700, lineHeight: 1 }}>←</span>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: prevValue, border: "1px solid #444", opacity: 0.55, flexShrink: 0 }} title="Previous colour" />
        </>}
        <span style={{ fontSize: 11, color: "#666", fontFamily: "monospace", letterSpacing: "0.04em" }}>{current}</span>
      </div>
    </div>
  );
}

export function HairstyleInput({ hairstyles, onEdit }) {
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
            <div key={h} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--c-1a1a1a)", border: "2px solid var(--c-2a2a2a)", borderRadius: 20, padding: "4px 8px 4px 12px" }}>
              <span style={{ fontSize: 13, color: "var(--c-c9b99a)", fontWeight: 500, fontFamily: "'Fredoka', sans-serif" }}>{h}</span>
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

export function TraitSelector({ traits, onEdit }) {
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
              background: active ? "var(--c-ff1d8e)" : "var(--c-1a1a1a)",
              border: `2px solid ${active ? "var(--c-ff1d8e)" : "var(--c-2a2a2a)"}`,
              color: active ? "var(--c-0d0d0d)" : "#777",
              padding: "5px 13px",
              borderRadius: 20,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              fontFamily: "'Fredoka', sans-serif",
              boxShadow: active ? "2px 2px 0 var(--c-3a0a2e)" : "none",
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
