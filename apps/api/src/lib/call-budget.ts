/**
 * A budget of outbound calls for one Worker invocation (architecture doc
 * §14). The Workers free plan allows 50 external subrequests per invocation,
 * cron runs included; D1 and Durable Object bindings don't count. One
 * scheduled run shares one budget across its jobs, so a run with a lot of
 * due work stops cleanly and leaves the rest for the next run instead of
 * failing at the platform limit half-way through a payment.
 *
 * HTTP requests carry no budget (one request makes only a few calls).
 */

/** Thrown by `take()` when the budget is used up. Not an error: stop and leave the rest. */
export class BudgetSpent extends Error {
  constructor() {
    super("call budget used up");
    this.name = "BudgetSpent";
  }
}

export class CallBudget {
  private used = 0;

  constructor(
    readonly limit: number,
    private readonly parent: CallBudget | null = null,
  ) {}

  /** Calls made through this budget (a child's calls count in its parent too). */
  get spent(): number {
    return this.used;
  }

  /** Calls still allowed (never more than the parent has left). */
  get left(): number {
    const own = this.limit - this.used;
    return this.parent ? Math.min(own, this.parent.left) : own;
  }

  canAfford(n: number): boolean {
    return this.left >= n;
  }

  /** Counts one call; throws `BudgetSpent` (before the call) when none is left. */
  take(): void {
    if (this.left <= 0) throw new BudgetSpent();
    this.used++;
    this.parent?.take();
  }

  /** Counts one call if one is left; false otherwise (for best-effort calls). */
  tryTake(): boolean {
    if (this.left <= 0) return false;
    this.take();
    return true;
  }

  /** A share of this budget: at most `limit` calls, counted here too. */
  child(limit: number): CallBudget {
    return new CallBudget(limit, this);
  }
}
