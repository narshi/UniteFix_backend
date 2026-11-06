/**
 * Options for a list that should keep itself current: bookings and recharges
 * change while staff and partners watch the page.
 *
 * The app's query defaults never refetch (staleTime Infinity, no focus
 * refetch), so these pages only changed on a browser reload. Spread this into
 * a useQuery to poll every 20 seconds while the tab is visible (browsers pause
 * it in a hidden tab) and to refetch the moment the tab is focused again.
 * Unchanged data keeps the same object, so open dialogs and forms are not reset.
 */
export const LIVE = {
  refetchInterval: 20_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: "always",
} as const;
