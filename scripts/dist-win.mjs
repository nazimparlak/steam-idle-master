import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const outputDir = path.join('release', 'versions', version);
// electron-builder bazı ortamlarda ters eğik çizgiyi tercih ediyor
const outputForConfig = outputDir.split(path.sep).join('/');

const ebBin = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

const args = ['-w', '--publish', 'never', `-c.directories.output=${outputForConfig}`];

const res = spawnSync(ebBin, args, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

if (res.error) {
  console.error(res.error);
  process.exit(1);
}
process.exit(res.status ?? 1);
