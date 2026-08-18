/**
 * Navigation type definitions
 */

export type AuthMode = 'login' | 'signup';

export type AuthStackParamList = {
    Splash: undefined;
    /** Explicit fork: create a new account vs sign in to an existing one. */
    AuthLanding: undefined;
    /** Role is only chosen when signing up; on login the server supplies it. */
    RoleSelection: { mode: AuthMode };
    TruecallerAuth: { role: 'user' | 'serviceman'; mode: AuthMode };
    EmployeePending: undefined;
    Legal: undefined;
};

/**
 * Mandatory post-signup onboarding. Rendered by RootNavigator whenever an
 * authenticated account still has outstanding steps, so quitting the app
 * mid-onboarding resumes here rather than dropping into the product.
 */
export type OnboardingStackParamList = {
    OnboardingProfile: undefined;
    OnboardingLocation: undefined;
    ExpertiseSelection: undefined;
    ExpertCodeOfConduct: undefined;
    OnboardingMapPicker: { mode?: 'onboarding' } | undefined;
};


export type CustomerTabParamList = {
    HomeTab: undefined;
    BookingsTab: undefined;
    ShopTab: undefined;
    OrdersTab: undefined;
    ProfileTab: undefined;
};

export type PartnerTabParamList = {
    IncomingTab: undefined;
    HistoryTab: undefined;
    WalletTab: undefined;
    ProfileTab: undefined;
};

// Stack params for nested navigators
export type HomeStackParamList = {
    Home: undefined;
    AllServices: undefined;
    ServiceRequest: { serviceType?: string; serviceName?: string; serviceId?: number; basePrice?: number; selectedAddress?: any };
    Notifications: undefined;
    SavedAddresses: { fromCheckout?: boolean };
    MapAddressPicker: { editAddressIndex?: number } | undefined;
};

export type BookingsStackParamList = {
    MyRequests: undefined;
    RequestDetail: { id: number };
    OTPDisplay: { serviceId: number };
};

export type ShopStackParamList = {
    Products: { category?: string };
    ProductDetail: { id: number };
    Cart: undefined;
    Checkout: undefined;
    OrderConfirmation: { orderId: number };
};

export type OrdersStackParamList = {
    MyOrders: undefined;
    OrderDetail: { id: number };
    ReturnRequest: { orderId: number };
};

export type ProfileStackParamList = {
    Profile: undefined;
    EditProfile: undefined;
    SupportTicket: undefined;
};

// Partner stacks
export type IncomingStackParamList = {
    IncomingList: undefined;
    AssignmentDetail: { id: number };
};

export type PartnerHistoryStackParamList = {
    PastServices: undefined;
    ServiceDetails: { id: number };
};

export type StartServiceStackParamList = {
    OTPVerify: { serviceId: number };
    StartService: { serviceId: number };
    EnterCharges: { serviceId: number };
};
