# UniteFix - Business Requirements Document (BRD)

## 1. Project Overview
UniteFix is a home services and product ordering platform for Uttara Kannada, Karnataka. It consists of a mobile app for Customers and Service Partners, a backend API, and a web-based Admin Dashboard.

## 2. System Architecture
- **Backend:** Node.js, Express.js, TypeScript
- **Database:** PostgreSQL (Neon Serverless) with Drizzle ORM
- **Mobile App:** React Native (Expo) for Android & iOS
- **Admin Dashboard:** React 18, Radix UI, Tailwind CSS
- **Authentication:** JWT, bcrypt, Social Logins (Google/Facebook), OTP-based Email/Truecaller flows
- **Payments:** Razorpay integration

## 3. User Roles
1. **Customer (User):** Books repair/maintenance services, tracks orders, pays via Razorpay, rates services, and purchases products.
2. **Service Partner:** Receives service requests, accepts/denies assignments, manages service state (start, complete), and withdraws wallet earnings.
3. **Admin:** Manages users, partners, inventory, service categories, orders, pincode availability, and platform configurations via the dashboard.

## 4. Key Features & Workflows
- **Authentication Flow:** Registration/Login via Email, Phone (OTP), Truecaller, Google, and Facebook. Includes password reset and account deletion capabilities.
- **Service Booking System:** Customers can browse services, book with a fee, and track status. Booking state machine: CREATED → ASSIGNED → ACCEPTED → IN_PROGRESS → COMPLETED.
- **Partner Management & Wallet:** Partners receive geo-fenced assignments and earn to a virtual wallet. Wallet features V2 include balance hold, release after 7 days, and withdrawals.
- **Product & Inventory Management:** Customers can buy products. Admins have CRUD access for inventory, complete with stock transaction history and low-stock alerts.
- **Rating & Reviews:** Customers can rate completed services (1-5 stars).
- **Support & Ticketing:** In-app support ticketing system for users to communicate with admins.

## 5. Security & Infrastructure
- Passwords hashed with bcrypt; robust JWT-based session management.
- Helmet for secure HTTP headers, CORS whitelisting, and rate-limiting per route.
- OTPs sent via Nodemailer and Twilio stub for verification.
- Push Notifications powered by Firebase Cloud Messaging (FCM).

## 6. Integration Points
- **Razorpay:** For processing booking fees, service charges, and product orders.
- **Firebase:** For push notifications (Device tokens mapped per user).
- **AWS S3 / Cloudinary:** Profile picture and service request photo uploads.

## 7. Current Project Status
- Mobile App and Backend functionality is largely complete (~90%).
- All key models mapped using Drizzle ORM (27 distinct tables).
- Focus remains on system stabilization, bug fixes (particularly around Truecaller & Email Auth), and final deployment readiness.
