/**
 * src/workflow/kage-reviewer/docs_ai_detector.js — Enterprise Document AI-Fingerprint Detector.
 *
 * Scans generated and source documents (.docx, .pdf, .pptx, .xlsx, .md, .txt)
 * for AI fingerprints, watermarks, metadata generator footprints, monotonous
 * sentence rhythm (low burstiness), AI buzzword density, and dark theme violations.
 *
 * Score: 0-100 (0-20 = HUMAN_WRITTEN, matching zero-AI human consistency target).
 * Zero external npm dependencies: uses native CLI/standard libraries for high-speed streaming.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  AI_BUZZWORDS,
  AI_COLLOCATIONS,
  GENERATOR_SIGNATURES,
  WATERMARK_PATTERNS
} = require('./docs_ai_constants');
const {
  extractDocx,
  extractPdf,
  extractPptx,
  extractXlsx
} = require('./docs_ai_extractors');
const {
  calculateBurstiness,
  analyzeParagraphBurstiness
} = require('./docs_ai_heuristics');

function loadDocumentData(resolved, ext) {
  if (ext === '.docx') return extractDocx(resolved);
  if (ext === '.pdf') return extractPdf(resolved);
  if (ext === '.pptx') return extractPptx(resolved);
  if (ext === '.xlsx') return extractXlsx(resolved);
  if (['.txt', '.md'].includes(ext)) {
    const text = fs.readFileSync(resolved, 'utf8');
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return { text, paragraphs, metadata: '', hasWatermark: false, darkFills: [], error: null };
  }
  return { error: `Unsupported document format '${ext}'. Supported: .docx, .pdf, .pptx, .xlsx, .md, .txt` };
}

function checkStructuralRules(docData, findings) {
  let score = 0;
  if (docData.hasWatermark) {
    findings.push({
      rule: 'WM-01', severity: 'high', weight: 35,
      title: 'Watermark or Evaluation Stamp Detected',
      evidence: 'Document contains embedded watermark elements or stamp text. Enterprise deliverables must have zero watermarks.'
    });
    score += 35;
  }

  for (const gen of GENERATOR_SIGNATURES) {
    if (gen.pattern.test(docData.metadata)) {
      findings.push({
        rule: 'META-01', severity: 'high', weight: 25,
        title: `Automated Library Footprint in Metadata (${gen.name})`,
        evidence: `Document metadata reveals automated generator tag '${gen.name}'. Requires sanitization.`
      });
      score += 25;
      break;
    }
  }

  if (docData.darkFills && docData.darkFills.length > 0) {
    findings.push({
      rule: 'THEME-01', severity: 'medium', weight: 20,
      title: 'Dark Theme Style Violation in Document',
      evidence: `Found dark fill styling (${docData.darkFills.slice(0, 3).join(', ')}). Enterprise documents must strictly enforce pure light mode.`
    });
    score += 20;
  }

  if (docData.lowercaseFormulas && docData.lowercaseFormulas.length > 0) {
    findings.push({
      rule: 'FMT-01', severity: 'medium', weight: 15,
      title: 'Lowercase Formula Names in Spreadsheet',
      evidence: `Found lowercase formulas: ${docData.lowercaseFormulas.slice(0, 3).join(', ')}. Must be uppercase (e.g. SUM, AVERAGE).`
    });
    score += 15;
  }

  return score;
}

function evaluateCliches(lowerText, findings) {
  const detected = [];
  for (const word of AI_BUZZWORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches && matches.length > 0) {
      detected.push(`${word} (${matches.length}x)`);
    }
  }

  if (detected.length >= 8) {
    findings.push({
      rule: 'CLICHE-01', severity: 'high', weight: 15,
      title: 'High AI Cliché & Buzzword Density',
      evidence: `Detected repetitive AI phrases: ${detected.slice(0, 5).join(', ')}.`
    });
    return 15;
  }
  if (detected.length >= 5) {
    findings.push({
      rule: 'CLICHE-01', severity: 'medium', weight: 6,
      title: 'Moderate AI Phrase Frequency',
      evidence: `Detected phrases: ${detected.join(', ')}.`
    });
    return 6;
  }
  return 0;
}

function evaluateLexicalAndCollocations(lowerText, findings) {
  let score = 0;
  const wordsOnly = lowerText.match(/\b[a-z]{3,}\b/g) || [];
  if (wordsOnly.length >= 100) {
    const uniqueWords = new Set(wordsOnly).size;
    const ttr = uniqueWords / wordsOnly.length;
    if (ttr < 0.38) {
      findings.push({
        rule: 'LEX-01', severity: 'medium', weight: 15,
        title: 'Low Lexical Diversity (Low Type-Token Ratio)',
        evidence: `Type-token ratio is ${(ttr * 100).toFixed(1)}% (${uniqueWords} unique / ${wordsOnly.length} total words). Indicates repetitive vocabulary distribution typical of language model output.`
      });
      score += 15;
    }
  }

  const matched = [];
  for (const col of AI_COLLOCATIONS) {
    if (lowerText.includes(col)) matched.push(col);
  }
  if (matched.length >= 2) {
    findings.push({
      rule: 'COLLOC-01', severity: 'medium', weight: 15,
      title: 'Predictable AI Collocation Phrasing',
      evidence: `Detected high-probability AI collocations: ${matched.join('; ')}.`
    });
    score += 15;
  }
  return score;
}

function evaluateBurstinessRules(docData, findings) {
  let score = 0;
  const stats = calculateBurstiness(docData.text);
  if (stats.sentenceCount >= 10 && stats.burstiness < 0.18) {
    findings.push({
      rule: 'BURST-01', severity: 'medium', weight: 8,
      title: 'Monotonous Sentence Rhythm (Low Burstiness)',
      evidence: `Sentence length coefficient of variation is ${stats.burstiness} (< 0.18). Indicates synthetic cadence.`
    });
    score += 8;
  }

  const paraAnalysis = analyzeParagraphBurstiness(docData.paragraphs || []);
  if (paraAnalysis.zerogptRisk > 5.0) {
    const sample = paraAnalysis.flagged
      .slice(0, 3)
      .map(f => `¶${f.paragraphIndex} [CV: ${f.cv}, lengths: ${f.sentenceLengths.join('/')}]: "${f.snippet}"`)
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

  if (paraAnalysis.templateCadences && paraAnalysis.templateCadences.length >= 2) {
    findings.push({
      rule: 'TEMPL-01', severity: 'medium', weight: 18,
      title: 'Syntactic Template Repetition Cadence Detected',
      evidence: `Detected repetitive 3-beat paragraph cadence (short punchy opener followed by fronted compound clause) across paragraphs ${paraAnalysis.templateCadences.join(', ')}. Commercial ZeroGPT flags this structural uniformity.`
    });
    score += 18;
  }

  return { score, stats, paraAnalysis };
}

function computeVerdict(score, zerogptRisk) {
  if (score <= 5 && zerogptRisk <= 3.0) {
    return {
      label: 'HUMAN_WRITTEN',
      verdict: 'Human-authentic document with 100% human consistency, zero watermarks, and 0.0%–3.0% ZeroGPT risk target satisfied.'
    };
  }
  if (score <= 20) {
    return {
      label: 'HUMAN_WRITTEN',
      verdict: 'Human-authentic document with 100% human consistency, zero watermarks, and zero AI fingerprints.'
    };
  }
  if (score <= 45) {
    return {
      label: 'LOW_AI_SUSPICION',
      verdict: 'Document exhibits minor AI characteristics or unscrubbed toolchain signatures.'
    };
  }
  return {
    label: 'AI_GENERATED',
    verdict: 'Document exhibits strong AI generation markers, watermarks, or un-sanitized automated generator footprints.'
  };
}

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
  const docData = loadDocumentData(resolved, ext);
  if (docData.error) return { error: docData.error };

  const findings = [];
  let score = checkStructuralRules(docData, findings);

  const lowerText = (docData.text || '').toLowerCase();
  score += evaluateCliches(lowerText, findings);
  score += evaluateLexicalAndCollocations(lowerText, findings);

  const burstRes = evaluateBurstinessRules(docData, findings);
  score = Math.min(100, score + burstRes.score);

  const { label, verdict } = computeVerdict(score, burstRes.paraAnalysis.zerogptRisk);

  return {
    target: path.basename(resolved),
    file_path: resolved,
    format: ext.replace('.', ''),
    score,
    human_score: 100 - score,
    label,
    verdict,
    zerogpt_risk_score: burstRes.paraAnalysis.zerogptRisk,
    watermark_detected: docData.hasWatermark,
    dark_theme_detected: Boolean(docData.darkFills && docData.darkFills.length > 0),
    stats: {
      words: burstRes.stats.wordCount,
      sentences: burstRes.stats.sentenceCount,
      paragraphs: (docData.paragraphs || []).length,
      burstiness: burstRes.stats.burstiness,
      zerogpt_risk_score: burstRes.paraAnalysis.zerogptRisk,
      flagged_paragraphs: burstRes.paraAnalysis.suspiciousCount,
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
