import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAdminMe } from "@/lib/admin-auth";

/**
 * `superAdminOnly` hides the entry for plain admins. The matching routes in
 * App.tsx are gated too — hiding a link is not access control on its own, and
 * the endpoints behind these pages enforce super_admin regardless.
 */
const navigation: Array<{ name: string; href: string; icon: string; superAdminOnly?: boolean }> = [
  { name: "Dashboard", href: "/", icon: "dashboard" },
  { name: "User Management", href: "/users", icon: "people" },
  { name: "Service Requests", href: "/services", icon: "build" },
  { name: "Support Tickets", href: "/admin/support-tickets", icon: "support_agent" },
  { name: "Assignment Queue", href: "/admin/assignments", icon: "assignment" },
  { name: "Service Catalog", href: "/admin/catalog", icon: "category" },
  { name: "Manual Bill", href: "/admin/manual-bill", icon: "receipt_long" },
  { name: "Technician Types", href: "/admin/technician-types", icon: "engineering" },
  { name: "Category Expertise", href: "/admin/category-expertise", icon: "hub" },
  { name: "Product Orders", href: "/orders", icon: "shopping_cart" },
  { name: "Inventory", href: "/admin/inventory", icon: "inventory_2" },
  { name: "Employees", href: "/partners", icon: "handyman" },
  { name: "Payments & Invoices", href: "/payments", icon: "payment" },
  { name: "Withdrawals", href: "/admin/withdrawals", icon: "account_balance" },
  { name: "Marketing Push", href: "/admin/marketing", icon: "campaign" },
  { name: "Audit Trail", href: "/admin/audit-logs", icon: "history", superAdminOnly: true },
  { name: "Districts", href: "/admin/districts", icon: "map" },
  { name: "Location Management", href: "/locations", icon: "location_on" },
  { name: "Administrators", href: "/admin/admins", icon: "admin_panel_settings", superAdminOnly: true },
  { name: "Database Console", href: "/admin/developer", icon: "storage", superAdminOnly: true },
  { name: "Settings", href: "/settings", icon: "settings" },
];

interface SidebarProps {
  /** Drawer state on screens below `lg`. Ignored at `lg` and up, where the rail is always visible. */
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { isSuperAdmin, admin } = useAdminMe();
  const visibleNavigation = navigation.filter((item) => !item.superAdminOnly || isSuperAdmin);

  // Close the mobile drawer whenever the route changes, otherwise it stays
  // open over the page the user just navigated to.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Allow Escape to dismiss the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
    window.location.reload();
  };

  let adminUser: { username?: string; email?: string } = {};
  try {
    adminUser = JSON.parse(localStorage.getItem("adminUser") || "{}") ?? {};
  } catch {
    adminUser = {};
  }

  return (
    <>
      {/* Backdrop — mobile/tablet only */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`glass-sidebar flex flex-col h-screen z-50 w-64 shrink-0
          fixed inset-y-0 left-0 transition-transform duration-300 ease-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:sticky lg:top-0 lg:translate-x-0 lg:transition-none`}
        aria-label="Admin navigation"
      >
        <div className="p-6 border-b border-[rgba(255,255,255,0.06)] relative overflow-hidden">
          <div className="gradient-orb w-32 h-32 -top-16 -left-16 bg-[hsl(217,91%,60%)]" />
          <div className="flex items-center space-x-3 relative z-10">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[hsla(217,91%,60%,0.15)] border border-[hsla(217,91%,60%,0.3)] shadow-[0_0_15px_hsla(217,91%,60%,0.2)] shrink-0">
              <svg className="w-6 h-6 text-[hsl(217,91%,60%)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 7.172V5L8 4z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-white truncate">Unite<span className="gradient-text">Fix</span></h1>
              <p className="text-xs font-medium tracking-wider uppercase text-[hsl(217,91%,60%)] truncate">Admin Dashboard</p>
            </div>
            {/* Close button — drawer mode only */}
            <button
              onClick={onClose}
              className="ml-auto lg:hidden text-[hsl(210,20%,75%)] hover:text-white p-1 rounded-lg hover:bg-[rgba(255,255,255,0.06)] transition-colors"
              aria-label="Close navigation"
            >
              <span className="material-icons" style={{ fontFamily: "Material Icons" }}>close</span>
            </button>
          </div>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <ul className="space-y-1.5">
            {visibleNavigation.map((item) => {
              const isActive = location === item.href;
              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative overflow-hidden ${isActive
                      ? "bg-[rgba(255,255,255,0.08)] text-white"
                      : "text-[hsl(210,20%,75%)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white"
                      }`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[hsl(217,91%,60%)] shadow-[0_0_10px_hsl(217,91%,60%)] rounded-r-full" />
                    )}
                    <span className={`material-icons text-xl transition-colors shrink-0 ${isActive ? 'text-[hsl(217,91%,60%)]' : 'group-hover:text-[hsl(217,91%,70%)]'}`} style={{ fontFamily: 'Material Icons' }}>{item.icon}</span>
                    <span className={`font-medium truncate ${isActive ? 'tracking-wide' : ''}`}>{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] relative z-20">
          <div className="glass-card p-3 flex items-center space-x-3 mb-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
            <div className="w-9 h-9 bg-[hsl(217,25%,18%)] rounded-full flex items-center justify-center border border-[rgba(255,255,255,0.1)] shrink-0">
              <span className="material-icons text-[hsl(210,20%,85%)]" style={{ fontFamily: 'Material Icons' }}>shield</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {admin?.username || adminUser.username || 'Administrator'}
              </p>
              <p className={`text-xs truncate ${isSuperAdmin ? 'text-[hsl(263,70%,70%)] font-medium' : 'text-[hsl(215,20%,55%)]'}`}>
                {isSuperAdmin ? 'Super Admin' : (admin?.role === 'admin' ? 'Administrator' : (adminUser.email || 'System Access'))}
              </p>
            </div>
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 transition-all"
          >
            <span className="material-icons text-[18px] mr-2" style={{ fontFamily: 'Material Icons' }}>logout</span>
            Secure Logout
          </Button>
        </div>
      </aside>
    </>
  );
}
