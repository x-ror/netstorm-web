/**
 * What the player has done of the campaign: the missions completed, as the original keeps a
 * `Done<FileName>` flag for each in its options (the `<$Config,Done{mission.fileName}=1>` of a
 * success page). Remembered per browser; storage may be unavailable.
 */
const STORAGE_KEY = 'netstorm.campaign';

export function doneMissions(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markDone(id: string): void {
  const done = doneMissions();
  done.add(id.toLowerCase());

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...done].sort()));
  } catch {
    // Not remembering is harmless.
  }
}
