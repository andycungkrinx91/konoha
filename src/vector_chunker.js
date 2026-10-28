'use strict';

const crypto = require('crypto');

function splitLongBlock(block, maxLen, overlap) {
  const pieces = [];
  let start = 0;
  while (start < block.length) {
    const end = start + maxLen;
    pieces.push(block.substring(start, end));
    if (end >= block.length) break;
    start = end - overlap;
  }
  return pieces;
}

function partitionSections(lines) {
  const sections = [];
  let currentLines = [];
  const headingRegex = /^#{1,6}\s+/;

  for (const line of lines) {
    if (headingRegex.test(line) && currentLines.length > 0) {
      sections.push(currentLines.join('\n').trim());
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push(currentLines.join('\n').trim());
  }
  return sections;
}

function processParagraphChunk(pClean, state, options) {
  const { maxChars, overlapChars } = options;
  if (pClean.length > maxChars) {
    if (state.currentSub) {
      state.chunks.push(state.currentSub);
      state.currentSub = '';
    }
    state.chunks.push(...splitLongBlock(pClean, maxChars, overlapChars));
    return;
  }
  if (state.currentSub.length + pClean.length + 2 <= maxChars) {
    state.currentSub = state.currentSub ? `${state.currentSub}\n\n${pClean}`.trim() : pClean;
    return;
  }
  if (state.currentSub) state.chunks.push(state.currentSub);
  state.currentSub = pClean;
}

function accumulateParagraphs(paragraphs, options) {
  const state = { chunks: [], currentSub: '' };
  for (const p of paragraphs) {
    const pClean = p.trim();
    if (pClean) processParagraphChunk(pClean, state, options);
  }
  if (state.currentSub) state.chunks.push(state.currentSub);
  return state.chunks;
}

function appendHashedChunk(fc, seenHashes, dedupedChunks) {
  const norm = fc.split(/\s+/).join(' ');
  const h = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
  if (seenHashes.has(h)) return;
  seenHashes.add(h);
  dedupedChunks.push([dedupedChunks.length, fc]);
}

function deduplicateChunks(rawChunks, maxChars, overlapChars) {
  const dedupedChunks = [];
  const seenHashes = new Set();
  for (const chunk of rawChunks) {
    const cClean = chunk.trim();
    if (!cClean) continue;
    const finalChunks = cClean.length > maxChars
      ? splitLongBlock(cClean, maxChars, overlapChars)
      : [cClean];
    for (const fc of finalChunks) {
      appendHashedChunk(fc, seenHashes, dedupedChunks);
    }
  }
  return dedupedChunks;
}

function chunkDocument(content, maxChars = 2000, overlapChars = 100) {
  if (!content || !content.trim()) return [];

  const lines = content.split(/\r?\n/);
  const sections = partitionSections(lines);
  const rawChunks = [];

  for (const section of sections) {
    if (!section) continue;
    if (section.length <= maxChars) {
      rawChunks.push(section);
    } else {
      const paragraphs = section.split(/\n\s*\n/);
      rawChunks.push(...accumulateParagraphs(paragraphs, { maxChars, overlapChars }));
    }
  }

  return deduplicateChunks(rawChunks, maxChars, overlapChars);
}

function reciprocalRankFusion(rankLists, k = 60) {
  const scores = {};
  for (const rList of rankLists) {
    rList.forEach((key, rank) => {
      scores[key] = (scores[key] || 0.0) + (1.0 / (k + rank + 1));
    });
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

module.exports = {
  splitLongBlock,
  partitionSections,
  accumulateParagraphs,
  chunkDocument,
  reciprocalRankFusion
};
