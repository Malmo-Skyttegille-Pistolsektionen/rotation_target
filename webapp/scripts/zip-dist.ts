import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// Read name and version from package.json
const { name, version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
) as { name: string; version: string };

// Normalize project name (replace slashes, spaces, etc.)
const normalizedName = name.replace(/[\/\s]/g, '-');

// Build the final zip filename
const zipFilename = `${normalizedName}_${version}.zip`;

console.log(`Zipping ./dist folder into ${zipFilename}...`);

// Create the zip archive
execSync(`zip -r ${zipFilename} dist`, { stdio: 'inherit' });

console.log(`✅ Created ${zipFilename} successfully!`);
