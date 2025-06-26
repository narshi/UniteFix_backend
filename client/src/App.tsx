import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import UsersPage from "@/pages/users";
import ServicesPage from "@/pages/services";
import OrdersPage from "@/pages/orders";
import PartnersPage from "@/pages/partners";
import PaymentsPage from "@/pages/payments";
import LocationsPage from "@/pages/locations";
import Sidebar from "@/components/admin/sidebar";

function Router() {
  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar />
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/users" component={UsersPage} />
        <Route path="/services" component={ServicesPage} />
        <Route path="/orders" component={OrdersPage} />
        <Route path="/partners" component={PartnersPage} />
        <Route path="/payments" component={PaymentsPage} />
        <Route path="/locations" component={LocationsPage} />
        <Route component={NotFound} />
      </Switch>
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
