const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const themeDirectories = ['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), 'utf8');
}

function assertPathExists(filePath) {
  assert.ok(fs.existsSync(path.join(root, filePath)), `${filePath} must exist`);
}

function walk(directory, predicate = () => true) {
  const directoryPath = path.join(root, directory);

  return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return walk(entryPath, predicate);
    }

    return predicate(entryPath) ? [entryPath] : [];
  });
}

function stripJsonComments(content) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        output += character;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && nextCharacter === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += character;

      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        inString = false;
        quote = '';
      }

      continue;
    }

    if (character === '"' || character === "'") {
      inString = true;
      quote = character;
      output += character;
      continue;
    }

    if (character === '/' && nextCharacter === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === '/' && nextCharacter === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += character;
  }

  return output;
}

function parseJsonc(filePath) {
  const content = read(filePath);
  const withoutComments = stripJsonComments(content);
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(withoutTrailingCommas);
}

function parseJson(filePath) {
  return JSON.parse(read(filePath));
}

function collectLeafKeys(value, prefix = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      return collectLeafKeys(child, nextPrefix);
    });
  }

  return [prefix];
}

function getPathValue(value, keyPath) {
  return keyPath.split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return current[key];
  }, value);
}

function extractLiquidBlock(content, blockName) {
  const pattern = new RegExp(`{%\\s*${blockName}\\s*%}([\\s\\S]*?){%\\s*end${blockName}\\s*%}`);
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function stripLiquidBlocks(content, blockNames) {
  return blockNames.reduce((current, blockName) => {
    const pattern = new RegExp(`{%\\s*${blockName}\\s*%}[\\s\\S]*?{%\\s*end${blockName}\\s*%}`, 'g');
    return current.replace(pattern, '');
  }, content);
}

function collectValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectValues);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectValues);
  }

  return [value];
}

function collectSchemaTranslationKeys(schema) {
  return collectValues(schema)
    .filter((value) => typeof value === 'string' && value.startsWith('t:'))
    .map((value) => value.slice(2));
}

function collectLiquidTranslationKeys(content) {
  const keys = new Set();
  const pattern = /['"]([a-z0-9_.-]+)['"]\s*\|\s*t\b/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    keys.add(match[1]);
  }

  return [...keys];
}

function assertNoHardcodedUserText(filePath, content) {
  const renderableContent = stripLiquidBlocks(content, ['comment', 'doc', 'schema', 'stylesheet', 'javascript']);
  const textPattern = />\s*([A-Za-z][^<{]*[A-Za-z][^<{]*)\s*</g;
  const attributePattern = /\b(?:aria-label|placeholder|title|value)=["']([A-Za-z][^"'{]*)["']/g;
  const offenses = [];
  let match;

  while ((match = textPattern.exec(renderableContent)) !== null) {
    offenses.push(`text "${match[1].trim()}"`);
  }

  while ((match = attributePattern.exec(renderableContent)) !== null) {
    if (!/^(true|false|\d+)$/.test(match[1])) {
      offenses.push(`attribute "${match[1].trim()}"`);
    }
  }

  assert.equal(offenses.length, 0, `${filePath} has hardcoded user-facing text: ${offenses.join(', ')}`);
}

for (const directory of themeDirectories) {
  assertPathExists(directory);
}

const themeLayout = read('layout/theme.liquid');
assert.ok(themeLayout.includes('{{ content_for_header }}'), 'layout/theme.liquid must include content_for_header');
assert.ok(themeLayout.includes('{{ content_for_layout }}'), 'layout/theme.liquid must include content_for_layout');

const jsonFiles = themeDirectories.flatMap((directory) =>
  walk(directory, (filePath) => filePath.endsWith('.json'))
);
const parsedJsoncFiles = new Map();

for (const filePath of jsonFiles) {
  if (filePath.startsWith('locales/')) {
    parseJson(filePath);
  } else {
    parsedJsoncFiles.set(filePath, parseJsonc(filePath));
  }
}

const localeFiles = walk('locales', (filePath) => filePath.endsWith('.json') && !filePath.endsWith('.schema.json'))
  .map((filePath) => path.basename(filePath))
  .sort();

assert.ok(localeFiles.includes('en.default.json'), 'locales/en.default.json must exist');

const defaultTranslations = parseJson('locales/en.default.json');
const defaultTranslationKeys = collectLeafKeys(defaultTranslations).sort();

for (const file of localeFiles) {
  const translations = parseJson(path.join('locales', file));
  const keys = collectLeafKeys(translations).sort();
  assert.deepEqual(keys, defaultTranslationKeys, `${file} must define the same translation keys as en.default.json`);
  console.log(`Validated locale ${file}`);
}

const schemaTranslations = parseJsonc('locales/en.default.schema.json');

for (const [filePath, parsedJsonc] of parsedJsoncFiles.entries()) {
  if (filePath.startsWith('locales/')) {
    continue;
  }

  for (const key of collectSchemaTranslationKeys(parsedJsonc)) {
    assert.notEqual(getPathValue(schemaTranslations, key), undefined, `${filePath} references missing schema locale key ${key}`);
  }
}

const liquidFiles = ['sections', 'blocks', 'snippets', 'layout', 'templates'].flatMap((directory) =>
  walk(directory, (filePath) => filePath.endsWith('.liquid'))
);

for (const filePath of liquidFiles) {
  const content = read(filePath);
  const posixPath = toPosix(filePath);

  if (posixPath.startsWith('snippets/')) {
    assert.ok(content.trimStart().startsWith('{% doc %}'), `${posixPath} must start with a LiquidDoc header`);
  }

  if (posixPath.startsWith('sections/') || posixPath.startsWith('blocks/')) {
    const schemaContent = extractLiquidBlock(content, 'schema');
    assert.ok(schemaContent, `${posixPath} must include a schema block`);

    const schema = JSON.parse(schemaContent.replace(/,\s*([}\]])/g, '$1'));

    for (const key of collectSchemaTranslationKeys(schema)) {
      assert.notEqual(getPathValue(schemaTranslations, key), undefined, `${posixPath} references missing schema locale key ${key}`);
    }
  }

  for (const key of collectLiquidTranslationKeys(content)) {
    assert.notEqual(getPathValue(defaultTranslations, key), undefined, `${posixPath} references missing locale key ${key}`);
  }

  assertNoHardcodedUserText(posixPath, content);
}
