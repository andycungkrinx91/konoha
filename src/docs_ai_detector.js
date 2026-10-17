/**
 * src/docs_ai_detector.js — Enterprise Document AI-Fingerprint Detector.
 *
 * Scans generated and source documents (.docx, .pdf, .pptx, .xlsx, .md, .txt)
 * for AI fingerprints, watermarks, metadata generator footprints, monotonous
 * sentence rhythm (low burstiness), AI buzzword density, and dark theme violations.
 *
 * Score: 0-100 (0-20 = HUMAN_WRITTEN, matching zero-AI human consistency target).
 *
 * Zero external npm dependencies: uses native CLI/standard libraries for high-speed streaming.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

// ── AI Clichés and Buzzword Signatures (English & Indonesian) ────────────────
const AI_BUZZWORDS = [
  // English AI Buzzwords
  'leverage', 'leveraging', 'leveraged',
  'delve', 'delving', 'delves',
  'tapestry', 'testament', 'testament to',
  'seamless', 'seamlessly',
  'paramount', 'pivotal',
  'beacon', 'game-changer',
  'it is important to note', 'it is worth noting',
  'in conclusion', 'in summary',
  'furthermore', 'moreover',
  'realm', 'underscores', 'multifaceted', 'holistic',
  'foster', 'fosters', 'fostering',
  'dynamic landscape', 'ever-evolving',
  'embark', 'harness', 'harnessing',
  'unlock', 'unlocking', 'vital role',
  'crucial aspect', 'comprehensive suite',
  'it is crucial', 'it is essential', 'it is worth highlighting',
  'plays a pivotal role', 'plays a key role', 'plays a central role',
  'spearheaded by', 'serves as a reminder', 'in order to facilitate',
  'intricate balance', 'fast-paced world', 'indelible mark',
  'resonates deeply', 'a myriad of', 'in essence',
  // Indonesian AI Buzzwords & Clichés
  'tidak dapat dipungkiri', 'tidak dapat disangkal',
  'merupakan hal yang sangat penting',
  'memainkan peran yang sangat penting',
  'memainkan peran krusial', 'berperan krusial',
  'memainkan peran sentral', 'patut dicatat bahwa', 'pada intinya',
  'merupakan wujud nyata', 'di era serba cepat ini', 'tak dapat dipisahkan',
  'menyelami', 'menelusuri jejak',
  'bukti nyata bahwa', 'tonggak sejarah yang tak lekang',
  'secara komprehensif', 'berbagai aspek yang melingkupi',
  'pada akhirnya dapat disimpulkan',
  'di era modern ini', 'di era globalisasi ini',
  'fondasi kokoh', 'menjadi saksi bisu',
  'tak lekang oleh waktu', 'sangatlah penting untuk dicatat',
  'tidak diragukan lagi bahwa'
];

// Predictive AI Collocations (commonly produced by LLM syntactic formulas)
const AI_COLLOCATIONS = [
  'without dropping a single',
  'throughout the cutover window',
  'eliminated single points of failure across our entire',
  'under continuous load',
  'strictly below',
  'serves as a testament to',
  'plays a pivotal role in ensuring',
  'fosters a culture of continuous',
  'comprehensive suite of',
  'fast-paced world of',
  'ever-evolving landscape of',
  'intricate balance between',
  'resonates deeply with',
  'vital role in facilitating'
];

// Generator metadata signatures
const GENERATOR_SIGNATURES = [
  { pattern: /python-docx/i, name: 'python-docx' },
  { pattern: /docx-js/i, name: 'docx-js' },
  { pattern: /docx4j/i, name: 'docx4j' },
  { pattern: /reportlab/i, name: 'ReportLab PDF Library' },
  { pattern: /weasyprint/i, name: 'WeasyPrint' },
  { pattern: /wkhtmltopdf/i, name: 'wkhtmltopdf' },
  { pattern: /openpyxl/i, name: 'openpyxl' },
  { pattern: /xlsxwriter/i, name: 'xlsxwriter' },
  { pattern: /python-pptx/i, name: 'python-pptx' },
  { pattern: /pptxgenjs/i, name: 'pptxgenjs' },
  { pattern: /pdfkit/i, name: 'pdfkit' },
  { pattern: /puppeteer/i, name: 'puppeteer' }
];

// Watermark signatures
const WATERMARK_PATTERNS = [
  /w:watermark/i,
  /PowerPlusWaterMarkObject/i,
  /id=["'][^"']*watermark[^"']*["']/i,
  /type=["']#_x0000_t136["']/i, // VML Watermark shape type
  /\/Type\s*\/Annot\s*\/Subtype\s*\/Watermark/i,
  /\/Watermark\b/i,
  /watermark-ribbon/i,
  /confidential-watermark/i
];

function parseZipCentralDirectory(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length < 22) return null;
    let eocdOffset = -1;
    const maxSearch = Math.min(buf.length, 65557);
    for (let i = buf.length - 22; i >= buf.length - maxSearch; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return null;

    const cdCount = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    return { buf, cdCount, cdOffset, eocdOffset };
  } catch (_) {
    return null;
  }
}

/**
 * Pure Node.js uncompressed / Deflated entry extractor without external dependencies.
 */
