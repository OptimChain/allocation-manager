/**
 * Lightweight cache for Twelve Data REST responses.
 *
 * Twelve Data's free/basic tiers are tightly rate-limited (~8 requests/min),
 * so pages that fan out across many symbols (e.g. the Compare page) quickly
 * hit HTTP 429. This wraps fetches with three layers:
 *
 *   1. In-memory map        — instant hits within a session, survives remounts
 *   2. localStorage         — survives reloads / navigation, keyed with a TTL
 *   3. In-flight dedup       — concurrent callers for the same key share one request
 *
 * On a fetch error (typically 429) we fall back to the last cached value if we
 * have one — stale data beats a broken chart.
 */

interface CacheEntry<T> {
  value: T;
  expires: number; // ms epoch
}

interface Slot {
  entry?: CacheEntry<unknown>;
  inflight?: Promise<unknown>;
}

const memory = new Map<string, Slot>();
const LS_PREFIX = 'td-cache:';

function readLS<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

function writeLS<T>(key: string, entry: CacheEntry<T>): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage unavailable or over quota — memory cache still works
  }
}

/**
 * Return a cached value for `key` if fresh, otherwise call `fetcher`, cache the
 * result for `ttlMs`, and return it. Concurrent calls for the same key share a
 * single in-flight request. On fetcher error, serve stale cache if present.
 */
export async function cachedJson<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const slot = memory.get(key);

  // 1. Fresh in-memory hit
  if (slot?.entry && slot.entry.expires > now) {
    return slot.entry.value as T;
  }

  // 2. Share an in-flight request
  if (slot?.inflight) {
    return slot.inflight as Promise<T>;
  }

  // 3. Fresh localStorage hit → hydrate memory
  const persisted = readLS<T>(key);
  if (persisted && persisted.expires > now) {
    memory.set(key, { entry: persisted });
    return persisted.value;
  }

  const inflight = (async (): Promise<T> => {
    try {
      const value = await fetcher();
      const entry: CacheEntry<T> = { value, expires: Date.now() + ttlMs };
      memory.set(key, { entry });
      writeLS(key, entry);
      return value;
    } catch (err) {
      // Stale-on-error: prefer last known value over a hard failure (e.g. 429)
      const stale = memory.get(key)?.entry ?? readLS<T>(key);
      if (stale) {
        memory.set(key, { entry: stale as CacheEntry<T> });
        return stale.value as T;
      }
      memory.delete(key);
      throw err;
    }
  })();

  memory.set(key, { entry: slot?.entry, inflight });
  void inflight.finally(() => {
    const s = memory.get(key);
    if (s?.inflight === inflight) {
      memory.set(key, { entry: s.entry });
    }
  });

  return inflight;
}

/** Clear all cached Twelve Data entries (memory + localStorage). */
export function clearTwelveDataCache(): void {
  memory.clear();
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
