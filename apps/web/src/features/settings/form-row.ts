/**
 * The form-row layout every settings tab shares: a label column, then the
 * control and whatever explains it. One definition, so the rows of all three
 * tabs line up with each other.
 *
 * The breakpoint is the form's own width (a container query; the form carries
 * `@container`), not the window's: a zoomed page or a narrow pane shrinks the
 * card without shrinking the window, and the rows have to follow the card.
 */

/**
 * A row: stacked while the form is narrow, a label column once it is wide
 * enough for that column and a usable control beside it.
 */
export const FORM_ROW =
  "grid gap-1.5 @[28rem]:grid-cols-[6.5rem_minmax(0,1fr)] @[28rem]:gap-4";

/**
 * A label in that column: as tall as a standard control once there is a
 * column to line up with, a plain line of text while stacked.
 */
export const FORM_ROW_LABEL =
  "flex items-center text-sm leading-none font-medium @[28rem]:h-9";
