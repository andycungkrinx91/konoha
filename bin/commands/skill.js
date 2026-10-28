"use strict";

/**
 * bin/commands/skill.js — Subagent Skill Installation, Embedding & Management.
 *
 * Subcommands:
 * - list: Show installed skills
 * - search: Search public registry (skills.sh)
 * - add: Install skill from registry or git URL
 * - remove: Uninstall skill from local environment
 * - embed: Assign skill to subagent
 * - unembed: Detach skill from subagent
 */

const { C, log, info, warn, error, success, header, chidoriTransition } = require("../lib/format");
const { cmdMigrate } = require("./migrate");
const skillManager = require("../../src/skill_manager");


function cmdSkillHelp() {
  log(`
  ${C.bold}📚 Konoha Skill Management Help 📚${C.reset}
  ${C.dim}========================================================================
  A "Skill" is a folder containing prompt instructions, examples, and rules
  that you teach to your AI subagents. By giving agents skills, they become
  experts in specific fields (like SvelteKit frontend, security DevOps, API design, etc.).
  ========================================================================${C.reset}

${C.bold}USAGE${C.reset}
  konoha skill <subcommand> [args]
  konoha skill <skillname> embed <agentname>
  konoha skill <skillname> unembed <agentname>

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}list${C.reset}                         Show all custom skills currently installed in your village.
  ${C.cyan}search <query>${C.reset}               Find new skills on the public registry (skills.sh) and install them.
  ${C.cyan}add <name|url> [name]${C.reset}        Install a skill from registry or directly from a Git repository URL.
  ${C.cyan}remove <name>${C.reset}                Uninstall a skill from your local environment.
  ${C.cyan}<skillname> embed <agent>${C.reset}   Embed an installed skill into a specific subagent.
  ${C.cyan}embed <skill> <agent>${C.reset}        Alias: Embed a skill into a specific subagent.
  ${C.cyan}<skillname> unembed <agent>${C.reset} Remove an embedded skill from a specific subagent.

${C.bold}EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. Find and install a Helm skill from the registry:${C.reset}
     konoha skill search helm

  ${C.dim}2. Add a skill directly by name from registry:${C.reset}
     konoha skill add helm-chart-scaffolding

  ${C.dim}3. Embed an installed skill into subagent @anbu:${C.reset}
     konoha skill helm-chart-scaffolding embed anbu

  ${C.dim}4. Install a specific skill directly from GitHub:${C.reset}
     konoha skill add https://github.com/example/my-skill my-custom-skill

  ${C.dim}5. View all skills currently installed:${C.reset}
     konoha skill list
`);
}

function handleSkillEmbedOrUnembed(subcommand, subArgs) {
  const isEmbed = (subcommand === 'embed' || subArgs[0] === 'embed');
  const skillName = (subcommand === 'embed' || subcommand === 'unembed') ? subArgs[0] : subcommand;
  const agentName = subArgs[1];

  if (!skillName || !agentName) {
    error(`Usage: konoha skill <skillname> ${isEmbed ? 'embed' : 'unembed'} <agentname>`);
    process.exit(1);
  }

  try {
    if (isEmbed) {
      const embedded = skillManager.embedSkillInAgent(skillName, agentName);
      if (embedded) success(`Successfully embedded skill "${skillName}" into @${agentName}`);
      else warn(`Skill "${skillName}" is already embedded in @${agentName}`);
    } else {
      const unembedded = skillManager.unembedSkillFromAgent(skillName, agentName);
      if (unembedded) success(`Successfully removed skill "${skillName}" from @${agentName}`);
      else warn(`Skill "${skillName}" was not embedded in @${agentName}`);
    }
    info('Re-deployed team configurations.');
  } catch (err) {
    error(`Failed to ${isEmbed ? 'embed' : 'unembed'} skill: ${err.message}`);
    process.exit(1);
  }
}

function handleSkillList() {
  header('Installed Skills');
  const installed = skillManager.listInstalledSkills();
  if (installed.length === 0) {
    warn('No custom skills currently installed.');
    return;
  }
  installed.forEach(s => {
    success(`${C.bold}${s.name}${C.reset}`);
    log(`  ${C.dim}Path:${C.reset} ${s.path}`);
    log(`  ${C.dim}Desc:${C.reset} ${s.description}`);
  });
}

function handleSkillSearch(subArgs) {
  const query = subArgs.join(' ');
  if (!query) {
    error('Usage: konoha skill search <query>');
    process.exit(1);
  }
  skillManager.runInteractiveSearch(query);
}

async function handleSkillAdd(subArgs) {
  if (subArgs.length === 0) {
    error('Usage: konoha skill add <skill-name> OR konoha skill add <repository-url> <skill-name>');
    process.exit(1);
  }
  try {
    if (subArgs.length >= 2) {
      await skillManager.addSkillDirect(subArgs[0], subArgs[1]);
    } else {
      await skillManager.addSkill(subArgs[0]);
    }
  } catch (err) {
    error(`Failed to add skill: ${err.message}`);
    process.exit(1);
  }
}

async function handleSkillRemove(subArgs) {
  const name = subArgs[0];
  if (!name) {
    error('Usage: konoha skill remove <skill-name>');
    process.exit(1);
  }
  try {
    skillManager.removeSkill(name);
    success(`Successfully removed skill: ${name}`);
    info('Re-indexing SQLite database...');
    await cmdMigrate([]);
  } catch (err) {
    error(`Failed to remove skill: ${err.message}`);
    process.exit(1);
  }
}

async function cmdSkill(args) {
  await chidoriTransition('skill');
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdSkillHelp();
    process.exit(0);
  }

  const isEmbed = (subcommand === 'embed' || subArgs[0] === 'embed');
  const isUnembed = (subcommand === 'unembed' || subArgs[0] === 'unembed');
  if (isEmbed || isUnembed) {
    handleSkillEmbedOrUnembed(subcommand, subArgs);
    return;
  }

  switch (subcommand) {
    case 'list': return handleSkillList();
    case 'search': return handleSkillSearch(subArgs);
    case 'add': return await handleSkillAdd(subArgs);
    case 'remove': return await handleSkillRemove(subArgs);
    default:
      error(`Unknown skill subcommand: ${subcommand}`);
      cmdSkillHelp();
      process.exit(1);
  }
}



module.exports = {
  cmdSkill,
  cmdSkillHelp,
};
