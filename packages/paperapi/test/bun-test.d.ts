// Minimal ambient typing for bun:test (bun types are not installed).
declare module "bun:test" {
    export function describe(name: string, fn: () => void): void;
    export function test(name: string, fn: () => unknown | Promise<unknown>): void;
    export function it(name: string, fn: () => unknown | Promise<unknown>): void;
    export function expect(value: any): {
        toBe(expected: any): void;
        toEqual(expected: any): void;
        toBeUndefined(): void;
        toBeDefined(): void;
        toBeNull(): void;
        toBeTruthy(): void;
        toBeFalsy(): void;
        toContain(expected: any): void;
        toHaveLength(expected: number): void;
        toMatch(expected: string | RegExp): void;
        toBeGreaterThan(expected: number): void;
        toBeGreaterThanOrEqual(expected: number): void;
        toBeLessThan(expected: number): void;
        toThrow(message?: string | RegExp): void;
        toThrowError(message?: string | RegExp): void;
        toMatchObject(expected: Record<string, unknown>): void;
        rejects: {
            toThrow(message?: string | RegExp): Promise<void>;
        };
        not: {
            toBe(expected: any): void;
            toEqual(expected: any): void;
            toThrow(message?: string | RegExp): void;
        };
    };
    export function beforeEach(fn: () => void): void;
    export function afterEach(fn: () => void): void;
}