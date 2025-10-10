import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const navigation = [
  { name: "Dashboard", href: "/", icon: "dashboard", current: true },
  { name: "User Management", href: "/users", icon: "people" },
  { name: "Service Requests", href: "/services", icon: "build" },
  { name: "Product Orders", href: "/orders", icon: "shopping_cart" },
  { name: "Service Partners", href: "/partners", icon: "handyman" },
  { name: "Payments & Invoices", href: "/payments", icon: "payment" },
  { name: "Location Management", href: "/locations", icon: "location_on" },
  { name: "Developer Details", href: "/developer", icon: "code" },
  { name: "Settings", href: "/settings", icon: "settings" },
];

export default function Sidebar() {
  const [location] = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
    window.location.reload();
  };

  const adminUser = JSON.parse(localStorage.getItem("adminUser") || "{}");

  return (
    <aside className="w-64 bg-white shadow-lg flex flex-col h-screen">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 7.172V5L8 4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">UniteFix</h1>
            <p className="text-sm text-gray-500">Admin Dashboard</p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-600 font-medium"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="material-icons text-lg" style={{ fontFamily: 'Material Icons' }}>{item.icon}</span>
                  <span>{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center space-x-3 mb-3">
          <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
            <span className="material-icons text-sm text-gray-600" style={{ fontFamily: 'Material Icons' }}>account_circle</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {adminUser.username || 'Admin'}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {adminUser.email || 'admin@unitefix.com'}
            </p>
          </div>
        </div>
        <Button
          onClick={handleLogout}
          variant="outline"
          size="sm"
          className="w-full"
        >
          <span className="material-icons text-sm mr-2" style={{ fontFamily: 'Material Icons' }}>logout</span>
          Logout
        </Button>
      </div>
    </aside>
  );
}
