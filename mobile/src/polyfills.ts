/**
 * Runtime polyfills. Imported FIRST from index.ts, before anything else.
 *
 * ── WeakRef ──────────────────────────────────────────────────────────────
 * Hermes does not implement WeakRef, but @react-navigation/core does:
 *
 *   useNavigationBuilder.js  ->  setConsumedParamsRef(new WeakRef(route.params))
 *   useNavigationBuilder.js  ->  consumedParams?.ref?.deref() === route.params
 *
 * That runs inside useNavigationBuilder, which every Navigator calls, so on a
 * device it threw "ReferenceError: Property 'WeakRef' doesn't exist" and the
 * ErrorBoundary caught it at NativeStackNavigator.
 *
 * It only fires when the route being entered HAS params, which is why it looked
 * random: opening a screen from a notification or resuming onto a params-
 * carrying route crashed, while retrying landed on a params-free tab and
 * appeared to work.
 *
 * The shim holds a STRONG reference. React Navigation uses this only to ask
 * "are these the same params object I already consumed?", so a deref() that
 * never returns undefined answers that question more reliably than a real
 * WeakRef, at the cost of retaining one params object per navigator. That is
 * the right trade: the alternative is a crash.
 */

if (typeof (globalThis as any).WeakRef === 'undefined') {
    class WeakRefShim<T extends object> {
        private readonly target: T;

        constructor(target: T) {
            this.target = target;
        }

        deref(): T | undefined {
            return this.target;
        }
    }

    Object.defineProperty(WeakRefShim, 'name', { value: 'WeakRef' });
    (globalThis as any).WeakRef = WeakRefShim;
}

export { };
