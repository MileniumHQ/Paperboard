// What the browser fixtures' pages and their harness (test/browserFixture.ts)
// agree on: the project the service starts with, the other panels on the
// daemon, and the project a refused call is sent for instead.
import type { ProjectMeta } from "../../src/panel";

/** the project the editor and panel pages open: on the service from the start */
export const SERVICED_PROJECT = "p-serviced";
export const SERVICED: ProjectMeta = { id: SERVICED_PROJECT, name: "Serviced project", enabled: true, createdAt: 0, editedAt: 0, preview: null };

/** the panel offering blocks from the start (test/helpers/otherPanel.ts, role "fixture") */
export const FIXTURE_PANEL = "dev.test.fixture";
export const FIXTURE_PANEL_NAME = "Fixture Panel";
/** the panel that starts offering a block part way (role "late") */
export const LATE_PANEL = "dev.test.late";
export const LATE_PANEL_NAME = "Late Panel";

/** a call the page makes while it is refused goes for this project, which the service doesn't have */
export const REFUSED_PROJECT = "p-refused";
/** what the service says to it */
export const REFUSAL = `There's no project "${REFUSED_PROJECT}"; it may have been deleted`;
/** what the relay answers the service's announcements with while the registry is away */
export const REGISTRY_AWAY = "the registry is away";
