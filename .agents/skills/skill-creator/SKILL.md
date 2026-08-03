---
name: skill-creator
description: Guide for creating, modifying, and maintaining AI agent skills following the Konoha skill specification. Covers SKILL.md structure, frontmatter conventions, domain routing tables, MCP tool usage, and skill versioning.
tags: [skill-creation, skill-development, konoha-skills, skill-specification, mcp-tools, agent-skills, skill-versioning]
license: MIT
author: Konoha Team
version: 1.0.0
---

# Skill Creator

## SKILL.md Structure

Every skill consists of:
1. **Frontmatter** (YAML): Metadata for the skill
2. **Markdown Body**: Content for the agent to read on demand

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique skill identifier (e.g., `anbu-skill/devops-engineer`) |
| `description` | Yes | Concise description for FTS5 indexing |
| `tags` | Yes | Array of searchable keywords |
| `license` | No | SPDX license identifier |
| `author` | No | Author or team name |
| `version` | No | Semantic version (e.g., `1.0.0`) |
| `context` | No | `fork` for isolated execution |
| `agent` | No | Target agent role |
| `complexity` | No | `simple`, `medium`, `complex` |
| `user-invocable` | No | Whether users can trigger this skill |

## Domain Routing Pattern

Skills should include a Domain Routing table to guide the agent:

```markdown
## Domain Routing

Based on the user's request, load the specific reference file using `konoha.get_skill("<reference-name>")` (for internal references) or `konoha.get_skill("<skill-name>")` (for global skills). **Never guess implementation details or read files under .agents/skills/ directly.**

| If the request involves... | Load this reference |
|---|---|
| Keyword or phrase to match | `skill-reference-name` |
| Another related topic | `another-reference` |
```

## Best Practices

### Content Organization
- Lead with the most important information
- Use clear, concise language
- Include code examples where applicable
- Add anti-patterns section for common mistakes
- Include references to authoritative sources

### SEO for FTS5
- Use relevant keywords in description
- Tag with specific and broad terms
- Include synonyms in tags
- Write comprehensive content for better indexing

### MCP Tool Usage
- Always use `konoha.get_skill()` for skill discovery
- Never use `semble` tools for skills
- Never read .agents/skills/ files directly
- Chain skills via domain routing

### Version Management
- Use semantic versioning (MAJOR.MINOR.PATCH)
- MAJOR: Breaking changes
- MINOR: New features, backward compatible
- PATCH: Bug fixes, backward compatible

## Skill Types

### Main Skills (SKILL.md)
- Primary agent instructions
- Contains workflow role, SOPs, domain routing
- Loaded at agent initialization

### Reference Files
- Supporting documentation
- Loaded on-demand by main skills
- Can be nested (e.g., `anbu-skill/devops-engineer`)

## Creating a New Skill

### Step 1: Define Purpose
- What problem does this skill solve?
- Which agent will use it?
- What keywords should trigger it?

### Step 2: Write Frontmatter
```yaml
---
name: agent-skill/skill-name
description: Clear description with keywords
tags:
  - tag1
  - tag2
  - tag3
license: MIT
author: Your Name
version: 1.0.0
---
```

### Step 3: Add Content
- Workflow Role section
- Standard Operating Procedures (SOPs)
- Domain Routing table
- Code examples
- Anti-patterns
- References

### Step 4: Test
- Verify FTS5 indexing
- Test skill retrieval
- Check domain routing works
- Validate content quality

## Naming Conventions

- Use kebab-case: `my-skill-name`
- Prefix with agent name for nested skills: `anbu-skill/my-reference`
- Avoid spaces and special characters
- Keep names descriptive but concise

## Common Pitfalls

1. **Duplicate Names**: Check existing skills before creating
2. **Missing Tags**: Reduces discoverability
3. **Vague Descriptions**: Hard to match via FTS5
4. **No Domain Routing**: Agents don't know when to use
5. **Duplicate Content**: Skills should be unique and focused

## References

- [Konoha Maintenance Skill](konoha)
- [Adding Skills Documentation](docs/ADDING-SKILLS.md)
- [Skill Registry](https://www.skills.sh/)
