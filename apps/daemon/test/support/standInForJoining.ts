// STANDS IN FOR JOINING, in tests only, until the join ceremony exists. It
// makes computers members of each other the way joining will leave them:
// each writes a "@roster" record about every other and shares its network
// keys with it. Nothing in the daemon makes computers members without a
// person's action; when joining is built, this file is deleted and its
// callers join for real.
import type { RecordStore } from "../../src/network/store";
import { ROSTER_SPACE } from "../../src/network/record";
import { memberIdOf } from "../../src/network/memberId";

export interface StandInMember {
	records: RecordStore;
	cert: string;
	/** where the others dial it; absent for a computer that can't be dialed */
	dial?: { host: string; port: number };
}

/**
 * Every member learns every other, where each is dialed (one record per
 * member, so every member's view of where another is dialed is the same),
 * and can read everything the others write.
 */
export async function standInForJoining(members: StandInMember[]): Promise<void> {
	for (const member of members) {
		for (const other of members) {
			await member.records.put(ROSTER_SPACE, memberIdOf(other.cert), { cert: other.cert, ...(other.dial ? { dial: other.dial } : {}), facts: {} });
		}
		await member.records.shareKeys(members.filter((other) => other !== member).map((other) => other.cert));
	}
}
