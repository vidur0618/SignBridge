export class LiveConcurrencyGuard {
  readonly #limit: number;
  readonly #counts = new Map<string, number>();

  constructor(limit: number) {
    this.#limit = limit;
  }

  acquire(siteId: string): boolean {
    const current = this.#counts.get(siteId) ?? 0;
    if (current >= this.#limit) return false;
    this.#counts.set(siteId, current + 1);
    return true;
  }

  release(siteId: string): void {
    const current = this.#counts.get(siteId) ?? 0;
    if (current <= 1) this.#counts.delete(siteId);
    else this.#counts.set(siteId, current - 1);
  }
}
