// STANDS IN FOR JOINING, in tests only, until the join ceremony exists. It
// makes computers members of each other the way joining will leave them:
// each writes a "@roster" record about every other, shares its network keys
// with it, and gets what the other already holds (what it says of itself
// among it) straight from the other's store, signed as it was written.
// Nothing in the daemon makes computers members without a person's action;
// when joining is built, this file is deleted and its callers join for real.
import type { RecordStore } from "../../src/network/store";
import { ROSTER_SPACE } from "../../src/network/record";
import { memberIdOf } from "../../src/network/memberId";

export interface StandInMember {
	records: RecordStore;
	cert: string;
}

/**
 * Every member learns every other and can read everything the others
 * write. Where each listens is what it said of itself before (its roster's
 * listensAt): no member can say it for another.
 */
export async function standInForJoining(members: StandInMember[]): Promise<void> {
	for (const member of members) {
		for (const other of members) await member.records.put(ROSTER_SPACE, memberIdOf(other.cert), { cert: other.cert });
		await member.records.shareKeys(members.filter((other) => other !== member).map((other) => other.cert));
	}
	for (const member of members) {
		for (const other of members) {
			if (other !== member) await member.records.pull(memberIdOf(other.cert), other.records);
		}
	}
}
