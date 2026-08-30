import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import UsersPage from "@/pages/users";
import ServicesPage from "@/pages/services";
import OrdersPage from "@/pages/orders";
import PartnersPage from "@/pages/partners";
import PaymentsPage from "@/pages/payments";
import LocationsPage from "@/pages/locations";
import DistrictsPage from "@/pages/admin/districts";
import InventoryPage from "@/pages/admin/inventory";
import WithdrawalsPage from "@/pages/admin/withdrawals";
import AuditLogsPage from "@/pages/admin/audit-logs";
import DeveloperPage from "@/pages/developer";
import SettingsPage from "@/pages/settings";
import ServiceCatalogPage from "@/pages/service-catalog";
import AssignmentQueuePage from "@/pages/assignment-queue";
import AdminLogin from "@/pages/admin-login";
import Sidebar from "@/components/admin/sidebar";
import SupportTicketsPage from "@/pages/admin/support-tickets";
import MarketingPage from "@/pages/admin/marketing";
import AdminsPage from "@/pages/admin/admins";
import ManualBillPage from "@/pages/admin/manual-bill";
import TechnicianTypesPage from "@/pages/admin/technician-types";
import CategoryExpertisePage from "@/pages/admin/category-expertise";
import FtthOperatorsPage from "@/pages/admin/ftth-operators";
import FtthOperatorDetailPage from "@/pages/admin/ftth-operator-detail";
import OperatorLayout from "@/layouts/OperatorLayout";
import { useAdminMe } from "@/lib/admin-auth";
import { getDashboardRole } from "@/lib/operator-auth";

/**
 * Route-level gate on a capability. The sidebar hides links the role can't use,
 * but someone could still type the URL — this is what stops the page rendering.
 *
 * Not access control on its own: every endpoint behind these pages is enforced
 * independently by the capability guard mounted on /api/admin, which denies
 * unmapped paths outright.
 */
function Gate({ capability, component: Component }: { capability: string; component: () => JSX.Element }) {
  const { can, isLoading } = useAdminMe();

  if (isLoading) {
    return <div className="flex-1 p-8 text-[hsl(215,20%,65%)]">Checking permissions…</div>;
  }

  if (!can(capability)) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen p-8">
        <div className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-8 max-w-md text-center">
          <span className="material-icons text-4xl text-[hsl(347,77%,60%)]" style={{ fontFamily: "Material Icons" }}>
            lock
          </span>
          <h2 className="text-xl font-bold text-white mt-3">Not available to your role</h2>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-2">
            Ask a super admin to grant your role access to this section.
          </p>
        </div>
      </div>
    );
  }

  return <Component />;
}

/**
 * Where a freshly signed-in account should start.
 *
 * Most roles get the dashboard. One that hasn't been granted it goes to the
 * first section its capabilities do allow, because landing on "not available to
 * your role" immediately after a successful login reads as a broken account
 * rather than a deliberately narrow one.
 */
const LANDING_FALLBACKS: Array<{ capability: string; href: string }> = [
  { capability: "bookings:view", href: "/services" },
  { capability: "support:view", href: "/admin/support-tickets" },
  { capability: "orders:view", href: "/orders" },
  { capability: "customers:view", href: "/users" },
  { capability: "employees:view", href: "/partners" },
  { capability: "payments:view", href: "/payments" },
  { capability: "withdrawals:view", href: "/admin/withdrawals" },
  { capability: "inventory:view", href: "/admin/inventory" },
  { capability: "catalog:view", href: "/admin/catalog" },
  { capability: "billing:view", href: "/admin/manual-bill" },
  { capability: "locations:view", href: "/locations" },
  { capability: "marketing:view", href: "/admin/marketing" },
  { capability: "ftth:view", href: "/admin/ftth-operators" },
  { capability: "accounts:view", href: "/admin/admins" },
  { capability: "audit:view", href: "/admin/audit-logs" },
  { capability: "settings:view", href: "/settings" },
];

function Landing() {
  const { can, isLoading } = useAdminMe();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading || can("dashboard:view")) return;
    const target = LANDING_FALLBACKS.find((f) => can(f.capability));
    if (target) navigate(target.href, { replace: true });
  }, [isLoading, can, navigate]);

  if (isLoading) {
    return <div className="flex-1 p-8 text-[hsl(215,20%,65%)]">Loading…</div>;
  }

  if (can("dashboard:view")) return <Dashboard />;

  // No capabilities at all — a role that exists but grants nothing yet.
  if (!LANDING_FALLBACKS.some((f) => can(f.capability))) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen p-8">
        <div className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-8 max-w-md text-center">
          <span className="material-icons text-4xl text-[hsl(38,92%,55%)]" style={{ fontFamily: "Material Icons" }}>
            hourglass_empty
          </span>
          <h2 className="text-xl font-bold text-white mt-3">No access granted yet</h2>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-2">
            Your account is active, but your role hasn't been given access to anything.
            Ask a super admin to grant it under Roles &amp; Access.
          </p>
        </div>
      </div>
    );
  }

  return <div className="flex-1 p-8 text-[hsl(215,20%,65%)]">Taking you to your work…</div>;
}

