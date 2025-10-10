# UniteFix App - Service Booking & Product Ordering Platform

## Overview
A comprehensive Node.js backend server for UniteFix App - a dual-purpose platform supporting service bookings and product orders with location-based validation for Uttara Kannada region. Built as backend support for a Kotlin Multiplatform Mobile (KMM) application with complete admin dashboard for managing users, services, orders, business partners, and payments.

## User Preferences
- Comprehensive functionality over previews
- Complete working codebase with all admin features
- Focus on practical business requirements
- Clear navigation between all sections

## Project Architecture
- **Backend**: Node.js with Express server using in-memory storage
- **Frontend**: React with TypeScript, Wouter routing, TanStack Query
- **UI Components**: Shadcn/ui with Tailwind CSS
- **Authentication**: JWT-based with OTP verification
- **Location Constraint**: Services limited to Uttara Kannada state only

## Business Requirements Summary
### Core Functionality
- **User Types**: Normal Users (NU) and Business Users (BU) with tailored workflows
- **Service Flow**: Two options - "Service with UniteFix" (admin assigns partner) or "Other Registered Businesses" (user contacts directly)
- **Service Tracking**: Placed → Confirmed → Partner Assigned → Service Started → Service Completed
- **Product Orders**: Browse, cart system, order tracking with delivery statuses
- **Payment System**: Booking fees, invoice generation, secure payment gateway integration
- **Location Restriction**: Uttara Kannada state only with pin code validation
- **Verification**: Phone/email OTP verification, 4-digit service verification codes
- **Business Dashboard**: Partner management, service assignment, completion tracking

### Key Business Rules
- Service cancellation allowed before partner assignment only
- 48-hour partner assignment window, 7-day maximum before refund
- No return/replacement policy for products
- Account deletion requires email request to support
- Phone/email changes require OTP verification

## Recent Changes (July 2, 2025)
- ✓ Successfully migrated project from Replit Agent to Replit environment
- ✓ Verified all dependencies and packages are properly installed
- ✓ Confirmed application runs cleanly on port 5000 with Express server
- ✓ All API endpoints functioning correctly (admin stats, services, orders)
- ✓ Updated project documentation with complete business requirements

### Major Feature Enhancements Completed:
- ✓ Fixed Business Partner status management (suspend, deactivate, delete functionality)
- ✓ Added visual feedback for partner status with grayed-out rows and reason display
- ✓ Added comprehensive search functionality across all admin pages
- ✓ Enhanced Service Requests with partner assignment column and detailed view modal
- ✓ Fixed Location Management counts and toggle functionality with persistent data
- ✓ Created comprehensive Settings page with all required business configurations
- ✓ Added invoice download functionality for completed services
- ✓ Implemented detailed service and order view modals
- ✓ Enhanced user schema with partner status tracking fields
- ✓ Added proper API endpoints for complete data retrieval (/api/admin/services, /api/admin/orders)

### Latest Updates (July 2, 2025 - Evening):
- ✓ Added search functionality to User Management page with real-time filtering
- ✓ Enhanced Service Requests with status filters (Placed, Confirmed, Partner Assigned, Service Started, Completed)
- ✓ Added individual PDF invoice download functionality in separate column for Service Requests
- ✓ Enhanced Product Orders with comprehensive search, status filters, and category filters
- ✓ Added product categories (AC, Laptop, Water Heater, Refrigerator, Washing Machine, etc.)
- ✓ Added individual PDF invoice download functionality for Product Orders
- ✓ Updated backend storage with properly categorized products and sample orders
- ✓ Implemented real-time filtering across all admin pages for improved usability

### Major System Overhaul (January 10, 2025):
- ✓ **Service Partner System**: Completely refactored Business Partner system to dedicated Service Partners
  - Separate `servicePartners` table with verification_status field
  - Partner Types: Individual / Business
  - Verification Statuses: "Pending Verification" / "Verified"
  - Mobile Partner Signup API with automatic "Pending Verification" status
  - Admin-created partners automatically "Verified"
- ✓ **Authentication System**:
  - Admin authentication with 8-hour JWT token expiry
  - Client app authentication with 30-day JWT token expiry  
  - Separate authentication flows for admin dashboard and mobile/web apps
- ✓ **API Infrastructure**:
  - Comprehensive client app APIs for mobile integration
  - Service Partner management APIs (signup, verification, CRUD)
  - All endpoints documented in API_DOCUMENTATION.md

## Previous Changes (December 26, 2024)
- ✓ Fixed all navigation 404 errors by implementing missing admin pages
- ✓ Created complete User Management page with user listing
- ✓ Added Service Requests page with status tracking and assignment
- ✓ Built Product Orders page with order management
- ✓ Implemented Business Partners page with partner listings
- ✓ Created Payments & Invoices page with financial records
- ✓ Added comprehensive Location Management with pin code validation
- ✓ Fixed duplicate key warnings causing React errors
- ✓ Added all required API endpoints for admin functionality
- ✓ Removed duplicate Add Partner and Export buttons from quick actions
- ✓ Enhanced partner management with comprehensive verification workflow
- ✓ Added partner actions: verify, suspend, deactivate, delete with comment system
- ✓ Implemented partner suspension with configurable day duration
- ✓ Fixed Material Icons display issues in sidebar navigation
- ✓ Added partner action API endpoints with proper error handling
- ✓ Fixed top-right Add Partner and Export Report buttons functionality
- ✓ Implemented "View All" buttons for Recent Service Request and Recent Product Request
- ✓ Added proper navigation handlers for all dashboard buttons
- ✓ Fixed array handling issues in Recent Activity component

## Current Features
### Admin Dashboard
- Real-time statistics and metrics
- Recent activity tracking
- Pending service assignments
- Quick action buttons

### User Management
- Complete user listing (Normal + Business users)
- User type identification and status tracking
- Registration date and verification status

### Service Requests
- Service request tracking and management
- Partner assignment functionality
- Status updates and history
- User details integration

### Product Orders
- Order management and tracking
- Product details and quantities
- Order status updates
- Total amount calculations

### Business Partners
- Partner listings and management
- Service specialization tracking
- Contact information management

### Payments & Invoices
- Invoice generation and tracking
- Payment status management
- Financial record keeping

### Location Management
- Pin code validation for Uttara Kannada region
- Location activation/deactivation
- Area and district management
- Statistics dashboard for locations

## Technical Constraints
- MongoDB unavailable in environment (using in-memory storage)
- Pin code validation restricted to Uttara Kannada (581xxx series)
- JWT authentication required for protected routes
- OTP verification for user registration

## API Endpoints Status
All required endpoints implemented:
- User management: `/api/admin/users`
- Service requests: `/api/admin/services/*`
- Product orders: `/api/admin/orders/*`
- Business partners: `/api/business/partners`
- Invoices: `/api/admin/invoices`
- Location management: `/api/admin/locations/*`
- Pin code validation: `/api/utils/validate-pincode`

## Known Issues Fixed
- Navigation 404 errors resolved
- Duplicate React keys causing console warnings
- API request type mismatches
- Missing component imports

## Next Priority Items
- Enhanced error handling for edge cases
- Advanced filtering and search functionality
- Data export capabilities
- Real-time notifications system