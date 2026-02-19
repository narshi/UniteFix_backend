# UniteFix API Documentation

## Overview
UniteFix provides a comprehensive REST API for service booking and product ordering platform, supporting both admin dashboard management and client application integration (Android/iOS/Web).

## Base URL
```
Production: https://api.unitefix.com
Development: http://localhost:5000/api
```

## Authentication

### Admin Authentication
- **Purpose**: Admin dashboard access
- **Token Type**: JWT with 8-hour expiry
- **Header**: `Authorization: Bearer <admin_token>`

### Client Authentication  
- **Purpose**: Mobile/client app access
- **Token Type**: JWT with 30-day expiry
- **Header**: `Authorization: Bearer <client_token>`

---

## Admin API Endpoints

### Admin Authentication

#### Login Admin
```http
POST /api/admin/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

**Response:**
```json
{
  "message": "Admin login successful",
  "admin": {
    "id": 1,
    "username": "admin",
    "email": "admin@unitefix.com",
    "role": "admin",
    "isActive": true
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### Get Admin Profile
```http
GET /api/admin/auth/profile
Authorization: Bearer <admin_token>
```

### Admin Dashboard Data

#### Get Dashboard Statistics
```http
GET /api/admin/stats
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "totalUsers": 150,
  "activeServices": 25,
  "productOrders": 89,
  "revenue": 45000
}
```

#### Get Recent Service Requests
```http
GET /api/admin/services/recent?limit=10
Authorization: Bearer <admin_token>
```

#### Get All Users
```http
GET /api/admin/users
Authorization: Bearer <admin_token>
```

#### Get All Service Requests
```http
GET /api/admin/services
Authorization: Bearer <admin_token>
```

#### Assign Partner to Service
```http
POST /api/admin/services/{serviceId}/assign
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "partnerId": 123
}
```

**Note**: Only verified Service Partners can be assigned to service requests.

### Service Partner Management

#### Get All Service Partners
```http
GET /api/service-partners
Authorization: Bearer <admin_token>
```

**Response:**
```json
[
  {
    "id": 1,
    "partnerId": "SP00001",
    "partnerName": "Rajesh Kumar",
    "email": "rajesh@example.com",
    "phone": "+919876543210",
    "partnerType": "Individual",
    "businessName": null,
    "services": ["AC Repair", "Refrigerator Repair"],
    "location": "581301",
    "address": "123 Service St, Sirsi",
    "verificationStatus": "Verified"
  }
]
```

#### Create Service Partner (Admin)
```http
POST /api/service-partners
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "partnerName": "Rajesh Kumar",
  "email": "rajesh@example.com",
  "phone": "+919876543210",
  "password": "temporaryPassword123",
  "partnerType": "Individual",
  "services": ["AC Repair", "Refrigerator Repair"],
  "location": "581301",
  "address": "123 Service St, Sirsi"
}
```

**Note**: Partners created by admin are automatically verified.

#### Update Partner Verification Status
```http
PATCH /api/service-partners/{partnerId}/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "verification_status": "Verified"
}
```

**Status Options**: "Pending Verification", "Verified", "Rejected"

#### Delete Service Partner
```http
DELETE /api/service-partners/{partnerId}
Authorization: Bearer <admin_token>
```

---

## Client API Endpoints

### Service Partner Mobile Signup

#### Register Service Partner (Mobile App)
```http
POST /api/service-partners/mobile-signup
Content-Type: application/json

{
  "partnerName": "Rajesh Kumar",
  "email": "rajesh@example.com",
  "phone": "+919876543210",
  "password": "securePassword123",
  "partnerType": "Individual",
  "businessName": "Rajesh Services",  // Required only for Business type
  "services": ["AC Repair", "Refrigerator Repair"],
  "location": "581301",
  "address": "123 Service St, Sirsi, Karnataka"
}
```

**Response:**
```json
{
  "message": "Service partner registered successfully. Pending verification by admin.",
  "partner": {
    "id": 1,
    "partnerId": "SP00001",
    "partnerName": "Rajesh Kumar",
    "email": "rajesh@example.com",
    "phone": "+919876543210",
    "partnerType": "Individual",
    "verificationStatus": "Pending Verification"
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "requiresVerification": true
}
```

**Notes**:
- Partners registered via mobile app start with "Pending Verification" status
- Admin must verify the partner before they can receive service assignments
- Token is issued immediately but full functionality requires verification

---

### Client Authentication

#### Register New User
```http
POST /api/client/auth/register
Content-Type: application/json

{
  "username": "john_doe",
  "email": "john@example.com",
  "phone": "+919876543210",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe",
  "pinCode": "581301",
  "homeAddress": "123 Main St, Sirsi",
  "userType": "normal"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": 123,
    "username": "john_doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "firstName": "John",
    "lastName": "Doe",
    "isVerified": false
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "requiresVerification": true
}
```

#### Login User
```http
POST /api/client/auth/login
Content-Type: application/json

{
  "identifier": "john@example.com",  // email or phone
  "password": "securePassword123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "user": {
    "id": 123,
    "username": "john_doe",
    "email": "john@example.com",
    "isVerified": true
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "isVerified": true
}
```

#### Refresh Token
```http
POST /api/client/auth/refresh-token
Authorization: Bearer <client_token>
```

#### Get User Profile
```http
GET /api/client/auth/profile
Authorization: Bearer <client_token>
```

#### Update User Profile
```http
PATCH /api/client/auth/profile
Authorization: Bearer <client_token>
Content-Type: application/json

{
  "firstName": "John Updated",
  "homeAddress": "New Address"
}
```

---

### Service Management

#### Get Available Service Types
```http
GET /api/client/services/types
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "AC Repair",
    "category": "Appliance",
    "estimatedDuration": "2-4 hours"
  },
  {
    "id": 2,
    "name": "Laptop Repair",
    "category": "Electronics",
    "estimatedDuration": "1-3 days"
  }
]
```

#### Request Service
```http
POST /api/client/services/request
Authorization: Bearer <client_token>
Content-Type: application/json

{
  "serviceType": "AC Repair",
  "description": "AC not cooling properly",
  "preferredDate": "2025-01-15",
  "preferredTime": "morning",
  "urgency": "normal",
  "bookingFee": 200,
  "address": "123 Main St, Sirsi"
}
```

**Response:**
```json
{
  "message": "Service request created successfully",
  "serviceRequest": {
    "id": 456,
    "serviceType": "AC Repair",
    "status": "placed",
    "verificationCode": "1234",
    "bookingFee": 200
  },
  "estimatedResponse": "You will receive confirmation within 2 hours"
}
```

#### Get My Service Requests
```http
GET /api/client/services/my-requests
Authorization: Bearer <client_token>
```

**Response:**
```json
[
  {
    "id": 456,
    "serviceType": "AC Repair",
    "status": "partner_assigned",
    "statusMessage": "A service partner has been assigned to your request.",
    "canCancel": false,
    "createdAt": "2025-01-10T10:00:00Z"
  }
]
```

#### Cancel Service Request
```http
PATCH /api/client/services/{serviceId}/cancel
Authorization: Bearer <client_token>
```

---

### Product & Order Management

#### Get Product Categories
```http
GET /api/client/products/categories
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "AC",
    "icon": "ac_unit"
  },
  {
    "id": 2,
    "name": "Laptop",
    "icon": "laptop"
  }
]
```

#### Get Products
```http
GET /api/client/products?category=AC&search=cooling
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "1.5 Ton Split AC",
    "description": "Energy efficient split AC",
    "price": 35000,
    "category": "AC",
    "imageUrl": "https://example.com/ac.jpg",
    "inStock": true
  }
]
```

#### Get Cart Items
```http
GET /api/client/cart
Authorization: Bearer <client_token>
```

**Response:**
```json
{
  "items": [
    {
      "id": 1,
      "productId": 1,
      "quantity": 2,
      "product": {
        "id": 1,
        "name": "1.5 Ton Split AC",
        "price": 35000
      },
      "totalPrice": 70000
    }
  ],
  "itemCount": 1,
  "totalAmount": 70000
}
```

#### Add to Cart
```http
POST /api/client/cart/add
Authorization: Bearer <client_token>
Content-Type: application/json

{
  "productId": 1,
  "quantity": 2
}
```

#### Place Order
```http
POST /api/client/orders/place
Authorization: Bearer <client_token>
Content-Type: application/json

{
  "deliveryAddress": "123 Main St, Sirsi, Karnataka",
  "paymentMethod": "COD"
}
```

**Response:**
```json
{
  "message": "Order placed successfully",
  "order": {
    "id": 789,
    "totalAmount": 70000,
    "status": "placed",
    "products": [...]
  },
  "estimatedDelivery": "3-5 business days"
}
```

#### Get My Orders
```http
GET /api/client/orders/my-orders
Authorization: Bearer <client_token>
```

---

## Error Responses

### Common Error Codes
- **400**: Bad Request - Invalid input data
- **401**: Unauthorized - Invalid or missing token
- **403**: Forbidden - Insufficient permissions
- **404**: Not Found - Resource not found
- **500**: Internal Server Error

### Error Response Format
```json
{
  "message": "Error description"
}
```

---

## Rate Limiting
- Admin API: 1000 requests per hour per IP
- Client API: 10000 requests per hour per user

## Region Restriction
- Services are only available in Uttara Kannada region
- Valid pin codes: 581301, 581320, 581343, 581355, 581313, 581325, 581350, 581345

## Support
For API support, contact: support@unitefix.com

---

## Mobile App Integration

### Android/iOS Implementation
1. Store JWT token securely using device keychain/keystore
2. Implement automatic token refresh before expiry
3. Handle 401 responses by redirecting to login
4. Use HTTPS for all API calls
5. Implement offline capabilities for basic data

### Example Mobile Integration (React Native)
```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

class UniteFix API {
  static baseURL = 'https://api.unitefix.com';
  
  static async makeRequest(endpoint, options = {}) {
    const token = await AsyncStorage.getItem('client_token');
    
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    };
    
    const response = await fetch(`${this.baseURL}${endpoint}`, config);
    
    if (response.status === 401) {
      // Handle token expiry
      await this.logout();
      throw new Error('Session expired');
    }
    
    return response.json();
  }
  
  static async login(identifier, password) {
    const response = await this.makeRequest('/client/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    
    if (response.token) {
      await AsyncStorage.setItem('client_token', response.token);
    }
    
    return response;
  }
}
```