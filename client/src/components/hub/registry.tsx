/**
 * Partner Hub navigation and routes — one registry.
 *
 * Each entry names the module it belongs to and the permission it needs. The
 * shell shows an entry only when the business has the module and the person
 * has the permission; `pending: true` entries are also open while an
 * application is under review. Later phases add their pages here.
 */

import type { ComponentType } from "react";
import type { HubModule, HubPermission } from "@shared/hub";

import HubHome from "@/pages/hub/home";
import HubOnboarding from "@/pages/hub/onboarding";
import HubTeam from "@/pages/hub/team";
import HubSettings from "@/pages/hub/settings";
import HubDocuments from "@/pages/hub/documents";
import OperatorPlans from "@/pages/operator/plans";
import OperatorAddons from "@/pages/operator/addons";
import OperatorCoverage from "@/pages/operator/coverage";
import OperatorCustomers from "@/pages/operator/customers";
import OperatorLeads from "@/pages/operator/leads";
import OperatorSettlements from "@/pages/operator/settlements";
import OperatorOverview from "@/pages/operator/overview";
import { HubPartsCatalogue, HubPartsOrders, HubPartsOrderDetail } from "@/pages/hub/parts";
import HubPurchases from "@/pages/hub/purchases";
import HubMoney from "@/pages/hub/money";
import HubCustomers, { HubCustomerDetail } from "@/pages/hub/customers";
import { HubInvoices, HubInvoiceNew, HubInvoiceDetail, HubQuotations, HubQuotationNew, HubQuotationDetail, HubQuotationRevise } from "@/pages/hub/sales";
import HubGstDesk from "@/pages/hub/gst";
import { HubFieldJobs, HubFieldTechnicians, HubFieldTerritory, HubFieldRates, HubFieldEarnings } from "@/pages/hub/field";
import { HubConsultServices, HubConsultCalendar, HubConsultAppointments, HubConsultRetainers } from "@/pages/hub/consulting";

export interface HubEntry {
  path: string;
  /** Older URLs that land on the same page (bookmarks from the operator portal). */
  aliases?: string[];
  component: ComponentType<any>;
  module: HubModule;
  perm?: HubPermission;
  /** Reachable while the application is under review. */
  pending?: boolean;
  nav?: { group: string; label: string; icon: string };
}

export const HUB_GROUP_ORDER = ["Home", "Broadband", "Field service", "Consulting", "Events", "Store", "Parts", "Customers", "Sales", "Purchases", "Money", "GST desk", "Business"];

