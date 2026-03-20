import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const jsonPath = fileURLToPath(new URL('../docs/mock-api-v2.openapi.json', import.meta.url));
const yamlPath = fileURLToPath(new URL('../docs/mock-api-v2.openapi.yaml', import.meta.url));

const source = await readFile(jsonPath, 'utf8');
const document = JSON.parse(source) as unknown;

const yamlText = [
  '# Generated from docs/mock-api-v2.openapi.json',
  '# Run `yarn openapi:yaml` after editing the JSON source.',
  '',
  stringify(document, {
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0,
  }),
].join('\n');

await writeFile(yamlPath, yamlText);

console.log('Wrote docs/mock-api-v2.openapi.yaml');
