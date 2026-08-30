import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useOperatorMe } from "@/lib/operator-auth";

/**
 * Operator navigation.
 *
 * Deliberately a SEPARATE component from `components/admin/sidebar`, not a
 * filtered version of it. Sharing one nav list would make "operators can see the
 * Database Console" permanently one bad `if` away — and the whole point of the
 * operator role is that a third-party ISP never sees staff tooling.
 *
 */
const navigation: Array<{ name: string; href: string; icon: string; soon?: boolean }> = [
  { name: "Overview", href: "/operator", icon: "dashboard" },
  { name: "Plans", href: "/operator/plans", icon: "speed" },
  { name: "Coverage", href: "/operator/coverage", icon: "map" },
  { name: "Customers", href: "/operator/customers", icon: "people" },
  { name: "Leads", href: "/operator/leads", icon: "person_add" },
  { name: "Settlements", href: "/operator/settlements", icon: "account_balance" },
];

interface SidebarProps {
  /** Drawer state below `lg`. Ignored at `lg` and up, where the rail is fixed. */
  open?: boolean;
  onClose?: () => void;
}

export default function OperatorSidebar({ open = false, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { operator } = useOperatorMe();

  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

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

  return (
    <>
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
        aria-label="Operator navigation"
      >
        <div className="p-6 border-b border-[rgba(255,255,255,0.06)] relative overflow-hidden">
          <div className="gradient-orb w-32 h-32 -top-16 -left-16 bg-[hsl(160,84%,39%)]" />
          <div className="flex items-center space-x-3 relative z-10">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[hsla(160,84%,39%,0.15)] border border-[hsla(160,84%,39%,0.3)] shadow-[0_0_15px_hsla(160,84%,39%,0.2)] shrink-0">
              <span className="material-icons text-[hsl(160,84%,45%)]" style={{ fontFamily: "Material Icons" }}>
                router
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-white truncate">
                {operator?.companyName || "Operator"}
              </h1>
              <p className="text-xs font-medium tracking-wider uppercase text-[hsl(160,84%,45%)] truncate">
                Broadband Portal
              </p>
            </div>
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
            {navigation.map((item) => {
              const isActive = location === item.href;

              // Not-yet-built sections are shown but inert, so an operator can
              // see what is coming without landing on a blank route.
              if (item.soon) {
                return (
                  <li key={item.name}>
                    <div
                      className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-[hsl(215,20%,45%)] cursor-default"
                      aria-disabled="true"
                    >
                      <span className="material-icons text-xl shrink-0" style={{ fontFamily: "Material Icons" }}>
                        {item.icon}
                      </span>
                      <span className="font-medium truncate">{item.name}</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-[hsl(215,20%,40%)]">soon</span>
                    </div>
                  </li>
                );
              }

              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative overflow-hidden ${
                      isActive
                        ? "bg-[rgba(255,255,255,0.08)] text-white"
                        : "text-[hsl(210,20%,75%)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white"
                    }`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[hsl(160,84%,39%)] shadow-[0_0_10px_hsl(160,84%,39%)] rounded-r-full" />
                    )}
                    <span
                      className={`material-icons text-xl transition-colors shrink-0 ${
                        isActive ? "text-[hsl(160,84%,45%)]" : "group-hover:text-[hsl(160,84%,55%)]"
                      }`}
                      style={{ fontFamily: "Material Icons" }}
                    >
                      {item.icon}
                    </span>
                    <span className={`font-medium truncate ${isActive ? "tracking-wide" : ""}`}>{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] relative z-20">
          <div className="glass-card p-3 flex items-center space-x-3 mb-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
            <div className="w-9 h-9 bg-[hsl(217,25%,18%)] rounded-full flex items-center justify-center border border-[rgba(255,255,255,0.1)] shrink-0">
              <span className="material-icons text-[hsl(210,20%,85%)]" style={{ fontFamily: "Material Icons" }}>
                business
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{operator?.username || "Operator"}</p>
              <p className="text-xs truncate text-[hsl(215,20%,55%)]">{operator?.contactEmail || "Partner access"}</p>
            </div>
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 transition-all"
          >
            <span className="material-icons text-[18px] mr-2" style={{ fontFamily: "Material Icons" }}>logout</span>
            Sign Out
          </Button>
        </div>
      </aside>
    </>
  );
}
