// Minimal publish/subscribe bus. Systems talk through this instead of
// reaching into each other, which keeps them independently testable.

export class EventBus {
  constructor() { this.handlers = new Map(); }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this.handlers.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) fn(payload);
  }

  clear() { this.handlers.clear(); }
}

export const bus = new EventBus();
