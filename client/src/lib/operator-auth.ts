/**
 * FTTH operator session helpers.
 *
 * Operators sign in through the SAME /api/admin/auth/login as staff and get a
 * token carrying role 'operator'. What differs is everything after: the token is
 * rejected by `authenticateAdmin`, so no staff endpoint answers it, and the
 * dashboard renders a separate shell.
 *
 * The role is read from the SIGNED TOKEN, not from the client-writable
 * `adminUser` blob in localStorage. Editing the blob in devtools would only
 * change which shell renders — every endpoint behind it still refuses — but
 * reading the claim keeps the two in step and costs nothing.
 *
 * `useAdminMe` is unusable here: it calls /api/admin/me, which 403s an operator.
 */

import { useQuery } from "@tanstack/react-query";

export type DashboardRole = "admin" | "super_admin" | "operator" | null;

export interface OperatorMe {
  id: number;
  username: string;
  companyName: string;
  legalName: string | null;
  gstin: string | null;
  contactName: string | null;
  contactEmail: string;
  contactPhone: string;
  logoUrl: string | null;
  brandColor: string | null;
  status: "pending_approval" | "active" | "paused" | "disabled";
  convenienceFee: number | null;
  pincodes: string[];
}

/** The role claim from the stored dashboard token, or null if there isn't one. */
export function getDashboardRole(): DashboardRole {
  const token = localStorage.getItem("adminToken");
  if (!token) return null;

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const role = payload?.role;
    return role === "admin" || role === "super_admin" || role === "operator" ? role : null;
  } catch {
    return null;
  }
}

/**
 * True when the server said the account is real but suspended
 * (403 + OPERATOR_NOT_ACTIVE). Distinct from a dead session, which the fetch
 * layer turns into a logout.
 */
export function isOperatorSuspended(error: unknown): boolean {
  return error instanceof Error && error.message.includes("OPERATOR_NOT_ACTIVE");
}

export function useOperatorMe() {
  const { data, isLoading, isError, error } = useQuery<{ data: OperatorMe }>({
    queryKey: ["/api/ftth/admin/me"],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    operator: data?.data ?? null,
    suspended: isOperatorSuspended(error),
    isLoading,
    isError,
    error,
  };
}
