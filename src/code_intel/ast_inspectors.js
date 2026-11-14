'use strict';

/**
 * AST symbol, reference, and import/edge extractors for web-tree-sitter parse trees,
 * plus structured Markdown and JSON/YAML/TOML extractors.
 */

const { MAX_SYMBOLS_PER_FILE, MAX_REFS_PER_FILE } = require('./config');
const { CHUNK_SCHEMA_VERSION } = require('./chunker');
const { KEYWORDS } = require('./lexer_fallback');

const CONTAINER_KINDS = {
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  class_definition: 'class',
  class_specifier: 'class',
  record_declaration: 'class',
  struct_item: 'class',
  struct_specifier: 'class',
  interface_declaration: 'interface',
  trait_item: 'interface',
  enum_declaration: 'enum',
  enum_item: 'enum',
  enum_specifier: 'enum',
  internal_module: 'namespace',
  namespace_definition: 'namespace',
  mod_item: 'namespace',
  impl_item: 'impl'
};

const FUNCTION_NODES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_signature',
  'method_definition',
  'method_signature',
  'function_definition',
  'method_declaration',
  'constructor_declaration',
  'function_item',
  'function_signature_item'
]);

const DIRECT_IDENT_TYPES = new Set([
  'identifier',
  'type_identifier',
  'namespace_identifier',
  'property_identifier',
  'field_identifier',
  'word',
  'constant',
  'qualified_identifier',
  'scoped_identifier',
  'dotted_name'
]);

const SQL_KIND_MAP = {
  create_table: 'class',
  create_view: 'interface',
  create_function: 'function',
  create_trigger: 'function',
  create_index: 'type',
  create_type: 'type',
  create_schema: 'namespace'
};

function _stripQuotes(raw) {
  const s = String(raw || '').trim();
  const wrapped =
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('`') && s.endsWith('`')) ||
    (s.startsWith('<') && s.endsWith('>'));
  return wrapped ? s.slice(1, -1) : s;
}

function _sigLine(lines, lineNum) {
  const raw = (lines[lineNum - 1] || '').trim();
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

function _nodeEndLine(node) {
  const startRow = node.startPosition.row;
  const endRow = node.endPosition.row;
  if (endRow > startRow && node.endPosition.column === 0) return endRow;
  return endRow + 1;
}

function _extractNameText(node) {
  if (!node) return '';
  if (DIRECT_IDENT_TYPES.has(node.type)) return node.text;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && DIRECT_IDENT_TYPES.has(child.type)) return child.text;
  }
  return '';
}

function _unwrapCppFuncName(declNode) {
  let cur = declNode;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.type === 'function_declarator') {
      cur = cur.childForFieldName('declarator');
      break;
    }
    const next = cur.childForFieldName('declarator');
    if (!next) break;
    cur = next;
  }
  if (!cur) return { name: '', parentName: '' };
  if (cur.type === 'qualified_identifier') {
    const scope = cur.childForFieldName('scope');
    const name = cur.childForFieldName('name');
    return { name: name ? name.text : cur.text, parentName: scope ? scope.text : '' };
  }
  return { name: _extractNameText(cur), parentName: '' };
}

function _extractGoReceiverType(node) {
  const recv = node.childForFieldName('receiver');
  if (!recv) return '';
  return recv.text.replace(/[()*&\s]/g, ' ').trim().split(/\s+/).pop() || '';
}

function _pushSymbol(ctx, spec) {
  if (ctx.symbols.length >= MAX_SYMBOLS_PER_FILE) return false;
  if (!spec.name || KEYWORDS.has(spec.name)) return false;
  const startLine = Math.max(1, spec.startLine);
  const endLine = Math.max(startLine, spec.endLine);
  const key = `${spec.name}:${spec.kind}:${startLine}`;
  if (ctx.seenSymbols.has(key)) return false;
  ctx.seenSymbols.add(key);
  ctx.symbols.push({
    name: spec.name,
    kind: spec.kind,
    parentName: spec.parentName || '',
    startLine,
    endLine,
    signature: _sigLine(ctx.lines, startLine),
    language: ctx.language
  });
  return true;
}

