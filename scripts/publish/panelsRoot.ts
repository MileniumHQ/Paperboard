// The one canonical panel source: <repo>/panels. Every consumer (Publish
// panels, the dev bootstrap's panel builds, the manifest checks) reads this
// root, since a wrong root silently finds zero panels. It has a file of its
// own so importing publishManifest's checks doesn't tie a part to every panel.
import { join } from "path";

export const PANELS_ROOT = join(import.meta.dir, "..", "..", "panels");
