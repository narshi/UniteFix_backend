import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Play, Code2, Server, Smartphone } from "lucide-react";

export default function DeveloperPage() {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [testEndpoint, setTestEndpoint] = useState("/api/admin/stats");
  const [testMethod, setTestMethod] = useState("GET");
  const [testBody, setTestBody] = useState("");
  const [testToken, setTestToken] = useState("");
  const [testResponse, setTestResponse] = useState("");
  const { toast } = useToast();

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const handleTestAPI = async () => {
    try {
      const options: RequestInit = {
        method: testMethod,
        headers: {
          "Content-Type": "application/json",
          ...(testToken && { Authorization: `Bearer ${testToken}` }),
        },
      };

      if (testMethod !== "GET" && testBody) {
        options.body = testBody;
      }

      const response = await fetch(testEndpoint, options);
      const data = await response.json();
      
      setTestResponse(JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        data: data
      }, null, 2));

      toast({
        title: "API Test Complete",
        description: `Status: ${response.status}`,
      });
    } catch (error: any) {
      setTestResponse(JSON.stringify({
        error: error.message
      }, null, 2));
      toast({
        title: "API Test Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const adminEndpoints = [
    {
      title: "Admin Login",
      method: "POST",
      endpoint: "/api/admin/auth/login",
      description: "Authenticate admin user and get 8-hour JWT token",
      request: {
        username: "admin",
        password: "admin123"
      },
      response: {
        message: "Admin login successful",
        admin: { id: 1, username: "admin", role: "admin" },
        token: "eyJhbGciOiJIUzI1NiIs..."
      }
    },
    {
      title: "Get Dashboard Stats",
      method: "GET",
      endpoint: "/api/admin/stats",
      description: "Retrieve dashboard statistics",
      auth: true,
      response: {
        totalUsers: 150,
        activeServices: 25,
        productOrders: 89,
        revenue: 45000
      }
    },
    {
      title: "Get All Service Partners",
      method: "GET",
      endpoint: "/api/service-partners",
      description: "Retrieve all service partners with verification status",
      auth: true,
      response: [
        {
          id: 1,
          partnerId: "SP00001",
          partnerName: "Rajesh Kumar",
          verificationStatus: "Verified",
          services: ["AC Repair", "Refrigerator Repair"]
        }
      ]
    },
    {
      title: "Update Partner Verification",
      method: "PATCH",
      endpoint: "/api/service-partners/{partnerId}/status",
      description: "Update service partner verification status",
      auth: true,
      request: {
        verification_status: "Verified"
      },
      response: {
        message: "Verification status updated successfully"
      }
    },
    {
      title: "Assign Partner to Service",
      method: "POST",
      endpoint: "/api/admin/services/{serviceId}/assign",
      description: "Assign a verified partner to a service request",
      auth: true,
      request: {
        partnerId: 123
      },
      note: "Only verified partners can be assigned",
      response: {
        message: "Partner assigned successfully",
        service: { id: 1, status: "partner_assigned" }
      }
    }
  ];

  const clientEndpoints = [
    {
      title: "Register User",
      method: "POST",
      endpoint: "/api/client/auth/register",
      description: "Register new user with 30-day JWT token",
      request: {
        username: "john_doe",
        email: "john@example.com",
        phone: "+919876543210",
        password: "securePassword123",
        firstName: "John",
        lastName: "Doe",
        pinCode: "581301",
        homeAddress: "123 Main St, Sirsi",
        userType: "normal"
      },
      response: {
        message: "User registered successfully",
        user: { id: 123, username: "john_doe" },
        token: "eyJhbGciOiJIUzI1NiIs...",
        requiresVerification: true
      }
    },
    {
      title: "Service Partner Signup (Mobile)",
      method: "POST",
      endpoint: "/api/service-partners/mobile-signup",
      description: "Register service partner via mobile app (Pending Verification status)",
      request: {
        partnerName: "Rajesh Kumar",
        email: "rajesh@example.com",
        phone: "+919876543210",
        password: "securePassword123",
        partnerType: "Individual",
        services: ["AC Repair", "Refrigerator Repair"],
        location: "581301",
        address: "123 Service St, Sirsi"
      },
      response: {
        message: "Service partner registered successfully. Pending verification by admin.",
        partner: {
          partnerId: "SP00001",
          verificationStatus: "Pending Verification"
        },
        token: "eyJhbGciOiJIUzI1NiIs...",
        requiresVerification: true
      }
    },
    {
      title: "Request Service",
      method: "POST",
      endpoint: "/api/client/services/request",
      description: "Create a new service request",
      auth: true,
      request: {
        serviceType: "AC Repair",
        description: "AC not cooling properly",
        preferredDate: "2025-01-15",
        preferredTime: "morning",
        urgency: "normal",
        bookingFee: 200,
        address: "123 Main St, Sirsi"
      },
      response: {
        message: "Service request created successfully",
        serviceRequest: {
          id: 456,
          serviceType: "AC Repair",
          status: "placed",
          verificationCode: "1234"
        }
      }
    },
    {
      title: "Get My Service Requests",
      method: "GET",
      endpoint: "/api/client/services/my-requests",
      description: "Get all service requests for authenticated user",
      auth: true,
      response: [
        {
          id: 456,
          serviceType: "AC Repair",
          status: "partner_assigned",
          statusMessage: "A service partner has been assigned to your request.",
          canCancel: false
        }
      ]
    }
  ];

  const codeExamples = {
    kotlin: `// Kotlin Multiplatform Mobile (KMM) Integration
import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import kotlinx.serialization.json.Json

class UniteFIxAPI {
    private val client = HttpClient()
    private val baseURL = "https://your-domain.replit.app/api"
    private var token: String? = null
    
    suspend fun login(identifier: String, password: String): LoginResponse {
        val response = client.post("$baseURL/client/auth/login") {
            setBody(mapOf(
                "identifier" to identifier,
                "password" to password
            ))
        }
        val data = Json.decodeFromString<LoginResponse>(response.bodyAsText())
        token = data.token
        return data
    }
    
    suspend fun registerServicePartner(
        partnerName: String,
        email: String,
        phone: String,
        password: String,
        partnerType: String,
        services: List<String>,
        location: String,
        address: String
    ): PartnerResponse {
        val response = client.post("$baseURL/service-partners/mobile-signup") {
            setBody(mapOf(
                "partnerName" to partnerName,
                "email" to email,
                "phone" to phone,
                "password" to password,
                "partnerType" to partnerType,
                "services" to services,
                "location" to location,
                "address" to address
            ))
        }
        return Json.decodeFromString(response.bodyAsText())
    }
    
    suspend fun requestService(serviceData: ServiceRequest): ServiceResponse {
        val response = client.post("$baseURL/client/services/request") {
            headers {
                append("Authorization", "Bearer $token")
            }
            setBody(serviceData)
        }
        return Json.decodeFromString(response.bodyAsText())
    }
}`,
    javascript: `// React Native / JavaScript Integration
import AsyncStorage from '@react-native-async-storage/async-storage';

class UniteFIxAPI {
  static baseURL = 'https://your-domain.replit.app/api';
  
  static async makeRequest(endpoint, options = {}) {
    const token = await AsyncStorage.getItem('client_token');
    
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: \`Bearer \${token}\` }),
        ...options.headers,
      },
    };
    
    const response = await fetch(\`\${this.baseURL}\${endpoint}\`, config);
    
    if (response.status === 401) {
      await this.logout();
      throw new Error('Session expired');
    }
    
    return response.json();
  }
  
  static async registerServicePartner(data) {
    const response = await this.makeRequest('/service-partners/mobile-signup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    if (response.token) {
      await AsyncStorage.setItem('partner_token', response.token);
    }
    
    return response;
  }
  
  static async requestService(serviceData) {
    return await this.makeRequest('/client/services/request', {
      method: 'POST',
      body: JSON.stringify(serviceData),
    });
  }
}`,
    flutter: `// Flutter / Dart Integration
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class UniteFIxAPI {
  static const String baseURL = 'https://your-domain.replit.app/api';
  
  static Future<Map<String, dynamic>> makeRequest(
    String endpoint, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('client_token');
    
    final headers = {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
    
    http.Response response;
    
    if (method == 'POST') {
      response = await http.post(
        Uri.parse('$baseURL$endpoint'),
        headers: headers,
        body: json.encode(body),
      );
    } else {
      response = await http.get(
        Uri.parse('$baseURL$endpoint'),
        headers: headers,
      );
    }
    
    if (response.statusCode == 401) {
      throw Exception('Session expired');
    }
    
    return json.decode(response.body);
  }
  
  static Future<Map<String, dynamic>> registerServicePartner(
    Map<String, dynamic> partnerData,
  ) async {
    final response = await makeRequest(
      '/service-partners/mobile-signup',
      method: 'POST',
      body: partnerData,
    );
    
    if (response['token'] != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('partner_token', response['token']);
    }
    
    return response;
  }
}`
  };

  return (
    <div className="flex-1 p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Developer Documentation</h2>
        <p className="text-gray-600">Complete API documentation and testing interface for UniteFix platform</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="admin">Admin API</TabsTrigger>
          <TabsTrigger value="client">Client API</TabsTrigger>
          <TabsTrigger value="testing">API Testing</TabsTrigger>
          <TabsTrigger value="examples">Code Examples</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Server className="w-5 h-5" />
                <span>API Overview</span>
              </CardTitle>
              <CardDescription>
                UniteFix provides comprehensive REST APIs for service booking and product ordering
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Base URLs</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <code className="text-sm">Production: https://your-domain.replit.app/api</code>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard("https://your-domain.replit.app/api", "prod-url")}>
                      {copiedCode === "prod-url" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <code className="text-sm">Development: http://localhost:5000/api</code>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard("http://localhost:5000/api", "dev-url")}>
                      {copiedCode === "dev-url" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-3">Authentication Types</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center space-x-2 mb-2">
                        <Badge variant="default">Admin</Badge>
                        <span className="text-sm font-medium">8-hour expiry</span>
                      </div>
                      <p className="text-sm text-gray-600">For admin dashboard access and management operations</p>
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded mt-2 block">Authorization: Bearer &lt;admin_token&gt;</code>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center space-x-2 mb-2">
                        <Badge variant="secondary">Client</Badge>
                        <span className="text-sm font-medium">30-day expiry</span>
                      </div>
                      <p className="text-sm text-gray-600">For mobile/client app user authentication</p>
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded mt-2 block">Authorization: Bearer &lt;client_token&gt;</code>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-3">Service Partner System</h3>
                <div className="p-4 bg-blue-50 rounded-lg space-y-2">
                  <p className="text-sm text-gray-700"><strong>Mobile Signup:</strong> Partners register via mobile app with "Pending Verification" status</p>
                  <p className="text-sm text-gray-700"><strong>Admin Creation:</strong> Admin-created partners are automatically "Verified"</p>
                  <p className="text-sm text-gray-700"><strong>Assignment Rule:</strong> Only verified partners can be assigned to service requests</p>
                  <p className="text-sm text-gray-700"><strong>Verification Flow:</strong> Admin verifies partners in dashboard before they can receive assignments</p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Region Restriction</h3>
                <p className="text-sm text-gray-600 mb-2">Services are only available in Uttara Kannada region</p>
                <div className="flex flex-wrap gap-2">
                  {["581301", "581320", "581343", "581355", "581313", "581325", "581350", "581345"].map(pin => (
                    <Badge key={pin} variant="outline">{pin}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="admin" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Admin API Endpoints</CardTitle>
              <CardDescription>Protected endpoints requiring admin authentication</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {adminEndpoints.map((endpoint, idx) => (
                <div key={idx} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <Badge variant={endpoint.method === "GET" ? "default" : endpoint.method === "POST" ? "secondary" : "outline"}>
                          {endpoint.method}
                        </Badge>
                        <code className="text-sm font-mono">{endpoint.endpoint}</code>
                        {endpoint.auth && <Badge variant="destructive" className="text-xs">Auth Required</Badge>}
                      </div>
                      <h4 className="font-semibold">{endpoint.title}</h4>
                      <p className="text-sm text-gray-600">{endpoint.description}</p>
                      {endpoint.note && (
                        <p className="text-xs text-blue-600 mt-1">Note: {endpoint.note}</p>
                      )}
                    </div>
                  </div>
                  {endpoint.request && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Request Body:</p>
                      <div className="relative">
                        <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                          {JSON.stringify(endpoint.request, null, 2)}
                        </pre>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="absolute top-2 right-2"
                          onClick={() => copyToClipboard(JSON.stringify(endpoint.request, null, 2), `admin-req-${idx}`)}
                        >
                          {copiedCode === `admin-req-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Response:</p>
                    <div className="relative">
                      <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                        {JSON.stringify(endpoint.response, null, 2)}
                      </pre>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute top-2 right-2"
                        onClick={() => copyToClipboard(JSON.stringify(endpoint.response, null, 2), `admin-res-${idx}`)}
                      >
                        {copiedCode === `admin-res-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="client" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Smartphone className="w-5 h-5" />
                <span>Client API Endpoints</span>
              </CardTitle>
              <CardDescription>Endpoints for mobile/web client applications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {clientEndpoints.map((endpoint, idx) => (
                <div key={idx} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <Badge variant={endpoint.method === "GET" ? "default" : "secondary"}>
                          {endpoint.method}
                        </Badge>
                        <code className="text-sm font-mono">{endpoint.endpoint}</code>
                        {endpoint.auth && <Badge variant="destructive" className="text-xs">Auth Required</Badge>}
                      </div>
                      <h4 className="font-semibold">{endpoint.title}</h4>
                      <p className="text-sm text-gray-600">{endpoint.description}</p>
                    </div>
                  </div>
                  {endpoint.request && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Request Body:</p>
                      <div className="relative">
                        <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                          {JSON.stringify(endpoint.request, null, 2)}
                        </pre>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="absolute top-2 right-2"
                          onClick={() => copyToClipboard(JSON.stringify(endpoint.request, null, 2), `client-req-${idx}`)}
                        >
                          {copiedCode === `client-req-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Response:</p>
                    <div className="relative">
                      <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                        {JSON.stringify(endpoint.response, null, 2)}
                      </pre>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute top-2 right-2"
                        onClick={() => copyToClipboard(JSON.stringify(endpoint.response, null, 2), `client-res-${idx}`)}
                      >
                        {copiedCode === `client-res-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="testing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Play className="w-5 h-5" />
                <span>API Testing Interface</span>
              </CardTitle>
              <CardDescription>Test API endpoints directly from the dashboard</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>HTTP Method</Label>
                  <Select value={testMethod} onValueChange={setTestMethod}>
                    <SelectTrigger data-testid="select-test-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PATCH">PATCH</SelectItem>
                      <SelectItem value="DELETE">DELETE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Endpoint</Label>
                  <Input
                    value={testEndpoint}
                    onChange={(e) => setTestEndpoint(e.target.value)}
                    placeholder="/api/admin/stats"
                    data-testid="input-test-endpoint"
                  />
                </div>
              </div>

              <div>
                <Label>Authorization Token (Optional)</Label>
                <Input
                  value={testToken}
                  onChange={(e) => setTestToken(e.target.value)}
                  placeholder="Bearer token (leave empty for public endpoints)"
                  data-testid="input-test-token"
                />
              </div>

              {testMethod !== "GET" && (
                <div>
                  <Label>Request Body (JSON)</Label>
                  <Textarea
                    value={testBody}
                    onChange={(e) => setTestBody(e.target.value)}
                    placeholder='{"key": "value"}'
                    rows={6}
                    data-testid="textarea-test-body"
                  />
                </div>
              )}

              <Button onClick={handleTestAPI} className="w-full" data-testid="button-test-api">
                <Play className="w-4 h-4 mr-2" />
                Send Request
              </Button>

              {testResponse && (
                <div>
                  <Label>Response</Label>
                  <div className="relative">
                    <pre className="bg-gray-50 p-4 rounded text-sm overflow-x-auto max-h-96" data-testid="text-test-response">
                      {testResponse}
                    </pre>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute top-2 right-2"
                      onClick={() => copyToClipboard(testResponse, "test-response")}
                    >
                      {copiedCode === "test-response" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="examples" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Code2 className="w-5 h-5" />
                <span>Mobile Integration Examples</span>
              </CardTitle>
              <CardDescription>Code examples for Kotlin, JavaScript, and Flutter</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold">Kotlin Multiplatform Mobile (KMM)</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(codeExamples.kotlin, "kotlin")}
                  >
                    {copiedCode === "kotlin" ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                    Copy
                  </Button>
                </div>
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
                  {codeExamples.kotlin}
                </pre>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold">React Native / JavaScript</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(codeExamples.javascript, "javascript")}
                  >
                    {copiedCode === "javascript" ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                    Copy
                  </Button>
                </div>
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
                  {codeExamples.javascript}
                </pre>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold">Flutter / Dart</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(codeExamples.flutter, "flutter")}
                  >
                    {copiedCode === "flutter" ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                    Copy
                  </Button>
                </div>
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
                  {codeExamples.flutter}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
