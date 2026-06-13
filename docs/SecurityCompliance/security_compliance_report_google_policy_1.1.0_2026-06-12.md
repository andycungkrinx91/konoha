# Security and Compliance Review: Konoha Project v1.1.0

## Executive Summary
A security and compliance review was performed on the Konoha project during the introduction of the Google Stitch integration feature (v1.1.0). The evaluation focused on ensuring that the new `konoha stitch` command suite complies with Google Policy requirements, specifically regarding transparency, explicit user consent, and secure command execution.

## Findings

### 1. Interactive Consent for Configuration (`bin/cli.js`)
- **Action Verified**: The `konoha stitch config` command dynamically imports and utilizes `@inquirer/prompts` to safely prompt the user for their `STITCH_API_KEY`.
- **Implementation Detail**: 
  - If a key already exists, it is displayed as a default, enabling users to verify or overwrite it explicitly.
  - The CLI does not silently auto-generate or write API keys or configure credentials in background threads without user interaction.
- **Impact**: Ensures credentials configuration is transparent and requires direct user interaction.

### 2. Auto-Approval Scoping in Settings Files
- **Action Verified**: The `konoha stitch enable` command writes specific, scoped permissions to `settings.json` (both local and user home directories) rather than wildcards for all command execution:
  - `mcp(stitch/*)`
  - `mcp(stitch/build_site)`
  - `mcp(stitch/get_screen_code)`
  - `mcp(stitch/get_screen_image)`
- **Impact**: Minimizes privilege escalation risks by limiting auto-approval settings to only the necessary Google Stitch MCP tools.

### 3. Safe Spawning of Subprocesses
- **Action Verified**: Both the `enable` and `disable` subcommands run plugin management commands via `spawnSync` without using raw string concatenation for shell commands.
- **Commands Executed**:
  - `npx plugins add google-labs-code/stitch-skills --scope global --target antigravity`
  - `npx plugins delete google-labs-code/stitch-skills --scope global --target antigravity`
- **Impact**: Eliminates injection risks by passing command arguments as a discrete array.

### 4. Reversible Actions (Rollback Procedures)
- **Action Verified**: The `konoha stitch disable` command acts as a complete rollback/removal mechanism:
  - Runs the plugin deletion command to clean up global node modules.
  - Removes the `stitch` MCP server definition from `mcp_config.json`.
  - Removes all auto-approve permissions from `settings.json`.
  - Removes Stitch skills from `@jonin`'s embedded skills array and redeploys agent instructions.
- **Impact**: Provides a safe and transparent way for the user to disable and clean up the integration completely.

## Conclusion
The Google Stitch integration implemented in Konoha v1.1.0 adheres strictly to secure design principles and compliance guidelines. All credential setup requires explicit user input, auto-approved permissions are restricted to the minimum required tools, subprocesses are safely parameterized, and a full rollback mechanism is provided via the `disable` command.
