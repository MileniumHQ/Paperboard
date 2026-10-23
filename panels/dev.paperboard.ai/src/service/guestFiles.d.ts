// The guest's own files ride inside service.js (bun build's text loader).
declare module "*.py" {
    const text: string;
    export default text;
}
declare module "*.sh" {
    const text: string;
    export default text;
}
