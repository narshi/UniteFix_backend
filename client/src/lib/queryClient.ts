import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
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
    if (res.status === 401 && (url.includes("/api/admin/") || url.includes("/api/service-partners"))) {
      // Admin token expired or invalid, clear storage and redirect to login
      localStorage.removeItem("adminToken");
      localStorage.removeItem("adminUser");
      window.location.reload();
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

      if (res.status === 401) {
        if (url.includes("/api/admin/") || url.includes("/api/service-partners")) {
          // Admin token expired or invalid, clear storage and redirect to login
          localStorage.removeItem("adminToken");
          localStorage.removeItem("adminUser");
          window.location.reload();
          return;
        }

        if (unauthorizedBehavior === "returnNull") {
          return null;
        }
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
