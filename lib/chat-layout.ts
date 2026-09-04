/** Maximum width of the centered chat column (conversation + composer).
 *  Kept in one place so the message list, notices shelf, empty state, and
 *  composer cannot drift apart. */
// Keep a readable measure on wide displays while leaving intentional breathing
// room on both sides. The gutter is fluid so a narrow window never gets a
// second horizontal scrollbar, and a wide desktop does not turn messages into
// a wall of text.
// A coding transcript reads best as a deliberately narrow column.  On a
// large desktop, 960px leaves a genuine resting area on both sides instead of
// turning a response into a wall of text; below that width the column remains
// fully fluid.
export const CHAT_COLUMN_MAX_WIDTH = 960;
export const CHAT_COLUMN_GUTTER = "clamp(28px, 5vw, 96px)";
/** Desktop-only reservation for the minimap rail (36px plus its 8px offset). */
export const CHAT_MINIMAP_RAIL_GUTTER = "44px";