function _pushRef(ctx, targetName, kind, line) {
  if (ctx.refs.length >= MAX_REFS_PER_FILE) return;
  if (!targetName || targetName.length < 2 || KEYWORDS.has(targetName)) return;
  const key = `${targetName}@${line}`;
  if (ctx.seenRefs.has(key)) return;
  ctx.seenRefs.add(key);
  ctx.refs.push({ targetName, kind, line });
}

function _collectSqlTableDecl(node, ctx) {
  let objName = '';
  for (let i = 0; i < node.namedChildCount; i++) {
    const ch = node.namedChild(i);
    if (ch && (ch.type === 'object_reference' || ch.type === 'identifier')) {
      objName = ch.text.split('.').pop();
      break;
    }
  }
  if (!objName) return;
  _pushSymbol(ctx, {
    name: objName,
    kind: SQL_KIND_MAP[node.type] || 'type',
    parentName: '',
    startLine: node.startPosition.row + 1,
    endLine: _nodeEndLine(node)
  });
}

function _recordHeritageNames(clauseNode, edgeKind, className, line, ctx) {
  if (!clauseNode) return;
  const names = [];
  for (let i = 0; i < clauseNode.namedChildCount; i++) {
    const ch = clauseNode.namedChild(i);
    if (!ch) continue;
    const text = _extractNameText(ch) || ch.text.split(/[.<]/)[0].trim();
    if (text && !KEYWORDS.has(text)) names.push(text);
  }
  if (names.length > 0) {
    ctx.imports.push({ edgeKind, specifier: '', names, sourceSymbolName: className, line });
  }
}

function _inspectJsTsVarDecl(node, parentName, ctx) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const decl = node.namedChild(i);
    if (!decl || decl.type !== 'variable_declarator') continue;
    const val = decl.childForFieldName('value');
    const nameNode = decl.childForFieldName('name');
    const isFn = val && (val.type === 'arrow_function' || val.type === 'function_expression' || val.type === 'generator_function');
    if (isFn && nameNode) {
      _pushSymbol(ctx, {
        name: nameNode.text,
        kind: parentName ? 'method' : 'function',
        parentName,
        startLine: node.startPosition.row + 1,
        endLine: _nodeEndLine(node)
      });
    }
  }
}

function _inspectHeritageClause(ch, className, line, ctx) {
  if (ch.type === 'extends_type_clause') {
    _recordHeritageNames(ch, 'extends', className, line, ctx);
    return;
  }
  if (ch.type !== 'class_heritage') return;
  for (let k = 0; k < ch.namedChildCount; k++) {
    const sub = ch.namedChild(k);
    if (!sub) continue;
    if (sub.type === 'extends_clause') _recordHeritageNames(sub, 'extends', className, line, ctx);
    if (sub.type === 'implements_clause') _recordHeritageNames(sub, 'implements', className, line, ctx);
  }
}

function _inspectJsTsNode(node, parentName, ctx) {
  const line = node.startPosition.row + 1;
  if (node.type === 'import_statement' || node.type === 'export_statement') {
    const src = node.childForFieldName('source');
    if (src) {
      const edgeKind = node.type === 'export_statement' ? 'reexports' : 'imports';
      ctx.imports.push({ edgeKind, specifier: _stripQuotes(src.text), names: [], line });
    }
    return;
  }
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function');
    const args = node.childForFieldName('arguments');
    const fnName = fn ? fn.text : '';
    const first = args && args.namedChildCount > 0 ? args.namedChild(0) : null;
    if ((fnName === 'require' || fnName === 'import') && first && (first.type === 'string' || first.type === 'template_string')) {
      ctx.imports.push({ edgeKind: 'imports', specifier: _stripQuotes(first.text), names: [], line });
    }
    return;
  }
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    _inspectJsTsVarDecl(node, parentName, ctx);
    return;
  }
  if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration' || node.type === 'interface_declaration') {
    const className = _extractNameText(node.childForFieldName('name'));
    for (let i = 0; i < node.namedChildCount; i++) {
      const ch = node.namedChild(i);
      if (ch) _inspectHeritageClause(ch, className, line, ctx);
    }
  }
}

