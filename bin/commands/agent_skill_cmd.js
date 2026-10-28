'use strict';

const agentManager = require('../../src/agent_manager');
const skillManager = require('../../src/skill_manager');
const { askQuestion, isCancel } = require('../lib/prompt');
const { C, header, log, info, success, warn, error } = require('../lib/format');

function registerAgentEmbeddedSkills(agents, allUniqueSkills) {
  for (const a of agents) {
    if (!a.skills) continue;
    for (const s of a.skills) {
      if (!allUniqueSkills.has(s)) allUniqueSkills.set(s, 'Currently embedded skill');
    }
  }
}

function collectAvailableSkills(agents) {
  const installedSkills = skillManager.listInstalledSkills();
  const allUniqueSkills = new Map();

  const defaultSkills = [
    { name: 'genin-skill', description: 'Codebase Reconnaissance & Trace SOPs' },
    { name: 'kage-skill', description: 'Architecture & Strategy SOPs' },
    { name: 'chunin-skill', description: 'Research & Intel SOPs' },
    { name: 'jonin-skill', description: 'UI & Frontend Specialist SOPs' },
    { name: 'anbu-skill', description: 'Backend, Bug Fixing & DevOps SOPs' },
    { name: 'tokubetsu-jonin-skill', description: 'Technical Scribe SOPs' }
  ];
  defaultSkills.forEach(s => allUniqueSkills.set(s.name, s.description));
  installedSkills.forEach(s => allUniqueSkills.set(s.name, s.description));

  registerAgentEmbeddedSkills(agents, allUniqueSkills);

  return Array.from(allUniqueSkills.entries())
    .map(([name, desc]) => ({ name, description: desc }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function printNonTtyAgentSkills(agents, agentName, agentPassedOnCli) {
  header(agentPassedOnCli ? `Skills Status for @${agentName}` : 'All Subagents Skills Status');
  const targetAgents = agentPassedOnCli ? [agents.find(a => a.name === agentName)] : agents;
  targetAgents.forEach(a => {
    log(`  ${C.bold}${a.icon || '👤'} @${a.name}${C.reset} ── ${a.title || 'Subagent'}`);
    const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
    log(`       ${C.dim}Skills: ${C.reset}${C.magenta}${skillsList}${C.reset}\n`);
  });
  info('Tip: Run interactively in a TTY, or use: konoha skill <skillname> embed <agentname>');
}

function handleDirectSkillEmbed(agentName, targetSkill) {
  try {
    const ok = agentManager.embedSkill(agentName, targetSkill);
    if (ok) {
      success(`Successfully embedded skill "${targetSkill}" into @${agentName}`);
    } else {
      warn(`Skill "${targetSkill}" is already embedded in @${agentName}`);
    }
    info('Re-deployed team configurations.');
  } catch (err) {
    error(`Failed to embed skill: ${err.message}`);
    process.exit(1);
  }
}

async function promptSelectAgent(agents) {
  header('Choose Subagent');
  agents.forEach((a, idx) => {
    const numStr = `${idx + 1}`.padStart(2);
    log(`  ${C.cyan}[${numStr}]${C.reset} ${C.bold}@${a.name}${C.reset} ── ${a.title || 'Subagent'}`);
    const skillsStr = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
    log(`       ${C.dim}Skills: ${C.reset}${C.magenta}${skillsStr}${C.reset}\n`);
  });
  log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back / Exit${C.reset}`);

  const ans = await askQuestion(`\nSelect subagent (1-${agents.length}): `);
  if (isCancel(ans)) return null;
  const num = parseInt(ans, 10);
  if (isNaN(num) || num < 1 || num > agents.length) {
    error('Invalid subagent selection.');
    return undefined;
  }
  return agents[num - 1].name;
}

function renderSkillsToggleMenu(agentName, skillList, agent) {
  header(`Configure Skills for @${agentName}`);
  log('Select a skill to toggle (embed / unembed):');
  skillList.forEach((s, idx) => {
    const isEmbedded = agent.skills && agent.skills.includes(s.name);
    const statusIcon = isEmbedded
      ? `${C.green}✨ [✓] Embedded${C.reset}`
      : `${C.dim}   [ ] Not Embedded${C.reset}`;
    const numStr = `${idx + 1}`.padStart(2);
    log(`  ${C.cyan}[${numStr}]${C.reset} ${statusIcon} ${C.bold}${s.name}${C.reset}`);
    log(`       ${C.dim}${s.description}${C.reset}\n`);
  });
  log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back${C.reset}`);
}

async function promptToggleSkill(agentName, skillList, agent) {
  renderSkillsToggleMenu(agentName, skillList, agent);
  const skillAns = await askQuestion(`\nSelect skill to toggle (1-${skillList.length}): `);
  if (isCancel(skillAns)) return null;

  const skillNum = parseInt(skillAns, 10);
  if (isNaN(skillNum) || skillNum < 1 || skillNum > skillList.length) {
    error('Invalid skill selection.');
    return undefined;
  }
  return skillList[skillNum - 1].name;
}

function applySkillToggle(agentName, selectedSkill, agent) {
  const isCurrentlyEmbedded = agent.skills && agent.skills.includes(selectedSkill);
  try {
    if (isCurrentlyEmbedded) {
      agentManager.unembedSkill(agentName, selectedSkill);
      success(`Successfully removed skill "${selectedSkill}" from @${agentName}`);
    } else {
      agentManager.embedSkill(agentName, selectedSkill);
      success(`Successfully embedded skill "${selectedSkill}" into @${agentName}`);
    }
    info('Re-deployed team configurations.');
  } catch (err) {
    error(`Failed to toggle skill: ${err.message}`);
  }
}

async function handleInteractiveSkillLoop(initialAgentName, agentPassedOnCli) {
  let step = agentPassedOnCli ? 'SELECT_SKILL' : 'SELECT_AGENT';
  let currentAgentName = initialAgentName;

  while (true) {
    let agents = agentManager.loadAgents();
    if (step === 'SELECT_AGENT') {
      const selected = await promptSelectAgent(agents);
      if (selected === null) break;
      if (selected === undefined) continue;
      currentAgentName = selected;
      step = 'SELECT_SKILL';
      continue;
    }

    const agent = agents.find(a => a.name.toLowerCase() === currentAgentName.toLowerCase());
    if (!agent) {
      error(`Error: agent @${currentAgentName} could not be loaded.`);
      step = 'SELECT_AGENT';
      continue;
    }

    const skillList = collectAvailableSkills(agents);
    if (skillList.length === 0) {
      warn('No skills found. Install some skills first using "konoha skill search" or "konoha skill add".');
      if (agentPassedOnCli) break;
      step = 'SELECT_AGENT';
      continue;
    }

    const selectedSkill = await promptToggleSkill(currentAgentName, skillList, agent);
    if (selectedSkill === null) {
      if (agentPassedOnCli) break;
      step = 'SELECT_AGENT';
      continue;
    }
    if (selectedSkill === undefined) continue;
    applySkillToggle(currentAgentName, selectedSkill, agent);
  }
}

async function handleAgentSkillCommand(subArgs) {
  let agentName = subArgs[0];
  const agents = agentManager.loadAgents();
  if (agents.length === 0) {
    warn('No subagents found.');
    process.exit(1);
  }

  const agentPassedOnCli = Boolean(agentName);
  if (agentPassedOnCli) {
    const found = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (!found) {
      error(`Subagent "@${agentName}" not found.`);
      process.exit(1);
    }
    agentName = found.name;
  }

  if (agentPassedOnCli && subArgs[1]) {
    handleDirectSkillEmbed(agentName, subArgs[1]);
    return;
  }

  if (!process.stdin || !process.stdin.isTTY) {
    printNonTtyAgentSkills(agents, agentName, agentPassedOnCli);
    return;
  }

  await handleInteractiveSkillLoop(agentName, agentPassedOnCli);
}

module.exports = {
  handleAgentSkillCommand
};
