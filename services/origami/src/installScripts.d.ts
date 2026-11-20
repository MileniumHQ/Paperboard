// install.sh arrives as text (wrangler.jsonc rules, bunfig.toml loader)
declare module "*.sh" {
    const text: string;
    export default text;
}