function _inspectPyImport(node, line, ctx) {
  const mod = node.childForFieldName('module_name');
  if (mod) {
    ctx.imports.push({ edgeKind: 'imports', specifier: mod.text, names: [], line });
    return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const ch = node.namedChild(i);
    if (ch && ch.type === 'dotted_name') ctx.imports.push({ edgeKind: 'imports', specifier: ch.text, names: [], line });
  }
}

function _inspectOtherImports(node, ctx) {
  const line = node.startPosition.row + 1;
  if ((node.type === 'import_statement' || node.type === 'import_from_statement') && ctx.grammarKey === 'python') {
    _inspectPyImport(node, line, ctx);
    return;
  }
  if (node.type === 'import_spec' && ctx.grammarKey === 'go') {
    const pathNode = node.childForFieldName('path');
    if (pathNode) ctx.imports.push({ edgeKind: 'imports', specifier: _stripQuotes(pathNode.text), names: [], line });
    return;
  }
  if (node.type === 'use_declaration' && ctx.grammarKey === 'rust') {
    const arg = node.childForFieldName('argument');
    if (arg) ctx.imports.push({ edgeKind: 'imports', specifier: arg.text, names: [], line });
    return;
  }
  if (node.type === 'preproc_include' && (ctx.grammarKey === 'c' || ctx.grammarKey === 'cpp')) {
    const inc = node.childForFieldName('path');
    if (inc) ctx.imports.push({ edgeKind: 'imports', specifier: _stripQuotes(inc.text), names: [], line });
    return;
  }
  if (node.type === 'import_declaration' && ctx.grammarKey === 'java') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const ch = node.namedChild(i);
      if (ch && (ch.type === 'scoped_identifier' || ch.type === 'identifier')) {
        ctx.imports.push({ edgeKind: 'imports', specifier: ch.text, names: [], line });
      }
    }
    return;
  }
  if (node.type === 'command' && ctx.grammarKey === 'bash' && node.namedChildCount >= 2) {
    const cmdName = node.childForFieldName('name');
    const nameText = cmdName ? cmdName.text : '';
    const arg = (nameText === 'source' || nameText === '.') ? node.namedChild(1) : null;
    if (arg) ctx.imports.push({ edgeKind: 'imports', specifier: _stripQuotes(arg.text), names: [], line });
  }
}

function _extractImplSymbol(node, parentName, ctx) {
  const typeNode = node.childForFieldName('type');
  const traitNode = node.childForFieldName('trait');
  const implName = _extractNameText(typeNode) || (typeNode ? typeNode.text : '');
  if (!implName) return parentName;

  _pushSymbol(ctx, {
    name: implName,
    kind: 'impl',
    parentName: '',
    startLine: node.startPosition.row + 1,
    endLine: _nodeEndLine(node)
  });
  const traitName = traitNode ? (_extractNameText(traitNode) || traitNode.text) : '';
  if (traitName) {
    ctx.imports.push({ edgeKind: 'implements', specifier: '', names: [traitName], sourceSymbolName: implName, line: node.startPosition.row + 1 });
  }
  return implName;
}

function _extractContainerSymbol(node, parentName, ctx) {
  const isFwdDecl = (node.type === 'struct_specifier' || node.type === 'class_specifier' || node.type === 'enum_specifier');
  if (isFwdDecl && !node.childForFieldName('body')) return parentName;

  if (node.type === 'mod_item' && !node.childForFieldName('body')) {
    const modName = _extractNameText(node.childForFieldName('name'));
    if (modName) ctx.imports.push({ edgeKind: 'imports', specifier: modName, names: [], line: node.startPosition.row + 1 });
    return parentName;
  }
  if (node.type === 'impl_item') return _extractImplSymbol(node, parentName, ctx);

  const name = _extractNameText(node.childForFieldName('name'));
  if (!name) return parentName;

  _pushSymbol(ctx, {
    name,
    kind: CONTAINER_KINDS[node.type],
    parentName,
    startLine: node.startPosition.row + 1,
    endLine: _nodeEndLine(node)
  });
  if (ctx.grammarKey === 'python') {
    const sc = node.childForFieldName('superclasses');
    if (sc) _recordHeritageNames(sc, 'extends', name, node.startPosition.row + 1, ctx);
  }
  return name;
}

