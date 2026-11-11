// install.sh and install.ps1 arrive as text (wrangler.jsonc rules, bunfig.toml loader)
declare module "*.sh" {
    const text: string;
    export default text;
}
declare module "*.ps1" {
    const text: string;
    export default text;
}
