# Droopescan CMS Vulnerability Scanner Reference

Droopescan is a plugin-based security scanner that checks for known vulnerabilities and configuration flaws in content management systems including Drupal, SilverStripe, WordPress, and Moodle.

## Source
- Kali Linux Official: `https://www.kali.org/tools/droopescan/`
- Chunin Threat Intelligence: Derived from CMS penetration testing adjacencies at `https://www.skills.sh/agent-skills-hub/agent-skills-hub/wordpress-penetration-testing` and curated profile specifications.

## When to Use
- Drupal & SilverStripe Security Auditing: identify CMS core version flaws and vulnerable modules.
- Static File & Directory Exposure: detect exposed changelogs, installation files, and database backups.
- Pre-Assessment CMS Fingerprinting: identify exact version releases through checksum matching.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `droopescan`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `vulnerability_audit`
- Timeout: 30000ms
- Evidence Outputs: `/tmp/akatsuki_droopescan.json`
- Cleanup Steps: Remove `/tmp/akatsuki_droopescan.*`, terminate lingering `droopescan` processes

## Command Patterns
```bash
# 1. Scan Drupal target with JSON output
droopescan scan drupal -u http://127.0.0.1:8080 -o json > /tmp/akatsuki_droopescan.json

# 2. Scan SilverStripe target for vulnerable themes and modules
droopescan scan silverstripe -u http://127.0.0.1:8080 -o json > /tmp/akatsuki_droopescan.json

# 3. Fast version-only fingerprint check
droopescan scan drupal -u http://127.0.0.1:3000 --number-checks 5 -o json > /tmp/akatsuki_droopescan.json
```

## Fail-Closed Notes
- Execution fails closed if container engine is missing or stopped.
- Target must comply with local/dev address bounds.
