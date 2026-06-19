import { describe, it, expect } from 'vitest';
import { smartParse, detectFormat } from './parseCore.js';

// Lines as extractTextFromPDF produces them; 12 = body size unless overridden
const L = (text, fontSize = 12) => ({ text, fontSize });

describe('detectFormat', () => {
  it('detects screenplays from scene headings and transitions', () => {
    const lines = [
      L('FADE IN:'),
      L('INT. KITCHEN - NIGHT'),
      L('A kettle whistles.'),
      L('EXT. GARDEN - DAY'),
      L('CUT TO:'),
    ];
    expect(detectFormat(lines)).toBe('screenplay');
  });

  it('detects prose from chapter keywords', () => {
    const lines = [
      L('Chapter 1'),
      L('It was a dark and stormy night.'),
      L('Chapter 2'),
      L('The storm had passed.'),
    ];
    expect(detectFormat(lines)).toBe('prose');
  });

  it('detects character sheets from Name: fields', () => {
    const lines = [
      L('Name: Alice'),
      L('Role: Protagonist'),
      L('Eye Color: Green'),
    ];
    expect(detectFormat(lines)).toBe('characters');
  });

  it('detects outlines from bullet lists', () => {
    const lines = [
      L('• Act one setup'),
      L('• Midpoint twist'),
      L('- Finale'),
    ];
    expect(detectFormat(lines)).toBe('outline');
  });
});

describe('smartParse', () => {
  it('returns empty collections for empty input', () => {
    expect(smartParse([])).toEqual({ chapters: [], characters: [], notes: [] });
  });

  it('builds chapters from numbered chapter headings with their body text', () => {
    const result = smartParse([
      L('Chapter 1: The Beginning'),
      L('It was a dark and stormy night.'),
      L('The rain fell hard.'),
      L('Chapter 2'),
      L('Morning came slowly.'),
    ]);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe('Chapter 1: The Beginning');
    expect(result.chapters[0].content).toContain('dark and stormy');
    expect(result.chapters[0].content).toContain('rain fell');
    expect(result.chapters[1].title).toBe('Chapter 2');
    expect(result.chapters[1].content).toContain('Morning came');
  });

  it('treats Prologue and Epilogue as chapters', () => {
    const result = smartParse([
      L('Prologue', 24),
      L('Before it all began.'),
      L('Epilogue', 24),
      L('After it all ended.'),
    ]);
    expect(result.chapters.map(c => c.title)).toEqual(['Prologue', 'Epilogue']);
  });

  it('turns a non-chapter heading with body text into a note group', () => {
    const result = smartParse([
      L('World Building', 24),
      L('The kingdom sits between two rivers.'),
      L('Filler body line one.'),
      L('Filler body line two.'),
    ]);
    expect(result.chapters).toHaveLength(0);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].title).toBe('World Building');
    expect(result.notes[0].subnotes[0].content).toContain('two rivers');
  });

  it('turns a heading with bullets into a note group with one subnote per bullet', () => {
    const result = smartParse([
      L('Plot Ideas', 24),
      L('• The heist goes wrong'),
      L('• A betrayal at midnight'),
      L('- The escape'),
    ]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].subnotes.map(sn => sn.title)).toEqual([
      'The heist goes wrong',
      'A betrayal at midnight',
      'The escape',
    ]);
  });

  it('parses character sheets from key: value fields', () => {
    const result = smartParse([
      L('Name: Alice'),
      L('Role: Protagonist'),
      L('Eye Color: Green'),
      L('Hair Color: Black'),
      L('Bio: A brave explorer of forgotten places.'),
    ]);
    expect(result.characters).toHaveLength(1);
    const c = result.characters[0];
    expect(c.name).toBe('Alice');
    expect(c.role).toBe('Protagonist');
    expect(c.eyeColor).toBe('Green');
    expect(c.hairColor).toBe('Black');
    expect(c.bio).toContain('brave explorer');
  });

  it('collects screenplay character cues as characters, deduplicated', () => {
    const result = smartParse([
      L('INT. KITCHEN - NIGHT'),
      L('JOHN'),
      L('We need to talk.'),
      L('MARY'),
      L('Not now.'),
      L('JOHN'),
      L('Please.'),
    ]);
    const names = result.characters.map(c => c.name).sort();
    expect(names).toEqual(['JOHN', 'MARY']);
  });

  it('does not treat scene headings or transitions as character cues', () => {
    const result = smartParse([
      L('FADE IN:'),
      L('INT. KITCHEN - NIGHT'),
      L('EXT. GARDEN - DAY'),
      L('JOHN'),
      L('Hello.'),
    ]);
    expect(result.characters.map(c => c.name)).toEqual(['JOHN']);
  });

  it('parses relationship headers with their description', () => {
    const result = smartParse([
      L('John / Mary'),
      L('Siblings who have not spoken in years.'),
    ]);
    expect(result.relationships).toHaveLength(1);
    const r = result.relationships[0];
    expect(r.nameA).toBe('John');
    expect(r.nameB).toBe('Mary');
    expect(r.content).toContain('Siblings');
    // Both sides also become characters so the pair can be linked on import
    expect(result.characters.map(c => c.name).sort()).toEqual(['John', 'Mary']);
  });

  it('parses "A & B" relationship form', () => {
    const result = smartParse([
      L('Alice & Bob'),
      L('Rivals turned allies.'),
    ]);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].nameA).toBe('Alice');
    expect(result.relationships[0].nameB).toBe('Bob');
  });
});
