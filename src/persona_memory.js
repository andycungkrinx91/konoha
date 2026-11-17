'use strict';

/**
 * Persistent Persona Memory & Project Context Engine (Facade)
 * Modularized into:
 * - src/persona_memory_projects.js
 * - src/persona_memory_items.js
 * - src/persona_memory_soul.js
 */

const db = require('./db');

const {
  DB_PATH,
  getDefaultDbPath,
  getDb,
  computeProjectHash,
  detectProjectStack,
  initMemoryTables,
  saveOrUpdateProject,
  getProjectProfile,
  listProjects,
  deleteProject,
  pruneAllProjects
} = require('./persona_memory_projects');

const {
  saveMemory,
  memoryContentExists,
  appendSessionFilter,
  queryMemories,
  listMemories,
  deleteMemory,
  pruneProjectMemories,
  pruneMemories,
  countMemories,
  pruneSessionMemories,
  recordFlowSkill,
  getFlowSkills
} = require('./persona_memory_items');

const {
  formatMemoriesForPrompt,
  formatProjectContextForPrompt,
  resolveSoulPath,
  parseSoulMarkdown,
  formatSoulBehavior,
  getSoul
} = require('./persona_memory_soul');

const memoryBrain = require('./memory_brain');
const memoryBrainExport = require('./memory_brain_export');
const { getMemoryProvider } = require('./memory_provider_adapter');

module.exports = {
  get DB_PATH() { return DB_PATH || db.DB_PATH; },
  set DB_PATH(val) { db.DB_PATH = val; },
  getDefaultDbPath,
  getDb,
  get_db: getDb,
  getSoul,
  get_soul: getSoul,
  recordFlowSkill,
  record_flow_skill: recordFlowSkill,
  getFlowSkills,
  get_flow_skills: getFlowSkills,
  formatSoulBehavior,
  format_soul_behavior: formatSoulBehavior,
  computeProjectHash,
  compute_project_hash: computeProjectHash,
  detectProjectStack,
  detect_project_stack: detectProjectStack,
  initMemoryTables,
  init_memory_tables: initMemoryTables,
  saveOrUpdateProject,
  save_or_update_project: saveOrUpdateProject,
  getProjectProfile,
  get_project_profile: getProjectProfile,
  listProjects,
  list_projects: listProjects,
  deleteProject,
  delete_project: deleteProject,
  saveMemory,
  save_memory: saveMemory,
  memoryContentExists,
  memory_content_exists: memoryContentExists,
  appendSessionFilter,
  queryMemories,
  query_memories: queryMemories,
  listMemories,
  list_memories: listMemories,
  deleteMemory,
  delete_memory: deleteMemory,
  pruneProjectMemories,
  prune_project_memories: pruneProjectMemories,
  pruneSessionMemories,
  prune_session_memories: pruneSessionMemories,
  pruneAllProjects,
  prune_all_projects: pruneAllProjects,
  pruneMemories,
  prune_memories: pruneMemories,
  countMemories,
  count_memories: countMemories,
  formatMemoriesForPrompt,
  format_memories_for_prompt: formatMemoriesForPrompt,
  formatProjectContextForPrompt,
  format_project_context_for_prompt: formatProjectContextForPrompt,
  resolveSoulPath,
  parseSoulMarkdown,
  remember: memoryBrain.remember,
  saveKnowledge: memoryBrain.saveKnowledge,
  recall: memoryBrain.recall,
  recallAsync: memoryBrain.recallAsync,
  listKnowledge: memoryBrain.listKnowledge,
  deleteKnowledge: memoryBrain.deleteKnowledge,
  correctMemory: memoryBrain.correctMemory,
  supersedeMemory: memoryBrain.supersedeMemory,
  withdrawMemory: memoryBrain.withdrawMemory,
  verifyMemory: memoryBrain.verifyMemory,
  restoreMemoryFromAudit: memoryBrain.restoreMemoryFromAudit,
  getMemoryHistory: memoryBrain.getMemoryHistory,
  linkMemories: memoryBrain.linkMemories,
  traverseKnowledgeGraph: memoryBrain.traverseKnowledgeGraph,
  explainRelation: memoryBrain.explainRelation,
  runMemoryMaintenance: memoryBrain.runMemoryMaintenance,
  revertMaintenanceRun: memoryBrain.revertMaintenanceRun,
  exportMemoryBrain: memoryBrainExport.exportMemoryBrain,
  importMemoryBrain: memoryBrainExport.importMemoryBrain,
  rebuildMemoryIndex: memoryBrainExport.rebuildMemoryIndex,
  benchmarkRetrieval: memoryBrainExport.benchmarkRetrieval,
  getMemoryProvider
};
