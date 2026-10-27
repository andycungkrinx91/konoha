'use strict';

const path = require('path');
const { resolveDynamicOutputPath } = require('./document_engine_common');
const { selectGradientTheme } = require('./document_cover');
const { createDocxDocument } = require('./doc_engine_docx');
const { createPdfDocument } = require('./doc_engine_pdf');

async function documentCreate(options = {}) {
  const format = (options.format || (options.output_path && path.extname(options.output_path).toLowerCase() === '.pdf' ? 'pdf' : 'docx')).toLowerCase();
  if (!['docx', 'pdf'].includes(format)) {
    return { success: false, error: `Unsupported document format '${format}'. Supported formats: 'docx', 'pdf'` };
  }

  const defaultFilename = `document.${format}`;
  const outputPath = resolveDynamicOutputPath(options.output_path, defaultFilename);

  const title = options.title || 'Technical Architecture Specification';
  const subtitle = options.subtitle || 'Operational Standards & Automated Delivery Architecture';
  const author = options.author || 'Enterprise Architecture Team';
  const classification = options.classification || 'Enterprise Standard (v1.0.0)';
  const dateStr = options.date || new Date().toISOString().split('T')[0];
  const compliance = options.compliance || 'Production Verified — Zero AI Artifacts';
  const sections = options.sections || [];
  const theme = selectGradientTheme(options.theme);
  const includeCover = options.cover !== false;

  const context = {
    outputPath,
    title,
    subtitle,
    author,
    classification,
    dateStr,
    compliance,
    sections,
    theme,
    includeCover
  };

  if (format === 'docx') {
    return createDocxDocument(options, context);
  }

  return createPdfDocument(options, context);
}

module.exports = {
  documentCreate
};
