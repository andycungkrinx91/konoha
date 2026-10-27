'use strict';

/**
 * scripts/generate_kali_tools_catalog.js
 *
 * Fetches the canonical tool listing from https://www.kali.org/tools/all-tools/
 * and generates src/templates/akatsuki_lab/kali_tools.json.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const KALI_URL = 'https://www.kali.org/tools/all-tools/';
const OUTPUT_PATH = path.join(__dirname, '../src/templates/akatsuki_lab/kali_tools.json');

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Konoha-MCP/2.2.11 (+https://github.com/andycungkrinx/konoha-mcp)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}: HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function parseKaliTools(html) {
  const tools = [];
  const seenSlugs = new Set();

  // Pattern matches <a href=https://www.kali.org/tools/<slug>/ ...>...<slug></a>
  const toolRegex = /href=https:\/\/www\.kali\.org\/tools\/([a-z0-9_-]+)\/(?:#[a-z0-9_-]+)?(?:\s+title=["']([^"']*)["'])?[^>]*>(?:<i[^>]*><\/i>)?\s*([^<]+)<\/a>/gi;
  let match;

  while ((match = toolRegex.exec(html)) !== null) {
    const slug = match[1].toLowerCase();
    const titleAttr = match[2] || '';
    const linkText = match[3].replace(/^[$\s]+/, '').trim();

    if (slug === 'all-tools' || slug === 'top-100' || !slug) continue;

    if (!seenSlugs.has(slug)) {
      seenSlugs.add(slug);

      // Category heuristic based on common tool names
      let category = 'information-gathering';
      if (/pass|crack|john|hash|hydra|wordlist/i.test(slug)) category = 'password-attacks';
      else if (/web|http|zap|nikto|sqlmap|burp|ffuf|katana|ferox|wp/i.test(slug)) category = 'web-applications';
      else if (/sniff|tshark|tcpdump|wireshark|ettercap|mitm/i.test(slug)) category = 'sniffing-spoofing';
      else if (/exploit|metasploit|msf|shell|payload|searchsploit/i.test(slug)) category = 'exploitation-tools';
      else if (/forensic|autopsy|binwalk|sleuthkit/i.test(slug)) category = 'forensics';
      else if (/wireless|aircrack|kismet|wifi|ble/i.test(slug)) category = 'wireless-attacks';
      else if (/reverse|ghidra|radare|apktool|gdb/i.test(slug)) category = 'reverse-engineering';
      else if (/vuln|scanner|nmap|nuclei|openvas/i.test(slug)) category = 'vulnerability-analysis';
      else if (/post|privilege|mimikatz|powersploit/i.test(slug)) category = 'post-exploitation';

      tools.push({
        id: slug,
        name: linkText || slug,
        slug,
        package: slug,
        category,
        description: titleAttr || `Kali Linux tool package: ${slug}`,
        url: `https://www.kali.org/tools/${slug}/`
      });
    }
  }

  // Ensure canonical core tools are present
  const coreTools = [
    { id: 'nmap', name: 'nmap', slug: 'nmap', package: 'nmap', category: 'vulnerability-analysis', description: 'Network exploration tool and security/port scanner', url: 'https://www.kali.org/tools/nmap/' },
    { id: 'sqlmap', name: 'sqlmap', slug: 'sqlmap', package: 'sqlmap', category: 'web-applications', description: 'Automatic SQL injection and database takeover tool', url: 'https://www.kali.org/tools/sqlmap/' },
    { id: 'metasploit-framework', name: 'metasploit-framework', slug: 'metasploit-framework', package: 'metasploit-framework', category: 'exploitation-tools', description: 'Penetration testing and exploit execution platform', url: 'https://www.kali.org/tools/metasploit-framework/' },
    { id: 'ffuf', name: 'ffuf', slug: 'ffuf', package: 'ffuf', category: 'web-applications', description: 'Fast web fuzzer written in Go', url: 'https://www.kali.org/tools/ffuf/' },
    { id: 'nuclei', name: 'nuclei', slug: 'nuclei', package: 'nuclei', category: 'vulnerability-analysis', description: 'Fast and customizable vulnerability scanner', url: 'https://www.kali.org/tools/nuclei/' },
    { id: 'nikto', name: 'nikto', slug: 'nikto', package: 'nikto', category: 'web-applications', description: 'Web server security scanner', url: 'https://www.kali.org/tools/nikto/' },
    { id: 'hydra', name: 'hydra', slug: 'hydra', package: 'hydra', category: 'password-attacks', description: 'Fast network logon cracking tool', url: 'https://www.kali.org/tools/hydra/' },
    { id: 'gobuster', name: 'gobuster', slug: 'gobuster', package: 'gobuster', category: 'web-applications', description: 'Directory, DNS, and vhost busting tool', url: 'https://www.kali.org/tools/gobuster/' },
    { id: 'whatweb', name: 'whatweb', slug: 'whatweb', package: 'whatweb', category: 'web-applications', description: 'Next generation web scanner', url: 'https://www.kali.org/tools/whatweb/' },
    { id: 'seclists', name: 'seclists', slug: 'seclists', package: 'seclists', category: 'password-attacks', description: 'Security Tester\'s Companion wordlists and fuzzing lists', url: 'https://www.kali.org/tools/seclists/' },
    { id: 'exploitdb', name: 'exploitdb', slug: 'exploitdb', package: 'exploitdb', category: 'exploitation-tools', description: 'Exploit Database archive and searchsploit', url: 'https://www.kali.org/tools/exploitdb/' }
  ];

  for (const ct of coreTools) {
    if (!seenSlugs.has(ct.slug)) {
      tools.push(ct);
      seenSlugs.add(ct.slug);
    }
  }

  tools.sort((a, b) => a.slug.localeCompare(b.slug));
  return tools;
}

async function main() {
  console.log(`Fetching Kali tool listing from ${KALI_URL}...`);
  try {
    const html = await fetchHtml(KALI_URL);
    const tools = parseKaliTools(html);
    console.log(`Parsed ${tools.length} Kali tools.`);

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(tools, null, 2), 'utf8');
    console.log(`✓ Wrote ${tools.length} tools to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('Error fetching Kali tools:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseKaliTools, fetchHtml };
