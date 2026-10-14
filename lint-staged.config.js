export default {
  // oxlint reads the <script> of a Svelte component too.
  '*.{js,mjs,cjs,ts,mts,cts,tsx,jsx,svelte}': ['oxlint --fix --deny-warnings', 'dprint fmt'],
  // Data files are excluded in dprint.json, so a commit may stage nothing dprint formats.
  '*.{json,jsonc,yml,yaml,html,css}': 'dprint fmt --allow-no-files',
};
