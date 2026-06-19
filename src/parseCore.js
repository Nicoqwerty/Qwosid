// Pure text-parsing logic for PDF import — no pdfjs dependency, so it is
// importable (and testable) in Node without browser APIs.

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const BLANK = {
  color: '#888', skinColor: '', eyeColor: '', hairColor: '',
  hairstyles: [], ethnicity: '', traits: [], outline: [],
};

// ── font tier detection ──────────────────────────────────────────────────────
// Body = most common font size. Anything 8%+ larger = subheading, 20%+ = heading.

function computeTiers(lines) {
  const sizes = lines.map(l => l.fontSize).filter(s => s > 0);
  if (!sizes.length) return { body: 0, subheading: Infinity, heading: Infinity };

  const freq = {};
  for (const s of sizes) freq[s] = (freq[s] || 0) + 1;
  const body = parseFloat(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);

  return {
    body,
    subheading: body * 1.08,
    heading:    body * 1.2,
  };
}

// ── line classification ──────────────────────────────────────────────────────
// Returns a role string for each line.

const CHAR_FIELDS_RE = /^(name|age|role|bio|description|occupation|background|backstory|ethnicity|race|eye color|eyes|hair color|hair|skin color|skin)\s*:/i;
const CHAR_CUE_RE    = /^[A-Z][A-Z\s\(\)'\-]{1,30}$/;
const CUE_EXCLUSIONS = /^(INT|EXT|FADE|CUT|SMASH|TITLE|THE END|ACT|SCENE|PAGE)/;
const SCENE_RE       = /^(INT|EXT)\.\s/i;
const TRANSITION_RE  = /^(FADE IN|FADE OUT|CUT TO|SMASH CUT|MATCH CUT)/i;
const BULLET_RE      = /^[\*\-–•]\s+\S|^\d+[\.\)]\s+\S/;
const ACT_RE         = /^ACT\s+(ONE|TWO|THREE|FOUR|I{1,3}V?|IV|VI{0,3}|\d+)/i;
const CHAPTER_RE     = /^(chapter|ch\.?|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword)[\s\d]/i;
// Only these titles actually become chapter items; everything else becomes a note
const CHAPTER_TITLE_RE = /^(prologue|epilogue)$|^chapter\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(\s*[:–\-].+)?$/i;
// Relationship header: two names joined by / & or vs  e.g. "John / Mary"  "Alice & Bob"  "Jess vs Tom"
const REL_RE = /^([A-Za-z][A-Za-z'\-\s]{1,28}?)\s*(?:\/|&)\s*([A-Za-z][A-Za-z'\-\s]{1,28})$|^([A-Za-z][A-Za-z'\-\s]{1,28}?)\s+vs\.?\s+([A-Za-z][A-Za-z'\-\s]{1,28})$/i;