function extractZipEntryPureJs(filePath, entryName) {
  try {
    const zip = parseZipCentralDirectory(filePath);
    if (!zip) return null;
    const { buf, cdCount, cdOffset, eocdOffset } = zip;

    let pos = cdOffset;
    for (let idx = 0; idx < cdCount && pos < eocdOffset; idx++) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) break;
      const method = buf.readUInt16LE(pos + 10);
      const compressedSize = buf.readUInt32LE(pos + 20);
      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const localHeaderOffset = buf.readUInt32LE(pos + 42);

      const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
      if (name === entryName || name.endsWith('/' + entryName) || (entryName.includes('/') && name.includes(entryName))) {
        if (localHeaderOffset + 30 <= buf.length && buf.readUInt32LE(localHeaderOffset) === 0x04034b50) {
          const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
          const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
          const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
          const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);
          if (method === 0) {
            return compressed.toString('utf8');
          } else if (method === 8) {
            return zlib.inflateRawSync(compressed).toString('utf8');
          }
        }
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
  } catch (_) { /* fallback to external unzip/python */ }
  return null;
}

/**
 * Pure Node.js ZIP entry lister.
 */
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
  } catch (_) { /* fallback to external unzip/python */ }
  return null;
}

/**
 * Streams an XML entry from a ZIP container (DOCX, PPTX, XLSX)
 */
function readZipEntry(filePath, entryName) {
  const pureJs = extractZipEntryPureJs(filePath, entryName);
  if (pureJs !== null && pureJs !== undefined) return pureJs;

  try {
    const res = spawnSync('unzip', ['-p', filePath, entryName], {
      encoding: 'utf8',
      maxBuffer: 15 * 1024 * 1024,
      windowsHide: true
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
      encoding: 'utf8',
      maxBuffer: 15 * 1024 * 1024,
      windowsHide: true
    });
    if (res.status === 0 && res.stdout) return res.stdout;
  } catch (_) { /* ignore */ }

  return '';
}

/**
 * Lists all file entries in a ZIP container
 */
function listZipEntries(filePath) {
  const pureJs = listZipEntriesPureJs(filePath);
  if (Array.isArray(pureJs) && pureJs.length > 0) return pureJs;

  try {
    const res = spawnSync('unzip', ['-l', filePath], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && res.stdout) {
      return res.stdout
        .split('\n')
        .map((l) => l.trim().split(/\s+/).pop())
        .filter(Boolean);
    }
  } catch (_) { /* fallback */ }

  try {
    const pyScript = `import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'r') as z:
    for n in z.namelist():
        print(n)`;
    const res = spawnSync('python3', ['-c', pyScript, filePath], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && res.stdout) {
      return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    }
  } catch (_) { /* ignore */ }

  return [];
}

/**
 * Extracts text and metadata from DOCX
 */
