/** The tones a greeting takes. */
export type Tone = 'soft' | 'loud';

/**
 * Says hello to a name.
 *
 * Wrapped lines join into
 * one paragraph.
 */
export function greet(name: string, tone?: Tone): string {
  return tone === 'loud' ? name.toUpperCase() : name;
}

/** Loud variant. */
export function shout(name: string): string {
  return name.toUpperCase();
}

/** Not part of the public surface. @internal */
export function hidden(): void {}

/** Multiline parameter lists collapse to one line. */
export function wide(
  first: string,
  second: string,
): string {
  return first + second;
}
