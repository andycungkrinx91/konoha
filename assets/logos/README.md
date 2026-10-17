# Official Client Brand Logos & Provenance

This directory archives verified, authentic brand marks and logos for the 8 official coding clients supported by Konoha MCP Orchestrator. All assets are bundled locally in `apps/web/static/logos/` to guarantee 100% offline rendering, zero network-runtime failure, and exact visual fidelity.

## Client Inventory & Verification Matrix

| Client ID | Display Name | Vendor / Project | Source URL / Provenance | Format & Dimensions | License / Usage Terms |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `cursor` | Cursor IDE / CLI | Anysphere Inc. | `https://cursor.com` (simple-icons / brand assets) | Vector SVG (24×24) | Trademark Anysphere Inc. Used for client identification. |
| `claude` | Claude Code CLI | Anthropic PBC | `https://claude.ai` / Anthropic Brand Guidelines | Vector SVG (24×24) | Trademark Anthropic PBC. Used for client identification. |
| `antigravity` | Antigravity IDE / CLI | Google DeepMind (Project Antigravity / Gemini) | `https://deepmind.google` / Google Brand Resource Center | Vector SVG (24×24) | Trademark Google LLC. Used for client identification. |
| `codex` | Codex IDE / CLI | OpenAI | `https://openai.com` / OpenAI Brand Assets | Vector SVG (2406×2406) | Trademark OpenAI. Used for client identification. |
| `opencode` | OpenCode IDE | OpenCode AI (`opencode.ai`) | `https://opencode.ai/favicon.svg` | Vector SVG (512×512) | Open source MIT / Trademark OpenCode AI. |
| `commandcode`| Command Code CLI | Command Code (`commandcode.ai`) | `https://commandcode.ai/favicon/2024/safari-pinned-tab.svg` | Vector SVG (700×700) | Trademark Command Code. Used for client identification. |
| `pi` | Pi (pi.dev) | Mario Zechner / Badlogic (`pi.dev`) | `https://pi.dev/favicon.svg` | Vector SVG (560×560) | Trademark Badlogic / pi.dev. Used for client identification. |
| `omp` | OMP Agent | Stencil Labs, Inc. (`omp.sh`) | `https://omp.sh/favicon.svg` | Vector SVG (64×64) | Open source MIT / Trademark Stencil Labs, Inc. |

## Verification Criteria
1. **Authenticity**: Every logo is acquired directly from the official vendor domain or primary open-source repository. No approximations, generic placeholders, or AI-generated fabrications.
2. **Offline Rendering**: All assets are served statically from `/logos/<client_id>.svg`.
3. **Accessibility**: Every `<img />` tag defines `alt="{client.name} logo"` and fallback text representation if rendering fails.
4. **Theme Resilience**: High contrast on both light and dark backgrounds.