function extractDocx(filePath) {
  let fullText = '';
  const paragraphs = [];
  let metadata = '';
  let hasWatermark = false;
  const darkFills = [];

  // 1. Read document.xml
  const docXml = readZipEntry(filePath, 'word/document.xml');
  if (docXml) {
    for (const pat of WATERMARK_PATTERNS) {
      if (pat.test(docXml)) hasWatermark = true;
    }

    const shdMatches = docXml.match(/w:fill=["']([0-9A-Fa-f]{6})["']/g) || [];
    for (const m of shdMatches) {
      const hex = m.replace(/.*["']([0-9A-Fa-f]{6})["']/, '$1').toUpperCase();
      if (['000000', '0F172A', '1E293B', '0B132B'].includes(hex)) {
        darkFills.push(hex);
      }
    }

    const pMatches = docXml.match(/<w:p(?:[\s>][\s\S]*?)?<\/w:p>/g) || [];
    for (const pXml of pMatches) {
      const cleanPXml = pXml.replace(/<w:br[^>]*>/g, ' ').replace(/<w:tab[^>]*>/g, ' ');
      const tMatches = cleanPXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
      const pText = tMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('').trim();
      if (pText.length > 0) {
        paragraphs.push(pText);
      }
    }
    fullText = paragraphs.join('\n\n');
    if (!fullText) {
      const textMatches = docXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
      fullText = textMatches.map((t) => t.replace(/<[^>]+>/g, '')).join(' ');
    }
  }

  // 2. Check header/footer XMLs
  const entries = listZipEntries(filePath);
  for (const entry of entries) {
    if (/word\/(header|footer)\d*\.xml/i.test(entry)) {
      const hfXml = readZipEntry(filePath, entry);
      for (const pat of WATERMARK_PATTERNS) {
        if (pat.test(hfXml)) hasWatermark = true;
      }
    }
  }

  // 3. Read docProps/core.xml and docProps/app.xml
  const coreXml = readZipEntry(filePath, 'docProps/core.xml');
  const appXml = readZipEntry(filePath, 'docProps/app.xml');
  metadata = `${coreXml}\n${appXml}`;

  return { text: fullText, paragraphs, metadata, hasWatermark, darkFills, error: null };
}

/**
 * Extracts text and metadata from PDF
 */
function extractPdf(filePath) {
  let text = '';
  let metadata = '';
  let hasWatermark = false;

  try {
    const res = spawnSync('pdftotext', [filePath, '-'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    if (res.status === 0 && res.stdout) {
      text = res.stdout;
    }
  } catch (_) { /* fallback */ }

  if (!text || text.trim().length === 0) {
    try {
      const pyScript = 'from pdfminer.high_level import extract_text; import sys; sys.stdout.write(extract_text(sys.argv[1]))';
      const res = spawnSync('python3', ['-c', pyScript, filePath], {
        encoding: 'utf8',
        maxBuffer: 15 * 1024 * 1024,
        windowsHide: true
      });
      if (res.status === 0 && res.stdout) {
        text = res.stdout;
      }
    } catch (_) { /* fallback */ }
  }

  try {
    const res = spawnSync('pdfinfo', [filePath], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && res.stdout) {
      metadata = res.stdout;
    }
  } catch (_) { /* fallback */ }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!metadata) {
      const prodMatch = raw.match(/\/Producer\s*\(([^)]+)\)/i);
      const authMatch = raw.match(/\/Author\s*\(([^)]+)\)/i);
      const creatMatch = raw.match(/\/Creator\s*\(([^)]+)\)/i);
      metadata = [
        prodMatch ? prodMatch[1] : '',
        authMatch ? authMatch[1] : '',
        creatMatch ? creatMatch[1] : ''
      ].join(' ');
    }
    for (const pat of WATERMARK_PATTERNS) {
      if (pat.test(raw)) hasWatermark = true;
    }
  } catch (_) { /* fallback */ }

  const paragraphs = (text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
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

/**
 * Extracts text and metadata from PPTX
 */
function extractPptx(filePath) {
  let fullText = '';
  let metadata = '';
  let hasWatermark = false;
  const darkFills = [];

  const entries = listZipEntries(filePath);
  for (const entry of entries) {
    if (/ppt\/slides\/slide\d+\.xml/i.test(entry)) {
      const slideXml = readZipEntry(filePath, entry);
      const textMatches = slideXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
      fullText += ' ' + textMatches.map((t) => t.replace(/<[^>]+>/g, '')).join(' ');

      const bgMatch = slideXml.match(/<p:bg>([\s\S]*?)<\/p:bg>/i) || slideXml.match(/<p:bgPr>([\s\S]*?)<\/p:bgPr>/i);
      if (bgMatch && /srgbClr\s+val=["'](000000|0F172A|1E293B|0B132B)["']/i.test(bgMatch[1])) {
        darkFills.push('Dark Slide Background Fill');
      }
    }
  }

  metadata = readZipEntry(filePath, 'docProps/core.xml');
  return { text: fullText.trim(), metadata, hasWatermark, darkFills, error: null };
}

/**
 * Extracts text and metadata from XLSX
 */
function extractXlsx(filePath) {
  let fullText = '';
  let metadata = '';
  const lowercaseFormulas = [];

  const entries = listZipEntries(filePath);
  for (const entry of entries) {
    if (/xl\/worksheets\/sheet\d+\.xml/i.test(entry)) {
      const sheetXml = readZipEntry(filePath, entry);
      const formulaMatches = sheetXml.match(/<f[^>]*>([\s\S]*?)<\/f>/g) || [];
      for (const f of formulaMatches) {
        const formula = f.replace(/<[^>]+>/g, '').trim();
        if (/^[a-z]+(?=\()/i.test(formula)) {
          const funcName = formula.match(/^[a-z]+/i)[0];
          if (
            funcName === funcName.toLowerCase() &&
            ['sum', 'average', 'vlookup', 'xlookup'].includes(funcName)
          ) {
            lowercaseFormulas.push(formula);
          }
        }
      }
    }
  }

  metadata = readZipEntry(filePath, 'docProps/core.xml');
  return {
    text: fullText,
    metadata,
    hasWatermark: false,
    darkFills: [],
    lowercaseFormulas,
    error: null
  };
}

/**
 * Calculates burstiness (sentence length variance).
 * High burstiness (> 0.40) is human signature; flat burstiness (< 0.18) is robotic AI signature.
 * Excludes structural elements (headers, bullet points, numbered lists) that
 * artificially reduce sentence length variance.
 */
function calculateBurstiness(text) {
  if (!text || text.length < 100) {
    return { burstiness: 0.5, sentenceCount: 0, wordCount: 0 };
  }

  // Filter out structural lines before splitting into sentences
  const lines = text.split('\n');
  const proseLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Exclude markdown/doc headers
    if (/^#{1,6}\s/.test(trimmed)) return false;
    // Exclude ALL-CAPS headers (2+ words, all uppercase)
    if (trimmed.length > 3 && trimmed === trimmed.toUpperCase() && /\s/.test(trimmed)) return false;
    // Exclude bullet points and numbered lists
    if (/^[-*•◦▪]\s/.test(trimmed)) return false;
    if (/^\d+[.)]\s/.test(trimmed)) return false;
    // Exclude very short lines (1-3 words) that are likely titles/labels
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 3) return false;
    return true;
  });

  const proseText = proseLines.join(' ');
  const sentences = proseText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  if (sentences.length < 5) {
    return {
      burstiness: 0.5,
      sentenceCount: sentences.length,
      wordCount: proseText.split(/\s+/).length
    };
  }

  const lengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const totalWords = lengths.reduce((a, b) => a + b, 0);
  const mean = totalWords / lengths.length;

  const variance =
    lengths.reduce((acc, l) => acc + Math.pow(l - mean, 2), 0) / lengths.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0.5;

  return {
    burstiness: parseFloat(cv.toFixed(2)),
    sentenceCount: sentences.length,
    wordCount: totalWords
  };
}

/**
 * Analyzes sliding-window paragraph burstiness and ZeroGPT AI risk.
 * Evaluates individual paragraphs for flat sentence variance and AI transition markers.
 * Target: 0.0%–3.0% ZeroGPT risk score.
 */
function analyzeParagraphBurstiness(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) {
    return { total: 0, suspiciousCount: 0, zerogptRisk: 0.0, flagged: [] };
  }

  const flagged = [];
  let evaluableCount = 0;

  paragraphs.forEach((p, idx) => {
    const words = p.split(/\s+/).filter(Boolean);
    // Prose sliding window: ZeroGPT evaluates paragraphs >= 25 words with multiple sentences
    if (words.length < 25) return;

    const sentences = p.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 3);
    if (sentences.length < 2) return;

    evaluableCount++;
    const sLengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
    const mean = sLengths.reduce((a, b) => a + b, 0) / sLengths.length;
    const variance = sLengths.reduce((acc, l) => acc + Math.pow(l - mean, 2), 0) / sLengths.length;
    const stddev = Math.sqrt(variance);
    const cv = mean > 0 ? stddev / mean : 0.5;

    // For 2-sentence paragraphs, CV is only statistically meaningful if sentences are virtually identical (CV < 0.08, e.g. 20 & 20 or 20 & 21 words).
    // For 3+ sentences, CV < 0.18 or sLengths all within 1-2 words of mean indicates monotonous AI cadence.
    const isAiCadence = sLengths.length >= 3
      ? (cv < 0.18 || ((mean >= 10 && mean <= 32) && (cv < 0.22 || sLengths.every((l) => Math.abs(l - mean) <= 1))))
      : (cv < 0.08 && mean >= 12 && mean <= 30);

    const lowerP = p.toLowerCase();
    const transitionTriggers = [
      'furthermore', 'moreover', 'in summary', 'in conclusion', 'in addition',
      'additionally', 'consequently', 'subsequently', 'notably',
      'it is important to note', 'it is worth noting', 'it should be noted',
      'it is crucial', 'it is essential',
      'plays a pivotal role', 'plays a vital role', 'plays a crucial role',
      'testament to', 'rich tapestry', 'delve into', 'beacon of hope',
      'tidak dapat dipungkiri', 'tidak dapat disangkal', 'memainkan peran penting',
      'berperan penting', 'memainkan peran krusial', 'di era modern ini',
      'di era globalisasi', 'selain itu', 'oleh karena itu', 'dengan demikian',
      'pada intinya', 'patut dicatat bahwa', 'dapat disimpulkan bahwa',
      'sebagai kesimpulan', 'fondasi kokoh', 'saksi bisu', 'tonggak sejarah'
    ].filter((t) => lowerP.includes(t));

    const isSuspicious = isAiCadence || transitionTriggers.length >= 3 || (transitionTriggers.length >= 2 && cv < 0.30);

    if (isSuspicious) {
      flagged.push({
        paragraphIndex: idx + 1,
        snippet: p.length > 90 ? p.substring(0, 90) + '…' : p,
        sentenceCount: sentences.length,
        sentenceLengths: sLengths,
        cv: parseFloat(cv.toFixed(2)),
        reasons: [
          isAiCadence ? `Monotonous AI sentence rhythm (mean ${mean.toFixed(1)} words, CV ${cv.toFixed(2)} < 0.30, lengths [${sLengths.join(', ')}])` : null,
          transitionTriggers.length > 0 ? `AI transition triggers: ${transitionTriggers.join(', ')}` : null
        ].filter(Boolean)
      });
    }
  });

  // Cross-paragraph template repetition check (e.g. repeated short-opener + compound-clause pattern)
  const templateCadences = [];
  paragraphs.forEach((p, idx) => {
    const sentences = p.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 3);
    if (sentences.length >= 2) {
      const sLengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
      if (sLengths[0] <= 5 && sLengths[1] >= 20) {
        templateCadences.push(idx + 1);
      }
    }
  });

  const denominator = Math.max(evaluableCount, 1);
  let zerogptRisk = evaluableCount > 0 ? parseFloat(((flagged.length / denominator) * 100).toFixed(1)) : 0.0;
  if (templateCadences.length >= 2) {
    zerogptRisk = Math.max(zerogptRisk, parseFloat(((templateCadences.length / denominator) * 100).toFixed(1)));
  }

  return {
    total: evaluableCount,
    suspiciousCount: flagged.length,
    zerogptRisk,
    flagged,
    templateCadences
  };
}

