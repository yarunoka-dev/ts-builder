/**
 * The options a widget takes.
 */
export type WidgetOptions = {
  /** How wide. */
  readonly width: number;
};

/** A widget. */
export class Widget {
  /** The width it was given. */
  readonly width: number;

  /** Not part of the public surface. @internal */
  readonly secret = 1;

  private counter = 0;

  /** Makes one. */
  constructor(options: WidgetOptions) {
    this.width = options.width;
  }

  /**
   * Renders itself.
   *
   * A second paragraph a member summary leaves out.
   */
  render(depth: number): string {
    this.counter += 1;

    return String(depth * this.width + this.counter);
  }

  private helper(): void {}
}

/** The version constant. */
export const VERSION = '1.0';

/** The word list constant. */
export const WORDS: readonly string[] = [
  // The first group
  'alpha',
  'beta',
];

/** Two declarators in one statement; only SECOND is re-exported. */
export const FIRST = '1',
  SECOND = '2';
