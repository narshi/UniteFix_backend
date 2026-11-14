import { Link, useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAdminMe } from "@/lib/admin-auth";

/**
 * Every entry declares the capability it needs, and the menu is filtered by what
 * the signed-in role actually holds. Roles are user-created, so this list can no
 * longer hardcode "super admin only" — a Manager role given `withdrawals:view`
 * must see Withdrawals, and one without it must not.
 *
 * Hiding a link is NOT access control. The matching endpoints are enforced by
 * the capability guard mounted on /api/admin, which denies unmapped paths
 * outright.
 */
type NavItem = { name: string; href: string; icon: string; capability: string };
type NavGroup = { key: string; label: string; icon: string; items: NavItem[] };

const home: NavItem = { name: "Dashboard", href: "/", icon: "dashboard", capability: "dashboard:view" };

/** The menu, grouped by the job staff are doing. Every page appears once. */
export const navGroups: NavGroup[] = [
  {
    key: "bookings", label: "Bookings", icon: "event_note", items: [
      { name: "Service Requests", href: "/services", icon: "build", capability: "bookings:view" },
      { name: "Assignment Queue", href: "/admin/assignments", icon: "assignment", capability: "bookings:view" },
      { name: "Book by Call", href: "/admin/book-by-call", icon: "phone_in_talk", capability: "bookings:view" },
      { name: "Enquiries", href: "/admin/enquiries", icon: "forum", capability: "bookings:view" },
      { name: "Support Tickets", href: "/admin/support-tickets", icon: "support_agent", capability: "support:view" },
      { name: "Warranty Claims", href: "/admin/warranty-claims", icon: "verified_user", capability: "bookings:view" },
    ],
  },
  {
    key: "people", label: "People", icon: "groups", items: [
      { name: "User Management", href: "/users", icon: "people", capability: "customers:view" },
      { name: "Employees", href: "/partners", icon: "handyman", capability: "employees:view" },
      { name: "Account Deletions", href: "/admin/account-deletions", icon: "person_remove", capability: "customers:view" },
    ],
  },
  {
    key: "partners", label: "Partners", icon: "handshake", items: [
      { name: "Business Partners", href: "/admin/business-partners", icon: "business", capability: "partners:view" },
      { name: "Partner Territories", href: "/admin/partner-territories", icon: "share_location", capability: "partners:view" },
      { name: "FTTH Operators", href: "/admin/ftth-operators", icon: "router", capability: "ftth:view" },
      { name: "Marketplace", href: "/admin/marketplace", icon: "storefront", capability: "partners:view" },
      { name: "Consignment", href: "/admin/consignment", icon: "warehouse", capability: "partners:view" },
      { name: "Celebrations", href: "/admin/celebrations", icon: "celebration", capability: "partners:view" },
      { name: "Newspapers", href: "/admin/news", icon: "newspaper", capability: "partners:view" },
    ],
  },
  {
    key: "money", label: "Money", icon: "currency_rupee", items: [
      { name: "Payments & Invoices", href: "/payments", icon: "payment", capability: "payments:view" },
      { name: "Manual Bill", href: "/admin/manual-bill", icon: "receipt_long", capability: "billing:view" },
      { name: "Withdrawals", href: "/admin/withdrawals", icon: "account_balance", capability: "withdrawals:view" },
      { name: "Partner Settlements", href: "/admin/partner-settlements", icon: "payments", capability: "partners:view" },
    ],
  },
  {
    key: "services", label: "Services & App", icon: "design_services", items: [
      { name: "Service Catalog", href: "/admin/catalog", icon: "category", capability: "catalog:view" },
      { name: "Home Screen", href: "/admin/home-screen", icon: "phone_iphone", capability: "catalog:view" },
      { name: "Service Expert Types", href: "/admin/technician-types", icon: "engineering", capability: "catalog:view" },
      { name: "Category Expertise", href: "/admin/category-expertise", icon: "hub", capability: "catalog:view" },
      { name: "Marketing Push", href: "/admin/marketing", icon: "campaign", capability: "marketing:view" },
      { name: "Districts", href: "/admin/districts", icon: "map", capability: "locations:view" },
      { name: "Location Management", href: "/locations", icon: "location_on", capability: "locations:view" },
    ],
  },
  {
    key: "store", label: "Store & Parts", icon: "inventory", items: [
      { name: "Product Orders", href: "/orders", icon: "shopping_cart", capability: "orders:view" },
      // The old "Inventory" page edits the halted product store — renamed so it is
      // not mistaken for spare parts, which live on their own page.
      { name: "Product Store", href: "/admin/inventory", icon: "storefront", capability: "inventory:view" },
      { name: "Spare Parts", href: "/admin/spare-parts", icon: "inventory_2", capability: "inventory:view" },
      { name: "Parts Access", href: "/admin/parts-access", icon: "verified", capability: "inventory:view" },
      { name: "B2B Orders", href: "/admin/b2b-orders", icon: "local_shipping", capability: "orders:view" },
    ],
  },
  {
    key: "system", label: "Settings & System", icon: "tune", items: [
      { name: "Settings", href: "/settings", icon: "settings", capability: "settings:view" },
      { name: "WhatsApp", href: "/admin/whatsapp", icon: "chat", capability: "settings:view" },
      { name: "Roles & Access", href: "/admin/admins", icon: "admin_panel_settings", capability: "accounts:view" },
      { name: "Audit Trail", href: "/admin/audit-logs", icon: "history", capability: "audit:view" },
      { name: "Go-live checklist", href: "/admin/go-live", icon: "checklist", capability: "partners:view" },
      { name: "Database Console", href: "/admin/developer", icon: "storage", capability: "db_console:manage" },
    ],
  },
];

