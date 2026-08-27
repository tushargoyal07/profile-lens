export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    if (this.ttlMs <= 0) {
      return undefined;
    }
    const hit = this.store.get(key);
    if (!hit) {
      return undefined;
    }
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0) {
      return;
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((ts) => now - ts < this.windowMs);
    if (recent.length >= this.maxHits) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
