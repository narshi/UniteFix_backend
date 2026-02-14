/**
 * PHASE 9: Social Authentication Routes
 * 
 * Implements OAuth2 flows for Google and Facebook using Passport.js.
 * 
 * Flow:
 * 1. User clicks "Login with Google" -> /api/auth/google
 * 2. Redirects to Google consent screen
 * 3. Google redirects back to /api/auth/google/callback
 * 4. We verify/create user and generate JWT
 * 5. We redirect to frontend with JWT in query param
 */

import type { Express } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { storage } from "../storage";
import jwt from "jsonwebtoken";
import { users } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "unitefix-secret-key-2024";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5000"; // Frontend URL

// Serialization (not strictly used for JWT but required by Passport)
passport.serializeUser((user: any, done) => done(null, user.id));
passport.deserializeUser((id: any, done) => done(null, { id }));

// Helper to generate token
function generateToken(user: any) {
    return jwt.sign(
        { userId: user.id, role: user.role, username: user.username },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
}

export function registerSocialAuthRoutes(app: Express) {

    // Initialize Passport
    app.use(passport.initialize());

    // Google Strategy
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        passport.use(new GoogleStrategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "/api/auth/google/callback"
        }, async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value;
                if (!email) return done(new Error("No email found in Google profile"));

                // 1. Check if provider link exists
                let providerLink = await storage.findSocialProvider('google', profile.id);

                let user;

                if (providerLink) {
                    // User exists, update tokens
                    await storage.linkSocialProvider({
                        userId: providerLink.userId,
                        provider: 'google',
                        providerId: profile.id,
                        email,
                        accessToken,
                        refreshToken
                    });
                    user = await storage.getUser(providerLink.userId);
                } else {
                    // 2. Check if user exists by email
                    user = await storage.getUserByEmail(email);

                    if (!user) {
                        // 3. Create new user
                        const [newUser] = await db.insert(users).values({
                            username: profile.displayName,
                            email: email,
                            password: "", // No password for social users
                            role: "user",
                            isVerified: true
                        }).returning();
                        user = newUser;
                    }

                    // Link provider
                    await storage.linkSocialProvider({
                        userId: user!.id,
                        provider: 'google',
                        providerId: profile.id,
                        email,
                        accessToken,
                        refreshToken
                    });
                }

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }));

        // Routes
        app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

        app.get('/api/auth/google/callback',
            passport.authenticate('google', { session: false, failureRedirect: '/login?error=auth_failed' }),
            (req: any, res) => {
                const token = generateToken(req.user);
                res.redirect(`${CLIENT_URL}/auth/success?token=${token}`);
            }
        );
    }

    // Facebook Strategy
    if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
        passport.use(new FacebookStrategy({
            clientID: process.env.FACEBOOK_APP_ID,
            clientSecret: process.env.FACEBOOK_APP_SECRET,
            callbackURL: "/api/auth/facebook/callback",
            profileFields: ['id', 'displayName', 'photos', 'email']
        }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
            try {
                const email = profile.emails?.[0]?.value;
                // Facebook might not return email

                let providerLink = await storage.findSocialProvider('facebook', profile.id);
                let user;

                if (providerLink) {
                    await storage.linkSocialProvider({
                        userId: providerLink.userId,
                        provider: 'facebook',
                        providerId: profile.id,
                        email,
                        accessToken,
                        refreshToken
                    });
                    user = await storage.getUser(providerLink.userId);
                } else {
                    // If we have email, try to find user
                    if (email) {
                        user = await storage.getUserByEmail(email);
                    }

                    if (!user) {
                        // Create new user (might miss email if FB didn't provide it)
                        const [newUser] = await db.insert(users).values({
                            username: profile.displayName,
                            email: email || `fb_${profile.id}@noemail.com`,
                            password: "",
                            role: "user",
                            isVerified: true
                        }).returning();
                        user = newUser;
                    }

                    await storage.linkSocialProvider({
                        userId: user!.id,
                        provider: 'facebook',
                        providerId: profile.id,
                        email,
                        accessToken,
                        refreshToken
                    });
                }

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }));

        // Routes
        app.get('/api/auth/facebook', passport.authenticate('facebook', { scope: ['email'] }));

        app.get('/api/auth/facebook/callback',
            passport.authenticate('facebook', { session: false, failureRedirect: '/login?error=auth_failed' }),
            (req: any, res) => {
                const token = generateToken(req.user);
                res.redirect(`${CLIENT_URL}/auth/success?token=${token}`);
            }
        );
    }
}
