// A window that stays mounted and opens once per request. Work it starts
// (a load, a save) belongs to the opening that started it: when that opening
// is over, the work's late result is dropped instead of landing on the next
// request. Each opening is answered at most once.
export function createOpenings() {
    let current = 0;
    let answered = 0;
    return {
        /** starts an opening; the token ties later work to it */
        open(): number {
            return ++current;
        },
        isCurrent(token: number): boolean {
            return token === current;
        },
        /** true the first time the current opening is answered; stale or repeat answers are refused */
        answer(token: number): boolean {
            if (token !== current || answered === token) return false;
            answered = token;
            return true;
        },
    };
}
