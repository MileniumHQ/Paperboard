// a file the service bundles beside itself (`with { type: "file" }`): its path, from the bundle
declare module "*.wasm" {
    const path: string;
    export default path;
}