export const HUB_ENTRIES: HubEntry[] = [
  { path: "/partner", aliases: ["/", "/operator"], component: HubHome, module: "home", pending: true, nav: { group: "Home", label: "Overview", icon: "dashboard" } },
  { path: "/partner/onboarding", component: HubOnboarding, module: "onboarding", pending: true, nav: { group: "Business", label: "Onboarding & KYC", icon: "verified_user" } },

  // Broadband — the operator portal's pages, moved inside the Hub.
  { path: "/partner/broadband", component: OperatorOverview, module: "broadband", perm: "ops:view", nav: { group: "Broadband", label: "Broadband overview", icon: "router" } },
  { path: "/partner/broadband/plans", aliases: ["/operator/plans"], component: OperatorPlans, module: "broadband", perm: "ops:manage", nav: { group: "Broadband", label: "Plans", icon: "speed" } },
  { path: "/partner/broadband/addons", aliases: ["/operator/addons"], component: OperatorAddons, module: "broadband", perm: "ops:manage", nav: { group: "Broadband", label: "Add-ons", icon: "add_circle" } },
  { path: "/partner/broadband/coverage", aliases: ["/operator/coverage"], component: OperatorCoverage, module: "broadband", perm: "ops:manage", nav: { group: "Broadband", label: "Coverage", icon: "map" } },
  { path: "/partner/broadband/subscribers", aliases: ["/operator/customers"], component: OperatorCustomers, module: "broadband", perm: "ops:view", nav: { group: "Broadband", label: "Subscribers", icon: "people" } },
  { path: "/partner/broadband/leads", aliases: ["/operator/leads"], component: OperatorLeads, module: "broadband", perm: "ops:view", nav: { group: "Broadband", label: "Leads", icon: "person_add" } },
  { path: "/partner/broadband/settlements", aliases: ["/operator/settlements"], component: OperatorSettlements, module: "broadband", perm: "money:view", nav: { group: "Broadband", label: "Recharge settlements", icon: "account_balance" } },

  // Phase 4 — field service in the partner's own territory.
  { path: "/partner/field/jobs", component: HubFieldJobs, module: "field", perm: "ops:view", nav: { group: "Field service", label: "Jobs", icon: "handyman" } },
  { path: "/partner/field/technicians", component: HubFieldTechnicians, module: "field", perm: "ops:view", nav: { group: "Field service", label: "Technicians", icon: "engineering" } },
  { path: "/partner/field/territory", component: HubFieldTerritory, module: "field", perm: "ops:view", nav: { group: "Field service", label: "Territory", icon: "map" } },
  { path: "/partner/field/rates", component: HubFieldRates, module: "field", perm: "ops:view", nav: { group: "Field service", label: "Rates", icon: "sell" } },
  { path: "/partner/field/earnings", component: HubFieldEarnings, module: "field", perm: "money:view", nav: { group: "Field service", label: "Earnings", icon: "payments" } },

  // Phase 5 — consulting.
  { path: "/partner/consulting/appointments", component: HubConsultAppointments, module: "consulting", perm: "ops:view", nav: { group: "Consulting", label: "Appointments", icon: "event" } },
  { path: "/partner/consulting/calendar", component: HubConsultCalendar, module: "consulting", perm: "ops:view", nav: { group: "Consulting", label: "Calendar", icon: "calendar_month" } },
  { path: "/partner/consulting/services", component: HubConsultServices, module: "consulting", perm: "ops:view", nav: { group: "Consulting", label: "Services", icon: "psychology" } },
  { path: "/partner/consulting/retainers", component: HubConsultRetainers, module: "consulting", perm: "sales:manage", nav: { group: "Consulting", label: "Retainers", icon: "autorenew" } },

  // Phase 2 — parts from UniteFix, purchases and money.
  { path: "/partner/parts", component: HubPartsCatalogue, module: "parts", perm: "purchases:manage", nav: { group: "Parts", label: "Order parts", icon: "inventory_2" } },
  { path: "/partner/parts/orders", component: HubPartsOrders, module: "parts", perm: "purchases:manage", nav: { group: "Parts", label: "Parts orders", icon: "local_shipping" } },
  { path: "/partner/parts/orders/:id", component: HubPartsOrderDetail, module: "parts", perm: "purchases:manage" },
  { path: "/partner/purchases", component: HubPurchases, module: "purchases", perm: "purchases:manage", nav: { group: "Purchases", label: "Purchases & ITC", icon: "receipt_long" } },
  { path: "/partner/money", component: HubMoney, module: "money", perm: "money:view", nav: { group: "Money", label: "Statement & settlements", icon: "account_balance_wallet" } },

  // Phase 3 — the business's own customers, sales and GST.
  { path: "/partner/customers", component: HubCustomers, module: "customers", perm: "customers:manage", nav: { group: "Customers", label: "Customers", icon: "people_alt" } },
  { path: "/partner/customers/:id", component: HubCustomerDetail, module: "customers", perm: "customers:manage" },
  { path: "/partner/sales/invoices", component: HubInvoices, module: "sales", perm: "sales:manage", nav: { group: "Sales", label: "Invoices", icon: "receipt" } },
  { path: "/partner/sales/invoices/new", component: HubInvoiceNew, module: "sales", perm: "sales:manage" },
  { path: "/partner/sales/invoices/:id", component: HubInvoiceDetail, module: "sales", perm: "sales:manage" },
  { path: "/partner/sales/quotations", component: HubQuotations, module: "sales", perm: "sales:manage", nav: { group: "Sales", label: "Quotations", icon: "request_quote" } },
  { path: "/partner/sales/quotations/new", component: HubQuotationNew, module: "sales", perm: "sales:manage" },
  { path: "/partner/sales/quotations/:id/edit", component: HubQuotationRevise, module: "sales", perm: "sales:manage" },
  { path: "/partner/sales/quotations/:id", component: HubQuotationDetail, module: "sales", perm: "sales:manage" },
  { path: "/partner/gst", component: HubGstDesk, module: "gst", perm: "gst:manage", nav: { group: "GST desk", label: "Returns & registers", icon: "gavel" } },

  { path: "/partner/team", component: HubTeam, module: "team", nav: { group: "Business", label: "Team", icon: "group" } },
  { path: "/partner/documents", component: HubDocuments, module: "docs", pending: true, nav: { group: "Business", label: "Documents", icon: "folder" } },
  { path: "/partner/settings", component: HubSettings, module: "home", pending: true, nav: { group: "Business", label: "Business profile", icon: "store" } },
];
