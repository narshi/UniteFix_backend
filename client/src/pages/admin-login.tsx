import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AdminLoginProps {
  onLoginSuccess?: () => void;
}

export default function AdminLogin({ onLoginSuccess }: AdminLoginProps) {
  const [, setLocation] = useLocation();
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      return await apiRequest("POST", "/api/admin/auth/login", data);
    },
    onSuccess: (data) => {
      // Store admin token
      localStorage.setItem("adminToken", data.token);
      localStorage.setItem("adminUser", JSON.stringify(data.admin));

      toast({
        title: "Login successful",
        description: `Welcome back, ${data.admin.username}!`,
      });

      // Trigger auth change event
      window.dispatchEvent(new Event('authChanged'));

      // Call the callback to update parent state
      if (onLoginSuccess) {
        onLoginSuccess();
      }

      // Redirect to admin dashboard
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!credentials.username || !credentials.password) {
      toast({
        title: "Missing credentials",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }
    loginMutation.mutate(credentials);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent relative overflow-hidden">
      {/* Background ambient effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-[hsla(217,91%,60%,0.15)] blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[hsla(347,77%,50%,0.1)] blur-[120px] pointer-events-none" />

      <Card className="w-full max-w-md glass-card border-[rgba(255,255,255,0.08)] relative z-10 stagger-enter mx-4">
        <CardHeader className="space-y-1 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl pb-6">
          <CardTitle className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">
            UniteFix Admin
          </CardTitle>
          <CardDescription className="text-center text-[hsl(215,20%,65%)]">
            Sign in to access the command center
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-[hsl(215,20%,75%)]">Username or Email</Label>
              <Input
                id="username"
                name="username"
                type="text"
                placeholder="Enter your username or email"
                value={credentials.username}
                onChange={handleInputChange}
                required
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all h-12"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-[hsl(215,20%,75%)]">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Enter your password"
                value={credentials.password}
                onChange={handleInputChange}
                required
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[hsl(215,20%,40%)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-[hsla(217,91%,60%,0.3)] transition-all h-12"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-12 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white shadow-[0_4px_15px_hsla(217,91%,60%,0.4)] transition-all active:scale-95 text-lg font-medium mt-4"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Authenticating..." : "Enter Command Center"}
            </Button>
          </form>

          <div className="mt-8 p-4 bg-[hsla(217,91%,60%,0.05)] border border-[hsla(217,91%,60%,0.15)] rounded-xl backdrop-blur-sm">
            <p className="text-sm text-[hsl(217,91%,70%)] font-medium mb-1">
              Demo Credentials:
            </p>
            <p className="text-sm text-[hsl(215,20%,65%)] font-mono">
              Username: <span className="text-white">admin</span><br />
              Password: <span className="text-white">admin123</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}