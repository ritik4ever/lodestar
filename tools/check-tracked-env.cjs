const { execFileSync } = require('node:child_process');

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const trackedEnvFiles = trackedFiles.filter((file) => {
  const parts = file.split('/');
  return parts[parts.length - 1] === '.env';
});

if (trackedEnvFiles.length > 0) {
  console.error('Tracked .env files are not allowed:');
  for (const file of trackedEnvFiles) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}
