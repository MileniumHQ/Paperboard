// The store's caps, apart from the Durable Object so tests read them without workerd.

/** Issues accepted from everyone together in any 24 hours, so a spread-out flood stays small. */
export const DAILY_LIMIT = 300;
/** Issues kept at once. Past it, new ones are refused until some are deleted. */
export const STORE_LIMIT = 5000;
