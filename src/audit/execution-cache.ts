export class ExecutionCache {
  private readonly values = new Map<string, Promise<unknown>>();

  getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.values.get(key);
    if (existing) return existing as Promise<T>;
    const pending = loader().catch((error: unknown) => {
      this.values.delete(key);
      throw error;
    });
    this.values.set(key, pending);
    return pending;
  }
}
