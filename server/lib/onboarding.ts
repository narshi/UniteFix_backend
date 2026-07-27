/**
 * Onboarding completeness — single source of truth.
 *
 * Signup and login are distinct flows: a brand-new account MUST supply profile
 * details and a location before it can use the app, and technicians must also
 * declare at least one skill.
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

    if (!user.homeAddress || !user.homeAddress.trim() || !user.pinCode || !user.pinCode.trim()) {
        pending.push('location');
    }

    // Skills are technician-only.
    if (user.role === 'serviceman') {
        const services = employee?.services;
        if (!Array.isArray(services) || services.length === 0) {
            pending.push('skills');
        }
    }

    return pending;
}

export function isOnboardingComplete(
    user: OnboardingSubject | null | undefined,
    employee?: OnboardingEmployee | null,
): boolean {
    return getPendingOnboardingSteps(user, employee).length === 0;
}