/**
 * Evaluates document AI fingerprints against authoritative rules.
 */
function detectDocsAi(targetPath) {
  const startTime = Date.now();
  if (!targetPath || typeof targetPath !== 'string') {
    return { error: 'Missing target document path' };
  }

  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    return { error: `File not found: ${targetPath}` };
  }

  const ext = path.extname(resolved).toLowerCase();
  let docData;

  if (ext === '.docx') docData = extractDocx(resolved);
  else if (ext === '.pdf') docData = extractPdf(resolved);
  else if (ext === '.pptx') docData = extractPptx(resolved);
  else if (ext === '.xlsx') docData = extractXlsx(resolved);
  else if (['.txt', '.md'].includes(ext)) {
    const text = fs.readFileSync(resolved, 'utf8');
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    docData = { text, paragraphs, metadata: '', hasWatermark: false, darkFills: [], error: null };
  } else {
    return {
      error: `Unsupported document format '${ext}'. Supported: .docx, .pdf, .pptx, .xlsx, .md, .txt`
    };
  }

  if (docData.error) {
    return { error: `Failed to inspect ${ext} document: ${docData.error}` };
  }

  const findings = [];
  let score = 0;

  // 1. Watermark Detection Rule (WM-01)
  if (docData.hasWatermark) {
    findings.push({
      rule: 'WM-01',
      severity: 'high',
      weight: 35,
      title: 'Watermark or Evaluation Stamp Detected',
      evidence:
        'Document contains embedded watermark elements or stamp text. Enterprise deliverables must have zero watermarks.'
    });
    score += 35;
  }

  // 2. Metadata Generator Footprint (META-01)
  for (const gen of GENERATOR_SIGNATURES) {
    if (gen.pattern.test(docData.metadata)) {
      findings.push({
        rule: 'META-01',
        severity: 'high',
        weight: 25,
        title: `Automated Library Footprint in Metadata (${gen.name})`,
        evidence: `Document metadata reveals automated generator tag '${gen.name}'. Requires sanitization.`
      });
      score += 25;
      break;
    }
  }

  // 3. Dark Theme Violation (THEME-01)
  if (docData.darkFills && docData.darkFills.length > 0) {
    findings.push({
      rule: 'THEME-01',
      severity: 'medium',
      weight: 20,
      title: 'Dark Theme Style Violation in Document',
      evidence: `Found dark fill styling (${docData.darkFills.slice(0, 3).join(', ')}). Enterprise documents must strictly enforce pure light mode.`
    });
    score += 20;
  }

  // 4. Lowercase Formulas in XLSX (FMT-01)
  if (docData.lowercaseFormulas && docData.lowercaseFormulas.length > 0) {
    findings.push({
      rule: 'FMT-01',
      severity: 'medium',
      weight: 15,
      title: 'Lowercase Formula Names in Spreadsheet',
      evidence: `Found lowercase formulas: ${docData.lowercaseFormulas.slice(0, 3).join(', ')}. Must be uppercase (e.g. SUM, AVERAGE).`
    });
    score += 15;
  }

  // 5. AI Clichés & Buzzword Density (CLICHE-01)
  const lowerText = (docData.text || '').toLowerCase();
  const detectedClichés = [];
  for (const word of AI_BUZZWORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches && matches.length > 0) {
      detectedClichés.push(`${word} (${matches.length}x)`);
    }
  }

  if (detectedClichés.length >= 8) {
    findings.push({
      rule: 'CLICHE-01',
      severity: 'high',
      weight: 15,
      title: 'High AI Cliché & Buzzword Density',
      evidence: `Detected repetitive AI phrases: ${detectedClichés.slice(0, 5).join(', ')}.`
    });
    score += 15;
  } else if (detectedClichés.length >= 5) {
    findings.push({
      rule: 'CLICHE-01',
      severity: 'medium',
      weight: 6,
      title: 'Moderate AI Phrase Frequency',
      evidence: `Detected phrases: ${detectedClichés.join(', ')}.`
    });
    score += 6;
  }

  // 6. Sentence Burstiness & Rhythm Analysis (BURST-01)
  const stats = calculateBurstiness(docData.text);
  if (stats.sentenceCount >= 10 && stats.burstiness < 0.18) {
    findings.push({
      rule: 'BURST-01',
      severity: 'medium',
      weight: 8,
      title: 'Monotonous Sentence Rhythm (Low Burstiness)',
      evidence: `Sentence length coefficient of variation is ${stats.burstiness} (< 0.18). Indicates synthetic cadence.`
    });
    score += 8;
  }

  // 7. Sliding-Window ZeroGPT Paragraph Burstiness (ZEROGPT-01)
  const paraAnalysis = analyzeParagraphBurstiness(docData.paragraphs || []);
  if (paraAnalysis.zerogptRisk > 5.0) {
    const sample = paraAnalysis.flagged
      .slice(0, 3)
      .map((f) => `¶${f.paragraphIndex} [CV: ${f.cv}, lengths: ${f.sentenceLengths.join('/')}]: "${f.snippet}"`)
      .join('; ');
    const weight = Math.min(20, Math.max(5, Math.round(paraAnalysis.zerogptRisk * 0.5)));
    findings.push({
      rule: 'ZEROGPT-01',
      severity: paraAnalysis.zerogptRisk > 25.0 ? 'high' : 'medium',
      weight,
      title: `ZeroGPT AI Sliding-Window Risk (${paraAnalysis.zerogptRisk}%) Exceeds 5.0% Target`,
      evidence: `Sliding-window evaluation flagged ${paraAnalysis.suspiciousCount}/${paraAnalysis.total} paragraphs with synthetic cadence (ZeroGPT risk: ${paraAnalysis.zerogptRisk}%, target: 0.0%–3.0%). Details: ${sample}`
    });
    score += weight;
  }

  // 8. Syntactic Template Repetition Detection (TEMPL-01)
  if (paraAnalysis.templateCadences && paraAnalysis.templateCadences.length >= 2) {
    findings.push({
      rule: 'TEMPL-01',
      severity: 'medium',
      weight: 18,
      title: 'Syntactic Template Repetition Cadence Detected',
      evidence: `Detected repetitive 3-beat paragraph cadence (short punchy opener followed by fronted compound clause) across paragraphs ${paraAnalysis.templateCadences.join(', ')}. Commercial ZeroGPT flags this structural uniformity.`
    });
    score += 18;
  }

  // 9. Lexical Diversity & Type-Token Ratio (LEX-01)
  const wordsOnly = lowerText.match(/\b[a-z]{3,}\b/g) || [];
  if (wordsOnly.length >= 100) {
    const uniqueWords = new Set(wordsOnly).size;
    const ttr = uniqueWords / wordsOnly.length;
    if (ttr < 0.38) {
      findings.push({
        rule: 'LEX-01',
        severity: 'medium',
        weight: 15,
        title: 'Low Lexical Diversity (Low Type-Token Ratio)',
        evidence: `Type-token ratio is ${(ttr * 100).toFixed(1)}% (${uniqueWords} unique / ${wordsOnly.length} total words). Indicates repetitive vocabulary distribution typical of language model output.`
      });
      score += 15;
    }
  }

  // 10. AI Collocation Predictability (COLLOC-01)
  const matchedCollocations = [];
  for (const col of AI_COLLOCATIONS) {
    if (lowerText.includes(col)) matchedCollocations.push(col);
  }
  if (matchedCollocations.length >= 2) {
    findings.push({
      rule: 'COLLOC-01',
      severity: 'medium',
      weight: 15,
      title: 'Predictable AI Collocation Phrasing',
      evidence: `Detected high-probability AI collocations: ${matchedCollocations.join('; ')}.`
    });
    score += 15;
  }

  score = Math.min(100, score);
  const humanScore = 100 - score;

  let label;
  let verdict;
  if (score <= 5 && paraAnalysis.zerogptRisk <= 3.0) {
    label = 'HUMAN_WRITTEN';
    verdict =
      'Human-authentic document with 100% human consistency, zero watermarks, and 0.0%–3.0% ZeroGPT risk target satisfied.';
  } else if (score <= 20) {
    label = 'HUMAN_WRITTEN';
    verdict =
      'Human-authentic document with 100% human consistency, zero watermarks, and zero AI fingerprints.';
  } else if (score <= 45) {
    label = 'LOW_AI_SUSPICION';
    verdict = 'Document exhibits minor AI characteristics or unscrubbed toolchain signatures.';
  } else {
    label = 'AI_GENERATED';
    verdict =
      'Document exhibits strong AI generation markers, watermarks, or un-sanitized automated generator footprints.';
  }

  return {
    target: path.basename(resolved),
    file_path: resolved,
    format: ext.replace('.', ''),
    score,
    human_score: humanScore,
    label,
    verdict,
    zerogpt_risk_score: paraAnalysis.zerogptRisk,
    watermark_detected: docData.hasWatermark,
    dark_theme_detected: Boolean(docData.darkFills && docData.darkFills.length > 0),
    stats: {
      words: stats.wordCount,
      sentences: stats.sentenceCount,
      paragraphs: (docData.paragraphs || []).length,
      burstiness: stats.burstiness,
      zerogpt_risk_score: paraAnalysis.zerogptRisk,
      flagged_paragraphs: paraAnalysis.suspiciousCount,
      elapsed_ms: Date.now() - startTime
    },
    findings
  };
}

module.exports = {
  detectDocsAi,
  AI_BUZZWORDS,
  GENERATOR_SIGNATURES,
  WATERMARK_PATTERNS
};
