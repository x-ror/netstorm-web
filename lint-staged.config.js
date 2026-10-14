export default {
  '*.{js,mjs,cjs,ts,mts,cts,tsx,jsx}': ['oxlint --fix --deny-warnings', 'dprint fmt'],
  // Data files are excluded in dprint.json, so a commit may stage nothing dprint formats.
  '*.{json,jsonc,yml,yaml,html,css,svelte}': 'dprint fmt --allow-no-files',
};
