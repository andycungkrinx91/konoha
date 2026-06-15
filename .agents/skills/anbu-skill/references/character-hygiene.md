# Character Hygiene

Use this reference when generating or editing commands, code, configs, YAML, JSON, Markdown frontmatter, env files, Dockerfiles, Terraform, Kubernetes manifests, package files, CI/CD files, scripts, filenames, paths, or Skill metadata.

## Goal

Prevent accidental non-ASCII, invisible, full-width, or homoglyph characters from breaking copy-paste workflows.

## Risk characters

Watch for accidental:
- Chinese/Japanese/Korean characters
- Cyrillic/Russian characters
- Thai characters
- Arabic/Hebrew characters
- full-width punctuation
- smart quotes
- curly apostrophes
- em dash/en dash used as command flags
- non-breaking spaces
- zero-width spaces
- Unicode minus signs
- homoglyphs that look like Latin letters
- invisible control characters

## Default rule

For commands, code, config, filenames, environment keys, package names, YAML, JSON, TOML, Dockerfiles, Terraform, Kubernetes manifests, and Skill frontmatter:

Prefer plain ASCII unless the user explicitly asks for non-English text or Unicode content.

## Important exceptions

Unicode is allowed when it is intentional:
- user-facing translated text
- UI copy in another language
- test fixtures that explicitly require Unicode
- documentation examples about Unicode handling
- names/content supplied by the user that must be preserved

Do not rewrite intentional user-provided non-English content unless it appears inside syntax-sensitive code/config/command positions.

## Command safety

Before outputting shell commands:
- Use ASCII hyphen `-`, not en dash `–` or em dash `—`.
- Use normal quotes `'` or `"`, not smart quotes.
- Use normal spaces, not non-breaking spaces.
- Use ASCII variable names.
- Use ASCII paths unless user provided a Unicode path.
- Use only POSIX-safe flags.
- Avoid accidental non-Latin characters in options.

Bad:

```bash
grep –R “foo” .
```

Good:

```bash
grep -R "foo" .
```

## Config and code safety

- Keep JSON/YAML/TOML keys ASCII unless the format explicitly stores translated content.
- Keep environment variable names ASCII uppercase with underscores.
- Keep filenames, package names, Docker image tags, Terraform resource names, Kubernetes metadata names, and CI job IDs ASCII unless the user explicitly requires Unicode.
- Watch for homoglyphs in identifiers, imports, route names, resource names, and package names.
- In Markdown frontmatter and Skill metadata, keep keys and technical trigger words ASCII.

## DevSecOps notes

- Use ASCII for Terraform resource names, variables, outputs, state paths, Kubernetes metadata, Helm values, CI job IDs, Docker tags, shell variables, and cloud resource identifiers unless an existing system requires Unicode.
- Never allow en dash/em dash or Unicode minus in command flags for Terraform, kubectl, helm, cloud CLIs, or shell scripts.
