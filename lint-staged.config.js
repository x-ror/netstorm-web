export default {
  '*.{js,mjs,cjs,ts,mts,cts,tsx,jsx}': ['oxlint --fix --deny-warnings', 'oxfmt'],
  '*.{json,jsonc,yml,yaml,html,css}': 'oxfmt --no-error-on-unmatched-pattern',
};
