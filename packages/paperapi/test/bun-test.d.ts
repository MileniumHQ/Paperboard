// Minimal ambient typing for bun:test (bun types are not installed).
declare module "bun:test" {
    interface Matchers {
        toBe(expected: any): void;
        toEqual(expected: any): void;
        toStrictEqual(expected: any): void;
        toBeUndefined(): void;
        toBeDefined(): void;
        toBeNull(): void;
        toBeTruthy(): void;
        toBeFalsy(): void;
        toBeInstanceOf(expected: any): void;
        toContain(expected: any): void;
        toHaveLength(expected: number): void;
        toHaveProperty(path: string, value?: any): void;
        toMatch(expected: string | RegExp): void;
        toBeGreaterThan(expected: number): void;
        toBeGreaterThanOrEqual(expected: number): void;
        toBeLessThan(expected: number): void;
        toThrow(message?: string | RegExp | Error | (new (...args: any[]) => Error)): void;
        toThrowError(message?: string | RegExp): void;
        toMatchObject(expected: Record<string, unknown> | unknown[]): void;
    }
    type AsyncMatchers = { [K in keyof Matchers]: (...args: Parameters<Matchers[K]>) => Promise<void> };
    export function describe(name: string, fn: () => void): void;
    export function test(name: string, fn: () => unknown | Promise<unknown>, timeoutMs?: number): void;
    export function it(name: string, fn: () => unknown | Promise<unknown>, timeoutMs?: number): void;
    export function expect(value: any): Matchers & {
        rejects: AsyncMatchers;
        resolves: AsyncMatchers;
        not: Matchers;
    };
    export function beforeEach(fn: () => unknown | Promise<unknown>): void;
    export function afterEach(fn: () => unknown | Promise<unknown>): void;
    export function beforeAll(fn: () => unknown | Promise<unknown>, timeoutMs?: number): void;
    export function afterAll(fn: () => unknown | Promise<unknown>, timeoutMs?: number): void;
    export const jest: {
        useFakeTimers(): void;
        useRealTimers(): void;
        advanceTimersByTime(ms: number): void;
    };
    export function setDefaultTimeout(timeoutMs: number): void;
}

// Bun's import.meta.dir: the directory of the running module.
interface ImportMeta {
    readonly dir: string;
}
