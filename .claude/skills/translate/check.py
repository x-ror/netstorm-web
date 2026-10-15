#!/usr/bin/env python3
"""Run LanguageTool (uk) over the strings of a translation JSON and print each hit with its JSON path.

Usage: python3 .claude/skills/translate/check.py [data/missions.uk.json] [mission-id ...]
Needs `brew install languagetool`. Spelling hits on capitalised words (invented names) and on the
game's own words below are skipped, and so is the sentence-start rule: the texts break lines mid-sentence.
"""
import json
import subprocess
import sys
import tempfile

path = sys.argv[1] if len(sys.argv) > 1 else 'data/missions.uk.json'
only = set(sys.argv[2:])
GAME_WORDS = ('німбі',)  # німбійський, німбієць
SKIP_RULES = {'UPPERCASE_SENTENCE_START'}
data = json.load(open(path, encoding='utf-8'))


def strings(node, where):
    if isinstance(node, str):
        yield where, node
    elif isinstance(node, dict):
        for key, value in node.items():
            yield from strings(value, f'{where}/{key}')


chunks = [(w, s) for mid, m in data.items() if not only or mid in only for w, s in strings(m, mid)]
text, spans = '', []
for where, s in chunks:
    spans.append((len(text), where))
    text += s + '\n\n'

with tempfile.NamedTemporaryFile('w', suffix='.txt', encoding='utf-8', delete=False) as f:
    f.write(text)

out = subprocess.run(['languagetool', '-l', 'uk', '--json', f.name], capture_output=True, text=True).stdout
report = json.loads(out[out.index('{'):])

for hit in report['matches']:
    at, size = hit['offset'], hit['length']
    word = text[at:at + size]
    if hit['rule']['id'] in SKIP_RULES:
        continue

    if hit['rule']['issueType'] == 'misspelling' and (
        word[:1].isupper() or word.lower().startswith(GAME_WORDS)
    ):
        continue

    start, where = max(s for s in spans if s[0] <= at)
    fixes = '; '.join(r['value'] for r in hit['replacements'][:3])
    context = text[max(start, at - 30):at + size + 30].replace('\n', ' ')
    print(f"{where}: «{word}» — {hit['message']}" + (f' → {fixes}' if fixes else ''))
    print(f'    …{context}…')
