// Original isometric cell: 16×11 px at 1×. We render at 2× with nearest-neighbour scaling.
export const TW = 16, TH = 11, ZOOM = 2;
export const iso = (x: number, y: number) => ({ sx: (x - y) * (TW / 2), sy: (x + y) * (TH / 2) });
export const unIso = (sx: number, sy: number) => ({ x: Math.floor((sx / (TW / 2) + sy / (TH / 2)) / 2), y: Math.floor((sy / (TH / 2) - sx / (TW / 2)) / 2) });
