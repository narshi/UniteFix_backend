import { Switch, Route } from "wouter";
import { useState } from "react";
import OperatorSidebar from "@/components/operator/sidebar";
import OperatorOverview from "@/pages/operator/overview";
import OperatorPlans from "@/pages/operator/plans";
import OperatorCoverage from "@/pages/operator/coverage";
import OperatorCustomers from "@/pages/operator/customers";
import OperatorLeads from "@/pages/operator/leads";
import OperatorSettlements from "@/pages/operator/settlements";
import NotFound from "@/pages/not-found";
import { useOperatorMe } from "@/lib/operator-auth";

/**
 * The FTTH operator shell.
 *
 * A separate top-level layout rather than a filtered admin shell: the operator
 * routes and the staff routes never appear in the same <Switch>, so there is no
 * URL an operator can type that renders a staff page. The server enforces this
 * independently — `authenticateAdmin` rejects an operator token on every
 * /api/admin/* route — and this shell is the UX half of the same rule.
 */
export default function OperatorLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { suspended } = useOperatorMe();

  // A paused or disabled operator has valid credentials, so signing them out
  // would show a login screen and imply their password is wrong. Tell them what
  // actually happened instead.
  if (suspended) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0 noise-overlay p-8">
        <div className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-8 max-w-md text-center">
          <span className="material-icons text-4xl text-[hsl(38,92%,55%)]" style={{ fontFamily: "Material Icons" }}>
            pause_circle
          </span>
          <h2 className="text-xl font-bold text-white mt-3">Account paused</h2>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-2">
            Your operator account is currently inactive. Please contact UniteFix to restore access.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem("adminToken");
              localStorage.removeItem("adminUser");
              window.location.reload();
            }}
            className="mt-5 text-sm text-[hsl(210,20%,75%)] hover:text-white underline underline-offset-4"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-surface-0 noise-overlay">
      <OperatorSidebar open={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex-1 min-w-0 overflow-y-auto h-screen">
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
          <Route path="/" component={OperatorOverview} />
          <Route path="/operator" component={OperatorOverview} />
          <Route path="/operator/plans" component={OperatorPlans} />
          <Route path="/operator/coverage" component={OperatorCoverage} />
          <Route path="/operator/customers" component={OperatorCustomers} />
          <Route path="/operator/leads" component={OperatorLeads} />
          <Route path="/operator/settlements" component={OperatorSettlements} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}
