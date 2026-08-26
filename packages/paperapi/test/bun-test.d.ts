// Minimal ambient typing for bun:test (bun types are not installed).
declare module "bun:test" {
    export function describe(name: string, fn: () => void): void;
    export function test(name: string, fn: () => unknown | Promise<unknown>): void;
    export function expect(value: any): {
        toBe(expected: any): void;
        toEqual(expected: any): void;
        toBeUndefined(): void;
    };
    export function beforeEach(fn: () => void): void;
    export function afterEach(fn: () => void): void;
}
