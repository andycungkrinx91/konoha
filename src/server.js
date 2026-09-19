#!/usr/bin/env node
/**
 * Konoha MCP Server — Unified Cross-Client MCP Subsystem
 * Thin CommonJS barrel re-exporting modular sub-modules under src/mcp/
 *
 * Orchestration & Subagent Pipelines:
 * - Code Exploration (Genin)
 * - Deep Research (Chunin)
 * - Architecture & Planning (Kage)
 * - Execution (Jonin / Anbu)
 * - Documentation & Refinement (Tokubetsu-Jonin)
 * - Final Report & Sannin Router
 * - Workflow review gate: review verification and confidence gate
 */

'use strict';

const db = require('./db');
const { getDb } = db;

// 1. Runtime State
const {
  getWorkspaceRoot,
  setWorkspaceRoot,
  getActiveClient,
  setActiveClient,
  setActiveSessionId,
  isPathVisible,
  konohaTmp,
  uriToPath,
  isIdeInstallationDir
} = require('./mcp/runtime_state');

// 2. Client Detection
const {
  detectActiveClient,
  detectActiveAgent,
  getActiveSessionId,
  getKonohaTmpRoot,
  getSessionKey,
  getAndIncrementSessionTurn,
  SESSION_TURNS,
  SESSION_TURN_LAST_ACCESS,
  SESSION_IDLE_RESET_SECONDS
} = require('./mcp/client_detection');

// 3. Skills
const {
  normalizeLegacySkillName,
  contentHash,
  autoMigrateProjectSkills,
  logToolCall,
  smartTruncate,
  findSkill,
  listSkills,
  getSkill,
  optimizeReport,
  getAgentSkills,
  levenshtein,
  fuzzyResolveSkill
} = require('./mcp/skills');

// 4. Build Spec
const {
  BUILD_FRAMEWORKS,
  validateBuildInput,
  resolveBuildSourceDir,
  normalizeFrameworkName,
  loadSkillContentForBuild,
  inferBuildArchetype,
  frameworkSourceSignals,
  buildFromSource,
  buildFromText
} = require('./mcp/build_spec');

// 5. Workflow
const {
  getResolvedTaskDir,
  readFileSafe,
  loadWorkflowStatus,
  saveWorkflowStatus,
  routeByKeywordsWithPrompt,
  workflowHash,
  workflowDispatch,
  workflowDispatchCompleted,
  isPentestTask,
  isCleanValidation,
  workflowParseTasks,
  workflowReviewApproved,
  cleanupTransientScratchFiles,
  runMcpWorkflow,
  runSannin
} = require('./mcp/workflow');

// 6. Web Search
const {
  runWebSearch,
} = require('./mcp/web_search');

// 6b. Website AI Detector & Docs AI Detector
const {
  runWebsiteAiDetector,
} = require('./mcp/ai_detector');
const {
  runDocsAiDetector,
} = require('./mcp/docs_ai_detector');

// 7. Memory & Reporting
const {
  getMainModel,
  applyFileEdits,
  autoloadSkillsFromPrompt,
  truncateAtBoundary,
  assessValidationEvidence,
  reportFromAgent,
  getProjectContext,
  saveProjectContext,
  queryProjectMemory,
  runMcpAgent
} = require('./mcp/memory_reporting');

// 8. Tool Dispatch
const {
  validateManifestArguments,
  executeTool,
  executeToolSync,
  _executeToolInternal
} = require('./mcp/tool_dispatch');

// 9. Protocol
const {
  getServerVersion,
  
  
  
  handleRequest,
  main,
  setInitialized
} = require('./mcp/protocol');

if (require.main === module) {
  (async () => {
    if (process.argv.length > 2 && process.argv[2] === '--tool') {
      const toolName = process.argv[3];
      const rawArgs = process.argv[4] || '{}';
      let args = {};
      try {
        args = JSON.parse(rawArgs);
      } catch (e) {
        console.log(JSON.stringify({ error: `Invalid tool arguments JSON: ${e.message}` }));
        process.exit(1);
      }
      setInitialized(true);
      try {
        const resultText = await executeTool(toolName, args);
        console.log(resultText);
      } catch (e) {
        console.log(JSON.stringify({ error: e.message || String(e) }));
      }
      process.exit(0);
    }
    try {
      const { ensureUiDaemonAutoStart } = require('../bin/cli');
      ensureUiDaemonAutoStart({ silent: true }).catch(() => {});
    } catch (_) { /* intentional best-effort fallback: UI auto-start must never block MCP server initialization */ }
    await main();
  })();
}

