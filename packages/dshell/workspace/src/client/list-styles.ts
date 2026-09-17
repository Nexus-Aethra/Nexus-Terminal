/**
 * Inline styles for the sidebar session list and its dialogs. Kept apart from
 * the components so the list file stays about behaviour; the values are the
 * ones dshell's flat list has always used, plus the row-action and archived
 * group geometry, which follow the same density.
 *
 * Every colour here is one of dsh's own aliases (`--dsw-alias-*`) rather than a
 * literal. The list itself is painted on the app's surface and inherits, but a
 * dialog is a card of its own: hard-coded ones left the new-session form a
 * near-black box with near-white text inside a light-mode app. The aliases are
 * the same ones the stock Modal and Input draw with, so the dialog is the
 * app's surface in whichever theme the user picked.
 */

import type { CSSProperties } from 'react'

export const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  flex: 1,
  overflow: 'hidden',
}
export const scrollStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  flex: 1,
  overflowY: 'auto',
}
export const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 8px',
  fontSize: 12,
  opacity: 0.75,
}
export const newButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 12,
  padding: '2px 6px',
}
export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
}
export const rowTitleStyle: CSSProperties = {
  flex: '1 1 auto',
  // Without this the flex child refuses to shrink below its content width and
  // the ellipsis below never engages.
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
/**
 * The `SSH` badge: a session that runs on a device, not on this machine.
 *
 * Deliberately a different colour from the title it sits beside — the whole
 * point is that a glance down the list separates the sessions whose shell is a
 * local fork from the ones whose shell is an ssh process. An outline pill in
 * the theme's info colour reads as a classification rather than as an alert,
 * and `currentColor` on the border keeps the two in step in either theme.
 */
export const sshBadgeStyle: CSSProperties = {
  flex: '0 0 auto',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.06em',
  lineHeight: '14px',
  padding: '0 4px',
  borderRadius: 3,
  color: 'var(--dsw-alias-state-business-primary, #679efe)',
  border: '1px solid currentColor',
}
/** Row actions stay invisible until the row is hovered (CSS drives it). */
export const rowActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  flex: '0 0 auto',
}
export const rowActionStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
  opacity: 0.65,
  padding: '1px 4px',
  borderRadius: 4,
}
export const emptyStyle: CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  opacity: 0.5,
}
/** The collapsible archive header: one quiet line above the archived rows. */
export const groupHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 10px 4px',
  marginTop: 4,
  borderTop: '1px solid var(--dsw-alias-border-l4, rgba(127,127,127,.25))',
  fontSize: 12,
  cursor: 'pointer',
  opacity: 0.7,
}
export const groupCountStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  opacity: 0.7,
}
/** A quiet qualifier beside a group's name, before the count pushes right. */
export const groupNoteStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.6,
}
export const archivedRowStyle: CSSProperties = {
  ...rowStyle,
  opacity: 0.6,
}
export const noticeStyle: CSSProperties = {
  padding: '4px 10px 6px',
  fontSize: 11,
  color: 'var(--dsw-alias-state-error-primary, #f87171)',
}
export const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.55))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}
export const dialogStyle: CSSProperties = {
  // The card the stock Modal draws: the layer-2 surface, the prominent
  // elevation that separates it from the page in light mode (where every layer
  // resolves to the same near-white), and label-primary text.
  background: 'var(--dsw-alias-bg-layer-2, #1b1b1f)',
  boxShadow: 'var(--dsw-elevation-prominent)',
  border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
  borderRadius: 10,
  padding: 18,
  width: 400,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  color: 'var(--dsw-alias-label-primary, #e8e8ec)',
}
export const dialogTitleStyle: CSSProperties = { fontSize: 15, fontWeight: 600 }
export const dialogBodyStyle: CSSProperties = { fontSize: 13, opacity: 0.8, lineHeight: 1.5 }
export const fieldLabelStyle: CSSProperties = { fontSize: 12, opacity: 0.7, marginBottom: 4 }
export const fieldInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  // dsh's input tokens (ui-primitives Input.module.css): the same fill, border,
  // and focus the stock settings forms draw with, so the dialog's fields don't
  // read as a different surface.
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '0.5px solid var(--dsw-alias-border-l4)',
  borderRadius: 8,
  color: 'var(--dsw-alias-label-primary)',
  padding: '7px 9px',
  fontSize: 13,
  outline: 'none',
}
/** Focus twin of {@link fieldInputStyle} for the dialog's fields. */
export const fieldInputFocusStyle: CSSProperties = {
  borderColor: 'var(--dsw-alias-brand-primary)',
}
/**
 * A native select rendered with {@link fieldInputStyle}.
 *
 * It carries no `color-scheme` of its own: the control's widget and its
 * OS-drawn option list follow the document's scheme, which the app sets on
 * `<html>` from the theme preference. The dialog used to pin `dark` because it
 * was dark whatever the app was; now that it follows the theme, so does this.
 */
export const fieldSelectStyle: CSSProperties = {
  ...fieldInputStyle,
  appearance: 'auto',
  cursor: 'pointer',
}
export const dialogErrorStyle: CSSProperties = { color: 'var(--dsw-alias-state-error-primary, #f87171)', fontSize: 12 }
/** Empty-registry line in the dialog: the statement plus the way out of it. */
export const emptyDeviceStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.75,
}
/** Inline text button that reads as a link next to that statement. */
export const linkButtonStyle: CSSProperties = {
  border: 'none', background: 'none', padding: 0, font: 'inherit',
  color: 'var(--dsw-alias-link, #7aa2f7)', cursor: 'pointer', textDecoration: 'underline',
}
export const dialogActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
}
export const cancelButtonStyle: CSSProperties = {
  border: '0.5px solid var(--dsw-alias-border-l4, #3a3a42)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
}
export const createButtonStyle: CSSProperties = {
  border: 'none',
  background: 'var(--dsw-alias-button-primary-fill, #4f6bed)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
  cursor: 'pointer',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
}
export const dangerButtonStyle: CSSProperties = {
  ...createButtonStyle,
  // Deliberately not `state-error-primary`: that alias is the error TEXT
  // colour, which dark mode resolves to a light red that white label text
  // would sit badly on. A filled destructive button is the one place a literal
  // is the readable choice.
  background: '#b3261e',
  color: '#fff',
}
