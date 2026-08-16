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
  role: "admin" | "super_admin";
  isSuperAdmin: boolean;
}

export function useAdminMe() {
  const { data, isLoading, isError } = useQuery<{ data: AdminMe }>({
    queryKey: ["/api/admin/me"],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    admin: data?.data ?? null,
    /**
     * Defaults to false while loading or on error, so a slow or failed lookup
     * hides privileged UI rather than flashing it.
     */
    isSuperAdmin: data?.data?.isSuperAdmin === true,
    isLoading,
    isError,
  };
}