function _extractFunctionSymbol(node, parentName, ctx) {
  let name = '';
  let owner = parentName;
  let kind = parentName ? 'method' : 'function';
  if ((ctx.grammarKey === 'c' || ctx.grammarKey === 'cpp') && node.type === 'function_definition') {
    const resolved = _unwrapCppFuncName(node.childForFieldName('declarator'));
    name = resolved.name;
    if (resolved.parentName) {
      owner = resolved.parentName;
      kind = 'method';
    }
  } else if (node.type === 'method_declaration' && ctx.grammarKey === 'go') {
    name = _extractNameText(node.childForFieldName('name'));
    owner = _extractGoReceiverType(node) || owner;
    kind = 'method';
  } else {
    name = _extractNameText(node.childForFieldName('name'));
    if (node.type === 'method_definition' || node.type === 'method_signature' ||
        node.type === 'method_declaration' || node.type === 'constructor_declaration') {
      kind = 'method';
    }
  }
  if (name) {
    _pushSymbol(ctx, {
      name,
      kind,
      parentName: owner,
      startLine: node.startPosition.row + 1,
      endLine: _nodeEndLine(node)
    });
  }
}

function _extractAstSymbol(node, parentName, ctx) {
  if (ctx.grammarKey === 'sql' && node.type.startsWith('create_')) {
    _collectSqlTableDecl(node, ctx);
    return parentName;
  }
  if (Object.hasOwn(CONTAINER_KINDS, node.type)) {
    return _extractContainerSymbol(node, parentName, ctx);
  }
  if (node.type === 'type_alias_declaration' || node.type === 'type_item' || node.type === 'type_definition') {
    const name = _extractNameText(node.childForFieldName('name') || node.childForFieldName('declarator'));
    if (name) {
      _pushSymbol(ctx, { name, kind: 'type', parentName, startLine: node.startPosition.row + 1, endLine: _nodeEndLine(node) });
    }
    return parentName;
  }
  if (node.type === 'type_spec' && ctx.grammarKey === 'go') {
    const name = _extractNameText(node.childForFieldName('name'));
    const body = node.childForFieldName('type');
    let kind = 'type';
    if (body && body.type === 'struct_type') kind = 'class';
    else if (body && body.type === 'interface_type') kind = 'interface';
    if (!name) return parentName;
    _pushSymbol(ctx, { name, kind, parentName, startLine: node.startPosition.row + 1, endLine: _nodeEndLine(node) });
    return (kind === 'class' || kind === 'interface') ? name : parentName;
  }
  if (FUNCTION_NODES.has(node.type)) _extractFunctionSymbol(node, parentName, ctx);
  return parentName;
}

function _recordNodeRef(node, ctx) {
  const t = node.type;
  const line = node.startPosition.row + 1;
  if (t === 'call_expression' || t === 'new_expression' || t === 'call' || t === 'method_invocation') {
    const fn = node.childForFieldName('function') || node.childForFieldName('constructor') || node.childForFieldName('name');
    const target = fn ? (fn.childForFieldName('property') || fn.childForFieldName('attribute') || fn.childForFieldName('field') || fn) : null;
    const name = _extractNameText(target);
    if (name) _pushRef(ctx, name, 'call', line);
    return;
  }
  if (t === 'member_expression' || t === 'attribute' || t === 'field_expression' || t === 'field_access') {
    const prop = node.childForFieldName('property') || node.childForFieldName('attribute') || node.childForFieldName('field');
    const name = _extractNameText(prop);
    if (name) _pushRef(ctx, name, 'member', line);
    return;
  }
  const parentType = node.parent ? node.parent.type : '';
  if (t === 'type_identifier') {
    if (!Object.hasOwn(CONTAINER_KINDS, parentType) && parentType !== 'type_alias_declaration' && parentType !== 'type_spec') {
      _pushRef(ctx, node.text, 'type', line);
    }
    return;
  }
  if (t === 'identifier' || t === 'word') {
    if (FUNCTION_NODES.has(parentType) || Object.hasOwn(CONTAINER_KINDS, parentType) ||
        parentType === 'import_specifier' || parentType === 'dotted_name') {
      return;
    }
    _pushRef(ctx, node.text, 'ident', line);
  }
}

