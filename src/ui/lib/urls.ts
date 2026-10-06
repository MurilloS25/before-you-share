/**
 * Every object URL the UI creates goes through this registry so none can be forgotten:
 * `clear()` revokes them all (reset, new file, unmount).
 */
export class ObjectUrlRegistry {
  private urls = new Set<string>();

  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  revoke(url: string | null | undefined): void {
    if (url && this.urls.delete(url)) URL.revokeObjectURL(url);
  }

  clear(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls.clear();
  }

  get size(): number {
    return this.urls.size;
  }
}

export const MIME = { jpeg: 'image/jpeg', png: 'image/png' } as const;
