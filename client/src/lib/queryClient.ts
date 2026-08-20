import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * Is this response the admin session ending?
 *
 * The middleware now returns 401 for an EXPIRED admin token and keeps 403 for a
 * malformed or revoked one. Both mean the dashboard has to send the user back
 * to the login screen, and both used to be treated as ordinary errors on the
 * 403 path — leaving an expired admin staring at failing pages with a dead
 * token still in localStorage.
 */
function isAdminSessionOver(status: number, url: string): boolean {
    const isAdminCall = url.includes("/api/admin/") || url.includes("/api/service-partners");
    return isAdminCall && (status === 401 || status === 403);
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

  // Add admin token to admin routes and service partner routes (admin-only endpoints)
  if (adminToken && (url.includes("/api/admin/") || url.includes("/api/service-partners"))) {
    headers.Authorization = `Bearer ${adminToken}`;
  }

  const res = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    if (isAdminSessionOver(res.status, url)) {
      endAdminSession();
      return;
    }

    const text = (await res.text()) || res.statusText;
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

      // Add admin token to admin routes and service partner routes (admin-only endpoints)
      if (adminToken && (url.includes("/api/admin/") || url.includes("/api/service-partners"))) {
        headers.Authorization = `Bearer ${adminToken}`;
      }

      const res = await fetch(url, {
        credentials: "include",
        headers,
      });

      if (isAdminSessionOver(res.status, url)) {
        endAdminSession();
        return;
      }

      if (res.status === 401 && unauthorizedBehavior === "returnNull") {
        return null;
      }

      await throwIfResNotOk(res);
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