/**
 * Traverses a web-tree-sitter parse tree iteratively to extract symbols, references, and imports.
 */
function walkAst(tree, source, language, grammarKey, parserVersion) {
  const ctx = {
    lines: source.split('\n'),
    language,
    grammarKey,
    symbols: [],
    refs: [],
    imports: [],
    seenSymbols: new Set(),
    seenRefs: new Set()
  };

  const stack = [{ node: tree.rootNode, parentName: '' }];
  while (stack.length > 0) {
    const { node, parentName } = stack.pop();
    if (!node) continue;
    if (grammarKey === 'javascript' || grammarKey === 'typescript' || grammarKey === 'tsx') {
      _inspectJsTsNode(node, parentName, ctx);
    } else {
      _inspectOtherImports(node, ctx);
    }
    const nextParent = _extractAstSymbol(node, parentName, ctx);
    _recordNodeRef(node, ctx);

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      stack.push({ node: node.namedChild(i), parentName: nextParent });
    }
  }

  ctx.symbols.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  return {
    symbols: ctx.symbols,
    refs: ctx.refs,
    imports: ctx.imports,
    parserVersion,
    parseEngine: 'tree-sitter-wasm'
  };
}

function _resolveHeadingRange(headings, index, totalLines) {
  const cur = headings[index];
  let endLine = totalLines;
  for (let j = index + 1; j < headings.length; j++) {
    if (headings[j].level <= cur.level) {
      endLine = headings[j].line - 1;
      break;
    }
  }
  let parentName = '';
  for (let j = index - 1; j >= 0; j--) {
    if (headings[j].level < cur.level) {
      parentName = headings[j].title;
      break;
    }
  }
  return { endLine: Math.max(cur.line, endLine), parentName };
}

/**
 * Extracts heading sections from Markdown files while skipping fenced code blocks.
 */
function parseMarkdownStructured(source) {
  const lines = source.split('\n');
  const symbols = [];
  const headings = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) headings.push({ level: m[1].length, title: m[2].slice(0, 120), line: i + 1, sig: line.trim().slice(0, 200) });
  }
  for (let i = 0; i < headings.length && symbols.length < MAX_SYMBOLS_PER_FILE; i++) {
    const cur = headings[i];
    const { endLine, parentName } = _resolveHeadingRange(headings, i, lines.length);
    symbols.push({
      name: cur.title,
      kind: 'section',
      parentName,
      startLine: cur.line,
      endLine,
      signature: cur.sig,
      language: 'markdown'
    });
  }
  return {
    symbols,
    refs: [],
    imports: [],
    parserVersion: `structured-md-v1-${CHUNK_SCHEMA_VERSION}`,
    parseEngine: 'structured-markdown'
  };
}

/**
 * Extracts top-level keys/sections from JSON, YAML, and TOML configuration files.
 */
function parseConfigStructured(source, language) {
  const lines = source.split('\n');
  const symbols = [];
  const pattern = language === 'json'
    ? /^\s{0,2}"([^"]+)"\s*:/
    : language === 'toml'
      ? /^\s*\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/
      : /^([A-Za-z0-9_.-]+)\s*:/;
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (m) starts.push({ name: m[1], line: i + 1, sig: lines[i].trim().slice(0, 200) });
  }
  for (let i = 0; i < starts.length && symbols.length < MAX_SYMBOLS_PER_FILE; i++) {
    const nextStart = i + 1 < starts.length ? starts[i + 1].line - 1 : lines.length;
    symbols.push({
      name: starts[i].name,
      kind: 'config_key',
      parentName: '',
      startLine: starts[i].line,
      endLine: Math.max(starts[i].line, nextStart),
      signature: starts[i].sig,
      language
    });
  }
  return {
    symbols,
    refs: [],
    imports: [],
    parserVersion: `structured-cfg-v1-${CHUNK_SCHEMA_VERSION}`,
    parseEngine: 'structured-config'
  };
}

module.exports = {
  walkAst,
  parseMarkdownStructured,
  parseConfigStructured
};
