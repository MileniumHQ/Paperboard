declare module "virtual:docs-search" {
    import type { SearchRecord } from "./docs";
    const records: SearchRecord[];
    export default records;
}
