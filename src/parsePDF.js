import * as pdfjs from 'pdfjs-dist';
import { smartParse, detectFormat } from './parseCore.js';

export { smartParse, detectFormat };

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

// ── extraction ───────────────────────────────────────────────────────────────
// Returns [{text, fontSize}] — font size preserved for tier detection

export async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const lines = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const lineMap = new Map();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      // item.height is the font size in user units; fall back to transform scale
      const fontSize = item.height || Math.abs(item.transform[3]) || Math.abs(item.transform[0]);
      const bucket = lineMap.get(y) || [];
      bucket.push({ x: item.transform[4], str: item.str, fontSize });
      lineMap.set(y, bucket);
    }

    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a); // top → bottom
    for (const y of sortedYs) {
      const items = lineMap.get(y).sort((a, b) => a.x - b.x);
      const text = items.map(i => i.str).join(' ').trim();
      const fontSize = Math.max(...items.map(i => i.fontSize));
      if (text) lines.push({ text, fontSize });
    }
  }

  return lines;
}

// ── main entry ───────────────────────────────────────────────────────────────

export async function parsePDFFile(file) {
  const lines = await extractTextFromPDF(file);
  const format = detectFormat(lines);
  const { chapters, characters, notes, relationships } = smartParse(lines);
  return { format, chapters, characters, notes, relationships };
}
