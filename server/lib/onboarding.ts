/**
 * Onboarding completeness — single source of truth.
 *
 * Signup and login are distinct flows: a brand-new account MUST supply profile
 * details and a location before it can use the app, and technicians must also
 * declare at least one trade.
 *
 * Order matters — it is the order the client walks the user through:
 *   customer:   profile -> location
 *   technician: profile -> skills -> location
 *
 * Completeness is derived from the stored data rather than a boolean flag so it
 * cannot drift: if the data is there the user is onboarded, regardless of which
 * path (Truecaller / Firebase OTP / email OTP) created the account, and a client
 * that is killed mid-onboarding resumes exactly where it left off.
 */

export interface OnboardingSubject {
    username?: string | null;
    homeAddress?: string | null;
    pinCode?: string | null;
    role?: string | null;
}

export interface OnboardingEmployee {
    services?: string[] | null;
}

export type OnboardingStep = 'profile' | 'location' | 'skills';

/**
 * Returns the steps still outstanding, in the order they must be completed.
 * An empty array means onboarding is done.
 */
export function getPendingOnboardingSteps(
    user: OnboardingSubject | null | undefined,
    employee?: OnboardingEmployee | null,
): OnboardingStep[] {
    if (!user) return ['profile', 'location'];

    const pending: OnboardingStep[] = [];

    if (!user.username || !user.username.trim()) {
        pending.push('profile');
    }

    // Trades come straight after name/email, BEFORE location. An expert has just
    // said who they are; "what work do you do" is the natural next question,
    // and asking it while they are still describing themselves gets a far better
    // answer than burying it behind an address and map picker.
    // Technician-only — customers never see it.
    if (user.role === 'serviceman') {
        const services = employee?.services;
        if (!Array.isArray(services) || services.length === 0) {
            pending.push('skills');
        }
    }

    if (!user.homeAddress || !user.homeAddress.trim() || !user.pinCode || !user.pinCode.trim()) {
        pending.push('location');
    }

    return pending;
}

export function isOnboardingComplete(
    user: OnboardingSubject | null | undefined,
    employee?: OnboardingEmployee | null,
): boolean {
    return getPendingOnboardingSteps(user, employee).length === 0;
}
