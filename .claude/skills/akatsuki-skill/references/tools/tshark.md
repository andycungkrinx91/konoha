# TShark Network Packet Analysis Reference

TShark is the terminal-based network protocol analyzer from Wireshark. It captures packet data from live interfaces, reads from saved capture files (.pcap/.pcapng), and parses protocols with rich display filters.

## Source
- Skills.sh: `https://skills.sh/agentsecops/secopsagentkit/analysis-tshark` (+ `https://www.skills.sh/terminalskills/skills/wireshark`)
- Kali Linux Official: `https://www.kali.org/tools/wireshark/`

## When to Use
- Passive Network Traffic Inspection: capture and inspect packets transmitted during test executions.
- Cleartext Protocol Auditing: verify whether sensitive data (credentials, tokens, cookies) is transmitted over unencrypted HTTP.
- Protocol Flow Debugging: analyze handshake timings, reset packets, and DNS resolution sequences.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `tshark`
- Target Scoping: Local container bridge interface (`eth0` or `labbr0`)
- Safety Class: `read_only`
- Timeout: 30000ms
- Evidence Outputs: `/tmp/akatsuki_tshark.pcap`, `/tmp/akatsuki_tshark.txt`
- Cleanup Steps: Remove `/tmp/akatsuki_tshark.*`, terminate lingering `tshark` processes

## Command Patterns
```bash
# 1. Capture 50 packets on container interface with text summary
tshark -i eth0 -c 50 -w /tmp/akatsuki_tshark.pcap

# 2. Extract HTTP requests, methods, and host headers from capture
tshark -r /tmp/akatsuki_tshark.pcap -Y "http.request" -T fields -e http.request.method -e http.host -e http.request.uri

# 3. Inspect DNS queries and response records
tshark -r /tmp/akatsuki_tshark.pcap -Y "dns" -T fields -e dns.qry.name -e dns.a
```

## Fail-Closed Notes
- Raw packet capture on host network interfaces is strictly forbidden.
- Execution is confined to the unprivileged container's network namespace.