function Router() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const checkAuthentication = () => {
    const token = localStorage.getItem("adminToken");
    const adminUser = localStorage.getItem("adminUser");

    if (token && adminUser) {
      // Verify token is still valid by checking expiration
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          setIsAuthenticated(true);
          return true;
        } else {
          // Token expired, clear storage
          localStorage.removeItem("adminToken");
          localStorage.removeItem("adminUser");
          setIsAuthenticated(false);
        }
      } catch (error) {
        // Invalid token, clear storage
        localStorage.removeItem("adminToken");
        localStorage.removeItem("adminUser");
        setIsAuthenticated(false);
      }
    } else {
      setIsAuthenticated(false);
    }
    return false;
  };

  useEffect(() => {
    checkAuthentication();
    setIsLoading(false);

    // Listen for storage changes (login from other tabs)
    const handleStorageChange = () => {
      checkAuthentication();
    };

    window.addEventListener('storage', handleStorageChange);

    // Also check authentication periodically
    const interval = setInterval(checkAuthentication, 60000); // Check every minute

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Force re-check authentication when localStorage changes
  useEffect(() => {
    const handleAuthChange = () => {
      checkAuthentication();
    };

    // Custom event for when authentication changes
    window.addEventListener('authChanged', handleAuthChange);
    return () => window.removeEventListener('authChanged', handleAuthChange);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminLogin onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  // FTTH operators sign in through the same login but get an entirely separate
  // shell — their routes and the staff routes never share a <Switch>, so there
  // is no URL an operator can type that renders a staff page. The role comes
  // from the signed token, not the client-writable `adminUser` blob; either way
  // the server is the real boundary, since authenticateAdmin rejects an
  // operator token on every /api/admin/* route.
  if (getDashboardRole() === "operator") {
    return <OperatorLayout />;
  }

  return (
    <div className="min-h-screen flex bg-surface-0 noise-overlay">
      <Sidebar open={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex-1 min-w-0 overflow-y-auto h-screen">
        {/* Mobile/tablet top bar — the sidebar is a drawer below `lg` */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 border-b border-[rgba(255,255,255,0.06)] bg-[hsla(222,47%,6%,0.85)] backdrop-blur-md">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="text-[hsl(210,20%,80%)] hover:text-white p-2 -ml-2 rounded-lg hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            aria-label="Open navigation"
          >
            <span className="material-icons" style={{ fontFamily: "Material Icons" }}>menu</span>
          </button>
          <span className="font-bold tracking-tight text-white">
            Unite<span className="gradient-text">Fix</span>
          </span>
        </header>

        <Switch>
          {/* A role without dashboard access must not land on a lock screen the
              moment it signs in — send it to the first page it can actually
              use instead. */}
          <Route path="/"><Landing /></Route>
          <Route path="/dashboard"><Gate capability="dashboard:view" component={Dashboard} /></Route>
          <Route path="/users"><Gate capability="customers:view" component={UsersPage} /></Route>
          <Route path="/services"><Gate capability="bookings:view" component={ServicesPage} /></Route>
          <Route path="/orders"><Gate capability="orders:view" component={OrdersPage} /></Route>
          <Route path="/partners"><Gate capability="employees:view" component={PartnersPage} /></Route>
          <Route path="/payments"><Gate capability="payments:view" component={PaymentsPage} /></Route>
          <Route path="/locations"><Gate capability="locations:view" component={LocationsPage} /></Route>
          <Route path="/admin/districts"><Gate capability="locations:view" component={DistrictsPage} /></Route>
          <Route path="/admin/inventory"><Gate capability="inventory:view" component={InventoryPage} /></Route>
          <Route path="/admin/withdrawals"><Gate capability="withdrawals:view" component={WithdrawalsPage} /></Route>
          <Route path="/admin/audit-logs"><Gate capability="audit:view" component={AuditLogsPage} /></Route>
          <Route path="/admin/developer"><Gate capability="db_console:manage" component={DeveloperPage} /></Route>
          <Route path="/admin/admins"><Gate capability="accounts:view" component={AdminsPage} /></Route>
          <Route path="/admin/ftth-operators"><Gate capability="ftth:view" component={FtthOperatorsPage} /></Route>
          <Route path="/admin/ftth-operators/:id"><Gate capability="ftth:view" component={FtthOperatorDetailPage} /></Route>
          <Route path="/admin/manual-bill"><Gate capability="billing:view" component={ManualBillPage} /></Route>
          <Route path="/admin/technician-types"><Gate capability="catalog:view" component={TechnicianTypesPage} /></Route>
          <Route path="/admin/category-expertise"><Gate capability="catalog:view" component={CategoryExpertisePage} /></Route>
          <Route path="/admin/catalog"><Gate capability="catalog:view" component={ServiceCatalogPage} /></Route>
          <Route path="/admin/assignments"><Gate capability="bookings:view" component={AssignmentQueuePage} /></Route>
          <Route path="/admin/support-tickets"><Gate capability="support:view" component={SupportTicketsPage} /></Route>
          <Route path="/admin/marketing"><Gate capability="marketing:view" component={MarketingPage} /></Route>
          <Route path="/settings"><Gate capability="settings:view" component={SettingsPage} /></Route>
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
