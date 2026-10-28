'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { WATERMARK_PATTERNS } = require('./docs_ai_constants');

function findEocdOffset(buf) {
  const maxSearch = Math.min(buf.length, 65557);
  for (let i = buf.length - 22; i >= buf.length - maxSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function parseZipCentralDirectory(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length < 22) return null;
    const eocdOffset = findEocdOffset(buf);
    if (eocdOffset === -1) return null;

    const cdCount = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    return { buf, cdCount, cdOffset, eocdOffset };
  } catch (_) {
    return null;
  }
}

function matchesEntryName(name, entryName) {
  return name === entryName || name.endsWith('/' + entryName) || (entryName.includes('/') && name.includes(entryName));
}

function extractZipEntryPayload(buf, localHeaderOffset, compressedSize, method) {
  if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    return null;
  }
  const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
  const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);
  if (method === 0) return compressed.toString('utf8');
  if (method === 8) return zlib.inflateRawSync(compressed).toString('utf8');
  return null;
}

function extractMatchingZipEntry(buf, pos, entryName) {
  const method = buf.readUInt16LE(pos + 10);
  const compressedSize = buf.readUInt32LE(pos + 20);
  const nameLen = buf.readUInt16LE(pos + 28);
  const localHeaderOffset = buf.readUInt32LE(pos + 42);
  const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
  if (!matchesEntryName(name, entryName)) return null;
  return extractZipEntryPayload(buf, localHeaderOffset, compressedSize, method);
}

function extractZipEntryPureJs(filePath, entryName) {
  try {
    const zip = parseZipCentralDirectory(filePath);
    if (!zip) return null;
    const { buf, cdCount, cdOffset, eocdOffset } = zip;

    let pos = cdOffset;
    for (let idx = 0; idx < cdCount && pos < eocdOffset; idx++) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) break;
      const payload = extractMatchingZipEntry(buf, pos, entryName);
      if (payload !== null) return payload;

      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      pos += 46 + nameLen + extraLen + commentLen;
    }
  } catch (_) { /* fallback to external unzip/python */ }
  return null;
}

function listZipEntriesPureJs(filePath) {
  try {
    const zip = parseZipCentralDirectory(filePath);
    if (!zip) return null;
    const { buf, cdCount, cdOffset, eocdOffset } = zip;
    const names = [];

    let pos = cdOffset;
    for (let idx = 0; idx < cdCount && pos < eocdOffset; idx++) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) break;
      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
      names.push(name);
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } catch (_) { /* fallback */ }
  return null;
}

function readZipEntry(filePath, entryName) {
  const pureJs = extractZipEntryPureJs(filePath, entryName);
  if (pureJs !== null && pureJs !== undefined) return pureJs;

  try {
    const res = spawnSync('unzip', ['-p', filePath, entryName], {
      encoding: 'utf8', maxBuffer: 15 * 1024 * 1024, windowsHide: true
    });
    if (res.status === 0 && res.stdout) return res.stdout;
  } catch (_) { /* fallback */ }

  try {
    const pyScript = `import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'r') as z:
    for n in z.namelist():
        if sys.argv[2] in n:
            sys.stdout.write(z.read(n).decode('utf-8', errors='ignore'))
            break`;
    const res = spawnSync('python3', ['-c', pyScript, filePath, entryName], {
      encoding: 'utf8', maxBuffer: 15 * 1024 * 1024, windowsHide: true
    });
    if (res.status === 0 && res.stdout) return res.stdout;
  } catch (_) { /* ignore */ }

  return '';
}

function listZipEntries(filePath) {
  const pureJs = listZipEntriesPureJs(filePath);
  if (Array.isArray(pureJs) && pureJs.length > 0) return pureJs;

  try {
    const res = spawnSync('unzip', ['-l', filePath], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && res.stdout) {
      return res.stdout.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(Boolean);
    }
  } catch (_) { /* fallback */ }

  try {
    const pyScript = `import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'r') as z:
    for n in z.namelist():
        print(n)`;
    const res = spawnSync('python3', ['-c', pyScript, filePath], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && res.stdout) {
      return res.stdout.split('\n').map(l => l.trim()).filter(Boolean);
    }
  } catch (_) { /* ignore */ }

  return [];
}

