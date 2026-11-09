# Red Skill Inventory

Single registry: `src/skill_authorization.js`. Every gate in Konoha consults it; no second list exists.
`classifySkill(name, tags)` returns `{ red, mode, requires_lab, reason }`.

## Classification rules (evaluated in order)

| # | Rule | Matches |
|---|------|---------|
| 1 | Exact name in `RED_SKILLS` | `akatsuki-skill` |
| 2 | Name matches `RED_SKILL_PATTERN` — `pentest`, `patch-diff-exploit` on a `-`/`_`/`/` boundary | `pentest-osint-recon`, `patch-diff-exploit`, `pentest-x` |
| 3 | Any tag in `RED_SKILL_TAGS` | `red-team`, `pentest`, `offensive` |
| — | Anything else | blue, `requires_lab: false` |

Names are normalized through `canonical_agents.normalizeAgentName` before matching (`@AKATSUKI_Skill` → `akatsuki-skill`). Tags are normalized to lowercase; a comma/space-separated string is accepted.

## Red skills currently in the tree

| Skill | Matched by | Invocable by | Lab required |
|-------|-----------|--------------|--------------|
| `akatsuki-skill` | rule 1 (name), also rule 3 (`red-team`, `pentest` tags) | `@akatsuki` | yes |

That is the whole set. `patch-diff-exploit`, `pentest-osint-recon`, and
`php-cve-patch-collection-maintenance` appear only as rule examples in tests and docs — no
template or installed skill carries those names. Rule 2 and rule 3 exist so an added skill
is classified red by construction; they are not claims about current content.

`src/templates/skills/akatsuki-skill/SKILL.md` additionally declares `mode: red` and `requires_lab: true` in its frontmatter. That declaration is documentation only — the frontmatter keys are not consulted by classification, so removing them cannot widen access.

## Authorization rule

`authorizeSkillAccess({ skillName, tags, agentName })`:

- blue → `{ authorized: true }`, identity irrelevant.
- red + `@akatsuki` → authorized.
- red + any other identity, or no identity → `{ authorized: false, code: 'SKILL_AUTHORIZATION_DENIED', requires_lab: true }` with a remediation string pointing at `@akatsuki` red-team delegation.

`KONOHA_AKATSUKI_REDTEAM`, `KONOHA_AKATSUKI_MODE`, workflow options, and MCP arguments cannot grant red access to another identity. `KONOHA_AKATSUKI_REDTEAM` only decides whether `@akatsuki` may run a red workflow; it is evaluated after the identity gate.

## Enforcement points

| Layer | File | Behavior on unauthorized red access |
|-------|------|-------------------------------------|
| Discovery (`find_skill`) | `src/mcp/skills_search.js` | Metadata row returned with `redacted: true`, `content: '[REDACTED]'`, `code`, `requires_lab`; a red-skill keyword query returns the denial payload |
| Discovery (`list_skills`) | `src/mcp/skills_search.js` | Rows annotated `redacted/code/requires_lab` |
| Retrieval (`get_skill`) | `src/mcp/skills_retrieval.js` | Denial payload before any path resolution or file read |
| Dispatch | `src/mcp/tool_dispatch.js` | Denial payload from `executeToolSync` / `executeTool` before the skill tool runs |
| Envelope | `src/mcp/sannin_router.js` | Blocked skills reported in the envelope, never bound to a non-akatsuki worker |
| Route | `src/mcp/workflow_sannin.js` | Whole route blocked with `phase: 'skill_authorization'` |
| Delegation | `src/mcp/lazy_subagent.js` | `buildSpawnDirective` / `buildParallelSpawnDirective` return the denial payload instead of a spawn instruction |
| Runtime | `src/workflow/akatsuki/workflows.js` | `runRedTeamWorkflow` checks identity first, before red-team mode and scope, so a denied caller learns nothing about either; absent identity denies |
| MCP boundary | `src/mcp/tool_dispatch.js` | Caller identity comes from `_resolveAgentIdentity(args)`, never from the requested tool name; a non-akatsuki or absent caller is denied |
| Audit writer | `src/workflow/akatsuki/lab_audit.js` | `auditRedSkill` is the only caller of `recordRedSkillAudit`; it never throws and never changes a decision |
| Audit store | `src/workflow/akatsuki/lab_db.js` | `recordRedSkillAudit` appends `allowed`/`denied` rows to `red_skill_audit` in the lab DB only, and never opens a connection itself. `runRedTeamWorkflow` calls it through `auditRedSkill` (`src/workflow/akatsuki/lab_audit.js`) for both the denial and the allowed path; it uses a caller-supplied `options.labConn` or opens the existing lab store read-write without creating it. No provisioned lab means no row, and the decision is unaffected |

## Audit scope

Only the runtime surface (`runRedTeamWorkflow`) writes `red_skill_audit` rows. The discovery,
retrieval, dispatch, delegation, route, and envelope gates deny without recording — they are
stateless rejections that never reach Akatsuki code, and writing from them would mean every
`find_skill` call touches the lab store. If those surfaces ever need an audit trail, add it to
`auditRedSkill`'s callers rather than to the shared gate.

## Lab requirement

Red execution has no host path. `runRedTeamWorkflow` requires `validateLabPrerequisites` to succeed against container `akatsuki-lab` (LXC on Linux, Docker on Windows/macOS), with network isolation verified. Missing engine returns `Declined: LXC/Docker not installed on this machine.`; unsupported platform returns no required engine and therefore fails closed. No Docker fallback exists on Linux.

## Adding a red skill

1. Either place it under a `pentest-` / `patch-diff-exploit-` prefix, tag it `red-team`/`pentest`/`offensive`, or add it to `RED_SKILLS`.
2. Do not add an authorization check at the call site — the shared gate already covers discovery, retrieval, dispatch, delegation, and runtime.
3. Add a case to `tests/test_akatsuki_skill_authz_db_isolation.js` section A and a denial case in section C.
