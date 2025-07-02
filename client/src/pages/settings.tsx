import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    // System Settings
    systemName: "UniteFix App",
    defaultBookingFee: 250,
    maxAssignmentDays: 7,
    reassignmentDays: 2,
    
    // Location Settings
    serviceRegion: "Uttara Kannada",
    allowedPinCodePrefix: "581",
    
    // Service Settings
    enableOTPVerification: true,
    enableEmailNotifications: true,
    enableSMSNotifications: false,
    autoAssignPartners: true,
    
    // Payment Settings
    paymentGateway: "razorpay",
    cgstRate: 9,
    sgstRate: 9,
    
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

  const { toast } = useToast();

  const handleSave = () => {
    // In a real app, save to database/API
    toast({
      title: "Settings Saved",
      description: "All settings have been updated successfully."
    });
  };

  const handleReset = () => {
    setSettings(prev => ({
      ...prev,
      // Reset to defaults
      defaultBookingFee: 250,
      maxAssignmentDays: 7,
      reassignmentDays: 2,
    }));
    toast({
      title: "Settings Reset",
      description: "Settings have been reset to default values."
    });
  };

  return (
    <div className="flex-1 p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Settings</h2>
        <p className="text-gray-600">Configure system settings and business rules</p>
      </div>

      <div className="space-y-6">
        {/* System Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>System Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="systemName">System Name</Label>
                <Input
                  id="systemName"
                  value={settings.systemName}
                  onChange={(e) => setSettings(prev => ({ ...prev, systemName: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="defaultBookingFee">Default Booking Fee (₹)</Label>
                <Input
                  id="defaultBookingFee"
                  type="number"
                  value={settings.defaultBookingFee}
                  onChange={(e) => setSettings(prev => ({ ...prev, defaultBookingFee: parseInt(e.target.value) }))}
                />
              </div>
              <div>
                <Label htmlFor="maxAssignmentDays">Max Assignment Days</Label>
                <Input
                  id="maxAssignmentDays"
                  type="number"
                  value={settings.maxAssignmentDays}
                  onChange={(e) => setSettings(prev => ({ ...prev, maxAssignmentDays: parseInt(e.target.value) }))}
                />
              </div>
              <div>
                <Label htmlFor="reassignmentDays">Reassignment Days</Label>
                <Input
                  id="reassignmentDays"
                  type="number"
                  value={settings.reassignmentDays}
                  onChange={(e) => setSettings(prev => ({ ...prev, reassignmentDays: parseInt(e.target.value) }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Location Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Location Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="serviceRegion">Service Region</Label>
                <Input
                  id="serviceRegion"
                  value={settings.serviceRegion}
                  onChange={(e) => setSettings(prev => ({ ...prev, serviceRegion: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="allowedPinCodePrefix">Allowed Pin Code Prefix</Label>
                <Input
                  id="allowedPinCodePrefix"
                  value={settings.allowedPinCodePrefix}
                  onChange={(e) => setSettings(prev => ({ ...prev, allowedPinCodePrefix: e.target.value }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Service Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Service Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enableOTPVerification">OTP Verification</Label>
                  <p className="text-sm text-gray-600">Require OTP verification for service start</p>
                </div>
                <Switch
                  id="enableOTPVerification"
                  checked={settings.enableOTPVerification}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableOTPVerification: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enableEmailNotifications">Email Notifications</Label>
                  <p className="text-sm text-gray-600">Send email notifications to users</p>
                </div>
                <Switch
                  id="enableEmailNotifications"
                  checked={settings.enableEmailNotifications}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableEmailNotifications: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enableSMSNotifications">SMS Notifications</Label>
                  <p className="text-sm text-gray-600">Send SMS notifications to users</p>
                </div>
                <Switch
                  id="enableSMSNotifications"
                  checked={settings.enableSMSNotifications}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableSMSNotifications: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="autoAssignPartners">Auto Assign Partners</Label>
                  <p className="text-sm text-gray-600">Automatically assign available partners</p>
                </div>
                <Switch
                  id="autoAssignPartners"
                  checked={settings.autoAssignPartners}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, autoAssignPartners: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="partnerVerificationRequired">Partner Verification Required</Label>
                  <p className="text-sm text-gray-600">Require partner verification before assignment</p>
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
        <Card>
          <CardHeader>
            <CardTitle>Payment Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="paymentGateway">Payment Gateway</Label>
                <Select
                  value={settings.paymentGateway}
                  onValueChange={(value) => setSettings(prev => ({ ...prev, paymentGateway: value }))}
                >
                  <SelectTrigger>
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
                <Label htmlFor="cgstRate">CGST Rate (%)</Label>
                <Input
                  id="cgstRate"
                  type="number"
                  value={settings.cgstRate}
                  onChange={(e) => setSettings(prev => ({ ...prev, cgstRate: parseInt(e.target.value) }))}
                />
              </div>
              <div>
                <Label htmlFor="sgstRate">SGST Rate (%)</Label>
                <Input
                  id="sgstRate"
                  type="number"
                  value={settings.sgstRate}
                  onChange={(e) => setSettings(prev => ({ ...prev, sgstRate: parseInt(e.target.value) }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Company Information */}
        <Card>
          <CardHeader>
            <CardTitle>Company Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="companyName">Company Name</Label>
              <Input
                id="companyName"
                value={settings.companyName}
                onChange={(e) => setSettings(prev => ({ ...prev, companyName: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="companyAddress">Company Address</Label>
              <Textarea
                id="companyAddress"
                value={settings.companyAddress}
                onChange={(e) => setSettings(prev => ({ ...prev, companyAddress: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="gstNumber">GST Number</Label>
                <Input
                  id="gstNumber"
                  value={settings.gstNumber}
                  onChange={(e) => setSettings(prev => ({ ...prev, gstNumber: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="allowCancellationDays">Allow Cancellation (Days)</Label>
                <Input
                  id="allowCancellationDays"
                  type="number"
                  value={settings.allowCancellationDays}
                  onChange={(e) => setSettings(prev => ({ ...prev, allowCancellationDays: parseInt(e.target.value) }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card>
          <CardHeader>
            <CardTitle>Customer Support</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="customerSupportEmail">Support Email</Label>
                <Input
                  id="customerSupportEmail"
                  type="email"
                  value={settings.customerSupportEmail}
                  onChange={(e) => setSettings(prev => ({ ...prev, customerSupportEmail: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="customerSupportPhone">Support Phone</Label>
                <Input
                  id="customerSupportPhone"
                  value={settings.customerSupportPhone}
                  onChange={(e) => setSettings(prev => ({ ...prev, customerSupportPhone: e.target.value }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notification Templates */}
        <Card>
          <CardHeader>
            <CardTitle>Notification Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="welcomeMessage">Welcome Message</Label>
              <Textarea
                id="welcomeMessage"
                value={settings.welcomeMessage}
                onChange={(e) => setSettings(prev => ({ ...prev, welcomeMessage: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="completionMessage">Service Completion Message</Label>
              <Textarea
                id="completionMessage"
                value={settings.completionMessage}
                onChange={(e) => setSettings(prev => ({ ...prev, completionMessage: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* Maintenance Mode */}
        <Card>
          <CardHeader>
            <CardTitle>Maintenance Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="maintenanceMode">Enable Maintenance Mode</Label>
                <p className="text-sm text-gray-600">Put the system in maintenance mode</p>
              </div>
              <Switch
                id="maintenanceMode"
                checked={settings.maintenanceMode}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, maintenanceMode: checked }))}
              />
            </div>
            {settings.maintenanceMode && (
              <div>
                <Label htmlFor="maintenanceMessage">Maintenance Message</Label>
                <Textarea
                  id="maintenanceMessage"
                  value={settings.maintenanceMessage}
                  onChange={(e) => setSettings(prev => ({ ...prev, maintenanceMessage: e.target.value }))}
                />
              </div>
            )}
            {settings.maintenanceMode && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Badge variant="destructive">MAINTENANCE MODE ACTIVE</Badge>
                </div>
                <p className="text-sm text-orange-700 mt-2">
                  The system is currently in maintenance mode. Users will see the maintenance message.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4">
          <Button variant="outline" onClick={handleReset}>
            Reset to Defaults
          </Button>
          <Button onClick={handleSave}>
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}