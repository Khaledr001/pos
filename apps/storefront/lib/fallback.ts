import { unstable_rethrow } from "next/navigation";

/**
 * For `.catch(...)` on a page's data: render a fallback when the API fails,
 * but never swallow Next's own control-flow errors.
 *
 * The one that matters most here is the request-time signal from
 * `headers()`: the tenant is read from the request's host, and catching that
 * signal would let Next pre-render the page once, at build time, as one
 * shop — and serve it to every other.
 */
export const orFallback =
  <T>(value: T) =>
  (error: unknown): T => {
    unstable_rethrow(error);
    return value;
  };
