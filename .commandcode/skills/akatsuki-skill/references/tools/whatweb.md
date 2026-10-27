# WhatWeb NextGen Web Scanner Reference

WhatWeb is a next-generation web scanner and technology fingerprinting tool. It identifies content management systems (CMS), blogging platforms, JavaScript libraries, web frameworks, embedded devices, and web server configurations.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/whatweb`
- Kali Linux Official: `https://www.kali.org/tools/whatweb/`

## When to Use
- Web Technology Fingerprinting: detect underlying web stack components (Express, Svelte, Next.js, Nginx, Apache).
- CMS & Framework Identification: discover presence of WordPress, Drupal, Joomla, or custom frameworks.
- Response Header Analysis: extract server headers, cookies, and security header configurations.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `whatweb`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `read_only`
- Timeout: 20000ms
- Evidence Outputs: `/tmp/akatsuki_whatweb.json`
- Cleanup Steps: Remove `/tmp/akatsuki_whatweb.*`, terminate lingering `whatweb` processes

## Command Patterns
```bash
# 1. Standard technology fingerprinting with JSON output
whatweb --log-json=/tmp/akatsuki_whatweb.json http://127.0.0.1:8080

# 2. Stealth fingerprinting with low aggression level
whatweb -a 1 --log-json=/tmp/akatsuki_whatweb.json http://127.0.0.1:3000

# 3. Detailed plugin and header inspection
whatweb -v -a 3 --log-json=/tmp/akatsuki_whatweb.json http://127.0.0.1:8080
```

## Fail-Closed Notes
- Out-of-scope external host URLs are blocked by Akatsuki authorization validation.
- Missing container engine declines execution with fail-closed notification.
