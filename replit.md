# UniteFix App - Service Booking & Product Ordering Platform

## Overview
A comprehensive Node.js backend server for UniteFix App - a dual-purpose platform supporting service bookings and product orders with location-based validation for Uttara Kannada region.

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

## Recent Changes (December 26, 2024)
- ✓ Fixed all navigation 404 errors by implementing missing admin pages
- ✓ Created complete User Management page with user listing
- ✓ Added Service Requests page with status tracking and assignment
- ✓ Built Product Orders page with order management
- ✓ Implemented Business Partners page with partner listings
- ✓ Created Payments & Invoices page with financial records
- ✓ Added comprehensive Location Management with pin code validation
- ✓ Fixed duplicate key warnings causing React errors
- ✓ Added all required API endpoints for admin functionality

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