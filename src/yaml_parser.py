#!/usr/bin/env python3
"""
Shared YAML parsing and serializing helper module for Konoha (C1).
Eliminates duplicated YAML parser implementations across server.py, db_agents.py, and migrate.py.
"""

import os


def parse_yaml(yaml_content):
    agents = []
    current_agent = None
    current_key = None
    multiline_val = None
    multiline_indent = None
    list_key = None
    list_val = []

    lines = yaml_content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip empty lines and comments (except in multiline block)
        if not stripped or stripped.startswith("#"):
            if current_key and multiline_val is not None:
                if not stripped:
                    multiline_val.append("")
                else:
                    indent = len(line) - len(line.lstrip(' '))
                    if indent >= multiline_indent:
                        multiline_val.append(line[multiline_indent:])
                    else:
                        current_agent[current_key] = "\n".join(multiline_val)
                        current_key = None
                        multiline_val = None
                        multiline_indent = None
                        continue
            i += 1
            continue

        indent = len(line) - len(line.lstrip(' '))

        if current_key and multiline_val is not None:
            if indent >= multiline_indent:
                multiline_val.append(line[multiline_indent:])
                i += 1
                continue
            else:
                current_agent[current_key] = "\n".join(multiline_val)
                current_key = None
                multiline_val = None
                multiline_indent = None
                continue

        if list_key and stripped.startswith("- "):
            val = stripped[2:].strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            list_val.append(val)
            i += 1
            continue
        elif list_key:
            current_agent[list_key] = list_val
            list_key = None
            list_val = []
            continue

        if stripped.startswith("-"):
            if current_agent is not None:
                agents.append(current_agent)
            current_agent = {}

            rest = stripped[1:].strip()
            if not rest:
                i += 1
                continue
            else:
                stripped = rest

        if ":" in stripped:
            parts = stripped.split(":", 1)
            key = parts[0].strip()
            val = parts[1].strip()

            if val == "|":
                current_key = key
                multiline_val = []
                next_line_idx = i + 1
                while next_line_idx < len(lines) and not lines[next_line_idx].strip():
                    next_line_idx += 1
                if next_line_idx < len(lines):
                    multiline_indent = len(lines[next_line_idx]) - len(lines[next_line_idx].lstrip(' '))
                else:
                    multiline_indent = indent + 4
            elif not val:
                list_key = key
                list_val = []
            else:
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                elif val.startswith("[") and val.endswith("]"):
                    inner = val[1:-1].strip()
                    if not inner:
                        val = []
                    else:
                        val = [item.strip().strip('"').strip("'") for item in inner.split(",")]
                elif val.lower() == "true":
                    val = True
                elif val.lower() == "false":
                    val = False
                elif val.lower() in ("null", "none"):
                    val = None
                elif val.isdigit():
                    val = int(val)
                current_agent[key] = val

        i += 1

    if current_key and multiline_val is not None:
        current_agent[current_key] = "\n".join(multiline_val)
    if list_key:
        current_agent[list_key] = list_val
    if current_agent is not None:
        agents.append(current_agent)

    return agents


def serialize_yaml(data):
    lines = []
    for item in data:
        name = item.get("name", "")
        if name and not name.startswith("mcp_"):
            name = f"mcp_{name}"
        lines.append(f"- name: {name}")
        for k, v in item.items():
            if k == "name":
                continue
            if v is None:
                lines.append(f"  {k}: null")
            elif isinstance(v, bool):
                lines.append(f"  {k}: {str(v).lower()}")
            elif isinstance(v, (int, float)):
                lines.append(f"  {k}: {v}")
            elif isinstance(v, list):
                lines.append(f"  {k}:")
                for elem in v:
                    lines.append(f"    - {elem}")
            elif isinstance(v, str):
                if "\n" in v:
                    lines.append(f"  {k}: |")
                    for line in v.splitlines():
                        lines.append(f"    {line}")
                else:
                    if ":" in v or "#" in v or v.startswith("-") or v.startswith(" ") or v.strip() in ("true", "false", "null", "none"):
                        escaped = v.replace('"', '\\"')
                        lines.append(f'  {k}: "{escaped}"')
                    else:
                        lines.append(f"  {k}: {v}")
    return "\n".join(lines) + "\n"


def load_yaml_file(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        return parse_yaml(f.read())


def dump_yaml_file(file_path, data):
    content = serialize_yaml(data)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
