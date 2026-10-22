import { Money } from "@devsfleet/shared-utils";

/**
 * What the drawer should hold: the float, plus cash taken at the counter, plus
 * money paid in, less money paid out. The same sum `close()` freezes onto the
 * row; for a drawer still open it is the figure so far.
 *
 * `cashSales` is net of cash refunds — both are cash `payments` rows, refunds
 * negative — so there is no separate refund term.
 */
export function expectedCash(parts: {
  opening: string;
  cashSales: string;
  cashIn: string;
  cashOut: string;
}): string {
  return Money.toDecimalString(
    Money.add(
      Money.toMinor(parts.opening),
      Money.toMinor(parts.cashSales),
      Money.toMinor(parts.cashIn),
      Money.negate(Money.toMinor(parts.cashOut)),
    ),
    4,
  );
}
