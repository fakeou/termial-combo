export interface ComboCounterOptions {
  comboWindowMs: number;
}

export class ComboCounter {
  private readonly comboWindowMs: number;
  private count = 0;
  private lastActivityAt = 0;

  constructor(options: ComboCounterOptions) {
    this.comboWindowMs = options.comboWindowMs;
  }

  recordActivity(now: number): number {
    this.count = this.valueAt(now) + 1;
    this.lastActivityAt = now;
    return this.count;
  }

  valueAt(now: number): number {
    if (this.count === 0) return 0;
    return now - this.lastActivityAt <= this.comboWindowMs ? this.count : 0;
  }
}
