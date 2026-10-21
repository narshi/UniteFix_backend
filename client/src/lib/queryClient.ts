import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Endpoints that need the dashboard's bearer token.
 *
 * `/api/ftth/admin/` is the FTTH operator portal. It is listed explicitly
 * because it does NOT contain the substring "/api/admin/" — without this the
 * token was never attached and every operator page 401'd while looking, from
 * the outside, like an auth bug.
 */
function isDashboardCall(url: string): boolean {
    return url.includes("/api/admin/")
        || url.includes("/api/ftth/")
        // Admin-only despite the legacy prefix: the technician directory used by
        // the assignment modal and the parts pickers. Without the token every
        // picker showed an empty list with no error.
        || url.includes("/api/business/")
        // Partner Hub and the B2B parts store, signed in with a Hub login.
        || url.includes("/api/hub/")
        || url.includes("/api/b2b/")
        || url.includes("/api/service-partners");
}

/**
 * Is this response the admin session ending?
 *
 * 401 always is: the token is missing or expired.
 *
 * 403 is two different things. The middleware answers 403 for a malformed or
 * revoked token and for an account that was removed or deactivated — the
 * session is over and the user goes back to the login screen. But a 403 also
 * means "signed in, not allowed THIS": a Hub page for a module the business
 * does not run yet, a super-admin-only action, a capability the role lacks.
 * Signing out on those threw a working user out of the dashboard the moment
 * one page asked for something they could not have (a new broadband partner
 * opening Broadband before its operator existed was signed out on every
 * visit). So a 403 ends the session only when it says the token or the
 * account is gone; any other 403 is an ordinary error the page can show.
 *
 * OPERATOR_NOT_ACTIVE ("UniteFix has paused your account") is deliberately not
 * one of them: a login screen would tell that operator their password is wrong.
 */
const SESSION_GONE_403 = /invalid or expired (admin )?token|account has been (removed|deactivated|closed)|account is deactivated|admin account has been deactivated/i;

function isAdminSessionOver(status: number, url: string, body: string): boolean {
    if (!isDashboardCall(url)) return false;
    if (status === 401) return true;
    if (status !== 403 || body.includes("OPERATOR_NOT_ACTIVE")) return false;
    return SESSION_GONE_403.test(body);
}

function endAdminSession(): void {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
    window.location.reload();
}

/**
 * The server's own message from an apiRequest() failure.
 *
 * apiRequest throws `"<status>: <body text>"`, and the body is usually the
 * JSON `{ success: false, message }` the route wrote for the person reading
 * it. A toast that shows `400: {"success":false,"message":"…"}` is technically
 * accurate and useless; this returns the message.
 */
export function apiErrorMessage(err: unknown, fallback = "Request failed"): string {
  const raw = String((err as any)?.message ?? "");
  const m = raw.match(/^\d{3}: ([\s\S]*)$/);
  if (m) {
    try {
      const body = JSON.parse(m[1]);
      if (body && typeof body.message === "string") return body.message;
      if (body && typeof body.error === "string") return body.error;
    } catch { /* not JSON — fall through */ }
    return m[1].trim() || fallback;
  }
  return raw || fallback;
}

/**
 * NOTE: resolves to the PARSED JSON body, not a Response. Do not call .json()
 * or read .ok on the result — a non-2xx throws instead (see apiErrorMessage).
 */
export async function apiRequest(
  method: string,
  url: string,
  body?: unknown
): Promise<any> {
  // Add admin token to requests if available
  const adminToken = localStorage.getItem("adminToken");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add the dashboard token to admin, operator-portal and service partner routes
  if (adminToken && isDashboardCall(url)) {
    headers.Authorization = `Bearer ${adminToken}`;
  }

  const res = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = (await res.text()) || res.statusText;

    if (isAdminSessionOver(res.status, url, text)) {
      endAdminSession();
      return;
    }

    throw new Error(`${res.status}: ${text}`);
  }

  if (res.status === 204) {
    return null;
  }

  return await res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      const url = queryKey[0] as string;
      const adminToken = localStorage.getItem("adminToken");
      const headers: Record<string, string> = {};

      // Add the dashboard token to admin, operator-portal and service partner routes
      if (adminToken && isDashboardCall(url)) {
        headers.Authorization = `Bearer ${adminToken}`;
      }

      const res = await fetch(url, {
        credentials: "include",
        headers,
      });

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;

        if (isAdminSessionOver(res.status, url, text)) {
          endAdminSession();
          return;
        }

        if (res.status === 401 && unauthorizedBehavior === "returnNull") {
          return null;
        }

        throw new Error(`${res.status}: ${text}`);
      }

      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
