import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function QuickActions() {
  const [pinCode, setPinCode] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [generatedCode, setGeneratedCode] = useState("8437");
  const { toast } = useToast();

  const validatePinMutation = useMutation({
    mutationFn: async (pinCode: string) => {
      const response = await apiRequest("POST", "/api/validate-pincode", { pinCode });
      return response.json();
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
      const response = await apiRequest("POST", "/api/otp/send", { 
        phone, 
        purpose: "test" 
      });
      return response.json();
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
      return response.json();
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

  const handleGenerateInvoice = () => {
    toast({
      title: "Invoice Generated",
      description: "Invoice generated with CGST/SGST calculations",
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      <div className="p-6 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
      </div>
      <div className="p-6">
        <div className="space-y-4">
          
          {/* Location Validator */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Location Validator</h4>
            <div className="space-y-3">
              <input 
                type="text" 
                placeholder="Enter Pin Code" 
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button 
                onClick={handleValidatePinCode}
                disabled={validatePinMutation.isPending}
                className="w-full bg-blue-600 text-white py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {validatePinMutation.isPending ? "Validating..." : "Validate Location"}
              </button>
            </div>
          </div>

          {/* OTP Simulator */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">OTP Simulator</h4>
            <div className="space-y-3">
              <input 
                type="tel" 
                placeholder="Phone Number" 
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button 
                onClick={handleGenerateOTP}
                disabled={generateOtpMutation.isPending}
                className="w-full bg-orange-600 text-white py-2 rounded text-sm hover:bg-orange-700 disabled:opacity-50 transition-colors"
              >
                {generateOtpMutation.isPending ? "Sending..." : "Generate Test OTP"}
              </button>
            </div>
          </div>

          {/* Service Code Generator */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Service Code</h4>
            <div className="space-y-3">
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{generatedCode}</p>
                <p className="text-xs text-gray-500">Current verification code</p>
              </div>
              <button 
                onClick={handleGenerateCode}
                disabled={generateCodeMutation.isPending}
                className="w-full bg-green-600 text-white py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {generateCodeMutation.isPending ? "Generating..." : "Generate New Code"}
              </button>
            </div>
          </div>

          {/* Invoice Generator */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Invoice Generator</h4>
            <div className="space-y-3">
              <select className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500">
                <option>Select Completed Service</option>
                <option>SR001234 - AC Repair</option>
                <option>SR001235 - Washing Machine</option>
              </select>
              <button 
                onClick={handleGenerateInvoice}
                className="w-full bg-gray-700 text-white py-2 rounded text-sm hover:bg-gray-800 transition-colors"
              >
                Generate Invoice
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
