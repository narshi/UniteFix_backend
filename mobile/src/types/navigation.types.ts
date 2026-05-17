/**
 * Navigation type definitions
 */

export type AuthStackParamList = {
    Splash: undefined;
    RoleSelection: undefined;
    TruecallerAuth: { role: 'user' | 'serviceman' };
    EmployeePending: undefined;
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
    StartTab: undefined;
    WalletTab: undefined;
    ProfileTab: undefined;
};

// Stack params for nested navigators
export type HomeStackParamList = {
    Home: undefined;
    AllServices: undefined;
    ServiceRequest: { serviceType?: string };
    Notifications: undefined;
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
