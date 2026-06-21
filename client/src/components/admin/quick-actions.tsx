import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function QuickActions() {
  const [pinCode, setPinCode] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [generatedCode, setGeneratedCode] = useState("8437");
  const { toast } = useToast();
  const [location, setLocation] = useLocation();

  const validatePinMutation = useMutation({
    mutationFn: async (pinCode: string) => {
      const response = await apiRequest("POST", "/api/validate-pincode", { pinCode });
      return response;
    },
    onSuccess: (data) => {
      toast({
        title: data.valid ? "Valid Pin Code" : "Invalid Pin Code",
        description: data.message,
        variant: data.valid ? "default" : "destructive",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to validate pin code",
        variant: "destructive",
      });
    },
  });

  const generateOtpMutation = useMutation({
    mutationFn: async (phone: string) => {
      const response = await apiRequest("POST", "/api/otp/send", { phone, purpose: "test" });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "OTP Sent",
        description: `Test OTP sent to ${phoneNumber}`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send OTP",
        variant: "destructive",
      });
    },
  });

  const generateCodeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/utils/generate-code");
      return response;
    },
    onSuccess: (data) => {
      setGeneratedCode(data.code);
      toast({
        title: "New Code Generated",
        description: `New verification code: ${data.code}`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate code",
        variant: "destructive",
      });
    },
  });

  const handleValidatePinCode = () => {
    if (!pinCode.trim()) {
      toast({
        title: "Error",
        description: "Please enter a pin code",
        variant: "destructive",
      });
      return;
    }
    validatePinMutation.mutate(pinCode);
  };

  const handleGenerateOTP = () => {
    if (!phoneNumber.trim()) {
      toast({
        title: "Error",
        description: "Please enter a phone number",
        variant: "destructive",
      });
      return;
    }
    generateOtpMutation.mutate(phoneNumber);
  };

  const handleGenerateCode = () => {
    generateCodeMutation.mutate();
  };

  const handleExportReport = async () => {
    try {
      // Fetch all necessary data for the report
      const [statsResponse, servicesResponse, ordersResponse, usersResponse] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/services/recent"),
        fetch("/api/admin/orders/recent"),
        fetch("/api/admin/users")
      ]);

      const stats = await statsResponse.json();
      const services = await servicesResponse.json();
      const orders = await ordersResponse.json();
      const users = await usersResponse.json();

      // Create CSV content
      const csvContent = [
        // Header
        ["UniteFix Admin Report", new Date().toLocaleDateString()],
        [],
        ["Summary Statistics"],
        ["Total Users", stats.totalUsers],
        ["Active Services", stats.activeServices],
        ["Product Orders", stats.productOrders],
        ["Total Revenue", `₹${stats.revenue}`],
        [],
        ["Recent Services"],
        ["Service ID", "Type", "Status", "Customer", "Created"],
        ...services.map((service: any) => [
          service.serviceId || "N/A",
          service.serviceType,
          service.status || "Pending",
          service.user?.username || "Unknown",
          new Date(service.createdAt).toLocaleDateString()
        ]),
        [],
        ["Recent Orders"],
        ["Order ID", "Amount", "Status", "Customer", "Created"],
        ...orders.map((order: any) => [
          order.orderId || "N/A",
          `₹${order.totalAmount}`,
          order.status || "Pending",
          order.user?.username || "Unknown",
          new Date(order.createdAt).toLocaleDateString()
        ])
      ];

      // Convert to CSV string
      const csv = csvContent.map(row =>
        row.map((cell: any) => `"${cell}"`).join(",")
      ).join("\n");

      // Create and download file
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `unitefix-report-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Report Exported",
        description: "Excel report has been downloaded successfully",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export report. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="glass-card stagger-enter">
      <div className="p-6 border-b border-[rgba(255,255,255,0.06)]">
        <h3 className="text-lg font-semibold text-white tracking-tight">Quick Actions</h3>
      </div>
      <div className="p-6">
        <div className="space-y-4">

          {/* Location Validator */}
          <div className="border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] rounded-lg p-4 transition-colors hover:bg-[rgba(255,255,255,0.04)]">
            <h4 className="font-medium text-[hsl(210,20%,85%)] mb-3">Location Validator</h4>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Enter Pin Code"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-[hsl(210,20%,92%)] placeholder:text-[hsl(215,20%,40%)] focus:outline-none focus:ring-2 focus:ring-[hsla(217,91%,60%,0.25)] focus:border-[hsl(217,91%,60%)] transition-all"
              />
              <button
                onClick={handleValidatePinCode}
                disabled={validatePinMutation.isPending}
                className="w-full bg-[hsl(217,91%,60%)] text-white py-2 rounded-lg text-sm font-medium hover:bg-[hsl(217,91%,55%)] shadow-lg shadow-[hsla(217,91%,60%,0.2)] disabled:opacity-40 transition-all active:scale-[0.97]"
              >
                {validatePinMutation.isPending ? "Validating..." : "Validate Location"}
              </button>
            </div>
          </div>

          {/* OTP Simulator */}
          <div className="border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] rounded-lg p-4 transition-colors hover:bg-[rgba(255,255,255,0.04)]">
            <h4 className="font-medium text-[hsl(210,20%,85%)] mb-3">OTP Simulator</h4>
            <div className="space-y-3">
              <input
                type="tel"
                placeholder="Phone Number"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-[hsl(210,20%,92%)] placeholder:text-[hsl(215,20%,40%)] focus:outline-none focus:ring-2 focus:ring-[hsla(38,92%,50%,0.25)] focus:border-[hsl(38,92%,50%)] transition-all"
              />
              <button
                onClick={handleGenerateOTP}
                disabled={generateOtpMutation.isPending}
                className="w-full bg-[hsl(38,92%,50%)] text-white py-2 rounded-lg text-sm font-medium hover:bg-[hsl(38,92%,45%)] shadow-lg shadow-[hsla(38,92%,50%,0.2)] disabled:opacity-40 transition-all active:scale-[0.97]"
              >
                {generateOtpMutation.isPending ? "Sending..." : "Generate Test OTP"}
              </button>
            </div>
          </div>

          {/* Service Code Generator */}
          <div className="border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] rounded-lg p-4 transition-colors hover:bg-[rgba(255,255,255,0.04)]">
            <h4 className="font-medium text-[hsl(210,20%,85%)] mb-3">Service Code</h4>
            <div className="space-y-3">
              <div className="text-center py-2 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.04)]">
                <p className="text-2xl font-bold text-[hsl(160,84%,60%)] tracking-wider">{generatedCode}</p>
                <p className="text-xs text-[hsl(215,20%,55%)] mt-1">Current verification code</p>
              </div>
              <button
                onClick={handleGenerateCode}
                disabled={generateCodeMutation.isPending}
                className="w-full bg-[hsl(160,84%,39%)] text-white py-2 rounded-lg text-sm font-medium hover:bg-[hsl(160,84%,34%)] shadow-lg shadow-[hsla(160,84%,39%,0.2)] disabled:opacity-40 transition-all active:scale-[0.97]"
              >
                {generateCodeMutation.isPending ? "Generating..." : "Generate New Code"}
              </button>
            </div>
          </div>



        </div>
      </div>
    </div>
  );
}