module.exports = {
  validateManifestArguments,
  _validate_manifest_arguments: validateManifestArguments,
  getServerVersion,
  isIdeInstallationDir,
  normalizeLegacySkillName,
  konohaTmp,
  uriToPath,
  contentHash,
  isPathVisible,
  autoMigrateProjectSkills,
  logToolCall,
  smartTruncate,
  findSkill,
  listSkills,
  getSkill,
  optimizeReport,
  getAgentSkills,
  BUILD_FRAMEWORKS,
  validateBuildInput,
  resolveBuildSourceDir,
  normalizeFrameworkName,
  levenshtein,
  _levenshtein: levenshtein,
  fuzzyResolveSkill,
  _fuzzy_resolve_skill: fuzzyResolveSkill,
  autoloadSkillsFromPrompt,
  _autoload_skills_from_prompt: autoloadSkillsFromPrompt,
  loadSkillContentForBuild,
  inferBuildArchetype,
  frameworkSourceSignals,
  buildFromSource,
  buildFromText,
  detectActiveClient,
  detectActiveAgent,
  getMainModel,
  applyFileEdits,
  readFileSafe,
  loadWorkflowStatus,
  saveWorkflowStatus,
  _load_workflow_status: loadWorkflowStatus,
  _save_workflow_status: saveWorkflowStatus,
  // aislop-ignore-next-line code-quality/duplicate-block (tool registration boilerplate across manifests)
  routeByKeywordsWithPrompt,
  workflowHash,
  workflowDispatch,
  workflowDispatchCompleted,
  isPentestTask,
  isCleanValidation,
  workflowParseTasks,
  workflowReviewApproved,
  cleanupTransientScratchFiles,
  runMcpWorkflow,
  runSannin,
  runWebSearch,
  assessValidationEvidence,
  reportFromAgent,
  getProjectContext,
  saveProjectContext,
  queryProjectMemory,
  getSessionKey,
  getAndIncrementSessionTurn,
  truncateAtBoundary,
  runMcpAgent,
  executeTool,
  executeToolSync,
  handleRequest,
  getDb,
  get DB_PATH() { return db.DB_PATH; },
  set DB_PATH(val) { db.DB_PATH = val; },
  get WORKSPACE_ROOT() { return getWorkspaceRoot(); },
  set WORKSPACE_ROOT(val) { setWorkspaceRoot(val); },
  get ACTIVE_CLIENT() { return getActiveClient(); },
  set ACTIVE_CLIENT(val) { setActiveClient(val); },
  SESSION_TURNS,
  SESSION_TURN_LAST_ACCESS,
  SESSION_IDLE_RESET_SECONDS,
  run_mcp_agent: runMcpAgent,
  report_from_agent: reportFromAgent,
  get_project_context: getProjectContext,
  save_project_context: saveProjectContext,
  query_project_memory: queryProjectMemory,
  run_mcp_workflow: runMcpWorkflow,
  run_sannin: runSannin,
  run_web_search: runWebSearch,
  run_website_ai_detector: runWebsiteAiDetector,
  website_ai_detector: runWebsiteAiDetector,
  run_docs_ai_detector: runDocsAiDetector,
  docs_ai_detector: runDocsAiDetector,
  assess_validation_evidence: assessValidationEvidence,
  find_skill: findSkill,
  list_skills: listSkills,
  get_skill: getSkill,
  build_from_source: buildFromSource,
  build_from_text: buildFromText,
  get_resolved_task_dir: getResolvedTaskDir,
  getResolvedTaskDir,
  getKonohaTmpRoot,
  get_konoha_tmp_root: getKonohaTmpRoot,
  getActiveSessionId,
  get_active_session_id: getActiveSessionId,
  setActiveSessionId,
  set_active_session_id: setActiveSessionId,
  getWorkspaceRoot,
  setWorkspaceRoot,
  getActiveClient,
  setActiveClient
};
