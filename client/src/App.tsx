import { Switch, Route } from "wouter";
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
import DeveloperPage from "@/pages/developer";
import SettingsPage from "@/pages/settings";
import AdminLogin from "@/pages/admin-login";
import Sidebar from "@/components/admin/sidebar";

function Router() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

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
        <Route path="/districts" component={DistrictsPage} />
        <Route path="/developer" component={DeveloperPage} />
        <Route path="/settings" component={SettingsPage} />
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