function parseRelNames(t) {
  const m = t.match(/^(.+?)\s*(?:\/|&)\s*(.+)$/) || t.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function classifyLine({ text, fontSize }, tiers) {
  const t = text.trim();
  if (!t) return 'blank';

  if (TRANSITION_RE.test(t))                                  return 'transition';
  if (ACT_RE.test(t))                                         return 'act-heading';
  if (SCENE_RE.test(t))                                       return 'scene-heading';
  if (CHAR_FIELDS_RE.test(t))                                 return 'char-field';
  if (BULLET_RE.test(t))                                      return 'bullet';
  if (CHAPTER_RE.test(t))                                     return 'chapter-keyword';

  // Relationship header — check before font-size headings so "John / Mary" isn't treated as chapter
  if (REL_RE.test(t) && t.length < 60)                        return 'relationship';

  // Font-size based headings (only when we have real size variation)
  if (tiers.heading < Infinity && fontSize >= tiers.heading)     return 'heading';
  if (tiers.subheading < Infinity && fontSize >= tiers.subheading) return 'subheading';

  // Screenplay character cue: ALL CAPS, short, not a known keyword
  if (CHAR_CUE_RE.test(t) && !CUE_EXCLUSIONS.test(t) && t.length < 36) return 'char-cue';

  return 'body';
}

// ── smart unified parser ─────────────────────────────────────────────────────

export function smartParse(lines) {
  if (!lines.length) return { chapters: [], characters: [], notes: [] };

  const tiers = computeTiers(lines);
  const annotated = lines.map(l => ({ ...l, role: classifyLine(l, tiers) }));

  const items = [];
  const charCueNames = new Set(); // screenplay cues — deduped into characters at end
  const knownCharNames = new Set(); // tracks names already pushed to items

  let cur = null;

  function newItem(title, isCharCue = false) {
    cur = { id: uid(), title, bodyText: '', bullets: [], charFields: [], _isCharCue: isCharCue };
  }

  const FIELD_MAP = {
    name: 'name', role: 'role', occupation: 'role', job: 'role',
    bio: 'bio', description: 'bio', background: 'bio', backstory: 'bio',
    ethnicity: 'ethnicity', race: 'ethnicity',
    'eye color': 'eyeColor', eyes: 'eyeColor',
    'hair color': 'hairColor', hair: 'hairColor',
    skin: 'skinColor', 'skin color': 'skinColor',
  };

  function flush() {
    if (!cur) return;

    const hasCharFields = cur.charFields.length > 0;
    const hasBullets    = cur.bullets.length > 0;
    const hasBody       = cur.bodyText.trim().length > 0;

    // ── char-cue items (ALL CAPS names from screenplay / name headings) ──
    if (cur._isCharCue) {
      const name = cur.title;
      charCueNames.add(name); // always register as a character

      if (hasBullets) {
        // Name + bullets → note group (bullets become subnotes), linked to character by name
        items.push({
          ...BLANK, id: uid(), type: 'note',
          title: name, name, content: '', role: '',
          subnotes: cur.bullets.map(b => ({ id: uid(), title: b, content: '' })),
        });
      }
      // Body text under a char-cue (screenplay dialogue) is intentionally discarded;
      // scene chapters already capture scene-level content.
      cur = null; return;
    }

    // ── relationship items ──
    if (cur._isRelationship) {
      items.push({
        ...BLANK, id: cur.id, type: 'relationship',
        title: cur.title, name: cur.title,
        nameA: cur._nameA, nameB: cur._nameB,
        content: cur.bodyText.trim(), role: '', subnotes: [],
      });
      // Ensure both names are tracked as characters
      charCueNames.add(cur._nameA);
      charCueNames.add(cur._nameB);
      cur = null; return;
    }

    // ── char-field items (Name: / Bio: key-value blocks) ──
    if (hasCharFields) {
      const fields = {};
      for (const f of cur.charFields) {
        const m = f.match(/^([^:]{1,30})\s*:\s*(.+)/);
        if (m) fields[m[1].trim().toLowerCase()] = m[2].trim();
      }
      const c = { ...BLANK, id: cur.id, type: 'character', color: '#888' };
      c.name = fields.name || cur.title;
      c.title = c.name;
      c.role = fields.role || fields.occupation || '';
      c.bio  = fields.bio || fields.description || fields.background || cur.bodyText.trim();
      for (const [k, v] of Object.entries(fields)) {
        const mapped = FIELD_MAP[k];
        if (mapped && !['name', 'role', 'bio'].includes(mapped)) c[mapped] = v;
      }
      c.content = c.bio;
      c.subnotes = [];
      if (!knownCharNames.has(c.name.toUpperCase())) {
        items.push(c);
        knownCharNames.add(c.name.toUpperCase());
      }
      return;
    }

    // ── heading + bullets only → note group ──
    if (hasBullets && !hasBody) {
      items.push({
        ...BLANK, id: cur.id, type: 'note',
        title: cur.title, name: cur.title, content: '', role: '',
        subnotes: cur.bullets.map(b => ({ id: uid(), title: b, content: '' })),
      });
      return;
    }

    // ── chapter OR note depending on title ──
    if (CHAPTER_TITLE_RE.test(cur.title.trim())) {
      const content = [
        cur.bodyText.trim(),
        ...(hasBullets ? ['', ...cur.bullets.map(b => `• ${b}`)] : []),
      ].join('\n').trim();
      items.push({ ...BLANK, id: cur.id, type: 'chapter', title: cur.title, name: cur.title, content, role: '', subnotes: [] });
    } else {
      // Not a named chapter → note; body text becomes a subnote, bullets become subnotes
      const subnotes = [
        ...(cur.bodyText.trim() ? [{ id: uid(), title: cur.bodyText.trim().split('\n')[0].slice(0, 80), content: cur.bodyText.trim() }] : []),
        ...cur.bullets.map(b => ({ id: uid(), title: b, content: '' })),
      ];
      items.push({ ...BLANK, id: cur.id, type: 'note', title: cur.title, name: cur.title, content: '', role: '', subnotes });
    }
  }

  for (const line of annotated) {
    const { text, role } = line;

    if (role === 'blank' || role === 'transition') continue;

    if (role === 'heading' || role === 'act-heading' || role === 'chapter-keyword') {
      flush(); newItem(text); continue;
    }

    if (role === 'scene-heading') {
      flush(); newItem(text); continue;
    }

    if (role === 'subheading') {
      if (!cur) { newItem(text); continue; }
      if (cur.bodyText.trim() || cur.bullets.length || cur.charFields.length) {
        flush(); newItem(text);
      } else {
        cur.title = text;
      }
      continue;
    }

    // Relationship header: Name/OtherName or Name & OtherName or Name vs OtherName
    if (role === 'relationship') {
      const names = parseRelNames(text);
      if (names) {
        flush();
        cur = { id: uid(), title: text, bodyText: '', bullets: [], charFields: [], _isRelationship: true, _nameA: names[0], _nameB: names[1] };
      }
      continue;
    }

    // Char-cue: flush current, start a new char-cue item so following bullets attach to it
    if (role === 'char-cue') {
      const name = text.replace(/\s*\([^)]*\)/g, '').trim();
      if (name.length > 1) {
        flush();
        newItem(name, true);
      }
      continue;
    }

    if (role === 'char-field') {
      if (!cur) newItem(text.split(':')[0].trim());
      cur.charFields.push(text);
      continue;
    }

    if (role === 'bullet') {
      if (!cur) newItem('Notes');
      cur.bullets.push(text.replace(/^[\*\-–•\d\.\)]+\s+/, ''));
      continue;
    }

    // Body text
    if (!cur) newItem(text.length < 80 ? text : 'Imported Content');
    cur.bodyText += (cur.bodyText ? '\n' : '') + text;
  }
  flush();

  // Create character items for all collected cue names not already in items
  for (const name of charCueNames) {
    if (!knownCharNames.has(name.toUpperCase())) {
      items.push({
        ...BLANK, id: uid(), type: 'character',
        title: name, name, content: '', role: '', bio: '', subnotes: [],
      });
      knownCharNames.add(name.toUpperCase());
    }
  }

  return {
    chapters:      items.filter(i => i.type === 'chapter'),
    characters:    items.filter(i => i.type === 'character'),
    notes:         items.filter(i => i.type === 'note'),
    relationships: items.filter(i => i.type === 'relationship'),
  };
}

// ── format badge detection (display only) ────────────────────────────────────

export function detectFormat(lines) {
  const scores = { screenplay: 0, prose: 0, outline: 0, characters: 0 };
  for (const { text: t } of lines) {
    if (SCENE_RE.test(t))                                       scores.screenplay += 3;
    if (TRANSITION_RE.test(t))                                  scores.screenplay += 2;
    if (CHAR_CUE_RE.test(t) && !CUE_EXCLUSIONS.test(t))        scores.screenplay += 0.4;
    if (CHAPTER_RE.test(t))                                     scores.prose += 3;
    if (BULLET_RE.test(t))                                      scores.outline += 1;
    if (/^name\s*:/i.test(t))                                   scores.characters += 4;
    if (CHAR_FIELDS_RE.test(t))                                 scores.characters += 2;
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}
