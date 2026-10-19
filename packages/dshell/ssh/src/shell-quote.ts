/**
 * Words that go into a remote shell line.
 *
 * The transport carries a command as one string the device's login shell reads,
 * so anything the caller or the device record contributes to that string has to
 * be quoted for a POSIX shell. One function, because a second quoting
 * implementation is a second chance to be wrong about a filename.
 */

/** Quote one word for a POSIX shell. */
export function quote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`
}
