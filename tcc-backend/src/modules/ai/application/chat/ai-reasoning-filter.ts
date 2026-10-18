const OPEN_THINK_TAG = "<think>";
const CLOSE_THINK_TAG = "</think>";

/** Removes model-emitted <think> blocks from a stream without leaking partial tags. */
export class AiReasoningFilter {
  private pending = "";
  private insideThinkBlock = false;
  private finished = false;

  push(chunk: string): string {
    if (this.finished || !chunk) return "";
    this.pending += chunk;

    let visible = "";
    while (this.pending) {
      const normalized = this.pending.toLocaleLowerCase("en-US");

      if (this.insideThinkBlock) {
        const closeIndex = normalized.indexOf(CLOSE_THINK_TAG);
        if (closeIndex < 0) {
          this.pending = this.keepPossibleTagPrefix(this.pending, [CLOSE_THINK_TAG]);
          break;
        }
        this.pending = this.pending.slice(closeIndex + CLOSE_THINK_TAG.length);
        this.insideThinkBlock = false;
        continue;
      }

      const openIndex = normalized.indexOf(OPEN_THINK_TAG);
      const closeIndex = normalized.indexOf(CLOSE_THINK_TAG);
      const nextTagIndex = [openIndex, closeIndex]
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0];

      if (nextTagIndex === undefined) {
        const remainder = this.keepPossibleTagPrefix(this.pending, [
          OPEN_THINK_TAG,
          CLOSE_THINK_TAG,
        ]);
        visible += this.pending.slice(0, this.pending.length - remainder.length);
        this.pending = remainder;
        break;
      }

      visible += this.pending.slice(0, nextTagIndex);
      const isOpenTag = nextTagIndex === openIndex;
      const tag = isOpenTag ? OPEN_THINK_TAG : CLOSE_THINK_TAG;
      this.pending = this.pending.slice(nextTagIndex + tag.length);
      if (isOpenTag) this.insideThinkBlock = true;
    }

    return visible;
  }

  finish(): string {
    if (this.finished) return "";
    this.finished = true;

    if (this.insideThinkBlock) {
      this.pending = "";
      return "";
    }

    const remainder = this.keepPossibleTagPrefix(this.pending, [
      OPEN_THINK_TAG,
      CLOSE_THINK_TAG,
    ]);
    const visible = this.pending.slice(0, this.pending.length - remainder.length);
    this.pending = "";
    return visible;
  }

  private keepPossibleTagPrefix(value: string, tags: string[]): string {
    const normalized = value.toLocaleLowerCase("en-US");
    let suffixLength = 0;

    for (const tag of tags) {
      const maxLength = Math.min(normalized.length, tag.length - 1);
      for (let length = maxLength; length > suffixLength; length -= 1) {
        if (normalized.endsWith(tag.slice(0, length))) {
          suffixLength = length;
          break;
        }
      }
    }

    return value.slice(value.length - suffixLength);
  }
}
