/**
 * Who the signed-in admin is, according to the server.
 *
 * Deliberately NOT read from the `adminUser` blob in localStorage: that is
 * client-writable, so anyone could set `role: "super_admin"` in devtools and
 * unhide the Database Console. This asks the server, which reads the role from
 * the `admin_users` row.
 *
 * Hiding menu items is a UX affordance, not a security boundary — every gated
 * capability is also enforced server-side by requireSuperAdmin.
 */

import { useQuery } from "@tanstack/react-query";

export interface AdminMe {
  id: number;
  username: string;
  email: string | null;
  /** The role's slug. Roles are user-created, so this is not a fixed union. */
  role: string;
  roleName: string;
  isSuperAdmin: boolean;
  /** Already expanded — `manage` implies `view`. */
  capabilities: string[];
}

/**
 * Download an admin-authenticated file.
 *
 * window.open / <a href> cannot be used for these: admin endpoints require an
 * Authorization header, and a plain navigation sends none, so the browser lands
 * on a 401 instead of a PDF. Fetch it with the token, then hand the browser a
 * blob URL.
 */
export async function downloadAdminFile(url: string, fallbackName: string): Promise<void> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });

  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }

  // Prefer the server's filename when it sent one.
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename=([^;]+)/i);
  const filename = match ? match[1].trim().replace(/["']/g, "") : fallbackName;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

export function useAdminMe() {
  const { data, isLoading, isError } = useQuery<{ data: AdminMe }>({
    queryKey: ["/api/admin/me"],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const capabilities = data?.data?.capabilities ?? [];
  const capSet = new Set(capabilities);

  return {
    admin: data?.data ?? null,
    /**
     * Defaults to false while loading or on error, so a slow or failed lookup
     * hides privileged UI rather than flashing it.
     */
    isSuperAdmin: data?.data?.isSuperAdmin === true,
    capabilities,
    /**
     * Hiding a menu or a button is a UX affordance, never access control —
     * every capability is enforced independently by the guard mounted on
     * /api/admin. Defaults to false while loading for the same reason as above.
     */
    can: (capability: string) => capSet.has(capability),
    isLoading,
    isError,
  };
}
