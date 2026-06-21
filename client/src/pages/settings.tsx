import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    // System Settings — loaded from DB
    systemName: "UniteFix App",
    defaultBookingFee: 99,
    platformFeePercent: 15,
    gstPercentage: 18,
    cancellationFee: 150,
    maxAssignmentDays: 7,
    reassignmentDays: 2,
    walletHoldDays: 7,
    minWalletRedemption: 500,
    maxServiceStartDistance: 200,
    partnerAcceptTimeoutHours: 4,
    
    // Location Settings
    serviceRegion: "Uttara Kannada",
    allowedPinCodePrefix: "581",
    
    // Service Settings
    enableOTPVerification: true,
    enableEmailNotifications: true,
    enableSMSNotifications: false,
    autoAssignPartners: false,
    
    // Payment Settings
    paymentGateway: "razorpay",
    
    // Business Rules
    allowCancellationDays: 1,
    partnerVerificationRequired: true,
    customerSupportEmail: "support@unitefix.com",
    customerSupportPhone: "+91-9876543210",
    
    // Invoice Settings
    companyName: "UniteFix Solutions Pvt Ltd",
    companyAddress: "Sirsi, Uttara Kannada, Karnataka - 581301",
    gstNumber: "29ABCDE1234F1Z5",
    
    // Notification Templates
    welcomeMessage: "Welcome to UniteFix! Your service request has been received.",
    completionMessage: "Your service has been completed. Thank you for choosing UniteFix!",
    
    // Maintenance Mode
    maintenanceMode: false,
    maintenanceMessage: "We are currently under maintenance. Please try again later."
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // CONFIG KEY → STATE FIELD MAPPING (only DB-backed fields)
  const CONFIG_MAP: Record<string, { field: string; parse: (v: string) => any }> = {
    'BUSINESS_CONFIG.BASE_SERVICE_FEE': { field: 'defaultBookingFee', parse: Number },
    'BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT': { field: 'platformFeePercent', parse: Number },
    'BUSINESS_CONFIG.GST_PERCENTAGE': { field: 'gstPercentage', parse: Number },
    'BUSINESS_CONFIG.CANCELLATION_FEE': { field: 'cancellationFee', parse: Number },
    'BUSINESS_CONFIG.WALLET_HOLD_DAYS': { field: 'walletHoldDays', parse: Number },
    'BUSINESS_CONFIG.MIN_WALLET_REDEMPTION': { field: 'minWalletRedemption', parse: Number },
    'OPERATIONAL_CONFIG.MAX_SERVICE_START_DISTANCE': { field: 'maxServiceStartDistance', parse: Number },
    'OPERATIONAL_CONFIG.PARTNER_ACCEPT_TIMEOUT_HOURS': { field: 'partnerAcceptTimeoutHours', parse: Number },
    'OPERATIONAL_CONFIG.ENABLE_AUTO_ASSIGNMENT': { field: 'autoAssignPartners', parse: (v) => v === 'true' },
  };

  // Reverse map: state field → config key
  const FIELD_TO_KEY: Record<string, string> = {};
  for (const [key, { field }] of Object.entries(CONFIG_MAP)) {
    FIELD_TO_KEY[field] = key;
  }

  // Load config from API on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await apiRequest("GET", "/api/admin/config");
        const configs = result?.data || result || [];
        
        const updates: any = {};
        for (const cfg of configs) {
          const mapping = CONFIG_MAP[cfg.key];
          if (mapping) {
            updates[mapping.field] = mapping.parse(cfg.value);
          }
        }
        
        if (Object.keys(updates).length > 0) {
          setSettings(prev => ({ ...prev, ...updates }));
        }
      } catch (err) {
        console.warn('Failed to load config from API, using defaults');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save all DB-backed fields
      const promises: { key: string; promise: Promise<any> }[] = [];
      for (const [field, configKey] of Object.entries(FIELD_TO_KEY)) {
        const value = String((settings as any)[field]);
        promises.push({
          key: configKey,
          promise: apiRequest("PATCH", `/api/admin/config/${encodeURIComponent(configKey)}`, { value })
        });
      }
      
      const results = await Promise.allSettled(promises.map(p => p.promise));
      const failed = results.filter(r => r.status === 'rejected');
      
      if (failed.length === 0) {
        toast({
          title: "Settings Saved",
          description: "All configuration values have been updated successfully."
        });
      } else if (failed.length < promises.length) {
        toast({
          title: "Partially Saved",
          description: `Saved ${promises.length - failed.length} settings. Failed to save ${failed.length} settings (e.g., read-only fields).`,
        });
      } else {
        throw new Error("Failed to save all settings");
      }
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings(prev => ({
      ...prev,
      defaultBookingFee: 99,
      platformFeePercent: 15,
      gstPercentage: 18,
      cancellationFee: 150,
      maxAssignmentDays: 7,
      reassignmentDays: 2,
    }));
    toast({
      title: "Settings Reset",
      description: "Settings have been reset to default values. Click Save to persist."
    });
  };

  return (
    <div className="flex-1 p-8 min-h-screen relative overflow-hidden bg-transparent">
      <div className="mb-8 relative z-10 stagger-enter">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] mb-2">Settings</h2>
        <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide">Configure system settings and business rules</p>
      </div>

      <div className="space-y-6 relative z-10 stagger-enter pb-24">
        {/* System Configuration */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">System Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {loading ? (
              <div className="animate-pulse space-y-3 skeleton-shimmer">
                <div className="h-4 bg-[rgba(255,255,255,0.05)] rounded w-1/4"></div>
                <div className="h-10 bg-[rgba(255,255,255,0.03)] rounded"></div>
                <div className="h-4 bg-[rgba(255,255,255,0.05)] rounded w-1/4"></div>
                <div className="h-10 bg-[rgba(255,255,255,0.03)] rounded"></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="systemName" className="text-[hsl(215,20%,75%)]">System Name</Label>
                  <Input
                    id="systemName"
                    value={settings.systemName}
                    onChange={(e) => setSettings(prev => ({ ...prev, systemName: e.target.value }))}
                    className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                </div>
                <div>
                  <Label htmlFor="defaultBookingFee" className="text-[hsl(215,20%,75%)]">Booking Fee (₹)</Label>
                  <Input
                    id="defaultBookingFee"
                    type="number"
                    value={settings.defaultBookingFee}
                    onChange={(e) => setSettings(prev => ({ ...prev, defaultBookingFee: parseInt(e.target.value) || 0 }))}
                    className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                  <p className="text-xs text-[hsl(215,20%,55%)] mt-1">Config: BASE_SERVICE_FEE</p>
                </div>
                <div>
                  <Label htmlFor="platformFeePercent" className="text-[hsl(215,20%,75%)]">Platform Fee (%)</Label>
                  <Input
                    id="platformFeePercent"
                    type="number"
                    value={settings.platformFeePercent}
                    onChange={(e) => setSettings(prev => ({ ...prev, platformFeePercent: parseInt(e.target.value) || 0 }))}
                    className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                  <p className="text-xs text-[hsl(215,20%,55%)] mt-1">Config: UNITEFIX_FEE_PERCENT</p>
                </div>
                <div>
                  <Label htmlFor="gstPercentage" className="text-[hsl(215,20%,75%)]">GST Rate (%)</Label>
                  <Input
                    id="gstPercentage"
                    type="number"
                    value={settings.gstPercentage}
                    onChange={(e) => setSettings(prev => ({ ...prev, gstPercentage: parseInt(e.target.value) || 0 }))}
                    className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                  <p className="text-xs text-[hsl(215,20%,55%)] mt-1">CGST + SGST combined</p>
                </div>
                <div>
                  <Label htmlFor="cancellationFee" className="text-[hsl(215,20%,75%)]">Cancellation Fee (₹)</Label>
                  <Input
                    id="cancellationFee"
                    type="number"
                    value={settings.cancellationFee}
                    onChange={(e) => setSettings(prev => ({ ...prev, cancellationFee: parseInt(e.target.value) || 0 }))}
                    className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                </div>
                <div>
                  <Label htmlFor="maxServiceStartDistance" className="text-[hsl(215,20%,75%)]">Max Service Start Distance (m)</Label>
                  <Input
                    id="maxServiceStartDistance"
                    type="number"
                    value={settings.maxServiceStartDistance}
                    onChange={(e) => setSettings(prev => ({ ...prev, maxServiceStartDistance: parseInt(e.target.value) || 0 }))}
                    className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Location Settings */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Location Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="serviceRegion" className="text-[hsl(215,20%,75%)]">Service Region</Label>
                <Input
                  id="serviceRegion"
                  value={settings.serviceRegion}
                  onChange={(e) => setSettings(prev => ({ ...prev, serviceRegion: e.target.value }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
              </div>
              <div>
                <Label htmlFor="allowedPinCodePrefix" className="text-[hsl(215,20%,75%)]">Allowed Pin Code Prefix</Label>
                <Input
                  id="allowedPinCodePrefix"
                  value={settings.allowedPinCodePrefix}
                  onChange={(e) => setSettings(prev => ({ ...prev, allowedPinCodePrefix: e.target.value }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Service Settings */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Service Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <div>
                  <Label htmlFor="enableOTPVerification" className="text-[hsl(215,20%,90%)]">OTP Verification</Label>
                  <p className="text-sm text-[hsl(215,20%,60%)] mt-0.5">Require OTP verification for service start</p>
                </div>
                <Switch
                  id="enableOTPVerification"
                  checked={settings.enableOTPVerification}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableOTPVerification: checked }))}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <div>
                  <Label htmlFor="enableEmailNotifications" className="text-[hsl(215,20%,90%)]">Email Notifications</Label>
                  <p className="text-sm text-[hsl(215,20%,60%)] mt-0.5">Send email notifications to users</p>
                </div>
                <Switch
                  id="enableEmailNotifications"
                  checked={settings.enableEmailNotifications}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableEmailNotifications: checked }))}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <div>
                  <Label htmlFor="enableSMSNotifications" className="text-[hsl(215,20%,90%)]">SMS Notifications</Label>
                  <p className="text-sm text-[hsl(215,20%,60%)] mt-0.5">Send SMS notifications to users</p>
                </div>
                <Switch
                  id="enableSMSNotifications"
                  checked={settings.enableSMSNotifications}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableSMSNotifications: checked }))}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <div>
                  <Label htmlFor="autoAssignPartners" className="text-[hsl(215,20%,90%)]">Auto Assign Employees</Label>
                  <p className="text-sm text-[hsl(215,20%,60%)] mt-0.5">Automatically assign available employees</p>
                </div>
                <Switch
                  id="autoAssignPartners"
                  checked={settings.autoAssignPartners}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, autoAssignPartners: checked }))}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <div>
                  <Label htmlFor="partnerVerificationRequired" className="text-[hsl(215,20%,90%)]">Employee Verification Required</Label>
                  <p className="text-sm text-[hsl(215,20%,60%)] mt-0.5">Require employee verification before assignment</p>
                </div>
                <Switch
                  id="partnerVerificationRequired"
                  checked={settings.partnerVerificationRequired}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, partnerVerificationRequired: checked }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Settings */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Payment Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="paymentGateway" className="text-[hsl(215,20%,75%)]">Payment Gateway</Label>
                <Select
                  value={settings.paymentGateway}
                  onValueChange={(value) => setSettings(prev => ({ ...prev, paymentGateway: value }))}
                >
                  <SelectTrigger className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:ring-[hsla(217,91%,60%,0.3)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="razorpay">Razorpay</SelectItem>
                    <SelectItem value="stripe">Stripe</SelectItem>
                    <SelectItem value="paytm">Paytm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="walletHoldDays" className="text-[hsl(215,20%,75%)]">Wallet Hold Days</Label>
                <Input
                  id="walletHoldDays"
                  type="number"
                  value={settings.walletHoldDays}
                  onChange={(e) => setSettings(prev => ({ ...prev, walletHoldDays: parseInt(e.target.value) || 0 }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
                <p className="text-xs text-[hsl(215,20%,55%)] mt-1">Days before partner earnings release</p>
              </div>
              <div>
                <Label htmlFor="minWalletRedemption" className="text-[hsl(215,20%,75%)]">Min Wallet Redemption (₹)</Label>
                <Input
                  id="minWalletRedemption"
                  type="number"
                  value={settings.minWalletRedemption}
                  onChange={(e) => setSettings(prev => ({ ...prev, minWalletRedemption: parseInt(e.target.value) || 0 }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Company Information */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Company Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <Label htmlFor="companyName" className="text-[hsl(215,20%,75%)]">Company Name</Label>
              <Input
                id="companyName"
                value={settings.companyName}
                onChange={(e) => setSettings(prev => ({ ...prev, companyName: e.target.value }))}
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
              />
            </div>
            <div>
              <Label htmlFor="companyAddress" className="text-[hsl(215,20%,75%)]">Company Address</Label>
              <Textarea
                id="companyAddress"
                value={settings.companyAddress}
                onChange={(e) => setSettings(prev => ({ ...prev, companyAddress: e.target.value }))}
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all min-h-[80px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="gstNumber" className="text-[hsl(215,20%,75%)]">GST Number</Label>
                <Input
                  id="gstNumber"
                  value={settings.gstNumber}
                  onChange={(e) => setSettings(prev => ({ ...prev, gstNumber: e.target.value }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
              </div>
              <div>
                <Label htmlFor="allowCancellationDays" className="text-[hsl(215,20%,75%)]">Allow Cancellation (Days)</Label>
                <Input
                  id="allowCancellationDays"
                  type="number"
                  value={settings.allowCancellationDays}
                  onChange={(e) => setSettings(prev => ({ ...prev, allowCancellationDays: parseInt(e.target.value) }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Customer Support</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="customerSupportEmail" className="text-[hsl(215,20%,75%)]">Support Email</Label>
                <Input
                  id="customerSupportEmail"
                  type="email"
                  value={settings.customerSupportEmail}
                  onChange={(e) => setSettings(prev => ({ ...prev, customerSupportEmail: e.target.value }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
              </div>
              <div>
                <Label htmlFor="customerSupportPhone" className="text-[hsl(215,20%,75%)]">Support Phone</Label>
                <Input
                  id="customerSupportPhone"
                  value={settings.customerSupportPhone}
                  onChange={(e) => setSettings(prev => ({ ...prev, customerSupportPhone: e.target.value }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notification Templates */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Notification Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <Label htmlFor="welcomeMessage" className="text-[hsl(215,20%,75%)]">Welcome Message</Label>
              <Textarea
                id="welcomeMessage"
                value={settings.welcomeMessage}
                onChange={(e) => setSettings(prev => ({ ...prev, welcomeMessage: e.target.value }))}
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all min-h-[80px]"
              />
            </div>
            <div>
              <Label htmlFor="completionMessage" className="text-[hsl(215,20%,75%)]">Service Completion Message</Label>
              <Textarea
                id="completionMessage"
                value={settings.completionMessage}
                onChange={(e) => setSettings(prev => ({ ...prev, completionMessage: e.target.value }))}
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all min-h-[80px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Maintenance Mode */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)]">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-[hsl(38,92%,60%)]">Maintenance Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-between p-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
              <div>
                <Label htmlFor="maintenanceMode" className="text-[hsl(215,20%,90%)]">Enable Maintenance Mode</Label>
                <p className="text-sm text-[hsl(215,20%,60%)] mt-0.5">Put the system in maintenance mode</p>
              </div>
              <Switch
                id="maintenanceMode"
                checked={settings.maintenanceMode}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, maintenanceMode: checked }))}
              />
            </div>
            {settings.maintenanceMode && (
              <div>
                <Label htmlFor="maintenanceMessage" className="text-[hsl(215,20%,75%)]">Maintenance Message</Label>
                <Textarea
                  id="maintenanceMessage"
                  value={settings.maintenanceMessage}
                  onChange={(e) => setSettings(prev => ({ ...prev, maintenanceMessage: e.target.value }))}
                  className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all min-h-[80px]"
                />
              </div>
            )}
            {settings.maintenanceMode && (
              <div className="p-4 bg-[hsla(38,92%,50%,0.1)] border border-[hsla(38,92%,50%,0.3)] rounded-lg">
                <div className="flex items-center space-x-2">
                  <Badge className="bg-[hsl(347,77%,50%)] hover:bg-[hsl(347,77%,45%)] text-white border-0">MAINTENANCE MODE ACTIVE</Badge>
                </div>
                <p className="text-sm text-[hsl(38,92%,70%)] mt-2 font-medium">
                  The system is currently in maintenance mode. Users will see the maintenance message.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4 pt-4 mb-16">
          <Button variant="outline" onClick={handleReset} disabled={saving} className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]">
            Reset to Defaults
          </Button>
          <Button onClick={handleSave} disabled={saving || loading} className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95">
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}