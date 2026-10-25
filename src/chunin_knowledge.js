'use strict';

const personaMemory = require('./persona_memory');
const db = require('./db');

function saveChuninKnowledge({
  title,
  content,
  libraryName = '',
  query = '',
  sourceUrls = [],
  projectPath = null,
  sessionId = null,
  dbPath = null,
  importance = 3,
  tags = ''
}) {
  if (!content || typeof content !== 'string' || !content.trim()) {
    return null;
  }

  const cleanContent = content.trim();
  const targetDbPath = dbPath || db.DB_PATH;
  const pPath = projectPath || process.cwd();

  let formattedContent = cleanContent;
  if (Array.isArray(sourceUrls) && sourceUrls.length > 0) {
    formattedContent += `\n\n### References & Sources\n${sourceUrls.map(u => `- ${u}`).join('\n')}`;
  }

  if (personaMemory.memoryContentExists({
    content: formattedContent,
    agentName: 'chunin',
    projectPath: pPath,
    dbPath: targetDbPath
  })) {
    return null;
  }

  const cleanTitle = title || (libraryName ? `Chunin Research: ${libraryName}` : `Chunin Knowledge: ${query || 'Intelligence'}`);
  const tagList = [];
  if (libraryName) tagList.push(libraryName.toLowerCase());
  if (query) tagList.push(query.toLowerCase());
  if (tags) tagList.push(tags);
  tagList.push('chunin', 'knowledge', 'reference');
  if (Array.isArray(sourceUrls) && sourceUrls.length > 0) {
    tagList.push('verified-source');
  }

  return personaMemory.saveMemory({
    agentName: 'chunin',
    content: formattedContent,
    title: cleanTitle,
    memoryType: 'knowledge',
    importance,
    projectPath: pPath,
    sessionId,
    dbPath: targetDbPath,
    tags: Array.from(new Set(tagList)).join(',')
  });
}

function findSimilarChuninKnowledge({
  query = '',
  libraryName = '',
  projectPath = null,
  sessionId = null,
  limit = 5,
  dbPath = null
}) {
  const targetDbPath = dbPath || db.DB_PATH;
  const pPath = projectPath || process.cwd();
  const searchTerms = [query, libraryName].filter(Boolean).join(' ').trim();

  if (!searchTerms) {
    return personaMemory.listMemories('chunin', 'knowledge', pPath, null, sessionId, limit, targetDbPath);
  }

  const results = personaMemory.queryMemories({
    agentName: 'chunin',
    query: searchTerms,
    memoryType: 'knowledge',
    projectPath: pPath,
    sessionId,
    limit,
    allSessions: true,
    dbPath: targetDbPath
  });

  return results || [];
}

function recordChuninReport({
  summary,
  learnings = [],
  validation = [],
  filesCreated = [],
  filesModified = [],
  projectPath = null,
  sessionId = null,
  dbPath = null
}) {
  const pPath = projectPath || process.cwd();
  const targetDbPath = dbPath || db.DB_PATH;
  const savedIds = [];

  const sourceUrls = [];
  if (Array.isArray(validation)) {
    for (const v of validation) {
      if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) {
        sourceUrls.push(v);
      }
    }
  }

  if (summary && typeof summary === 'string' && summary.trim()) {
    let summaryText = summary;
    if (Array.isArray(filesCreated) && filesCreated.length > 0) {
      summaryText += `\nFiles created: ${filesCreated.join(', ')}`;
    }
    if (Array.isArray(filesModified) && filesModified.length > 0) {
      summaryText += `\nFiles modified: ${filesModified.join(', ')}`;
    }
    const memoryId = saveChuninKnowledge({
      title: `Chunin Research: ${summary.slice(0, 60)}`,
      content: summaryText,
      sourceUrls,
      projectPath: pPath,
      sessionId,
      dbPath: targetDbPath,
      importance: 3
    });
    if (memoryId) savedIds.push(memoryId);
  }

  if (Array.isArray(learnings)) {
    for (const item of learnings) {
      if (item && typeof item === 'string' && item.trim()) {
        const memoryId = saveChuninKnowledge({
          title: `Chunin Reference: ${item.slice(0, 50)}`,
          content: item,
          sourceUrls,
          projectPath: pPath,
          sessionId,
          dbPath: targetDbPath,
          importance: 2
        });
        if (memoryId) savedIds.push(memoryId);
      }
    }
  }

  return savedIds;
}

module.exports = {
  saveChuninKnowledge,
  findSimilarChuninKnowledge,
  recordChuninReport
};
