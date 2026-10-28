'use strict';

function calculateBurstiness(text) {
  if (!text || text.length < 100) {
    return { burstiness: 0.5, sentenceCount: 0, wordCount: 0 };
  }

  const lines = text.split('\n');
  const proseLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^#{1,6}\s/.test(trimmed)) return false;
    if (trimmed.length > 3 && trimmed === trimmed.toUpperCase() && /\s/.test(trimmed)) return false;
    if (/^[-*•◦▪]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) return false;
    return trimmed.split(/\s+/).filter(Boolean).length > 3;
  });

  const proseText = proseLines.join(' ');
  const sentences = proseText.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 5);

  if (sentences.length < 5) {
    return { burstiness: 0.5, sentenceCount: sentences.length, wordCount: proseText.split(/\s+/).length };
  }

  const lengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const totalWords = lengths.reduce((a, b) => a + b, 0);
  const mean = totalWords / lengths.length;

  const variance = lengths.reduce((acc, l) => acc + Math.pow(l - mean, 2), 0) / lengths.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0.5;

  return { burstiness: parseFloat(cv.toFixed(2)), sentenceCount: sentences.length, wordCount: totalWords };
}

const TRANSITION_WORDS = [
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
];

function evaluateParagraphCadence(p, idx) {
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length < 25) return null;

  const sentences = p.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
  if (sentences.length < 2) return null;

  const sLengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const mean = sLengths.reduce((a, b) => a + b, 0) / sLengths.length;
  const variance = sLengths.reduce((acc, l) => acc + Math.pow(l - mean, 2), 0) / sLengths.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0.5;

  const isAiCadence = sLengths.length >= 3
    ? (cv < 0.18 || ((mean >= 10 && mean <= 32) && (cv < 0.22 || sLengths.every(l => Math.abs(l - mean) <= 1))))
    : (cv < 0.08 && mean >= 12 && mean <= 30);

  const lowerP = p.toLowerCase();
  const matchedTriggers = TRANSITION_WORDS.filter(t => lowerP.includes(t));
  const isSuspicious = isAiCadence || matchedTriggers.length >= 3 || (matchedTriggers.length >= 2 && cv < 0.30);

  if (!isSuspicious) {
    return { evaluable: true, flagged: null };
  }

  return {
    evaluable: true,
    flagged: {
      paragraphIndex: idx + 1,
      snippet: p.length > 90 ? p.substring(0, 90) + '…' : p,
      sentenceCount: sentences.length,
      sentenceLengths: sLengths,
      cv: parseFloat(cv.toFixed(2)),
      reasons: [
        isAiCadence ? `Monotonous AI sentence rhythm (mean ${mean.toFixed(1)} words, CV ${cv.toFixed(2)} < 0.30, lengths [${sLengths.join(', ')}])` : null,
        matchedTriggers.length > 0 ? `AI transition triggers: ${matchedTriggers.join(', ')}` : null
      ].filter(Boolean)
    }
  };
}

function isTemplateParagraphCadence(p) {
  const sentences = p.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
  if (sentences.length < 2) return false;
  const sLengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  return sLengths[0] <= 5 && sLengths[1] >= 20;
}

function findTemplateCadences(paragraphs) {
  const templateCadences = [];
  paragraphs.forEach((p, idx) => {
    if (isTemplateParagraphCadence(p)) {
      templateCadences.push(idx + 1);
    }
  });
  return templateCadences;
}

function analyzeParagraphBurstiness(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) {
    return { total: 0, suspiciousCount: 0, zerogptRisk: 0.0, flagged: [] };
  }

  const flagged = [];
  let evaluableCount = 0;

  paragraphs.forEach((p, idx) => {
    const res = evaluateParagraphCadence(p, idx);
    if (!res) return;
    evaluableCount++;
    if (res.flagged) flagged.push(res.flagged);
  });

  const templateCadences = findTemplateCadences(paragraphs);
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

module.exports = {
  calculateBurstiness,
  analyzeParagraphBurstiness
};
