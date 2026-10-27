# ProjectDiscovery Katana Crawler Reference

Katana is a high-performance web crawling and spidering engine from ProjectDiscovery. It supports standard DOM parsing, JavaScript execution crawling via headless Chrome, endpoint extraction, and API route discovery.

## Source
- Skills.sh: `https://www.skills.sh/crtvrffnrt/skills/pentest-web-enumeration`
- Kali Linux / ProjectDiscovery: `https://www.kali.org/tools/katana/`

## When to Use
- Web Asset Crawling: map all reachable links, sub-routes, and static assets in a target web application.
- API Route Discovery: parse client-side JavaScript bundles to extract hidden API routes and endpoints.
- Pre-Audit Scope Mapping: provide comprehensive endpoint inventories for downstream fuzzing.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `katana`, `/root/go/bin/katana`, `/usr/local/go/bin/katana`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `active_recon`
- Timeout: 35000ms
- Evidence Outputs: `/tmp/akatsuki_katana.txt`
- Cleanup Steps: Remove `/tmp/akatsuki_katana.*`, terminate lingering `katana` processes

## Command Patterns
```bash
# 1. Standard depth-2 crawler with output file
katana -u http://127.0.0.1:8080 -depth 2 -o /tmp/akatsuki_katana.txt

# 2. Extract endpoints and API URLs in JSON line format
katana -u http://127.0.0.1:3000 -jc -jsonl -o /tmp/akatsuki_katana.txt

# 3. Controlled crawl with crawling rate limit and concurrency caps
katana -u http://127.0.0.1:8080 -concurrency 5 -rate-limit 15 -o /tmp/akatsuki_katana.txt
```

## Fail-Closed Notes
- External target URLs are refused by Akatsuki target validation.
- Missing sandbox container engine declines execution with fail-closed message.
