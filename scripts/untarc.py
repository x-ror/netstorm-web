"""Unpack netstorm.tarc (TAFF v0.2) from the original game.

Usage: python3 scripts/untarc.py original/game/Netstorm/netstorm.tarc original/extracted

Every file in the archive, and the .cfg files next to it, is XORed with a fixed key.
"""
import struct, sys, os
src, out = sys.argv[1], sys.argv[2]
d = open(src, 'rb').read()
assert d[:9] == b'TAFF v0.2'
_, count, _, _, table, _, data, _ = struct.unpack('<8I', d[0x10:0x30])
key = b'mydoghasfleas'
p = table
for _ in range(count):
    off, size = struct.unpack('<2I', d[p:p + 8])
    end = d.index(b'\0', p + 8)
    name = d[p + 8:end].decode('latin-1').replace('\\', '/').lstrip('/')
    p = end + 1
    assert '..' not in name
    raw = d[data + off:data + off + size]
    plain = bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))
    path = os.path.join(out, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(plain)
print(count, 'files')
