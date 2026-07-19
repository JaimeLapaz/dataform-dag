import "@testing-library/jest-dom/vitest";

// React Flow touches these browser APIs jsdom lacks; harmless stubs keep any accidental render alive.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