function extractDocx(filePath) {
  let fullText = '';
  const paragraphs = [];
  let metadata = '';
  let hasWatermark = false;
  const darkFills = [];

  const docXml = readZipEntry(filePath, 'word/document.xml');
  if (docXml) {
    for (const pat of WATERMARK_PATTERNS) {
      if (pat.test(docXml)) hasWatermark = true;
    }
    const shdMatches = docXml.match(/w:fill=["']([0-9A-Fa-f]{6})["']/g) || [];
    for (const m of shdMatches) {
      const hex = m.replace(/.*["']([0-9A-Fa-f]{6})["']/, '$1').toUpperCase();
      if (['000000', '0F172A', '1E293B', '0B132B'].includes(hex)) darkFills.push(hex);
    }
    const pMatches = docXml.match(/<w:p(?:[\s>][\s\S]*?)?<\/w:p>/g) || [];
    for (const pXml of pMatches) {
      const cleanPXml = pXml.replace(/<w:br[^>]*>/g, ' ').replace(/<w:tab[^>]*>/g, ' ');
      const tMatches = cleanPXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
      const pText = tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('').trim();
      if (pText.length > 0) paragraphs.push(pText);
    }
    fullText = paragraphs.join('\n\n');
  }

  const entries = listZipEntries(filePath);
  for (const entry of entries) {
    if (!/word\/(header|footer)\d*\.xml/i.test(entry)) continue;
    const hfXml = readZipEntry(filePath, entry);
    for (const pat of WATERMARK_PATTERNS) {
      if (pat.test(hfXml)) hasWatermark = true;
    }
  }

  metadata = `${readZipEntry(filePath, 'docProps/core.xml')}\n${readZipEntry(filePath, 'docProps/app.xml')}`;
  return { text: fullText, paragraphs, metadata, hasWatermark, darkFills, error: null };
}

function extractPdf(filePath) {
  let text = '';
  let metadata = '';
  let hasWatermark = false;

  try {
    const res = spawnSync('pdftotext', [filePath, '-'], {
      encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true
    });
    if (res.status === 0 && res.stdout) text = res.stdout;
  } catch (_) { /* fallback */ }

  try {
    const res = spawnSync('pdfinfo', [filePath], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && res.stdout) metadata = res.stdout;
  } catch (_) { /* fallback */ }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const pat of WATERMARK_PATTERNS) {
      if (pat.test(raw)) hasWatermark = true;
    }
  } catch (_) { /* fallback */ }

  const paragraphs = (text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  let error = null;
  try {
    const st = fs.statSync(filePath);
    if (words.length < 15 && st.size > 2000) {
      error = `Unable to extract readable text layer from PDF (${words.length} words found, file size ${st.size} bytes). File may be corrupted, raster-only, or missing text streams.`;
    }
  } catch (_) { /* ignore */ }

  return { text, paragraphs, metadata, hasWatermark, darkFills: [], error };
}

function extractPptx(filePath) {
  let fullText = '';
  let metadata = '';
  let hasWatermark = false;
  const darkFills = [];

  const entries = listZipEntries(filePath);
  for (const entry of entries) {
    if (!/ppt\/slides\/slide\d+\.xml/i.test(entry)) continue;
    const slideXml = readZipEntry(filePath, entry);
    const textMatches = slideXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
    fullText += ' ' + textMatches.map(t => t.replace(/<[^>]+>/g, '')).join(' ');
    const bgMatch = slideXml.match(/<p:bg>([\s\S]*?)<\/p:bg>/i) || slideXml.match(/<p:bgPr>([\s\S]*?)<\/p:bgPr>/i);
    if (bgMatch && /srgbClr\s+val=["'](000000|0F172A|1E293B|0B132B)["']/i.test(bgMatch[1])) {
      darkFills.push('Dark Slide Background Fill');
    }
  }

  metadata = readZipEntry(filePath, 'docProps/core.xml');
  return { text: fullText.trim(), metadata, hasWatermark, darkFills, error: null };
}

function findLowercaseFormulas(sheetXml) {
  const lowercaseFormulas = [];
  const formulaMatches = sheetXml.match(/<f[^>]*>([\s\S]*?)<\/f>/g) || [];
  for (const f of formulaMatches) {
    const formula = f.replace(/<[^>]+>/g, '').trim();
    const match = formula.match(/^[a-z]+/i);
    const isTargetFunc = match && match[0] === match[0].toLowerCase() && ['sum', 'average', 'vlookup', 'xlookup'].includes(match[0]);
    if (isTargetFunc) {
      lowercaseFormulas.push(formula);
    }
  }
  return lowercaseFormulas;
}

function extractXlsx(filePath) {
  let fullText = '';
  const lowercaseFormulas = [];
  const entries = listZipEntries(filePath);
  for (const entry of entries) {
    if (!/xl\/worksheets\/sheet\d+\.xml/i.test(entry)) continue;
    const sheetXml = readZipEntry(filePath, entry);
    lowercaseFormulas.push(...findLowercaseFormulas(sheetXml));
  }

  const metadata = readZipEntry(filePath, 'docProps/core.xml');
  return { text: fullText, metadata, hasWatermark: false, darkFills: [], lowercaseFormulas, error: null };
}

module.exports = {
  parseZipCentralDirectory,
  extractZipEntryPureJs,
  listZipEntriesPureJs,
  readZipEntry,
  listZipEntries,
  extractDocx,
  extractPdf,
  extractPptx,
  extractXlsx
};
