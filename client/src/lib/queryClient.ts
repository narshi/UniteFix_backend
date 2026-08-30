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
        || url.includes("/api/service-partners");
}

/**
 * Is this response the admin session ending?
 *
 * The middleware now returns 401 for an EXPIRED admin token and keeps 403 for a
 * malformed or revoked one. Both mean the dashboard has to send the user back
 * to the login screen, and both used to be treated as ordinary errors on the
 * 403 path — leaving an expired admin staring at failing pages with a dead
 * token still in localStorage.
 *
 * One exception on the operator side: a 403 carrying OPERATOR_NOT_ACTIVE means
 * "your credentials are fine, but UniteFix has paused your account". Clearing
 * the token and reloading would show that operator a login screen, i.e. tell
 * them their password is wrong. Let it through as an ordinary error so the
 * portal can say what actually happened.
 */
function isAdminSessionOver(status: number, url: string, body: string): boolean {
    if (!isDashboardCall(url)) return false;
    if (status !== 401 && status !== 403) return false;
    return !body.includes("OPERATOR_NOT_ACTIVE");
}

function endAdminSession(): void {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
    window.location.reload();
}

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