const OPEN_KEY = "adminNavOpenGroups";
function readOpen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
function writeOpen(keys: string[]) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(keys)); } catch { /* private mode: fine */ }
}

interface SidebarProps {
  /** Drawer state on screens below `lg`. Ignored at `lg` and up, where the rail is always visible. */
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { isSuperAdmin, admin, can } = useAdminMe();
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>(readOpen);

  // Only the pages this role can open; a group with none of them disappears.
  const groups = useMemo(() => navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => can(i.capability)) }))
    .filter((g) => g.items.length > 0), [can]);
  const activeGroup = groups.find((g) => g.items.some((i) => i.href === location))?.key;

  // The group holding the current page is always open.
  useEffect(() => {
    if (activeGroup && !openGroups.includes(activeGroup)) {
      const next = [...openGroups, activeGroup];
      setOpenGroups(next); writeOpen(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);

  const toggle = (key: string) => {
    const next = openGroups.includes(key) ? openGroups.filter((k) => k !== key) : [...openGroups, key];
    setOpenGroups(next); writeOpen(next);
  };

  // Typing filters every group's pages by name (and by group name).
  const q = query.trim().toLowerCase();
  const shown = q
    ? groups.map((g) => ({ ...g, items: g.label.toLowerCase().includes(q) ? g.items : g.items.filter((i) => i.name.toLowerCase().includes(q)) })).filter((g) => g.items.length)
    : groups;

  const renderItem = (item: NavItem, nested: boolean) => {
    const isActive = location === item.href;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          className={`flex items-center space-x-3 ${nested ? "pl-4 pr-3 py-2" : "px-3 py-2.5"} rounded-lg transition-all duration-200 group relative overflow-hidden ${isActive
            ? "bg-[rgba(255,255,255,0.08)] text-white"
            : "text-[hsl(210,20%,75%)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white"
            }`}
        >
          {isActive && (
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[hsl(217,91%,60%)] shadow-[0_0_10px_hsl(217,91%,60%)] rounded-r-full" />
          )}
          <span className={`material-icons ${nested ? "text-lg" : "text-xl"} transition-colors shrink-0 ${isActive ? 'text-[hsl(217,91%,60%)]' : 'group-hover:text-[hsl(217,91%,70%)]'}`} style={{ fontFamily: 'Material Icons' }}>{item.icon}</span>
          <span className={`${nested ? "text-sm" : ""} font-medium truncate ${isActive ? 'tracking-wide' : ''}`}>{item.name}</span>
        </Link>
      </li>
    );
  };

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
          <div className="relative mb-3">
            <span className="material-icons absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-[hsl(215,20%,55%)] pointer-events-none" style={{ fontFamily: 'Material Icons' }}>search</span>
            <input
              id="admin-nav-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a page"
              aria-label="Find a page"
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-sm text-white placeholder:text-[hsl(215,20%,55%)] focus:outline-none focus:border-[hsla(217,91%,60%,0.5)]"
            />
          </div>
          <ul className="space-y-1.5">
            {!q && can(home.capability) && renderItem(home, false)}
            {shown.map((g) => {
              const expanded = !!q || openGroups.includes(g.key);
              const holdsActive = g.key === activeGroup;
              return (
                <li key={g.key} className="pt-1">
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    aria-expanded={expanded}
                    aria-controls={`nav-group-${g.key}`}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors hover:bg-[rgba(255,255,255,0.04)] ${holdsActive ? "text-white" : "text-[hsl(210,20%,75%)]"}`}
                  >
                    <span className={`material-icons text-xl shrink-0 ${holdsActive ? "text-[hsl(217,91%,60%)]" : ""}`} style={{ fontFamily: 'Material Icons' }}>{g.icon}</span>
                    <span className="flex-1 font-semibold text-sm truncate">{g.label}</span>
                    {!expanded && <span className="text-[11px] text-[hsl(215,20%,55%)] tabular-nums">{g.items.length}</span>}
                    <span className={`material-icons text-lg shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} style={{ fontFamily: 'Material Icons' }}>expand_more</span>
                  </button>
                  {expanded && (
                    <ul id={`nav-group-${g.key}`} className="mt-1 ml-3 pl-2 space-y-0.5 border-l border-[rgba(255,255,255,0.06)]">
                      {g.items.map((item) => renderItem(item, true))}
                    </ul>
                  )}
                </li>
              );
            })}
            {q && !shown.length && <li className="px-3 py-2 text-sm text-[hsl(215,20%,55%)]">No page called "{query.trim()}".</li>}
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
                {admin?.roleName || adminUser.email || 'System Access'}
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
