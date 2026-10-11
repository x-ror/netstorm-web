export default {
  '*.{js,mjs,cjs,ts,mts,cts,tsx,jsx}': ['oxlint --fix --deny-warnings', 'dprint fmt'],
  '*.{json,jsonc,yml,yaml,html,css}': 'dprint fmt',
};
