# Truecaller for Developers



---

## Page 1

1
Truecaller SDK
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 2

2
Hello!
Welcome to Truecaller SDK documentation!
Here you will find answers to all your queries on how to easily integrate Verification
via Truecaller feature into your mobile app and mobile sites.
What is Truecaller SDK?
Truecaller SDK is a mobile number verification service, which you can use wherever
you look to verify your users.
With more than 400+ million users globally, Truecaller is the largest mobile number
identity platform.
This means that these 400+ million users who have Truecaller mobile app on their
mobile devices, have created their profiles with Truecaller by verifying their mobile
numbers, and associating their identity.
Since these users are already mobile number verified, verification via Truecaller
enables you to quickly verify/ signup/ login your users, basis their mobile number -
without the need of any SMS based OTP, and at the same time capture their
mapped user profile.
Along with this, the SDK also gives you an option to verify users who do not have
the Truecaller app present on their devices, via the means of a drop call being
triggered to the user's device in background
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 3

3
Why Truecaller SDK?
Here are some advantages of using Truecaller SDK:
• Increase successful verification/ signup/ login attempts with already mobile
number verified Truecaller users.
• Avoid user drop-off and app abandonment with 1-tap, instant verification -
without any OTP SMS whatsoever.
• Simple, ZERO effort flow and avoid typos as users do not even need to type
mobile number.
• Auto-fill user registration form by capturing mapped user profile (user name,
email ID, city, etc.) post their consent.
• Achieve easy user activation and quick checkout with less number of steps/
screens.
• Optimize marketing spends and ROI by by reducing user drops resulting from
failed/ delayed SMS OTP and multiple steps.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 4

4
Getting Started
You should start by creating your developer account on the Truecaller Developer
portal here: https://sdk-console-noneu.truecaller.com/sign-up
a) Register with email ID and set a password.
b) Verify your email ID to proceed.
PS: The developer portal link shared above is only for registering android apps, if
you are looking to do the integration in Mobile Site, iOS or any other platform please
sign via this developer portal link : https://verification-sdk-
console.truecaller.com/sign-up
We recommend you to create your account with a team generic email ID, instead of a
personal email ID.
For example: Use techteam@truecaller.com
 or android@truecaller.com
, instead of
john.doe@truecaller.com
.
In case you do not see the account verification email in your Primary Inbox, please do
check for the same in your Other and Spam email inbox as well.
If you already have created your developer account, please login here
.
To reset your account password, please request for it here
.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 5

5
Android
OAuth SDK 3.0.0
SDK v2.8.0[Deprecating Soon ⚠ ]
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 6

6
[Latest]OAuth SDK 3.2.1
Implementing user flow for your App
Scenarios for all user verifications : Truecaller and Non Truecaller Users
Integration Steps
Instrumentation
Getting Release Ready
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 7

7
Implementing user flow for your App
Truecaller SDK is a mobile number verification service, without the need for any
OTP whatsoever.
The right way to implement Truecaller SDK in your mobile app, is to invoke mobile
number verification via Truecaller at touch points, where you have your users to
sign-up/ login/ checkout by verifying their mobile numbers.
Let us now see an example to understand how to effectively use Truecaller SDK at
such touch points in your user journey
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process.
For example, one could address it as Get Started, Join Us, Login, Sign up, etc.,
shown as a button to the users, clicking which leads to the mobile number based
identity verification of users.
Here is such an example from CentroStore - our very own in-house sample app:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 8

8
Building for Various Touch points
a. Invoking user signup/ login/ verification via Truecaller at app onboarding
Example: CentroStore - our very own in-house sample app
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process. For example, one could address it as Get Started,
Join Us, Login, Sign up, etc., shown as a button to the users, clicking which leads to
the mobile number-based identity verification of users. Here is such an example
from CetroStore.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 9

9
b. Directly invoking verification via Truecaller
Example : CentroStore - our very own in-house sample app
CentroStore has mobile number as the primary identifier for its users. So as soon as
users lands on their mobile number login/ signup screen, it invokes Verification via
Truecaller, and onboards itʼs users within seconds in just 1-tap.
c. Performing user verification at checkout
Example : CentroStore - our very own in-house sample app
CentroStore also allows users to browse through itʼs app and check for bus ETAs,
without needing to sign-up or log-in. However, when users wish to purchase the
ticket or travel pass, it requires users to verify their mobile number.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 10

10
Now that we have gone through and understood how to implement Verification via
Truecaller, letʼs get started with the SDK integration.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 11

11
Scenarios for all user verifications :
Truecaller and Non Truecaller Users
Truecaller SDK enables you to verify your user's mobile number in a seamless way.
For users who have the Truecaller app present on their smartphones and are
already registered Truecaller users, they get verified in a 1-tap flow (supported
globally), without the need of any manual input.
For users who don't have the Truecaller app present on their smartphones, the SDK
enables user verification by means of a drop call, which is triggered to the user's
number in the background to complete the verification flow (currently supported
only for India).
To understand various possible user scenarios in the user's verification flow, let's
try to take the example of CentroStore. CetroStore is using Truecaller SDK for
verifying the numbers of all their users.
Scenario 1 
a) New user on CentroStore app and 
b) Truecaller app present on user's smartphone
Scenario 2 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 12

12
a) Existing user on CentroStore app, and 
b) Truecaller app present on smartphone
Scenario 3 
a) New user on CentroStore app, and
b) Truecaller app NOT present on a smartphone, and user's mobile number NOT
already verified on smartphone
Scenario 4 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 13

13
a) Existing user on CentroStore app, and 
b) Truecaller app NOT present on smartphone and user's mobile number NOT
verified on smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 14

14
Integration Steps
Step by step guide to integrate Truecaller OAuth SDK with your android project.
In order to proceed with the integration, please refer to the previous sections
 so as
to understand various user flows and touch points in the user journey where Truecaller
can be enabled.
• Register on the OAuth portal
  to create your business account and manage
OAuth projects.
• Once you have created your account, create your OAuth project & generate
credentials by following the steps here.
• Once you have generated the credentials, you can easily, in a few simple steps
integrate the Truecaller SDK by referring to our step-by-step guide in the
subsequent sections.
• Post integration completion, submit your project for review and go live.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 15

15
Generating Client ID
To ensure the authenticity of interactions between your app and Truecaller, you
need to generate a client ID from the Truecaller developer portal by following the
steps below:
• Go to https://sdk-console-noneu.truecaller.com/login
 and register your
account.
• Once registered, log in to your account and click on the "create project” button.
• Enter the project name and select the business category from the dropdown
menu. This will create a new project.
• On the project screen, click the “add credential” button and select the platform
as Android from the dropdown menu.
• On the credential section, enter the package name and the SHA1.
• Your package name corresponds to the applicationId in your app level 
build.gradle  file.
You can get to know the SHA1 for your different app builds by following these steps
:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 16

16
• Open your project in android studio
• Open terminal
• Type command ./gradlew signingReport
Once done you should be able to see the SHA1 fingerprint of your different build
configurations [ debug /release ] in the terminal window within the android studio.
Once you input your app details and create the app, you will be able to see a unique
"ClientID" for your app which you need to include in your project to authorise all
verification requests.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 17

17
Setup
1.Ensure that your Minimum SDK version is at least API level 24 or above. In case
your android project compiles for API level below 24, you can include the
following line in your AndroidManifest.xml file to avoid any compilation issues :
<uses-sdk tools:overrideLibrary="com.truecaller.android.sdk"/> 
Using this would ensure that the SDK works normally for API level 24 & above,
and would be disabled for API level < 24. Note: Please make sure that you put
the necessary API level checks before accessing the SDK methods in case of
compiling for API level < 24
2.
2.1) Add the Truecaller SDK which contains OAuth functionality to your app-
level build.gradle file 
dependencies {
...
implementation "com.truecaller.android.sdk:truecaller-sdk:3.2.0"
} 
2.2) Also, add the following lines of code in your gradle file, if not already
present
android{
compileOptions{
sourceCompatibility JavaVersion.VERSION_1_8
targetCompatibility JavaVersion.VERSION_1_8
}
} 
3.Add mavenCentral() in your project level build.gradle file :
allprojects{
   repositories{
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 18

18
 ...
       mavenCentral()
 ...
} 
Also check your AGP and distribution URL version AGP : 7.4.2 (minimum)
distributionUrl=https\://services.gradle.org/distributions/gradle-7.5-bin.zip
(minimum).
4.Configure Client ID : 
a.) Open your strings.xml file. Example path: /app/src/main/res/values/strings.xml
and add a new string with the name "clientID" and value as your "clientID"
b.) Open your AndroidManifest.xml and add a meta-data element to the application
element
<application android:label="@string/app_name" ...>
...
<meta-data android:name="com.truecaller.android.sdk.ClientId" 
android:value="@string/clientID"/>
...
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 19

19
Implementing Callbacks
4.In your Activity/Fragment where you want to integrate the Truecaller OAuth flow,
either make the component implement the interface TcOAuthCallback or create
an instance of it which you would require to initialize TcSdkOptions in the next
step.
The interface has 2 functions which need to be overridden -
• onFailure() method will be called in case of an error. You would get the error
details like the error code and error message through tcOAuthError returned
with this method.
• onSuccess() method will be called when the user gives consent to authorize
your app by tapping on the primary button on the Truecallerʼs consent screen,
and subsequently, an authorization code will be successfully generated and
received. This method would return tcOAuthData, which contains information
like :
Auth Parameters [Live]
◦ authorizationCode - which you can utilize to fetch the userʼs access token
◦ scopesGranted - list of scopes granted by the user
◦ state - state parameter returned by the authorisation server. If the state set
by your application is the same as the state returned by the authorisation
server, itʼs safe to proceed further. If state parameters are different,
someone else has initiated the request, and it could be a case of request
forgery.
private val tcOAuthCallback: TcOAuthCallback = object : TcOAuthCallback 
{
    override fun onSuccess(tcOAuthData: TcOAuthData) {
        ..
    }
    override fun onFailure(tcOAuthError: TcOAuthError) {
        ..
    }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 20

20
[New] Sim and Device Info Parameters [EAP - for access, mail us at
developersupport@truecaller.com]
◦ Sim Status - This will be a parameter returned to you in successCallback,
which helps understand whether the number passed to you is actually
present on the device at the time of verification. In case it is present, the
variable returns 1, In case it's not present, the variable returns 0, and in
case, due to OS level restrictions, the SDK is not able to detect it, the
variable returns -1
◦ Device Code - This parameter helps you tie the number onboarded on your
platform to a particular device identifier. This parameter for a user on a
device will always be the same until the Truecaller profile is changed on that
very device OR the user is using some other device to verify their number.
5.Call onActivityResultObtained() within the registerForActivityResult() like below:
and then assign it to a variable   to use it under step 13 (Invocation
).
val launcher = registerForActivityResult(StartActivityForResult()) { 
result: ActivityResult ->
    TcSdk.getInstance().onActivityResultObtained(requireActivity(), 
result.resultCode, result.data)
}
(Ex: launcher)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 21

21
Initialisation
6.Create a TcSdkOptions object by using the tcOAuthCallback from the previous
step and provide the context. Supply the appropriate customization settings to
the relevant methods of TcSdkOptions and use the instance of tcSdkOptions to
initialize the TcSdk in the next step.
In case you do not wish to provide any customization settings and fall back to the
default SDK settings, you may simply call -
7.Initialize TcSdk using the tcSdkOptions from the previous step :
Note: Truecaller OAuth SDK needs to be initialized only once in the component and
the same instance can be accessed without the need to initialize it again, via 
TcSdk.getInstance()
Ideally, you should call the init() method when the component is getting
created/initialized to avoid calling it multiple times.
The SDK init should always happen in a background thread. You can refer to an
example snippet below  : 
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback)
.buttonColor(Color.parseColor("<<VALID_COLOR_HEX_CODE>>"))
          .buttonTextColor(Color.parseColor("
<<VALID_COLOR_HEX_CODE>>"))
            
.loginTextPrefix(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
            .ctaText(TcSdkOptions.CTA_TEXT_CONTINUE)
            .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
            .footerType(TcSdkOptions.FOOTER_TYPE_SKIP)
            .consentTitleOption(TcSdkOptions.SDK_CONSENT_TITLE_LOG_IN)
            .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback).build()
TcSdk.init(tcSdkOptions)
[Recommended]
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 22

22
8.Once the SDK is initialized, check whether the OAuth functionality is usable or
not by calling :
If isUsable is True, you can proceed with further steps, otherwise, youʼd have to fall
back to some other mechanism ( your fallback verification flow ). Calling other SDK
methods when isUsable is False would result in an exception, so please ensure to
call this soon after initializing the SDK, and proceed to further steps only if this
method returns True.
launch {
  withContext(Dispatchers.IO) {
     TcSdk.init(tcSdkOptions)
// Now can access TcSdk.getInstance()
}
val isUsable = TcSdk.getInstance().isOAuthFlowUsable
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 23

23
Setting up OAuth parameters
9.Set a unique state parameter & store it in the current session to use it later in the
onSuccess() callback method of the TcOAuthCallback to match if the state
received from the authorization server is the same as set here to prevent
request forgery attacks.
One good choice for a state token is a string of around 32 characters constructed
using a high-quality random-number generator as we did above. Another approach
could be a hash generated by signing some of your session state variables with a
key that is kept secret on your back-end.
Truecaller OAuth SDK already verifies the request-response correlation before
forwarding it to the your app.
10.Set the list of scopes to be requested.
11.Generate a unique code verifier & store it in the current session since it would
be required later to generate the access token. It can be generated using the
utility class CodeVerifierUtil provided in the SDK.
stateRequested = BigInteger(130, SecureRandom()).toString(32)
TcSdk.getInstance().setOAuthState(stateRequested)
TcSdk.getInstance().setOAuthScopes(arrayOf("profile", "phone", ...))
// Currently available list of scopes :
- profile
- phone
- openid
- offline_access
- email
- address
Note : 
Please include the relevant scopes for your project. 
Make sure the scopes you’re requesting above are selected on the portal 
for your project
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 24

24
This utility method generates a random code verifier string using SecureRandom as
the source of entropy with 64 as the default entropy quantity.
12.Set the corresponding code challenge using the code verifier generated in the
previous step. This can be generated using the utility class CodeVerifierUtil
provided in the SDK.
This utility method produces a code challenge from the supplied code verifier using
SHA-256 as the challenge method and Base64 as encoding if the system supports
it (all Android devices should ideally support SHA-256 and Base64), but in rare
case if the device doesnʼt, then this method would return null meaning that you
canʼt proceed further. Please ensure to have a null safe check for such cases.
codeVerifier = CodeVerifierUtil.generateRandomCodeVerifier()
val codeChallenge = CodeVerifierUtil.getCodeChallenge(codeVerifier)
codeChallenge?.let {
                TcSdk.getInstance().setCodeChallenge(it)
} ?: print(“Code challenge is Null. Can’t proceed further”)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 25

25
Invocation
13.You can trigger the Truecaller profile verification dialog anywhere in your app
flow by calling the following method
where the launcher is derived in step 5 (Implementing Callback
)
In case isOAuthFlowUsable() method returns false, implying that the Truecaller app
is not present on the device, you can take the user to your app screen and continue
with the verification flow for non-Truecaller users or implement your fallback
verification mechanism.
Please note that the instance you pass in the method above should be of the
activity/fragment where you have initialized the SDK.
TcSdk.getInstance().getAuthorizationCode(this, launcher)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 26

26
Customisation
Truecaller SDK provides you with capabilities to configure the following:
Refer to the section below for details on all the customization capabilities and the
possible values you may set:
Consent Mode Style  [ .consentMode() ] 
To align the consent screen with your UX, which could either be centrally or bottom
aligned, choose either of the consent screens, making the SDK integration more
homogeneous with your app UX. 
TcSdkOptions.Builder(this, tcOAuthCallback)
       .consentMode(TcSdkOptions.CONSENT_MODE_BOTTOMSHEET) 
       .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
       .footerType(TcSdkOptions.FOOTER_TYPE_ANOTHER_MOBILE_NO)
       .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
       .ctaText(TcSdkOptions.CTA_TEXT_ACCEPT)
       .heading(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
       .buttonColor(1111)
       .buttonTextColor(1111)
       .build()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 27

27
Contextual header [ .heading() ] 
To provide the appropriate context of verification to the Truecaller user, use one of
the below mentioned TruecallerSdkScope values to show the corresponding
message to the user
Consent Mode Value
Consent Mode - Center PopUp TcSdkOptions.CONSENT_MODE_POPUP
Consent Mode - Bottomsheet TcSdkOptions.CONSENT_MODE_BOTTOMS
HEET
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 28

28
Log in to TcSdkOptions.SDK_CONSENT_HEADING_L
OG_IN_TO
Sign up with TcSdkOptions.SDK_CONSENT_HEADING_SI
GNUP_WITH
Sign in to TcSdkOptions.SDK_CONSENT_HEADING_SI
GN_IN_TO
Verify number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_NUMBER_WITH
Register with TcSdkOptions.SDK_CONSENT_HEADING_RE
GISTER_WITH
Get started with TcSdkOptions.SDK_CONSENT_HEADING_GE
T_STARTED_WITH
Proceed with TcSdkOptions.SDK_CONSENT_HEADING_PR
OCEED_WITH
Verify with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_WITH
Verify profile with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_PROFILE_WITH
Verify your profile with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_YOUR_PROFILE_WITH
Verify your phone number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_PHONE_NO_WITH
Verify your number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_YOUR_NO_WITH
Continue with TcSdkOptions.SDK_CONSENT_HEADING_C
ONTINUE_WITH
Complete order with TcSdkOptions.SDK_CONSENT_HEADING_C
OMPLETE_ORDER_WITH
Place order with TcSdkOptions.SDK_CONSENT_HEADING_PL
ACE_ORDER_WITH
Complete booking with TcSdkOptions.SDK_CONSENT_HEADING_C
OMPLETE_BOOKING_WITH
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 29

29
Button text options [ .ctaTextPrefix() ] 
To set the prefix on the CTA button
Button shape [ .buttonShapeOptions() ] 
To chose the shape of the CTA button
Checkout with TcSdkOptions.SDK_CONSENT_HEADING_C
HECKOUT_WITH
Manage Details with TcSdkOptions.SDK_CONSENT_HEADING_M
ANAGE_DETAILS_WITH
Manage your details with TcSdkOptions.SDK_CONSENT_HEADING_M
ANAGE_YOUR_DETAILS_WITH
Login to <<APP_NAME>> with one tap TcSdkOptions.SDK_CONSENT_HEADING_L
OGIN_TO_WITH_ONE_TAP
Subscribe to TcSdkOptions.SDK_CONSENT_HEADING_S
UBSCRIBE_TO
Get updates from TcSdkOptions.SDK_CONSENT_HEADING_GE
T_UPDATES_FROM
Continue reading on TcSdkOptions.SDK_CONSENT_HEADING_C
ONTINUE_READING_ON
Get new updates from TcSdkOptions.SDK_CONSENT_HEADING_GE
T_NEW_UPDATES_FROM
Log in/ Signup with TcSdkOptions.SDK_CONSENT_HEADING_L
OGIN_SIGNUP_WITH
Continue TcSdkOptions.CTA_TEXT_CONTINUE
Proceed TcSdkOptions.CTA_TEXT_PROCEED
Accept TcSdkOptions.CTA_TEXT_ACCEPT
Confirm TcSdkOptions.CTA_TEXT_COFIRM
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 30

30
Footer CTA text [ .footerType() ] 
To configure the text of the additional footer CTA present at the bottom
Dark Theme
To set the consent screen in dark mode, you can call 
TcSdk.getInstance().setTheme(OAuthThemeOptions.DARK)
just before calling the 
TcSdk.getInstance().getAuthorizationCode(this, launcher)
By default, the SDK is configured with the light theme. 
Privacy policy : 
To add your privacy policy link on the verification screen, you can configure the
respective hyperlink from your developer account
Terms of service: To add your terms of service link on the verification screen, you
can configure the respective hyperlink from your developer account
Round TcSdkOptions.BUTTON_SHAPE_ROUNDED
Rectangle TcSdkOptions.BUTTON_SHAPE_RECTANGL
E
Use another number TcSdkOptions.FOOTER_TYPE_CONTINUE
Use another method TcSdkOptions.FOOTER_TYPE_ANOTHER_M
ETHOD
Enter details manually TcSdkOptions.FOOTER_TYPE_MANUALLY
Later TcSdkOptions.FOOTER_TYPE_LATER
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 31

31
Language: You can optionally customize the consent screen in any of the
supported languages. To do so, add the following line :
Copy
Currently supported languages:
val locale = Locale("hi") // change language to Hindi
TcSdk.getInstance().setLocale(locale)
english en
hindi hi
marathi mr
telugu te
malayalam ml
urdu ur
punjabi pa
tamil ta
bengali bn
kannada kn
swahili sw
arabic ar
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 32

32
Clearing SDK Instance
In order to clear the resources taken up by the SDK, you may use the following
method
TcSdk.clear()
Ideally, you should call this method when the component in which you initialized the
SDK is getting killed/destroyed.
For instance, if you have initialized the SDK in the onCreate() method of the activity
lifecycle, then you need to call clear it in the onDestroy() method of the activity
lifecycle.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 33

33
Handling Error Scenarios
Failure/ Error responses
The "onFailure" callback method that you just implemented in the previous step
helps you to handle all the possible failure cases when the user couldn't be verified
successfully via the Truecaller flow.
Below are some of the possible failure scenarios and the corresponding error
response that you receive for each of the cases :
Please note that when you encounter any of the error scenarios and get the control
in the "onFailure()" method, you should redirect the user to your alternate
verification flow.
Error Description Error Code
"Something went wrong" 0
"Device is not supported" 16
"Truecaller user has an invalid account
state" 10
"Invalid partner or partner information is
missing" 12
"Conflicting request code possible in
onActivityResult()" 6
"Truecaller app closed unexpectedly" 7
"Truecaller app is not installed/loggedin" 5
"User denied by pressing the footer button" 11
"User denied by dismissing consent
screen" 14
"User denied while loading" 2
"Truecaller sdk is old and not compatible" 6
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 34

34
Exceptions
In case you face any of the following run time exceptions, please follow the
recommended steps as mentioned below :
"No compatible client available. Please change your scope"
As the exception suggests, you are trying to call an SDK method even though no
client is available to handle it. This usually happens if you have initialized the SDK
using ONLY_TC_USERS scope option i.e to verify only the Truecaller users, and you
are not calling isOAuthFlowUsable() method before calling an SDK method. To
resolve this, call isOAuthFlowUsable() before calling any SDK method if you are
using VERIFY_TC_USERS scope option.
"Please call init() on TruecallerSDK first"
This exception suggests that you are trying to call an SDK method before the SDK
has been initialised. To resolve it, check for all possible user flows in your app
which could lead to calling an SDK method directly before it has been initialised.
"Add client id in your manifest"
This exception suggests that you are trying to call SDK initialization/build method
without having your clientID mentioned in your manifest as meta-data.
"OAuth scopes cannot be null or empty"
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the OAuth scopes.
"OAuth state cannot be null or empty"
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the OAuth state.
“Code challenge cannot be null or empty”
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 35

35
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the Code challenge.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 36

36
Integrating with your Backend
Fetching User Token
Fetching User Profile
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 37

37
Fetching User Token
Using the “state” from step 10, “code verifier” from step 12, and the “authorization
code” from step 9, you need to make a network call to Truecallerʼs backend so as to
fetch the access token :
POST https://oauth-account-noneu.truecaller.com/v1/token
Headers
Request Body
200: OK Success 
{ 
"access_token": "some-access-token", 
"expires_in": 3600, 
"token_type": "Bearer" 
}
Name Type Description
Content-Type* application/x-www-form-
urlencoded
String
Name Type Description
grant_type "authorization_code" // hardcoded value
String
client_id <YOUR_CLIENT_ID>
code <USER_AUTHORISATION_C
ODE>
Authorisation code from
TcOAuthData callback from
step 9
code_verifier <YOUR_CODE_VERIFIER> From step 12
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 38

38
400: Bad Request -  If grant type is not supported
403: Forbidden - If client id is invalid
500: Internal Server Error - Unexpected error on the server side
400: Bad Request  - Some of the parameters are empty in the request
403: Forbidden Valid grant type but not allowed for the client
403: Forbidden Invalid auth code provided
403: Forbidden Invalid/expired auth code in provided
403: Forbidden Invalid/expired code verifier is provided
429: Too Many Requests If the number of requests exceeds the allowed limit
503: Service Unavailable Resource unavailable due to server-side issue
Sample cURL request :
curl --location --request POST 'https://oauth-account-
noneu.truecaller.com/v1/token' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'grant_type=authorization_code' \
--data-urlencode 'client_id=<<your-client-id>>' \
--data-urlencode 'code=<<authorization_code>>' \
--data-urlencode 'code_verifier=<<your-code-verifier>>'
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 39

39
Fetching User Profile
Make a network call to fetch the userInfo using access token from step 14. The
response would be corresponding to the scopes granted by the user.
GET https://oauth-account-noneu.truecaller.com/v1/userinfo
Headers
200: OK 
{
“sub”: “13627101294235520", 
“given_name”: “xyz”,  
“family_name”: “xyz”, 
“phone_number”: “91xxxxxxxxxx", 
“email”: “pqr@gmail.com”,
“picture”: “https://www.truecaller.com/xyz”, 
“gender”: “male/female”,
“phone_number_country_code”: “IN”,
“phone_number_verified”: true, 
ˇ “address”: { “locality”: “Bangalore”, “postal_code”: “5xxxxx" }
}
401: Unauthorized If authentication type is not bearer token
404: Not Found Profile information is not present for the user
500: Internal Server Error Failed to validate token due to server error
Name Type Description
Authorization* "Bearer
<ACCESS_TOKEN>"
Insert access token from
the previous step - fetching
user token
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 40

40
401: Unauthorized Token in invalid/ expired
422: Unprocessable Entity openid scope missing in initial request
500: Internal Server Error Unexpected error at server side
Sample cURL request :
curl --location --request GET 'https://oauth-account-
noneu.truecaller.com/v1/userinfo' \
--header 'Authorization: Bearer testtoken'
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 41

41
Non Truecaller User Verification
This section defines the steps that can be used to trigger verification of non
Truecaller app users which will be powered via Truecaller's drop call based
verification flow
In order to verify both the Truecaller users (via OAuth Flow) and the non-Truecaller
users (via manual verification), follow these steps :
1.Enable the Non Truecaller user verification capability for your app, by going to
your project on the Truecaller developer portal and navigating to the bottom
section.
2.Configure sdkOptions in the TcSdkOptions Builder and supply a value of 
TcSdkOptions.OPTION_VERIFY_ALL_USERS to it like below.
3.Configure permissions required by the SDK :
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback)
.sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
. // other customizations (if any)
.build()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 42

42
4.Once you receive a callback in the 
TcOAuthCallback#onVerificationRequired() , you can initiate the verification
for the user by calling the following method:
Here -
• the first parameter is the country code of the mobile number for which the
verification needs to be triggered
• the second parameter (PHONE_NUMBER_STRING) is the mobile number to be
verified. Please ensure proper validations are in place so as to send correct
phone number string to the above method, otherwise an exception would be
thrown
• the third parameter is an instance of VerificationCallback as defined here
• the fourth parameter is an instance of FragmentActivity
Please note that Truecaller OAuth SDK v3.0.0 currently supports the verification for
non-Truecaller users for Indian numbers only
For Android 8 and above :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.ANSWER_PHONE_CALLS"/>
For Android 7 and below :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.CALL_PHONE"/>
try{
  TcSdk.getInstance().requestVerification("IN", <PHONE_NUMBER>, 
verificationCallback, context);
}catch (RuntimeException e){
  Log.i(TAG, e.getMessage());
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 43

43
5.Once you initiate the verification via 
TcSdk.getInstance().requestVerification()  method, you will receive either a
callback in your VerificationCallback  instance with a specific requestType
as described below
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 44

44
override fun onRequestSuccess(callbackType: Int,verificationDataBundle 
: VerificationDataBundle?) {
         when(callbackType){
   
   VerificationCallback.TYPE_MISSED_CALL_INITIATED)-> {
             //missed-call initiated
              if(verificationDataBundle != null){                  
              
verificationDataBundle.getString(VerificationDataBundle.KEY_TTL);         
              
verificationDataBundle.getString(VerificationDataBundle.KEY_REQUEST_NON
CE);
      }
       }
   VerificationCallback.TYPE_MISSED_CALL_RECEIVED)-> {
             //missed-call received
       }
       
       //OTP initiated via Truecaller IM
   VerificationCallback.TYPE_IM_OTP_INITIATED) -> {
          if(verificationDataBundle != null) {                  
              val ttl = 
verificationDataBundle.getString(VerificationDataBundle.KEY_TTL);         
              val requestNonce = 
verificationDataBundle.getString(VerificationDataBundle.KEY_REQUEST_NON
CE);
}
}
//OTP auto-read via Truecaller IM which you can pre-fill in the OTP 
view
             val otp = bundle.getString(VerificationDataBundle.KEY_OTP)
}
       
       
   VerificationCallback.TYPE_VERIFICATION_COMPLETE)-> {
             //verification complete
       }
   VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE)-> {
             //user already verified 
       }
   }
}
override fun onRequestFailure(callbackType: Int, trueException : 
TrueException) {
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 45

45
onRequestSuccess() method is called under any of the following scenarios -
• When the OTP via Truecaller IM is successfully initiated for the input mobile
number. In this case, you will get the callbackType as 
VerificationCallback.TYPE_IM_OTP_INITIATED
• When the OTP via Truecaller IM is successfully detected on that device by the
SDK present in your app. In this case, you will get the callbackType as 
VerificationCallback.TYPE_IM_OTP_RECEIVED 
• When drop call is successfully initiated for the input mobile number. In this case,
you will get the callbackType as 
VerificationCallback.TYPE_MISSED_CALL_INITIATED
• When drop call is successfully detected on that device by the SDK present in
your app. In this case, you will get the callbackType as 
VerificationCallback.TYPE_MISSED_CALL_RECEIVED
• When the verification is successful for a particular number. In this case, you will
get the callbackType as VerificationCallback.TYPE_VERIFICATION_COMPLETE
• When the user is already verified on that particular device before. In this case,
you will get the callbackType as 
VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE
When callbackType is VerificationCallback.TYPE_MISSED_CALL_INITIATED , you
will receive an additional parameter for the time to live i.e TTL (in seconds) which is
passed as String extra in the VerificationDataBundle  of onRequestSuccess() .
This value determines amount of time left to complete the verification. You can use
this value to show a waiting message to your user before they can try for another
attempt.
Once the TTL expires, you can either auto-retry the verification by calling the
requestVerification() method automatically with the same input parameters OR you
can also take the user back to the number input screen to enter a different number
for verification.
//Exception
    }
   
};
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 46

46
When the callbackType is VerificationCallback.TYPE_ALREADY_VERIFIED_BEFORE
or VerificationCallback.TYPE_VERIFICATION_COMPLETE , it means that the user
verification via Truecaller SDK is complete. In these cases, the SDK will share an
additional access token with your application, which you may then use to validate
the response at your server end. To fetch the access token, you may use the
following code snippet :
Post fetching the access token, you may perform the server side validation by
referring to the steps mentioned in the later part of the documentation here
onRequestFailure() method will be called when some error has occurred while
verifying the provided mobile number. You will receive the appropriate error
message from TrueException using TrueException#getExceptionMessage().For
details of different possible error types you may encounter, please refer to the 
TrueException
//For when the control goes to TYPE_ALREADY_VERIFIED_BEFORE 
verificationDataBundle.getProfile().accessToken
//For when the control goes to TYPE_VERIFICATION_COMPLETE 
verificationDataBundle.getString(VerificationDataBundle.KEY_ACCESS_TOKE
N)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 47

47
Completing Verification
To complete the verification you need to create a TrueProfile instance by passing
the user's first and last name as defined above.
Please note that the first name and last name values to be passed in the above
method call need to follow below mentioned rules :
• The strings need to contains at least 1 alphabet, and cannot be completely
comprised of numbers or special characters.
• String length should be less than 128 characters.
• First name is a mandatory field, last name can be empty ( but non nullable ).
Once you receive a callback in your VerificationCallback instance with the
callbackType TYPE_MISSED_CALL_RECEIVED   or TYPE_IM_OTP_RECEIVED  , you can
complete the verification process by calling the following method from within your
activity :
Please note that Truecaller SDK 3.1.0 is not by default enabled for the IM OTP flow.
This new update is currently under early access. In case you want to enable it for
your app, please drop in a request at developersupport@truecaller.com 
TrueProfile profile = new TrueProfile.Builder(firstName, 
lastName).build();
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 48

48
TrueException
Handling error responses for cases of verifying non-Truecaller users
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 49

49
Error Code Error Message Description
4 "Desired permissions are
missing"
When the requisite
permissions are missing or
not granted while making
the verification request
6 “Sim state is not ready” When the SIM state on the
device is not ready
7 “Airplane mode is ON”
When the device is on
airplane mode, hence
causing missed call to not
go through
2 "Phone number limit
reached”
When the used mobile
number has exceeded the
maximum number of
allowed verification
attempts within a span of
24 hours from the time the
first verification attempt
was made
2 “Request id limit reached”
When the used device
exceeds the maximum
number of allowed
verification attempts in a
span of 24h
2 “Invalid partner credentials.
When the partner key ( app
key ) you have configured in
your project is incorrect.
Visit here
 for more info
2 “Something went wrong:
Failed to create installation.”
In case of Truecaller
internal service error
2 “Invalid phone number”
When the input mobile
number is not a valid mobile
number
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 50

50
2 “Profile has not been
created yet”
When the user has been
successfully verified, but
for some reason their profile
is not created which could
be due to incorrect profile
data while creating
TrueProfile() in
verifyMissedCall method or
due to network issues
5 “Invalid Name”
When the string entered in
the profile builder method
doesnʼt follow the validation
checks :
{
min 1 char, max 128, at least
1 alphabet required with
optional numeric and
special chars,
cannot be all numeric or all
special characters, but can
be all alphabets
}
Refer here
 for more info
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 51

51
Server Side Validation
Once the SDK shares the accessToken for any user verified via drop call based
verification flow, you can verify the authenticity of the access token by making API
call from your server to Truecaller's server. The following endpoint will return phone
number and country code for the given access token.
API Endpoint:
REQUEST :
Method : GET
Header Parameters:
Request Path Parameters:
RESPONSE:
• 200 OK - If access token is valid
"https://sdk-otp-verification-
noneu.truecaller.com/v1/otp/client/installation/phoneNumberDetail/{acce
ssToken}"
Parameter Name Required Description Example
clientId yes Client ID
zHTqS70ca9d3e016
946f19a65b01dRR5
e56460
Parameter Name Required Description Example
accessToken yes
token granted for
the partner for the
respective user
number that
initiated login
"71d8367e-39f7-
4de5-a3a3-
2066431b9ca8"
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 52

52
• 404 Not Found - If your credentials are not valid
• 404 Not Found - If access token is invalid
• 500 Internal Error - for any other internal error
{
    "phoneNumber":919999XXXXX9
    "countryCode":"IN"
}
{
    "code":404
    "message":"Invalid partner credentials."
}
{
    "code":1404
    "message":"Invalid access token."
}
{
    "code":500
    "message":"error message"
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 53

53
Instrumentation
Quick guide on how to properly track and instrument funnel for the verification flow
of users via Truecaller on your app
For proper tracking of the verification funnel via Truecaller SDK on your app, we
recommend you to implement tracking events for the following states :
When you are using the SDK for verification of Truecaller users only:
1.Total users coming to your verification flow
2.Number of cases when the Truecaller app is present on your smartphone
3.Number of profile verification requests made by your app ( when 
TcSdk.getInstance().isOAuthFlowUsable  method is invoked )
4.Number of users who proceed with this flow and click Continue on the
Truecaller dialog [ for these cases, you receive a success callback with
TcOAuthData response in onSuccess() callback method ]
5.Number of cases where you received any error, where you receive an error
callback with TcOAuthError response in onFailure() callback method. For details
on specific error codes, please refer here
When you are using the SDK for verification of non-Truecaller users also ( via
drop call):
1.Total users coming to your verification flow.
2.Number of cases, when the Truecaller app is present on your smartphone and
users, get verified via the Truecaller 1-tap flow (as described in the above
section)
3.Number of verification requests made by your app for a non-Truecaller user (
when TruecallerSDK.getInstance().requestVerification()  method is
invoked ).
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 54

54
4.Number of cases where the user is getting verified for the very first time on the
current smartphone and you receive a success callback - onRequestSuccess()
method ( Please refer here
 ) - a.) When the callback type you receive is 
VerificationCallback.TYPE_MISSED_CALL_INITIATED . This implies that a drop
call has been triggered to the user's mobile number b.) When the callback type
you receive is VerificationCallback.TYPE_MISSED_CALL_RECEIVED . This implies
that a drop call has been received on the user's mobile number on that
smartphone c.) Further to the above step, you complete the user verification by
invoking TcSdk.getInstance().verifyMissedCall(profile, 
verificationCallback) When the callback type you receive is either 
VerificationCallback.TYPE_VERIFICATION_COMPLETE . This implies that the
verification is complete for the user d.) Number of cases where the user is
already verified previously on the current smartphone and gets verified directly.
In such cases, you receive the success callback - onRequestSuccess() method
with callback type as VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE .
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 55

55
Getting Release Ready
Testing your verification flow
Google play store app permission declaration form
Moving to Production
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 56

56
Testing your verification flow
Non Truecaller User Verification
Truecaller user verification flow
Test Setup
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 57

57
Non-Truecaller user verification flow
Common scenarios to check for in you app verification flow for non-Truecaller
users
If the user does not have the Truecaller app present on their device or they chose to
verify using a different number than the one already verified on Truecaller app
currently, they can be taken to this flow in which we provision the verification of the
user by sending missed call using our infrastructure.
User verifying via Truecaller's missed call mechanism for the very first time
Proceed to the flow where the user needs to input their mobile number. Give the
necessary permissions ( as described here
 ) and proceed with the verification.
You would receive a missed call on the device which gets automatically detected by
the SDK. Post this, you need to pass the user's first name and last name to the SDK
to complete the verification
User already verified with the same credentials previously on the smartphone
Once a user's verification is completed successfully on a particular device, and
they re-attempt to verify on the same app using the same credentials ( same
smartphone, same mobile number ), Truecaller SDK is able to identify the user and
we can tell you it's the same user. In this case, no additional missed call / OTP is
needed to re-verify the user. The SDK will directly tell the status of the repeat user,
and in this case returns the first name and last name of the user back to you in
response.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 58

58
Truecaller user verification flow
Common scenarios to check for in you app verification flow for existing Truecaller
users
Truecaller app present and registration completed on Truecaller app
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Open your app and initiate the Truecaller
verification flow. The user should see the Truecaller profile dialog. Click on continue
to complete the verification flow and ensure that the verification is completed.
Truecaller app present but registration not completed on Truecaller app
Ensure that the Truecaller app is present on your device but you have not
completed the profile creation step on Truecaller app. Open your app and initiate
the Truecaller verification flow. The user should not see the Truecaller profile
dialog, and you would receive the control in onFailureProfileShared() with the
specific error code.
Truecaller app not present on the device
Remove the Truecaller app from your device. Open your app and try to initiate the
Truecaller verification flow. The user should not see the Truecaller profile dialog
and should be taken to either your alternate verification flow or in case you are
using Truecaller SDK's functionality of verifying non-Truecaller users, user should
be redirected to that flow.
Network not available on device
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Turn off the mobile data and WiFi on
your device. Open your app and initiate the Truecaller verification flow. You would
see the Truecaller profile dialog. Click on continue button on the dialog, you would
receive control in onFailureProfileShared() method with a specific error code.
Client ID should be working fine ( onFailure() Error Type 12)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 59

59
For complete details on this part, please refer here.
User wishes to proceed with another number OR does not want to share their
Truecaller profile
Initiate the Truecaller verification flow in your app to invoke the Truecaller profile
dialog. Click on system back or Use another mobile number button on the dialog to
dismiss the dialog. In such a scenario, user should be taken to either your alternate
verification flow or in case you are using Truecaller SDK's functionality of verifying
non-Truecaller users, user should be redirected to that flow.
We also recommend that you go through the FAQ section to go through some of the
commonly asked questions.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 60

60
Test Setup
Quick guide on getting your test setup ready to test the common verification
scenarios as described in previous sections
Pre-Requisites
• We suggest you to keep handy at-least 2 android smartphones with active SIM
connections. Ensure that both the smartphones have your test app installed
(Integrated with Truecaller SDK)
• 2 different smartphones are required so that in case you get verified on one of
the smartphones, you can use the second smartphone to check for the fresh
verification scenarios.
Steps to follow for testing user scenarios :
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 61

61
User State App Scenario Steps
Existing Truecaller user
• Install Truecaller on
smartphone 'A'
• Complete profile
creation step on
Truecaller app
• Launch your application
and initiate the
Truecaller verification
flow
• Truecaller profile
consent screen should
appear
• Tapping on Continue
button should verify the
user
Non Truecaller User User getting verified for the
first time on smartphone
• Take smartphone 'A'
• Uninstall Truecaller app
from the smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs &
phone permissions are
asked ( if not already
granted )
• Allow the permissions
to enable receiving a
drop call
• User is manually asked
to enter name ( if it's a
new user on your app )
• On entering the name,
SDK verifies the user
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 62

62
Non Truecaller User
User already verified on the
smartphone and tried to re-
verify
( Please ensure that you try
this step only after you have
performed the above step )
• Take smartphone 'A'
• Launch your application
and logout from the app
• Initiate the verification
flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
Non Truecaller User
User already verified on the
smartphone, uninstalls and
re-installs the application
on the device
( Please ensure that you try
this step only after you have
performed the 2nd step )
• Take smartphone 'A'
• Uninstall your
application from the
smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 63

63
Wi-Fi or mobile internet should also be enabled on both the smartphones
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 64

64
Google play store app
permission declaration form
This section is only relevant for apps who are using the Truecaller SDK for verifying
non-Truecaller user as well and seek phone permissions from the users
If you are using the functionality of verifying non Truecaller users also via the SDK,
your app would need specific phone permissions as has been described in this 
section
. If you are using the Truecaller SDK for verification of existing Truecaller
users only ( 1-tap flow ), you can skip this section.
As you upload the new app build to PlayStore with user verification feature via
Truecaller SDK and the requisite permissions, you might be asked to fill an app
permission declaration form.
We are sharing some tips on how to appropriately justify the need for these
permissions for your verification flow :
#1: In one sentence, please describe the core functionality of your app. To be
defined by you as a publisher of your app
#2: What is the core functionality in your app requiring the Call Log and / or SMS
permissions? Mobile number verification to onboard users on <your_app>
This is in-line with Googleʼs allowed usage of this permission for account
verification via phone call, as stated here:
https://support.google.com/googleplay/android-developer/answer/9047303 Flow:
a)Enter mobile number b)Request READ_CALL_LOG permission c)Initiate drop call
from 3rd party service to respective number d)Drop call hits userʼs device and is
rejected automatically via above permission to complete verification
#3: Do any of the following disallowed use cases apply to your appʼs core
functionality request for Call Log or SMS permissions? NO
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 65

65
#4: Do any of the following other use cases apply to your appʼs core functionality
request for Call Log or SMS permissions? OTP & Account verification via Phone
Call (select this from the given list of options)
#5: Is your appʼs use of Call Log or SMS permissions to provide functionality
required by law or regulation? No
#6: Other We use drop call based verification of usersʼ mobile number for account
creation or logging into their <your app name> accounts. Such method of mobile
number verification results in better verification success rates in our key markets
like India, etc.
Android guidelines for asking app permissions from user 
https://developer.android.com/training/permissions/requesting
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 66

66
Moving to Production
Submitting your project for review post integration
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 67

67
OAuth SDK 3.2.0
Implementing user flow for your App
Scenarios for all user verifications : Truecaller and Non Truecaller Users
Integration Steps
Instrumentation
Getting Release Ready
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 68

68
Implementing user flow for your App
Truecaller SDK is a mobile number verification service, without the need for any
OTP whatsoever.
The right way to implement Truecaller SDK in your mobile app, is to invoke mobile
number verification via Truecaller at touch points, where you have your users to
sign-up/ login/ checkout by verifying their mobile numbers.
Let us now see an example to understand how to effectively use Truecaller SDK at
such touch points in your user journey
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process.
For example, one could address it as Get Started, Join Us, Login, Sign up, etc.,
shown as a button to the users, clicking which leads to the mobile number based
identity verification of users.
Here is such an example from CentroStore - our very own in-house sample app:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 69

69
Building for Various Touch points
a. Invoking user signup/ login/ verification via Truecaller at app onboarding
Example: CentroStore - our very own in-house sample app
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process. For example, one could address it as Get Started,
Join Us, Login, Sign up, etc., shown as a button to the users, clicking which leads to
the mobile number-based identity verification of users. Here is such an example
from CetroStore.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 70

70
b. Directly invoking verification via Truecaller
Example : CentroStore - our very own in-house sample app
CentroStore has mobile number as the primary identifier for its users. So as soon as
users lands on their mobile number login/ signup screen, it invokes Verification via
Truecaller, and onboards itʼs users within seconds in just 1-tap.
c. Performing user verification at checkout
Example : CentroStore - our very own in-house sample app
CentroStore also allows users to browse through itʼs app and check for bus ETAs,
without needing to sign-up or log-in. However, when users wish to purchase the
ticket or travel pass, it requires users to verify their mobile number.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 71

71
Now that we have gone through and understood how to implement Verification via
Truecaller, letʼs get started with the SDK integration.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 72

72
Scenarios for all user verifications :
Truecaller and Non Truecaller Users
Truecaller SDK enables you to verify your user's mobile number in a seamless way.
For users who have the Truecaller app present on their smartphones and are
already registered Truecaller users, they get verified in a 1-tap flow (supported
globally), without the need of any manual input.
For users who don't have the Truecaller app present on their smartphones, the SDK
enables user verification by means of a drop call, which is triggered to the user's
number in the background to complete the verification flow (currently supported
only for India).
To understand various possible user scenarios in the user's verification flow, let's
try to take the example of CentroStore. CetroStore is using Truecaller SDK for
verifying the numbers of all their users.
Scenario 1 
a) New user on CentroStore app and 
b) Truecaller app present on user's smartphone
Scenario 2 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 73

73
a) Existing user on CentroStore app, and 
b) Truecaller app present on smartphone
Scenario 3 
a) New user on CentroStore app, and
b) Truecaller app NOT present on a smartphone, and user's mobile number NOT
already verified on smartphone
Scenario 4 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 74

74
a) Existing user on CentroStore app, and 
b) Truecaller app NOT present on smartphone and user's mobile number NOT
verified on smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 75

75
Integration Steps
Step by step guide to integrate Truecaller OAuth SDK with your android project.
In order to proceed with the integration, please refer to the previous sections
 so as
to understand various user flows and touch points in the user journey where Truecaller
can be enabled.
• Register on the OAuth portal
  to create your business account and manage
OAuth projects.
• Once you have created your account, create your OAuth project & generate
credentials by following the steps here.
• Once you have generated the credentials, you can easily, in a few simple steps
integrate the Truecaller SDK by referring to our step-by-step guide in the
subsequent sections.
• Post integration completion, submit your project for review and go live.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 76

76
Generating Client ID
To ensure the authenticity of interactions between your app and Truecaller, you
need to generate a client ID from the Truecaller developer portal by following the
steps below:
• Go to https://sdk-console-noneu.truecaller.com/login
 and register your
account.
• Once registered, log in to your account and click on the "create project” button.
• Enter the project name and select the business category from the dropdown
menu. This will create a new project.
• On the project screen, click the “add credential” button and select the platform
as Android from the dropdown menu.
• On the credential section, enter the package name and the SHA1.
• Your package name corresponds to the applicationId in your app level 
build.gradle  file.
You can get to know the SHA1 for your different app builds by following these steps
:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 77

77
• Open your project in android studio
• Open terminal
• Type command ./gradlew signingReport
Once done you should be able to see the SHA1 fingerprint of your different build
configurations [ debug /release ] in the terminal window within the android studio.
Once you input your app details and create the app, you will be able to see a unique
"ClientID" for your app which you need to include in your project to authorise all
verification requests.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 78

78
Setup
1.Ensure that your Minimum SDK version is at least API level 24 or above. In case
your android project compiles for API level below 24, you can include the
following line in your AndroidManifest.xml file to avoid any compilation issues :
<uses-sdk tools:overrideLibrary="com.truecaller.android.sdk"/> 
Using this would ensure that the SDK works normally for API level 24 & above,
and would be disabled for API level < 24. Note: Please make sure that you put
the necessary API level checks before accessing the SDK methods in case of
compiling for API level < 24
2.
2.1) Add the Truecaller SDK which contains OAuth functionality to your app-
level build.gradle file 
dependencies {
...
implementation "com.truecaller.android.sdk:truecaller-sdk:3.2.0"
} 
2.2) Also, add the following lines of code in your gradle file, if not already
present
android{
compileOptions{
sourceCompatibility JavaVersion.VERSION_1_8
targetCompatibility JavaVersion.VERSION_1_8
}
} 
3.Add mavenCentral() in your project level build.gradle file :
allprojects{
   repositories{
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 79

79
 ...
       mavenCentral()
 ...
} 
Also check your AGP and distribution URL version AGP : 7.4.2 (minimum)
distributionUrl=https\://services.gradle.org/distributions/gradle-7.5-bin.zip
(minimum).
4.Configure Client ID : 
a.) Open your strings.xml file. Example path: /app/src/main/res/values/strings.xml
and add a new string with the name "clientID" and value as your "clientID"
b.) Open your AndroidManifest.xml and add a meta-data element to the application
element
<application android:label="@string/app_name" ...>
...
<meta-data android:name="com.truecaller.android.sdk.ClientId" 
android:value="@string/clientID"/>
...
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 80

80
Implementing Callbacks
4.In your Activity/Fragment where you want to integrate the Truecaller OAuth flow,
either make the component implement the interface TcOAuthCallback or create
an instance of it which you would require to initialize TcSdkOptions in the next
step.
The interface has 2 functions which need to be overridden -
• onFailure() method will be called in case of an error. You would get the error
details like the error code and error message through tcOAuthError returned
with this method.
• onSuccess() method will be called when the user gives consent to authorize
your app by tapping on the primary button on the Truecallerʼs consent screen,
and subsequently, an authorization code will be successfully generated and
received. This method would return tcOAuthData, which contains information
like :
Auth Parameters [Live]
◦ authorizationCode - which you can utilize to fetch the userʼs access token
◦ scopesGranted - list of scopes granted by the user
◦ state - state parameter returned by the authorisation server. If the state set
by your application is the same as the state returned by the authorisation
server, itʼs safe to proceed further. If state parameters are different,
someone else has initiated the request and it could be a case of request
forgery.
private val tcOAuthCallback: TcOAuthCallback = object : TcOAuthCallback 
{
    override fun onSuccess(tcOAuthData: TcOAuthData) {
        ..
    }
    override fun onFailure(tcOAuthError: TcOAuthError) {
        ..
    }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 81

81
[New] Sim Info Parameters[EAP - for access, mail us at
developersupport@truecaller.com]
◦ Sim Status - This will be a parameter returned to you in successCallback,
which helps understand whether the number passed to you is actually
present on the device at the time of verification. In case it is present, the
variable returns 1, In case it's not present, the variable returns 0, and in
case, due to OS level restrictions, the SDK is not able to detect it, the
variable returns -1
5.Call onActivityResultObtained() within the registerForActivityResult() like below:
and then assign it to a variable   to use it under step 13 (Invocation
).
val launcher = registerForActivityResult(StartActivityForResult()) { 
result: ActivityResult ->
    TcSdk.getInstance().onActivityResultObtained(requireActivity(), 
result.resultCode, result.data)
}
(Ex: launcher)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 82

82
Initialisation
6.Create a TcSdkOptions object by using the tcOAuthCallback from the previous
step and provide the context. Supply the appropriate customization settings to
the relevant methods of TcSdkOptions and use the instance of tcSdkOptions to
initialize the TcSdk in the next step.
In case you do not wish to provide any customization settings and fall back to the
default SDK settings, you may simply call -
7.Initialize TcSdk using the tcSdkOptions from the previous step :
Note: Truecaller OAuth SDK needs to be initialized only once in the component and
the same instance can be accessed without the need to initialize it again, via 
TcSdk.getInstance()
Ideally, you should call the init() method when the component is getting
created/initialized to avoid calling it multiple times.
The SDK init should always happen in a background thread. You can refer to an
example snippet below  : 
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback)
.buttonColor(Color.parseColor("<<VALID_COLOR_HEX_CODE>>"))
          .buttonTextColor(Color.parseColor("
<<VALID_COLOR_HEX_CODE>>"))
            
.loginTextPrefix(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
            .ctaText(TcSdkOptions.CTA_TEXT_CONTINUE)
            .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
            .footerType(TcSdkOptions.FOOTER_TYPE_SKIP)
            .consentTitleOption(TcSdkOptions.SDK_CONSENT_TITLE_LOG_IN)
            .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback).build()
TcSdk.init(tcSdkOptions)
[Recommended]
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 83

83
8.Once the SDK is initialized, check whether the OAuth functionality is usable or
not by calling :
If isUsable is True, you can proceed with further steps, otherwise, youʼd have to fall
back to some other mechanism ( your fallback verification flow ). Calling other SDK
methods when isUsable is False would result in an exception, so please ensure to
call this soon after initializing the SDK, and proceed to further steps only if this
method returns True.
launch {
  withContext(Dispatchers.IO) {
     TcSdk.init(tcSdkOptions)
// Now can access TcSdk.getInstance()
}
val isUsable = TcSdk.getInstance().isOAuthFlowUsable
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 84

84
Setting up OAuth parameters
9.Set a unique state parameter & store it in the current session to use it later in the
onSuccess() callback method of the TcOAuthCallback to match if the state
received from the authorization server is the same as set here to prevent
request forgery attacks.
One good choice for a state token is a string of around 32 characters constructed
using a high-quality random-number generator as we did above. Another approach
could be a hash generated by signing some of your session state variables with a
key that is kept secret on your back-end.
Truecaller OAuth SDK already verifies the request-response correlation before
forwarding it to the your app.
10.Set the list of scopes to be requested.
11.Generate a unique code verifier & store it in the current session since it would
be required later to generate the access token. It can be generated using the
utility class CodeVerifierUtil provided in the SDK.
stateRequested = BigInteger(130, SecureRandom()).toString(32)
TcSdk.getInstance().setOAuthState(stateRequested)
TcSdk.getInstance().setOAuthScopes(arrayOf("profile", "phone", ...))
// Currently available list of scopes :
- profile
- phone
- openid
- offline_access
- email
- address
Note : 
Please include the relevant scopes for your project. 
Make sure the scopes you’re requesting above are selected on the portal 
for your project
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 85

85
This utility method generates a random code verifier string using SecureRandom as
the source of entropy with 64 as the default entropy quantity.
12.Set the corresponding code challenge using the code verifier generated in the
previous step. This can be generated using the utility class CodeVerifierUtil
provided in the SDK.
This utility method produces a code challenge from the supplied code verifier using
SHA-256 as the challenge method and Base64 as encoding if the system supports
it (all Android devices should ideally support SHA-256 and Base64), but in rare
case if the device doesnʼt, then this method would return null meaning that you
canʼt proceed further. Please ensure to have a null safe check for such cases.
codeVerifier = CodeVerifierUtil.generateRandomCodeVerifier()
val codeChallenge = CodeVerifierUtil.getCodeChallenge(codeVerifier)
codeChallenge?.let {
                TcSdk.getInstance().setCodeChallenge(it)
} ?: print(“Code challenge is Null. Can’t proceed further”)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 86

86
Invocation
13.You can trigger the Truecaller profile verification dialog anywhere in your app
flow by calling the following method
where the launcher is derived in step 5 (Implementing Callback
)
In case isOAuthFlowUsable() method returns false, implying that the Truecaller app
is not present on the device, you can take the user to your app screen and continue
with the verification flow for non-Truecaller users or implement your fallback
verification mechanism.
Please note that the instance you pass in the method above should be of the
activity/fragment where you have initialized the SDK.
TcSdk.getInstance().getAuthorizationCode(this, launcher)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 87

87
Customisation
Truecaller SDK provides you with capabilities to configure the following:
Refer to the section below for details on all the customization capabilities and the
possible values you may set:
Consent Mode Style  [ .consentMode() ] 
To align the consent screen with your UX, which could either be centrally or bottom
aligned, choose either of the consent screens, making the SDK integration more
homogeneous with your app UX. 
TcSdkOptions.Builder(this, tcOAuthCallback)
       .consentMode(TcSdkOptions.CONSENT_MODE_BOTTOMSHEET) 
       .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
       .footerType(TcSdkOptions.FOOTER_TYPE_ANOTHER_MOBILE_NO)
       .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
       .ctaText(TcSdkOptions.CTA_TEXT_ACCEPT)
       .heading(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
       .buttonColor(1111)
       .buttonTextColor(1111)
       .build()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 88

88
Contextual header [ .heading() ] 
To provide the appropriate context of verification to the Truecaller user, use one of
the below mentioned TruecallerSdkScope values to show the corresponding
message to the user
Consent Mode Value
Consent Mode - Center PopUp TcSdkOptions.CONSENT_MODE_POPUP
Consent Mode - Bottomsheet TcSdkOptions.CONSENT_MODE_BOTTOMS
HEET
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 89

89
Log in to TcSdkOptions.SDK_CONSENT_HEADING_L
OG_IN_TO
Sign up with TcSdkOptions.SDK_CONSENT_HEADING_SI
GNUP_WITH
Sign in to TcSdkOptions.SDK_CONSENT_HEADING_SI
GN_IN_TO
Verify number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_NUMBER_WITH
Register with TcSdkOptions.SDK_CONSENT_HEADING_RE
GISTER_WITH
Get started with TcSdkOptions.SDK_CONSENT_HEADING_GE
T_STARTED_WITH
Proceed with TcSdkOptions.SDK_CONSENT_HEADING_PR
OCEED_WITH
Verify with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_WITH
Verify profile with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_PROFILE_WITH
Verify your profile with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_YOUR_PROFILE_WITH
Verify your phone number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_PHONE_NO_WITH
Verify your number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_YOUR_NO_WITH
Continue with TcSdkOptions.SDK_CONSENT_HEADING_C
ONTINUE_WITH
Complete order with TcSdkOptions.SDK_CONSENT_HEADING_C
OMPLETE_ORDER_WITH
Place order with TcSdkOptions.SDK_CONSENT_HEADING_PL
ACE_ORDER_WITH
Complete booking with TcSdkOptions.SDK_CONSENT_HEADING_C
OMPLETE_BOOKING_WITH
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 90

90
Button text options [ .ctaTextPrefix() ] 
To set the prefix on the CTA button
Button shape [ .buttonShapeOptions() ] 
To chose the shape of the CTA button
Checkout with TcSdkOptions.SDK_CONSENT_HEADING_C
HECKOUT_WITH
Manage Details with TcSdkOptions.SDK_CONSENT_HEADING_M
ANAGE_DETAILS_WITH
Manage your details with TcSdkOptions.SDK_CONSENT_HEADING_M
ANAGE_YOUR_DETAILS_WITH
Login to <<APP_NAME>> with one tap TcSdkOptions.SDK_CONSENT_HEADING_L
OGIN_TO_WITH_ONE_TAP
Subscribe to TcSdkOptions.SDK_CONSENT_HEADING_S
UBSCRIBE_TO
Get updates from TcSdkOptions.SDK_CONSENT_HEADING_GE
T_UPDATES_FROM
Continue reading on TcSdkOptions.SDK_CONSENT_HEADING_C
ONTINUE_READING_ON
Get new updates from TcSdkOptions.SDK_CONSENT_HEADING_GE
T_NEW_UPDATES_FROM
Log in/ Signup with TcSdkOptions.SDK_CONSENT_HEADING_L
OGIN_SIGNUP_WITH
Continue TcSdkOptions.CTA_TEXT_CONTINUE
Proceed TcSdkOptions.CTA_TEXT_PROCEED
Accept TcSdkOptions.CTA_TEXT_ACCEPT
Confirm TcSdkOptions.CTA_TEXT_COFIRM
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 91

91
Footer CTA text [ .footerType() ] 
To configure the text of the additional footer CTA present at the bottom
Dark Theme
To set the consent screen in dark mode, you can call 
TcSdk.getInstance().setTheme(OAuthThemeOptions.DARK)
just before calling the 
TcSdk.getInstance().getAuthorizationCode(this, launcher)
By default, the SDK is configured with the light theme. 
Privacy policy : 
To add your privacy policy link on the verification screen, you can configure the
respective hyperlink from your developer account
Terms of service: To add your terms of service link on the verification screen, you
can configure the respective hyperlink from your developer account
Round TcSdkOptions.BUTTON_SHAPE_ROUNDED
Rectangle TcSdkOptions.BUTTON_SHAPE_RECTANGL
E
Use another number TcSdkOptions.FOOTER_TYPE_CONTINUE
Use another method TcSdkOptions.FOOTER_TYPE_ANOTHER_M
ETHOD
Enter details manually TcSdkOptions.FOOTER_TYPE_MANUALLY
Later TcSdkOptions.FOOTER_TYPE_LATER
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 92

92
Language: You can optionally customize the consent screen in any of the
supported languages. To do so, add the following line :
Copy
Currently supported languages:
val locale = Locale("hi") // change language to Hindi
TcSdk.getInstance().setLocale(locale)
english en
hindi hi
marathi mr
telugu te
malayalam ml
urdu ur
punjabi pa
tamil ta
bengali bn
kannada kn
swahili sw
arabic ar
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 93

93
Clearing SDK Instance
In order to clear the resources taken up by the SDK, you may use the following
method
TcSdk.clear()
Ideally, you should call this method when the component in which you initialized the
SDK is getting killed/destroyed.
For instance, if you have initialized the SDK in the onCreate() method of the activity
lifecycle, then you need to call clear it in the onDestroy() method of the activity
lifecycle.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 94

94
Handling Error Scenarios
Failure/ Error responses
The "onFailure" callback method that you just implemented in the previous step
helps you to handle all the possible failure cases when the user couldn't be verified
successfully via the Truecaller flow.
Below are some of the possible failure scenarios and the corresponding error
response that you receive for each of the cases :
Please note that when you encounter any of the error scenarios and get the control
in the "onFailure()" method, you should redirect the user to your alternate
verification flow.
Error Description Error Code
"Something went wrong" 0
"Device is not supported" 16
"Truecaller user has an invalid account
state" 10
"Invalid partner or partner information is
missing" 12
"Conflicting request code possible in
onActivityResult()" 6
"Truecaller app closed unexpectedly" 7
"Truecaller app is not installed/loggedin" 5
"User denied by pressing the footer button" 11
"User denied by dismissing consent
screen" 14
"User denied while loading" 2
"Truecaller sdk is old and not compatible" 6
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 95

95
Exceptions
In case you face any of the following run time exceptions, please follow the
recommended steps as mentioned below :
"No compatible client available. Please change your scope"
As the exception suggests, you are trying to call an SDK method even though no
client is available to handle it. This usually happens if you have initialized the SDK
using ONLY_TC_USERS scope option i.e to verify only the Truecaller users, and you
are not calling isOAuthFlowUsable() method before calling an SDK method. To
resolve this, call isOAuthFlowUsable() before calling any SDK method if you are
using VERIFY_TC_USERS scope option.
"Please call init() on TruecallerSDK first"
This exception suggests that you are trying to call an SDK method before the SDK
has been initialised. To resolve it, check for all possible user flows in your app
which could lead to calling an SDK method directly before it has been initialised.
"Add client id in your manifest"
This exception suggests that you are trying to call SDK initialization/build method
without having your clientID mentioned in your manifest as meta-data.
"OAuth scopes cannot be null or empty"
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the OAuth scopes.
"OAuth state cannot be null or empty"
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the OAuth state.
“Code challenge cannot be null or empty”
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 96

96
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the Code challenge.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 97

97
Integrating with your Backend
Fetching User Token
Fetching User Profile
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 98

98
Fetching User Token
Using the “state” from step 10, “code verifier” from step 12, and the “authorization
code” from step 9, you need to make a network call to Truecallerʼs backend so as to
fetch the access token :
POST https://oauth-account-noneu.truecaller.com/v1/token
Headers
Request Body
200: OK Success 
{ 
"access_token": "some-access-token", 
"expires_in": 3600, 
"token_type": "Bearer" 
}
Name Type Description
Content-Type* application/x-www-form-
urlencoded
String
Name Type Description
grant_type "authorization_code" // hardcoded value
String
client_id <YOUR_CLIENT_ID>
code <USER_AUTHORISATION_C
ODE>
Authorisation code from
TcOAuthData callback from
step 9
code_verifier <YOUR_CODE_VERIFIER> From step 12
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 99

99
400: Bad Request -  If grant type is not supported
403: Forbidden - If client id is invalid
500: Internal Server Error - Unexpected error on the server side
400: Bad Request  - Some of the parameters are empty in the request
403: Forbidden Valid grant type but not allowed for the client
403: Forbidden Invalid auth code provided
403: Forbidden Invalid/expired auth code in provided
403: Forbidden Invalid/expired code verifier is provided
429: Too Many Requests If the number of requests exceeds the allowed limit
503: Service Unavailable Resource unavailable due to server-side issue
Sample cURL request :
curl --location --request POST 'https://oauth-account-
noneu.truecaller.com/v1/token' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'grant_type=authorization_code' \
--data-urlencode 'client_id=<<your-client-id>>' \
--data-urlencode 'code=<<authorization_code>>' \
--data-urlencode 'code_verifier=<<your-code-verifier>>'
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 100

100
Fetching User Profile
Make a network call to fetch the userInfo using access token from step 14. The
response would be corresponding to the scopes granted by the user.
GET https://oauth-account-noneu.truecaller.com/v1/userinfo
Headers
200: OK 
{
“sub”: “13627101294235520", 
“given_name”: “xyz”,  
“family_name”: “xyz”, 
“phone_number”: “91xxxxxxxxxx", 
“email”: “pqr@gmail.com”,
“picture”: “https://www.truecaller.com/xyz”, 
“gender”: “male/female”,
“phone_number_country_code”: “IN”,
“phone_number_verified”: true, 
ˇ “address”: { “locality”: “Bangalore”, “postal_code”: “5xxxxx" }
}
401: Unauthorized If authentication type is not bearer token
404: Not Found Profile information is not present for the user
500: Internal Server Error Failed to validate token due to server error
Name Type Description
Authorization* "Bearer
<ACCESS_TOKEN>"
Insert access token from
the previous step - fetching
user token
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 101

101
401: Unauthorized Token in invalid/ expired
422: Unprocessable Entity openid scope missing in initial request
500: Internal Server Error Unexpected error at server side
Sample cURL request :
curl --location --request GET 'https://oauth-account-
noneu.truecaller.com/v1/userinfo' \
--header 'Authorization: Bearer testtoken'
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 102

102
Non Truecaller User Verification
This section defines the steps that can be used to trigger verification of non
Truecaller app users which will be powered via Truecaller's drop call based
verification flow
In order to verify both the Truecaller users (via OAuth Flow) and the non-Truecaller
users (via manual verification), follow these steps :
1.Enable the Non Truecaller user verification capability for your app, by going to
your project on the Truecaller developer portal and navigating to the bottom
section.
2.Configure sdkOptions in the TcSdkOptions Builder and supply a value of 
TcSdkOptions.OPTION_VERIFY_ALL_USERS to it like below.
3.Configure permissions required by the SDK :
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback)
.sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
. // other customizations (if any)
.build()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 103

103
4.Once you receive a callback in the 
TcOAuthCallback#onVerificationRequired() , you can initiate the verification
for the user by calling the following method:
Here -
• the first parameter is the country code of the mobile number for which the
verification needs to be triggered
• the second parameter (PHONE_NUMBER_STRING) is the mobile number to be
verified. Please ensure proper validations are in place so as to send correct
phone number string to the above method, otherwise an exception would be
thrown
• the third parameter is an instance of VerificationCallback as defined here
• the fourth parameter is an instance of FragmentActivity
Please note that Truecaller OAuth SDK v3.0.0 currently supports the verification for
non-Truecaller users for Indian numbers only
For Android 8 and above :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.ANSWER_PHONE_CALLS"/>
For Android 7 and below :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.CALL_PHONE"/>
try{
  TcSdk.getInstance().requestVerification("IN", <PHONE_NUMBER>, 
verificationCallback, context);
}catch (RuntimeException e){
  Log.i(TAG, e.getMessage());
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 104

104
5.Once you initiate the verification via 
TcSdk.getInstance().requestVerification()  method, you will receive either a
callback in your VerificationCallback  instance with a specific requestType
as described below
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 105

105
override fun onRequestSuccess(callbackType: Int,verificationDataBundle 
: VerificationDataBundle?) {
         when(callbackType){
   
   VerificationCallback.TYPE_MISSED_CALL_INITIATED)-> {
             //missed-call initiated
              if(verificationDataBundle != null){                  
              
verificationDataBundle.getString(VerificationDataBundle.KEY_TTL);         
              
verificationDataBundle.getString(VerificationDataBundle.KEY_REQUEST_NON
CE);
      }
       }
   VerificationCallback.TYPE_MISSED_CALL_RECEIVED)-> {
             //missed-call received
       }
       
       //OTP initiated via Truecaller IM
   VerificationCallback.TYPE_IM_OTP_INITIATED) -> {
          if(verificationDataBundle != null) {                  
              val ttl = 
verificationDataBundle.getString(VerificationDataBundle.KEY_TTL);         
              val requestNonce = 
verificationDataBundle.getString(VerificationDataBundle.KEY_REQUEST_NON
CE);
}
}
//OTP auto-read via Truecaller IM which you can pre-fill in the OTP 
view
             val otp = bundle.getString(VerificationDataBundle.KEY_OTP)
}
       
       
   VerificationCallback.TYPE_VERIFICATION_COMPLETE)-> {
             //verification complete
       }
   VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE)-> {
             //user already verified 
       }
   }
}
override fun onRequestFailure(callbackType: Int, trueException : 
TrueException) {
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 106

106
onRequestSuccess() method is called under any of the following scenarios -
• When the OTP via Truecaller IM is successfully initiated for the input mobile
number. In this case, you will get the callbackType as 
VerificationCallback.TYPE_IM_OTP_INITIATED
• When the OTP via Truecaller IM is successfully detected on that device by the
SDK present in your app. In this case, you will get the callbackType as 
VerificationCallback.TYPE_IM_OTP_RECEIVED 
• When drop call is successfully initiated for the input mobile number. In this case,
you will get the callbackType as 
VerificationCallback.TYPE_MISSED_CALL_INITIATED
• When drop call is successfully detected on that device by the SDK present in
your app. In this case, you will get the callbackType as 
VerificationCallback.TYPE_MISSED_CALL_RECEIVED
• When the verification is successful for a particular number. In this case, you will
get the callbackType as VerificationCallback.TYPE_VERIFICATION_COMPLETE
• When the user is already verified on that particular device before. In this case,
you will get the callbackType as 
VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE
When callbackType is VerificationCallback.TYPE_MISSED_CALL_INITIATED , you
will receive an additional parameter for the time to live i.e TTL (in seconds) which is
passed as String extra in the VerificationDataBundle  of onRequestSuccess() .
This value determines amount of time left to complete the verification. You can use
this value to show a waiting message to your user before they can try for another
attempt.
Once the TTL expires, you can either auto-retry the verification by calling the
requestVerification() method automatically with the same input parameters OR you
can also take the user back to the number input screen to enter a different number
for verification.
//Exception
    }
   
};
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 107

107
When the callbackType is VerificationCallback.TYPE_ALREADY_VERIFIED_BEFORE
or VerificationCallback.TYPE_VERIFICATION_COMPLETE , it means that the user
verification via Truecaller SDK is complete. In these cases, the SDK will share an
additional access token with your application, which you may then use to validate
the response at your server end. To fetch the access token, you may use the
following code snippet :
Post fetching the access token, you may perform the server side validation by
referring to the steps mentioned in the later part of the documentation here
onRequestFailure() method will be called when some error has occurred while
verifying the provided mobile number. You will receive the appropriate error
message from TrueException using TrueException#getExceptionMessage().For
details of different possible error types you may encounter, please refer to the 
TrueException
//For when the control goes to TYPE_ALREADY_VERIFIED_BEFORE 
verificationDataBundle.getProfile().accessToken
//For when the control goes to TYPE_VERIFICATION_COMPLETE 
verificationDataBundle.getString(VerificationDataBundle.KEY_ACCESS_TOKE
N)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 108

108
Completing Verification
To complete the verification you need to create a TrueProfile instance by passing
the user's first and last name as defined above.
Please note that the first name and last name values to be passed in the above
method call need to follow below mentioned rules :
• The strings need to contains at least 1 alphabet, and cannot be completely
comprised of numbers or special characters.
• String length should be less than 128 characters.
• First name is a mandatory field, last name can be empty ( but non nullable ).
Once you receive a callback in your VerificationCallback instance with the
callbackType TYPE_MISSED_CALL_RECEIVED   or TYPE_IM_OTP_RECEIVED  , you can
complete the verification process by calling the following method from within your
activity :
Please note that Truecaller SDK 3.1.0 is not by default enabled for the IM OTP flow.
This new update is currently under early access. In case you want to enable it for
your app, please drop in a request at developersupport@truecaller.com 
TrueProfile profile = new TrueProfile.Builder(firstName, 
lastName).build();
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 109

109
TrueException
Handling error responses for cases of verifying non-Truecaller users
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 110

110
Error Code Error Message Description
4 "Desired permissions are
missing"
When the requisite
permissions are missing or
not granted while making
the verification request
6 “Sim state is not ready” When the SIM state on the
device is not ready
7 “Airplane mode is ON”
When the device is on
airplane mode, hence
causing missed call to not
go through
2 "Phone number limit
reached”
When the used mobile
number has exceeded the
maximum number of
allowed verification
attempts within a span of
24 hours from the time the
first verification attempt
was made
2 “Request id limit reached”
When the used device
exceeds the maximum
number of allowed
verification attempts in a
span of 24h
2 “Invalid partner credentials.
When the partner key ( app
key ) you have configured in
your project is incorrect.
Visit here
 for more info
2 “Something went wrong:
Failed to create installation.”
In case of Truecaller
internal service error
2 “Invalid phone number”
When the input mobile
number is not a valid mobile
number
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 111

111
2 “Profile has not been
created yet”
When the user has been
successfully verified, but
for some reason their profile
is not created which could
be due to incorrect profile
data while creating
TrueProfile() in
verifyMissedCall method or
due to network issues
5 “Invalid Name”
When the string entered in
the profile builder method
doesnʼt follow the validation
checks :
{
min 1 char, max 128, at least
1 alphabet required with
optional numeric and
special chars,
cannot be all numeric or all
special characters, but can
be all alphabets
}
Refer here
 for more info
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 112

112
Server Side Validation
Once the SDK shares the accessToken for any user verified via drop call based
verification flow, you can verify the authenticity of the access token by making API
call from your server to Truecaller's server. The following endpoint will return phone
number and country code for the given access token.
API Endpoint:
REQUEST :
Method : GET
Header Parameters:
Request Path Parameters:
RESPONSE:
• 200 OK - If access token is valid
"https://sdk-otp-verification-
noneu.truecaller.com/v1/otp/client/installation/phoneNumberDetail/{acce
ssToken}"
Parameter Name Required Description Example
clientId yes Client ID
zHTqS70ca9d3e016
946f19a65b01dRR5
e56460
Parameter Name Required Description Example
accessToken yes
token granted for
the partner for the
respective user
number that
initiated login
"71d8367e-39f7-
4de5-a3a3-
2066431b9ca8"
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 113

113
• 404 Not Found - If your credentials are not valid
• 404 Not Found - If access token is invalid
• 500 Internal Error - for any other internal error
{
    "phoneNumber":919999XXXXX9
    "countryCode":"IN"
}
{
    "code":404
    "message":"Invalid partner credentials."
}
{
    "code":1404
    "message":"Invalid access token."
}
{
    "code":500
    "message":"error message"
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 114

114
Instrumentation
Quick guide on how to properly track and instrument funnel for the verification flow
of users via Truecaller on your app
For proper tracking of the verification funnel via Truecaller SDK on your app, we
recommend you to implement tracking events for the following states :
When you are using the SDK for verification of Truecaller users only:
1.Total users coming to your verification flow
2.Number of cases when the Truecaller app is present on your smartphone
3.Number of profile verification requests made by your app ( when 
TcSdk.getInstance().isOAuthFlowUsable  method is invoked )
4.Number of users who proceed with this flow and click Continue on the
Truecaller dialog [ for these cases, you receive a success callback with
TcOAuthData response in onSuccess() callback method ]
5.Number of cases where you received any error, where you receive an error
callback with TcOAuthError response in onFailure() callback method. For details
on specific error codes, please refer here
When you are using the SDK for verification of non-Truecaller users also ( via
drop call):
1.Total users coming to your verification flow.
2.Number of cases, when the Truecaller app is present on your smartphone and
users, get verified via the Truecaller 1-tap flow (as described in the above
section)
3.Number of verification requests made by your app for a non-Truecaller user (
when TruecallerSDK.getInstance().requestVerification()  method is
invoked ).
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 115

115
4.Number of cases where the user is getting verified for the very first time on the
current smartphone and you receive a success callback - onRequestSuccess()
method ( Please refer here
 ) - a.) When the callback type you receive is 
VerificationCallback.TYPE_MISSED_CALL_INITIATED . This implies that a drop
call has been triggered to the user's mobile number b.) When the callback type
you receive is VerificationCallback.TYPE_MISSED_CALL_RECEIVED . This implies
that a drop call has been received on the user's mobile number on that
smartphone c.) Further to the above step, you complete the user verification by
invoking TcSdk.getInstance().verifyMissedCall(profile, 
verificationCallback) When the callback type you receive is either 
VerificationCallback.TYPE_VERIFICATION_COMPLETE . This implies that the
verification is complete for the user d.) Number of cases where the user is
already verified previously on the current smartphone and gets verified directly.
In such cases, you receive the success callback - onRequestSuccess() method
with callback type as VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE .
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 116

116
Getting Release Ready
Testing your verification flow
Google play store app permission declaration form
Moving to Production
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 117

117
Testing your verification flow
Non Truecaller User Verification
Truecaller user verification flow
Test Setup
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 118

118
Non-Truecaller user verification flow
Common scenarios to check for in you app verification flow for non-Truecaller
users
If the user does not have the Truecaller app present on their device or they chose to
verify using a different number than the one already verified on Truecaller app
currently, they can be taken to this flow in which we provision the verification of the
user by sending missed call using our infrastructure.
User verifying via Truecaller's missed call mechanism for the very first time
Proceed to the flow where the user needs to input their mobile number. Give the
necessary permissions ( as described here
 ) and proceed with the verification.
You would receive a missed call on the device which gets automatically detected by
the SDK. Post this, you need to pass the user's first name and last name to the SDK
to complete the verification
User already verified with the same credentials previously on the smartphone
Once a user's verification is completed successfully on a particular device, and
they re-attempt to verify on the same app using the same credentials ( same
smartphone, same mobile number ), Truecaller SDK is able to identify the user and
we can tell you it's the same user. In this case, no additional missed call / OTP is
needed to re-verify the user. The SDK will directly tell the status of the repeat user,
and in this case returns the first name and last name of the user back to you in
response.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 119

119
Truecaller user verification flow
Common scenarios to check for in you app verification flow for existing Truecaller
users
Truecaller app present and registration completed on Truecaller app
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Open your app and initiate the Truecaller
verification flow. The user should see the Truecaller profile dialog. Click on continue
to complete the verification flow and ensure that the verification is completed.
Truecaller app present but registration not completed on Truecaller app
Ensure that the Truecaller app is present on your device but you have not
completed the profile creation step on Truecaller app. Open your app and initiate
the Truecaller verification flow. The user should not see the Truecaller profile
dialog, and you would receive the control in onFailureProfileShared() with the
specific error code.
Truecaller app not present on the device
Remove the Truecaller app from your device. Open your app and try to initiate the
Truecaller verification flow. The user should not see the Truecaller profile dialog
and should be taken to either your alternate verification flow or in case you are
using Truecaller SDK's functionality of verifying non-Truecaller users, user should
be redirected to that flow.
Network not available on device
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Turn off the mobile data and WiFi on
your device. Open your app and initiate the Truecaller verification flow. You would
see the Truecaller profile dialog. Click on continue button on the dialog, you would
receive control in onFailureProfileShared() method with a specific error code.
Client ID should be working fine ( onFailure() Error Type 12)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 120

120
For complete details on this part, please refer here.
User wishes to proceed with another number OR does not want to share their
Truecaller profile
Initiate the Truecaller verification flow in your app to invoke the Truecaller profile
dialog. Click on system back or Use another mobile number button on the dialog to
dismiss the dialog. In such a scenario, user should be taken to either your alternate
verification flow or in case you are using Truecaller SDK's functionality of verifying
non-Truecaller users, user should be redirected to that flow.
We also recommend that you go through the FAQ section to go through some of the
commonly asked questions.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 121

121
Test Setup
Quick guide on getting your test setup ready to test the common verification
scenarios as described in previous sections
Pre-Requisites
• We suggest you to keep handy at-least 2 android smartphones with active SIM
connections. Ensure that both the smartphones have your test app installed
(Integrated with Truecaller SDK)
• 2 different smartphones are required so that in case you get verified on one of
the smartphones, you can use the second smartphone to check for the fresh
verification scenarios.
Steps to follow for testing user scenarios :
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 122

122
User State App Scenario Steps
Existing Truecaller user
• Install Truecaller on
smartphone 'A'
• Complete profile
creation step on
Truecaller app
• Launch your application
and initiate the
Truecaller verification
flow
• Truecaller profile
consent screen should
appear
• Tapping on Continue
button should verify the
user
Non Truecaller User User getting verified for the
first time on smartphone
• Take smartphone 'A'
• Uninstall Truecaller app
from the smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs &
phone permissions are
asked ( if not already
granted )
• Allow the permissions
to enable receiving a
drop call
• User is manually asked
to enter name ( if it's a
new user on your app )
• On entering the name,
SDK verifies the user
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 123

123
Non Truecaller User
User already verified on the
smartphone and tried to re-
verify
( Please ensure that you try
this step only after you have
performed the above step )
• Take smartphone 'A'
• Launch your application
and logout from the app
• Initiate the verification
flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
Non Truecaller User
User already verified on the
smartphone, uninstalls and
re-installs the application
on the device
( Please ensure that you try
this step only after you have
performed the 2nd step )
• Take smartphone 'A'
• Uninstall your
application from the
smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 124

124
Wi-Fi or mobile internet should also be enabled on both the smartphones
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 125

125
Google play store app
permission declaration form
This section is only relevant for apps who are using the Truecaller SDK for verifying
non-Truecaller user as well and seek phone permissions from the users
If you are using the functionality of verifying non Truecaller users also via the SDK,
your app would need specific phone permissions as has been described in this 
section
. If you are using the Truecaller SDK for verification of existing Truecaller
users only ( 1-tap flow ), you can skip this section.
As you upload the new app build to PlayStore with user verification feature via
Truecaller SDK and the requisite permissions, you might be asked to fill an app
permission declaration form.
We are sharing some tips on how to appropriately justify the need for these
permissions for your verification flow :
#1: In one sentence, please describe the core functionality of your app. To be
defined by you as a publisher of your app
#2: What is the core functionality in your app requiring the Call Log and / or SMS
permissions? Mobile number verification to onboard users on <your_app>
This is in-line with Googleʼs allowed usage of this permission for account
verification via phone call, as stated here:
https://support.google.com/googleplay/android-developer/answer/9047303 Flow:
a)Enter mobile number b)Request READ_CALL_LOG permission c)Initiate drop call
from 3rd party service to respective number d)Drop call hits userʼs device and is
rejected automatically via above permission to complete verification
#3: Do any of the following disallowed use cases apply to your appʼs core
functionality request for Call Log or SMS permissions? NO
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 126

126
#4: Do any of the following other use cases apply to your appʼs core functionality
request for Call Log or SMS permissions? OTP & Account verification via Phone
Call (select this from the given list of options)
#5: Is your appʼs use of Call Log or SMS permissions to provide functionality
required by law or regulation? No
#6: Other We use drop call based verification of usersʼ mobile number for account
creation or logging into their <your app name> accounts. Such method of mobile
number verification results in better verification success rates in our key markets
like India, etc.
Android guidelines for asking app permissions from user 
https://developer.android.com/training/permissions/requesting
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 127

127
Moving to Production
Submitting your project for review post integration
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 128

128
OAuth SDK 3.1.0
Implementing user flow for your App
Scenarios for all user verifications : Truecaller and Non Truecaller Users
Integration Steps
Instrumentation
Getting Release Ready
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 129

129
Implementing user flow for your App
Truecaller SDK is a mobile number verification service, without the need for any
OTP whatsoever.
The right way to implement Truecaller SDK in your mobile app, is to invoke mobile
number verification via Truecaller at touch points, where you have your users to
sign-up/ login/ checkout by verifying their mobile numbers.
Let us now see an example to understand how to effectively use Truecaller SDK at
such touch points in your user journey
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process.
For example, one could address it as Get Started, Join Us, Login, Sign up, etc.,
shown as a button to the users, clicking which leads to the mobile number based
identity verification of users.
Here is such an example from CentroStore - our very own in-house sample app:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 130

130
Building for Various Touch points
a. Invoking user signup/ login/ verification via Truecaller at app onboarding
Example: CentroStore - our very own in-house sample app
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process. For example, one could address it as Get Started,
Join Us, Login, Sign up, etc., shown as a button to the users, clicking which leads to
the mobile number-based identity verification of users. Here is such an example
from CetroStore.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 131

131
b. Directly invoking verification via Truecaller
Example : CentroStore - our very own in-house sample app
CentroStore has mobile number as the primary identifier for its users. So as soon as
users lands on their mobile number login/ signup screen, it invokes Verification via
Truecaller, and onboards itʼs users within seconds in just 1-tap.
c. Performing user verification at checkout
Example : CentroStore - our very own in-house sample app
CentroStore also allows users to browse through itʼs app and check for bus ETAs,
without needing to sign-up or log-in. However, when users wish to purchase the
ticket or travel pass, it requires users to verify their mobile number.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 132

132
Now that we have gone through and understood how to implement Verification via
Truecaller, letʼs get started with the SDK integration.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 133

133
Scenarios for all user verifications :
Truecaller and Non Truecaller Users
Truecaller SDK enables you to verify your user's mobile number in a seamless way.
For users who have the Truecaller app present on their smartphones and are
already registered Truecaller users, they get verified in a 1-tap flow (supported
globally), without the need of any manual input.
For users who don't have the Truecaller app present on their smartphones, the SDK
enables user verification by means of a drop call, which is triggered to the user's
number in the background to complete the verification flow (currently supported
only for India).
To understand various possible user scenarios in the user's verification flow, let's
try to take the example of CentroStore. CetroStore is using Truecaller SDK for
verifying the numbers of all their users.
Scenario 1 
a) New user on CentroStore app and 
b) Truecaller app present on user's smartphone
Scenario 2 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 134

134
a) Existing user on CentroStore app, and 
b) Truecaller app present on smartphone
Scenario 3 
a) New user on CentroStore app, and
b) Truecaller app NOT present on a smartphone, and user's mobile number NOT
already verified on smartphone
Scenario 4 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 135

135
a) Existing user on CentroStore app, and 
b) Truecaller app NOT present on smartphone and user's mobile number NOT
verified on smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 136

136
Integration Steps
Step by step guide to integrate Truecaller OAuth SDK with your android project.
In order to proceed with the integration, please refer to the previous sections
 so as
to understand various user flows and touch points in the user journey where Truecaller
can be enabled.
• Register on the OAuth portal
  to create your business account and manage
OAuth projects.
• Once you have created your account, create your OAuth project & generate
credentials by following the steps here.
• Once you have generated the credentials, you can easily, in a few simple steps
integrate the Truecaller SDK by referring to our step-by-step guide in the
subsequent sections.
• Post integration completion, submit your project for review and go live.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 137

137
Generating Client ID
To ensure the authenticity of interactions between your app and Truecaller, you
need to generate a client ID from the Truecaller developer portal by following the
steps below:
• Go to https://sdk-console-noneu.truecaller.com/login
 and register your
account.
• Once registered, log in to your account and click on the "create project” button.
• Enter the project name and select the business category from the dropdown
menu. This will create a new project.
• On the project screen, click the “add credential” button and select the platform
as Android from the dropdown menu.
• On the credential section, enter the package name and the SHA1.
• Your package name corresponds to the applicationId in your app level 
build.gradle  file.
You can get to know the SHA1 for your different app builds by following these steps
:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 138

138
• Open your project in android studio
• Open terminal
• Type command ./gradlew signingReport
Once done you should be able to see the SHA1 fingerprint of your different build
configurations [ debug /release ] in the terminal window within the android studio.
Once you input your app details and create the app, you will be able to see a unique
"ClientID" for your app which you need to include in your project to authorise all
verification requests.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 139

139
Setup
1.Ensure that your Minimum SDK version is at least API level 24 or above. In case
your android project compiles for API level below 24, you can include the
following line in your AndroidManifest.xml file to avoid any compilation issues :
<uses-sdk tools:overrideLibrary="com.truecaller.android.sdk"/> 
Using this would ensure that the SDK works normally for API level 24 & above,
and would be disabled for API level < 24. Note: Please make sure that you put
the necessary API level checks before accessing the SDK methods in case of
compiling for API level < 24
2.
2.1) Add the Truecaller SDK which contains OAuth functionality to your app-
level build.gradle file 
dependencies {
...
implementation "com.truecaller.android.sdk:truecaller-sdk:3.1.0"
} 
2.2) Also, add the following lines of code in your gradle file, if not already
present
android{
compileOptions{
sourceCompatibility JavaVersion.VERSION_1_8
targetCompatibility JavaVersion.VERSION_1_8
}
} 
3.Add mavenCentral() in your project level build.gradle file :
allprojects{
   repositories{
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 140

140
 ...
       mavenCentral()
 ...
} 
Also check your AGP and distribution URL version AGP : 7.4.2 (minimum)
distributionUrl=https\://services.gradle.org/distributions/gradle-7.5-bin.zip
(minimum).
4.Configure Client ID : 
a.) Open your strings.xml file. Example path: /app/src/main/res/values/strings.xml
and add a new string with the name "clientID" and value as your "clientID"
b.) Open your AndroidManifest.xml and add a meta-data element to the application
element
<application android:label="@string/app_name" ...>
...
<meta-data android:name="com.truecaller.android.sdk.ClientId" 
android:value="@string/clientID"/>
...
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 141

141
Implementing Callbacks
4.In your Activity/Fragment where you want to integrate the Truecaller OAuth flow,
either make the component implement the interface TcOAuthCallback or create
an instance of it which you would require to initialize TcSdkOptions in the next
step.
The interface has 2 functions which need to be overridden -
• onFailure() method will be called in case of an error. You would get the error
details like the error code and error message through tcOAuthError returned
with this method.
• onSuccess() method will be called when the user gives consent to authorize
your app by tapping on the primary button on the Truecallerʼs consent screen,
and subsequently, an authorization code will be successfully generated and
received. This method would return tcOAuthData which contains information
like :
◦ authorizationCode - which you can utilize to fetch the userʼs access token
◦ scopesGranted - list of scopes granted by the user
◦ state - state parameter returned by the authorisation server. If the state set
by your application is the same as the state returned by the authorisation
server, itʼs safe to proceed further. If state parameters are different,
someone else has initiated the request and it could be a case of request
forgery.
5.Override the onActivityResult() method of the component used in step 1 and call
the onActivityResultObtained() method if the requestCode matches to
TcSdk.SHARE_PROFILE_REQUEST_CODE.
private val tcOAuthCallback: TcOAuthCallback = object : TcOAuthCallback 
{
    override fun onSuccess(tcOAuthData: TcOAuthData) {
        ..
    }
    override fun onFailure(tcOAuthError: TcOAuthError) {
        ..
    }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 142

142
override fun onActivityResult(requestCode: Int, resultCode: Int, data: 
Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == TcSdk.SHARE_PROFILE_REQUEST_CODE) {
             TcSdk.getInstance().onActivityResultObtained(this, 
requestCode, resultCode, data)
        }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 143

143
Initialisation
6.Create a TcSdkOptions object by using the tcOAuthCallback from the previous
step and provide the context. Supply the appropriate customization settings to
the relevant methods of TcSdkOptions and use the instance of tcSdkOptions to
initialize the TcSdk in the next step.
In case you do not wish to provide any customization settings and fall back to the
default SDK settings, you may simply call -
7.Initialize TcSdk using the tcSdkOptions from the previous step :
Note: Truecaller OAuth SDK needs to be initialized only once in the component and
the same instance can be accessed without the need to initialize it again, via 
TcSdk.getInstance()
Ideally, you should call the init() method when the component is getting
created/initialized to avoid calling it multiple times. The SDK init should always
happen in a background thread.
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback)
.buttonColor(Color.parseColor("<<VALID_COLOR_HEX_CODE>>"))
          .buttonTextColor(Color.parseColor("
<<VALID_COLOR_HEX_CODE>>"))
            
.loginTextPrefix(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
            .ctaText(TcSdkOptions.CTA_TEXT_CONTINUE)
            .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
            .footerType(TcSdkOptions.FOOTER_TYPE_SKIP)
            .consentTitleOption(TcSdkOptions.SDK_CONSENT_TITLE_LOG_IN)
            .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback).build()
TcSdk.init(tcSdkOptions)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 144

144
8.Once the SDK is initialized, check whether the OAuth functionality is usable or
not by calling :
If isUsable is True, you can proceed with further steps, otherwise, youʼd have to fall
back to some other mechanism ( your fallback verification flow ). Calling other SDK
methods when isUsable is False would result in an exception, so please ensure to
call this soon after initializing the SDK, and proceed to further steps only if this
method returns True.
val isUsable = TcSdk.getInstance().isOAuthFlowUsable
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 145

145
Setting up OAuth parameters
9.Set a unique state parameter & store it in the current session to use it later in the
onSuccess() callback method of the TcOAuthCallback to match if the state
received from the authorization server is the same as set here to prevent
request forgery attacks.
One good choice for a state token is a string of around 32 characters constructed
using a high-quality random-number generator as we did above. Another approach
could be a hash generated by signing some of your session state variables with a
key that is kept secret on your back-end.
Truecaller OAuth SDK already verifies the request-response correlation before
forwarding it to the your app.
10.Set the list of scopes to be requested.
11.Generate a unique code verifier & store it in the current session since it would
be required later to generate the access token. It can be generated using the
utility class CodeVerifierUtil provided in the SDK.
stateRequested = BigInteger(130, SecureRandom()).toString(32)
TcSdk.getInstance().setOAuthState(stateRequested)
TcSdk.getInstance().setOAuthScopes(arrayOf("profile", "phone", ...))
// Currently available list of scopes :
- profile
- phone
- openid
- offline_access
- email
- address
Note : 
Please include the relevant scopes for your project. 
Make sure the scopes you’re requesting above are selected on the portal 
for your project
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 146

146
This utility method generates a random code verifier string using SecureRandom as
the source of entropy with 64 as the default entropy quantity.
12.Set the corresponding code challenge using the code verifier generated in the
previous step. This can be generated using the utility class CodeVerifierUtil
provided in the SDK.
This utility method produces a code challenge from the supplied code verifier using
SHA-256 as the challenge method and Base64 as encoding if the system supports
it (all Android devices should ideally support SHA-256 and Base64), but in rare
case if the device doesnʼt, then this method would return null meaning that you
canʼt proceed further. Please ensure to have a null safe check for such cases.
codeVerifier = CodeVerifierUtil.generateRandomCodeVerifier()
val codeChallenge = CodeVerifierUtil.getCodeChallenge(codeVerifier)
codeChallenge?.let {
                TcSdk.getInstance().setCodeChallenge(it)
} ?: print(“Code challenge is Null. Can’t proceed further”)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 147

147
Invocation
13.You can trigger the Truecaller profile verification dialog anywhere in your app
flow by calling the following method
In case isOAuthFlowUsable() method returns false, implying that Truecaller app is
not present on the device, you can take the user to your app screen and continue
with the verification flow for non-Truecaller users.
Please note that the instance you pass in the method above should be of the
activity/fragment where you have initialized the SDK.
TcSdk.getInstance().getAuthorizationCode(this);
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 148

148
Customisation
Truecaller SDK provides you with capabilities to configure the following:
Refer to the below section for details on all the customization capabilities and the
possible values you may set:
Contextual header [ .heading() ] 
To provide the appropriate context of verification to the Truecaller user, use one of
the below mentioned TruecallerSdkScope values to show the corresponding
message to the user
TcSdkOptions.Builder(this, tcOAuthCallback)
       .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
       .footerType(TcSdkOptions.FOOTER_TYPE_ANOTHER_MOBILE_NO)
       .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
       .ctaText(TcSdkOptions.CTA_TEXT_ACCEPT)
       .heading(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
       .buttonColor(1111)
       .buttonTextColor(1111)
       .build()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 149

149
Log in to TcSdkOptions.SDK_CONSENT_HEADING_L
OG_IN_TO
Sign up with TcSdkOptions.SDK_CONSENT_HEADING_SI
GNUP_WITH
Sign in to TcSdkOptions.SDK_CONSENT_HEADING_SI
GN_IN_TO
Verify number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_NUMBER_WITH
Register with TcSdkOptions.SDK_CONSENT_HEADING_RE
GISTER_WITH
Get started with TcSdkOptions.SDK_CONSENT_HEADING_GE
T_STARTED_WITH
Proceed with TcSdkOptions.SDK_CONSENT_HEADING_PR
OCEED_WITH
Verify with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_WITH
Verify profile with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_PROFILE_WITH
Verify your profile with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_YOUR_PROFILE_WITH
Verify your phone number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_PHONE_NO_WITH
Verify your number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_YOUR_NO_WITH
Continue with TcSdkOptions.SDK_CONSENT_HEADING_C
ONTINUE_WITH
Complete order with TcSdkOptions.SDK_CONSENT_HEADING_C
OMPLETE_ORDER_WITH
Place order with TcSdkOptions.SDK_CONSENT_HEADING_PL
ACE_ORDER_WITH
Complete booking with TcSdkOptions.SDK_CONSENT_HEADING_C
OMPLETE_BOOKING_WITH
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 150

150
Button text options [ .ctaTextPrefix() ] 
To set the prefix on the CTA button
Button shape [ .buttonShapeOptions() ] 
To chose the shape of the CTA button
Checkout with TcSdkOptions.SDK_CONSENT_HEADING_C
HECKOUT_WITH
Manage Details with TcSdkOptions.SDK_CONSENT_HEADING_M
ANAGE_DETAILS_WITH
Manage your details with TcSdkOptions.SDK_CONSENT_HEADING_M
ANAGE_YOUR_DETAILS_WITH
Login to <<APP_NAME>> with one tap TcSdkOptions.SDK_CONSENT_HEADING_L
OGIN_TO_WITH_ONE_TAP
Subscribe to TcSdkOptions.SDK_CONSENT_HEADING_S
UBSCRIBE_TO
Get updates from TcSdkOptions.SDK_CONSENT_HEADING_GE
T_UPDATES_FROM
Continue reading on TcSdkOptions.SDK_CONSENT_HEADING_C
ONTINUE_READING_ON
Get new updates from TcSdkOptions.SDK_CONSENT_HEADING_GE
T_NEW_UPDATES_FROM
Log in/ Signup with TcSdkOptions.SDK_CONSENT_HEADING_L
OGIN_SIGNUP_WITH
Continue TcSdkOptions.CTA_TEXT_CONTINUE
Proceed TcSdkOptions.CTA_TEXT_PROCEED
Accept TcSdkOptions.CTA_TEXT_ACCEPT
Confirm TcSdkOptions.CTA_TEXT_COFIRM
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 151

151
Footer CTA text [ .footerType() ] 
To configure the text of the additional footer CTA present at the bottom
Privacy policy : 
To add your privacy policy link on the verification screen, you can configure the
respective hyperlink from your developer account
Terms of service: To add your terms of service link on the verification screen, you
can configure the respective hyperlink from your developer account
Language You can optionally customize the consent screen in any of the supported
languages. To do so, add the following line :
Copy
Currently supported languages:
Round TcSdkOptions.BUTTON_SHAPE_ROUNDED
Rectangle TcSdkOptions.BUTTON_SHAPE_RECTANGL
E
Use another number TcSdkOptions.FOOTER_TYPE_CONTINUE
Use another method TcSdkOptions.FOOTER_TYPE_ANOTHER_M
ETHOD
Enter details manually TcSdkOptions.FOOTER_TYPE_MANUALLY
Later TcSdkOptions.FOOTER_TYPE_LATER
val locale = Locale("hi") // change language to Hindi
TcSdk.getInstance().setLocale(locale)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 152

152
english en
hindi hi
marathi mr
telugu te
malayalam ml
urdu ur
punjabi pa
tamil ta
bengali bn
kannada kn
swahili sw
arabic ar
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 153

153
Clearing SDK Instance
In order to clear the resources taken up by the SDK, you may use the following
method
TcSdk.clear()
Ideally, you should call this method when the component in which you initialized the
SDK is getting killed/destroyed.
For instance, if you have initialized the SDK in the onCreate() method of the activity
lifecycle, then you need to call clear it in the onDestroy() method of the activity
lifecycle.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 154

154
Handling Error Scenarios
Failure/ Error responses
The "onFailure" callback method that you just implemented in the previous step
helps you to handle all the possible failure cases when the user couldn't be verified
successfully via the Truecaller flow.
Below are some of the possible failure scenarios and the corresponding error
response that you receive for each of the cases :
Please note that when you encounter any of the error scenarios and get the control
in the "onFailure()" method, you should redirect the user to your alternate
verification flow.
Error Description Error Code
"Something went wrong" 0
"Device is not supported" 16
"Truecaller user has an invalid account
state" 10
"Invalid partner or partner information is
missing" 12
"Conflicting request code possible in
onActivityResult()" 6
"Truecaller app closed unexpectedly" 7
"Truecaller app is not installed/loggedin" 5
"User denied by pressing the footer button" 11
"User denied by dismissing consent
screen" 14
"User denied while loading" 2
"Truecaller sdk is old and not compatible" 6
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 155

155
Exceptions
In case you face any of the following run time exceptions, please follow the
recommended steps as mentioned below :
"No compatible client available. Please change your scope"
As the exception suggests, you are trying to call an SDK method even though no
client is available to handle it. This usually happens if you have initialized the SDK
using ONLY_TC_USERS scope option i.e to verify only the Truecaller users, and you
are not calling isOAuthFlowUsable() method before calling an SDK method. To
resolve this, call isOAuthFlowUsable() before calling any SDK method if you are
using VERIFY_TC_USERS scope option.
"Please call init() on TruecallerSDK first"
This exception suggests that you are trying to call an SDK method before the SDK
has been initialised. To resolve it, check for all possible user flows in your app
which could lead to calling an SDK method directly before it has been initialised.
"Add client id in your manifest"
This exception suggests that you are trying to call SDK initialization/build method
without having your clientID mentioned in your manifest as meta-data.
"OAuth scopes cannot be null or empty"
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the OAuth scopes.
"OAuth state cannot be null or empty"
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the OAuth state.
“Code challenge cannot be null or empty”
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 156

156
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the Code challenge.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 157

157
Integrating with your Backend
Fetching User Token
Fetching User Profile
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 158

158
Fetching User Token
Using the “state” from step 10, “code verifier” from step 12, and the “authorization
code” from step 9, you need to make a network call to Truecallerʼs backend so as to
fetch the access token :
POST https://oauth-account-noneu.truecaller.com/v1/token
Headers
Request Body
200: OK Success 
{ 
"access_token": "some-access-token", 
"expires_in": 3600, 
"token_type": "Bearer" 
}
Name Type Description
Content-Type* application/x-www-form-
urlencoded
String
Name Type Description
grant_type "authorization_code" // hardcoded value
String
client_id <YOUR_CLIENT_ID>
code <USER_AUTHORISATION_C
ODE>
Authorisation code from
TcOAuthData callback from
step 9
code_verifier <YOUR_CODE_VERIFIER> From step 12
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 159

159
400: Bad Request -  If grant type is not supported
403: Forbidden - If client id is invalid
500: Internal Server Error - Unexpected error on the server side
400: Bad Request  - Some of the parameters are empty in the request
403: Forbidden Valid grant type but not allowed for the client
403: Forbidden Invalid auth code provided
403: Forbidden Invalid/expired auth code in provided
403: Forbidden Invalid/expired code verifier is provided
429: Too Many Requests If the number of requests exceeds the allowed limit
503: Service Unavailable Resource unavailable due to server-side issue
Sample cURL request :
curl --location --request POST 'https://oauth-account-
noneu.truecaller.com/v1/token' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'grant_type=authorization_code' \
--data-urlencode 'client_id=<<your-client-id>>' \
--data-urlencode 'code=<<authorization_code>>' \
--data-urlencode 'code_verifier=<<your-code-verifier>>'
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 160

160
Fetching User Profile
Make a network call to fetch the userInfo using access token from step 14. The
response would be corresponding to the scopes granted by the user.
GET https://oauth-account-noneu.truecaller.com/v1/userinfo
Headers
200: OK 
{
“sub”: “13627101294235520", 
“given_name”: “xyz”,  
“family_name”: “xyz”, 
“phone_number”: “91xxxxxxxxxx", 
“email”: “pqr@gmail.com”,
“picture”: “https://www.truecaller.com/xyz”, 
“gender”: “male/female”,
“phone_number_country_code”: “IN”,
“phone_number_verified”: true, 
ˇ “address”: { “locality”: “Bangalore”, “postal_code”: “5xxxxx" }
}
401: Unauthorized If authentication type is not bearer token
404: Not Found Profile information is not present for the user
500: Internal Server Error Failed to validate token due to server error
Name Type Description
Authorization* "Bearer
<ACCESS_TOKEN>"
Insert access token from
the previous step - fetching
user token
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 161

161
401: Unauthorized Token in invalid/ expired
422: Unprocessable Entity openid scope missing in initial request
500: Internal Server Error Unexpected error at server side
Sample cURL request :
curl --location --request GET 'https://oauth-account-
noneu.truecaller.com/v1/userinfo' \
--header 'Authorization: Bearer testtoken'
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 162

162
Non Truecaller User Verification
This section defines the steps that can be used to trigger verification of non
Truecaller app users which will be powered via Truecaller's drop call based
verification flow
In order to verify both the Truecaller users (via OAuth Flow) and the non-Truecaller
users (via manual verification), follow these steps :
1.Enable the Non Truecaller user verification capability for your app, by going to
your project on the Truecaller developer portal and navigating to the bottom
section.
2.Configure sdkOptions in the TcSdkOptions Builder and supply a value of 
TcSdkOptions.OPTION_VERIFY_ALL_USERS to it like below.
3.Configure permissions required by the SDK :
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback)
.sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
. // other customizations (if any)
.build()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 163

163
4.Once you receive a callback in the 
TcOAuthCallback#onVerificationRequired() , you can initiate the verification
for the user by calling the following method:
Here -
• the first parameter is the country code of the mobile number for which the
verification needs to be triggered
• the second parameter (PHONE_NUMBER_STRING) is the mobile number to be
verified. Please ensure proper validations are in place so as to send correct
phone number string to the above method, otherwise an exception would be
thrown
• the third parameter is an instance of VerificationCallback as defined here
• the fourth parameter is an instance of FragmentActivity
Please note that Truecaller OAuth SDK v3.0.0 currently supports the verification for
non-Truecaller users for Indian numbers only
For Android 8 and above :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.ANSWER_PHONE_CALLS"/>
For Android 7 and below :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.CALL_PHONE"/>
try{
  TcSdk.getInstance().requestVerification("IN", <PHONE_NUMBER>, 
verificationCallback, context);
}catch (RuntimeException e){
  Log.i(TAG, e.getMessage());
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 164

164
5.Once you initiate the verification via 
TcSdk.getInstance().requestVerification()  method, you will receive either a
callback in your VerificationCallback  instance with a specific requestType
as described below
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 165

165
override fun onRequestSuccess(callbackType: Int,verificationDataBundle 
: VerificationDataBundle?) {
         when(callbackType){
   
   VerificationCallback.TYPE_MISSED_CALL_INITIATED)-> {
             //missed-call initiated
              if(verificationDataBundle != null){                  
              
verificationDataBundle.getString(VerificationDataBundle.KEY_TTL);         
              
verificationDataBundle.getString(VerificationDataBundle.KEY_REQUEST_NON
CE);
      }
       }
   VerificationCallback.TYPE_MISSED_CALL_RECEIVED)-> {
             //missed-call received
       }
       
       //OTP initiated via Truecaller IM
   VerificationCallback.TYPE_IM_OTP_INITIATED) -> {
          if(verificationDataBundle != null) {                  
              val ttl = 
verificationDataBundle.getString(VerificationDataBundle.KEY_TTL);         
              val requestNonce = 
verificationDataBundle.getString(VerificationDataBundle.KEY_REQUEST_NON
CE);
}
}
//OTP auto-read via Truecaller IM which you can pre-fill in the OTP 
view
             val otp = bundle.getString(VerificationDataBundle.KEY_OTP)
}
       
       
   VerificationCallback.TYPE_VERIFICATION_COMPLETE)-> {
             //verification complete
       }
   VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE)-> {
             //user already verified 
       }
   }
}
override fun onRequestFailure(callbackType: Int, trueException : 
TrueException) {
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 166

166
onRequestSuccess() method is called under any of the following scenarios -
• When the OTP via Truecaller IM is successfully initiated for the input mobile
number. In this case, you will get the callbackType as 
VerificationCallback.TYPE_IM_OTP_INITIATED
• When the OTP via Truecaller IM is successfully detected on that device by the
SDK present in your app. In this case, you will get the callbackType as 
VerificationCallback.TYPE_IM_OTP_RECEIVED 
• When drop call is successfully initiated for the input mobile number. In this case,
you will get the callbackType as 
VerificationCallback.TYPE_MISSED_CALL_INITIATED
• When drop call is successfully detected on that device by the SDK present in
your app. In this case, you will get the callbackType as 
VerificationCallback.TYPE_MISSED_CALL_RECEIVED
• When the verification is successful for a particular number. In this case, you will
get the callbackType as VerificationCallback.TYPE_VERIFICATION_COMPLETE
• When the user is already verified on that particular device before. In this case,
you will get the callbackType as 
VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE
When callbackType is VerificationCallback.TYPE_MISSED_CALL_INITIATED , you
will receive an additional parameter for the time to live i.e TTL (in seconds) which is
passed as String extra in the VerificationDataBundle  of onRequestSuccess() .
This value determines amount of time left to complete the verification. You can use
this value to show a waiting message to your user before they can try for another
attempt.
Once the TTL expires, you can either auto-retry the verification by calling the
requestVerification() method automatically with the same input parameters OR you
can also take the user back to the number input screen to enter a different number
for verification.
//Exception
    }
   
};
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 167

167
When the callbackType is VerificationCallback.TYPE_ALREADY_VERIFIED_BEFORE
or VerificationCallback.TYPE_VERIFICATION_COMPLETE , it means that the user
verification via Truecaller SDK is complete. In these cases, the SDK will share an
additional access token with your application, which you may then use to validate
the response at your server end. To fetch the access token, you may use the
following code snippet :
Post fetching the access token, you may perform the server side validation by
referring to the steps mentioned in the later part of the documentation here
onRequestFailure() method will be called when some error has occurred while
verifying the provided mobile number. You will receive the appropriate error
message from TrueException using TrueException#getExceptionMessage().For
details of different possible error types you may encounter, please refer to the 
TrueException
//For when the control goes to TYPE_ALREADY_VERIFIED_BEFORE 
verificationDataBundle.getProfile().accessToken
//For when the control goes to TYPE_VERIFICATION_COMPLETE 
verificationDataBundle.getString(VerificationDataBundle.KEY_ACCESS_TOKE
N)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 168

168
Completing Verification
To complete the verification you need to create a TrueProfile instance by passing
the user's first and last name as defined above.
Please note that the first name and last name values to be passed in the above
method call need to follow below mentioned rules :
• The strings need to contains at least 1 alphabet, and cannot be completely
comprised of numbers or special characters.
• String length should be less than 128 characters.
• First name is a mandatory field, last name can be empty ( but non nullable ).
Once you receive a callback in your VerificationCallback instance with the
callbackType TYPE_MISSED_CALL_RECEIVED   or TYPE_IM_OTP_RECEIVED  , you can
complete the verification process by calling the following method from within your
activity :
Please note that Truecaller SDK 3.1.0 is not by default enabled for the IM OTP flow.
This new update is currently under early access. In case you want to enable it for
your app, please drop in a request at developersupport@truecaller.com 
TrueProfile profile = new TrueProfile.Builder(firstName, 
lastName).build();
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 169

169
TrueException
Handling error responses for cases of verifying non-Truecaller users
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 170

170
Error Code Error Message Description
4 "Desired permissions are
missing"
When the requisite
permissions are missing or
not granted while making
the verification request
6 “Sim state is not ready” When the SIM state on the
device is not ready
7 “Airplane mode is ON”
When the device is on
airplane mode, hence
causing missed call to not
go through
2 "Phone number limit
reached”
When the used mobile
number has exceeded the
maximum number of
allowed verification
attempts within a span of
24 hours from the time the
first verification attempt
was made
2 “Request id limit reached”
When the used device
exceeds the maximum
number of allowed
verification attempts in a
span of 24h
2 “Invalid partner credentials.
When the partner key ( app
key ) you have configured in
your project is incorrect.
Visit here
 for more info
2 “Something went wrong:
Failed to create installation.”
In case of Truecaller
internal service error
2 “Invalid phone number”
When the input mobile
number is not a valid mobile
number
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 171

171
2 “Profile has not been
created yet”
When the user has been
successfully verified, but
for some reason their profile
is not created which could
be due to incorrect profile
data while creating
TrueProfile() in
verifyMissedCall method or
due to network issues
5 “Invalid Name”
When the string entered in
the profile builder method
doesnʼt follow the validation
checks :
{
min 1 char, max 128, at least
1 alphabet required with
optional numeric and
special chars,
cannot be all numeric or all
special characters, but can
be all alphabets
}
Refer here
 for more info
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 172

172
Server Side Validation
Once the SDK shares the accessToken for any user verified via drop call based
verification flow, you can verify the authenticity of the access token by making API
call from your server to Truecaller's server. The following endpoint will return phone
number and country code for the given access token.
API Endpoint:
REQUEST :
Method : GET
Header Parameters:
Request Path Parameters:
RESPONSE:
• 200 OK - If access token is valid
"https://sdk-otp-verification-
noneu.truecaller.com/v1/otp/client/installation/phoneNumberDetail/{acce
ssToken}"
Parameter Name Required Description Example
clientId yes Client ID
zHTqS70ca9d3e016
946f19a65b01dRR5
e56460
Parameter Name Required Description Example
accessToken yes
token granted for
the partner for the
respective user
number that
initiated login
"71d8367e-39f7-
4de5-a3a3-
2066431b9ca8"
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 173

173
• 404 Not Found - If your credentials are not valid
• 404 Not Found - If access token is invalid
• 500 Internal Error - for any other internal error
{
    "phoneNumber":919999XXXXX9
    "countryCode":"IN"
}
{
    "code":404
    "message":"Invalid partner credentials."
}
{
    "code":1404
    "message":"Invalid access token."
}
{
    "code":500
    "message":"error message"
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 174

174
Instrumentation
Quick guide on how to properly track and instrument funnel for the verification flow
of users via Truecaller on your app
For proper tracking of the verification funnel via Truecaller SDK on your app, we
recommend you to implement tracking events for the following states :
When you are using the SDK for verification of Truecaller users only:
1.Total users coming to your verification flow
2.Number of cases when the Truecaller app is present on your smartphone
3.Number of profile verification requests made by your app ( when 
TcSdk.getInstance().isOAuthFlowUsable  method is invoked )
4.Number of users who proceed with this flow and click Continue on the
Truecaller dialog [ for these cases, you receive a success callback with
TcOAuthData response in onSuccess() callback method ]
5.Number of cases where you received any error, where you receive an error
callback with TcOAuthError response in onFailure() callback method. For details
on specific error codes, please refer here
When you are using the SDK for verification of non-Truecaller users also ( via
drop call):
1.Total users coming to your verification flow.
2.Number of cases, when the Truecaller app is present on your smartphone and
users, get verified via the Truecaller 1-tap flow (as described in the above
section)
3.Number of verification requests made by your app for a non-Truecaller user (
when TruecallerSDK.getInstance().requestVerification()  method is
invoked ).
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 175

175
4.Number of cases where the user is getting verified for the very first time on the
current smartphone and you receive a success callback - onRequestSuccess()
method ( Please refer here
 ) - a.) When the callback type you receive is 
VerificationCallback.TYPE_MISSED_CALL_INITIATED . This implies that a drop
call has been triggered to the user's mobile number b.) When the callback type
you receive is VerificationCallback.TYPE_MISSED_CALL_RECEIVED . This implies
that a drop call has been received on the user's mobile number on that
smartphone c.) Further to the above step, you complete the user verification by
invoking TcSdk.getInstance().verifyMissedCall(profile, 
verificationCallback) When the callback type you receive is either 
VerificationCallback.TYPE_VERIFICATION_COMPLETE . This implies that the
verification is complete for the user d.) Number of cases where the user is
already verified previously on the current smartphone and gets verified directly.
In such cases, you receive the success callback - onRequestSuccess() method
with callback type as VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE .
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 176

176
Getting Release Ready
Testing your verification flow
Google play store app permission declaration form
Moving to Production
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 177

177
Testing your verification flow
Non Truecaller User Verification
Truecaller user verification flow
Test Setup
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 178

178
Non-Truecaller user verification flow
Common scenarios to check for in you app verification flow for non-Truecaller
users
If the user does not have the Truecaller app present on their device or they chose to
verify using a different number than the one already verified on Truecaller app
currently, they can be taken to this flow in which we provision the verification of the
user by sending missed call using our infrastructure.
User verifying via Truecaller's missed call mechanism for the very first time
Proceed to the flow where the user needs to input their mobile number. Give the
necessary permissions ( as described here
 ) and proceed with the verification.
You would receive a missed call on the device which gets automatically detected by
the SDK. Post this, you need to pass the user's first name and last name to the SDK
to complete the verification
User already verified with the same credentials previously on the smartphone
Once a user's verification is completed successfully on a particular device, and
they re-attempt to verify on the same app using the same credentials ( same
smartphone, same mobile number ), Truecaller SDK is able to identify the user and
we can tell you it's the same user. In this case, no additional missed call / OTP is
needed to re-verify the user. The SDK will directly tell the status of the repeat user,
and in this case returns the first name and last name of the user back to you in
response.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 179

179
Truecaller user verification flow
Common scenarios to check for in you app verification flow for existing Truecaller
users
Truecaller app present and registration completed on Truecaller app
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Open your app and initiate the Truecaller
verification flow. The user should see the Truecaller profile dialog. Click on continue
to complete the verification flow and ensure that the verification is completed.
Truecaller app present but registration not completed on Truecaller app
Ensure that the Truecaller app is present on your device but you have not
completed the profile creation step on Truecaller app. Open your app and initiate
the Truecaller verification flow. The user should not see the Truecaller profile
dialog, and you would receive the control in onFailureProfileShared() with the
specific error code.
Truecaller app not present on the device
Remove the Truecaller app from your device. Open your app and try to initiate the
Truecaller verification flow. The user should not see the Truecaller profile dialog
and should be taken to either your alternate verification flow or in case you are
using Truecaller SDK's functionality of verifying non-Truecaller users, user should
be redirected to that flow.
Network not available on device
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Turn off the mobile data and WiFi on
your device. Open your app and initiate the Truecaller verification flow. You would
see the Truecaller profile dialog. Click on continue button on the dialog, you would
receive control in onFailureProfileShared() method with a specific error code.
Client ID should be working fine ( onFailure() Error Type 12)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 180

180
For complete details on this part, please refer here.
User wishes to proceed with another number OR does not want to share their
Truecaller profile
Initiate the Truecaller verification flow in your app to invoke the Truecaller profile
dialog. Click on system back or Use another mobile number button on the dialog to
dismiss the dialog. In such a scenario, user should be taken to either your alternate
verification flow or in case you are using Truecaller SDK's functionality of verifying
non-Truecaller users, user should be redirected to that flow.
We also recommend that you go through the FAQ section to go through some of the
commonly asked questions.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 181

181
Test Setup
Quick guide on getting your test setup ready to test the common verification
scenarios as described in previous sections
Pre-Requisites
• We suggest you to keep handy at-least 2 android smartphones with active SIM
connections. Ensure that both the smartphones have your test app installed
(Integrated with Truecaller SDK)
• 2 different smartphones are required so that in case you get verified on one of
the smartphones, you can use the second smartphone to check for the fresh
verification scenarios.
Steps to follow for testing user scenarios :
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 182

182
User State App Scenario Steps
Existing Truecaller user
• Install Truecaller on
smartphone 'A'
• Complete profile
creation step on
Truecaller app
• Launch your application
and initiate the
Truecaller verification
flow
• Truecaller profile
consent screen should
appear
• Tapping on Continue
button should verify the
user
Non Truecaller User User getting verified for the
first time on smartphone
• Take smartphone 'A'
• Uninstall Truecaller app
from the smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs &
phone permissions are
asked ( if not already
granted )
• Allow the permissions
to enable receiving a
drop call
• User is manually asked
to enter name ( if it's a
new user on your app )
• On entering the name,
SDK verifies the user
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 183

183
Non Truecaller User
User already verified on the
smartphone and tried to re-
verify
( Please ensure that you try
this step only after you have
performed the above step )
• Take smartphone 'A'
• Launch your application
and logout from the app
• Initiate the verification
flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
Non Truecaller User
User already verified on the
smartphone, uninstalls and
re-installs the application
on the device
( Please ensure that you try
this step only after you have
performed the 2nd step )
• Take smartphone 'A'
• Uninstall your
application from the
smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 184

184
Wi-Fi or mobile internet should also be enabled on both the smartphones
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 185

185
Google play store app
permission declaration form
This section is only relevant for apps who are using the Truecaller SDK for verifying
non-Truecaller user as well and seek phone permissions from the users
If you are using the functionality of verifying non Truecaller users also via the SDK,
your app would need specific phone permissions as has been described in this 
section
. If you are using the Truecaller SDK for verification of existing Truecaller
users only ( 1-tap flow ), you can skip this section.
As you upload the new app build to PlayStore with user verification feature via
Truecaller SDK and the requisite permissions, you might be asked to fill an app
permission declaration form.
We are sharing some tips on how to appropriately justify the need for these
permissions for your verification flow :
#1: In one sentence, please describe the core functionality of your app. To be
defined by you as a publisher of your app
#2: What is the core functionality in your app requiring the Call Log and / or SMS
permissions? Mobile number verification to onboard users on <your_app>
This is in-line with Googleʼs allowed usage of this permission for account
verification via phone call, as stated here:
https://support.google.com/googleplay/android-developer/answer/9047303 Flow:
a)Enter mobile number b)Request READ_CALL_LOG permission c)Initiate drop call
from 3rd party service to respective number d)Drop call hits userʼs device and is
rejected automatically via above permission to complete verification
#3: Do any of the following disallowed use cases apply to your appʼs core
functionality request for Call Log or SMS permissions? NO
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 186

186
#4: Do any of the following other use cases apply to your appʼs core functionality
request for Call Log or SMS permissions? OTP & Account verification via Phone
Call (select this from the given list of options)
#5: Is your appʼs use of Call Log or SMS permissions to provide functionality
required by law or regulation? No
#6: Other We use drop call based verification of usersʼ mobile number for account
creation or logging into their <your app name> accounts. Such method of mobile
number verification results in better verification success rates in our key markets
like India, etc.
Android guidelines for asking app permissions from user 
https://developer.android.com/training/permissions/requesting
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 187

187
Moving to Production
Submitting your project for review post integration
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 188

188
OAuth SDK 3.0.0
Implementing user flow for your App
Scenarios for all user verifications : Truecaller and Non Truecaller Users
Integration Steps
Instrumentation
Getting Release Ready
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 189

189
Implementing user flow for your App
Truecaller SDK is a mobile number verification service, without the need for any
OTP whatsoever.
The right way to implement Truecaller SDK in your mobile app, is to invoke mobile
number verification via Truecaller at touch points, where you have your users to
sign-up/ login/ checkout by verifying their mobile numbers.
Let us now see an example to understand how to effectively use Truecaller SDK at
such touch points in your user journey
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process.
For example, one could address it as Get Started, Join Us, Login, Sign up, etc.,
shown as a button to the users, clicking which leads to the mobile number based
identity verification of users.
Here is such an example from CentroStore - our very own in-house sample app:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 190

190
Building for Various Touch points
a. Invoking user signup/ login/ verification via Truecaller at app onboarding
Example: CentroStore - our very own in-house sample app
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process. For example, one could address it as Get Started,
Join Us, Login, Sign up, etc., shown as a button to the users, clicking which leads to
the mobile number-based identity verification of users. Here is such an example
from CetroStore.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 191

191
b. Directly invoking verification via Truecaller
Example : CentroStore - our very own in-house sample app
CentroStore has mobile number as the primary identifier for its users. So as soon as
users lands on their mobile number login/ signup screen, it invokes Verification via
Truecaller, and onboards itʼs users within seconds in just 1-tap.
c. Performing user verification at checkout
Example : CentroStore - our very own in-house sample app
CentroStore also allows users to browse through itʼs app and check for bus ETAs,
without needing to sign-up or log-in. However, when users wish to purchase the
ticket or travel pass, it requires users to verify their mobile number.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 192

192
Now that we have gone through and understood how to implement Verification via
Truecaller, letʼs get started with the SDK integration.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 193

193
Scenarios for all user verifications :
Truecaller and Non Truecaller Users
Truecaller SDK enables you to verify your user's mobile number in a seamless way.
For users who have the Truecaller app present on their smartphones and are
already registered Truecaller users, they get verified in a 1-tap flow (supported
globally), without the need of any manual input.
For users who don't have the Truecaller app present on their smartphones, the SDK
enables user verification by means of a drop call, which is triggered to the user's
number in the background to complete the verification flow (currently supported
only for India).
To understand various possible user scenarios in the user's verification flow, let's
try to take the example of CentroStore. CetroStore is using Truecaller SDK for
verifying the numbers of all their users.
Scenario 1 
a) New user on CentroStore app and 
b) Truecaller app present on user's smartphone
Scenario 2 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 194

194
a) Existing user on CentroStore app, and 
b) Truecaller app present on smartphone
Scenario 3 
a) New user on CentroStore app, and
b) Truecaller app NOT present on a smartphone, and user's mobile number NOT
already verified on smartphone
Scenario 4 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 195

195
a) Existing user on CentroStore app, and 
b) Truecaller app NOT present on smartphone and user's mobile number NOT
verified on smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 196

196
Integration Steps
Step by step guide to integrate Truecaller OAuth SDK with your android project.
In order to proceed with the integration, please refer to the previous sections
 so as
to understand various user flows and touch points in the user journey where Truecaller
can be enabled.
• Register on the OAuth portal
  to create your business account and manage
OAuth projects.
• Once you have created your account, create your OAuth project & generate
credentials by following the steps here.
• Once you have generated the credentials, you can easily, in a few simple steps
integrate the Truecaller SDK by referring to our step-by-step guide in the
subsequent sections.
• Post integration completion, submit your project for review and go live.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 197

197
Generating Client ID
To ensure the authenticity of interactions between your app and Truecaller, you
need to generate a client ID from the Truecaller developer portal by following the
steps below:
• Go to https://sdk-console-noneu.truecaller.com/login
 and register your
account.
• Once registered, log in to your account and click on the "create project” button.
• Enter the project name and select the business category from the dropdown
menu. This will create a new project.
• On the project screen, click the “add credential” button and select the platform
as Android from the dropdown menu.
• On the credential section, enter the package name and the SHA1.
• Your package name corresponds to the applicationId in your app level 
build.gradle  file.
You can get to know the SHA1 for your different app builds by following these steps
:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 198

198
• Open your project in android studio
• Open terminal
• Type command ./gradlew signingReport
Once done you should be able to see the SHA1 fingerprint of your different build
configurations [ debug /release ] in the terminal window within the android studio.
Once you input your app details and create the app, you will be able to see a unique
"ClientID" for your app which you need to include in your project to authorise all
verification requests.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 199

199
Setup
1.Ensure that your Minimum SDK version is at least API level 24 or above. In case
your android project compiles for API level below 24, you can include the
following line in your AndroidManifest.xml file to avoid any compilation issues :
<uses-sdk tools:overrideLibrary="com.truecaller.android.sdk"/> 
Using this would ensure that the SDK works normally for API level 24 & above,
and would be disabled for API level < 24. Note: Please make sure that you put
the necessary API level checks before accessing the SDK methods in case of
compiling for API level < 24
2.
2.1) Add the Truecaller SDK which contains OAuth functionality to your app-
level build.gradle file 
dependencies {
...
implementation "com.truecaller.android.sdk:truecaller-sdk:3.0.0"
} 
2.2) Also, add the following lines of code in your gradle file, if not already
present
android{
compileOptions{
sourceCompatibility JavaVersion.VERSION_1_8
targetCompatibility JavaVersion.VERSION_1_8
}
} 
3.Add mavenCentral() in your project level build.gradle file :
allprojects{
   repositories{
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 200

200
 ...
       mavenCentral()
 ...
} 
Also check your AGP and distribution URL version AGP : 7.4.2 (minimum)
distributionUrl=https\://services.gradle.org/distributions/gradle-7.5-bin.zip
(minimum).
4.Configure Client ID : 
a.) Open your strings.xml file. Example path: /app/src/main/res/values/strings.xml
and add a new string with the name "clientID" and value as your "clientID"
b.) Open your AndroidManifest.xml and add a meta-data element to the application
element
<application android:label="@string/app_name" ...>
...
<meta-data android:name="com.truecaller.android.sdk.ClientId" 
android:value="@string/clientID"/>
...
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 201

201
Implementing Callbacks
4.In your Activity/Fragment where you want to integrate the Truecaller OAuth flow,
either make the component implement the interface TcOAuthCallback or create
an instance of it which you would require to initialize TcSdkOptions in the next
step.
The interface has 2 functions which need to be overridden -
• onFailure() method will be called in case of an error. You would get the error
details like the error code and error message through tcOAuthError returned
with this method.
• onSuccess() method will be called when the user gives consent to authorize
your app by tapping on the primary button on the Truecallerʼs consent screen,
and subsequently, an authorization code will be successfully generated and
received. This method would return tcOAuthData which contains information
like :
◦ authorizationCode - which you can utilize to fetch the userʼs access token
◦ scopesGranted - list of scopes granted by the user
◦ state - state parameter returned by the authorisation server. If the state set
by your application is the same as the state returned by the authorisation
server, itʼs safe to proceed further. If state parameters are different,
someone else has initiated the request and it could be a case of request
forgery.
5.Override the onActivityResult() method of the component used in step 1 and call
the onActivityResultObtained() method if the requestCode matches to
TcSdk.SHARE_PROFILE_REQUEST_CODE.
private val tcOAuthCallback: TcOAuthCallback = object : TcOAuthCallback 
{
    override fun onSuccess(tcOAuthData: TcOAuthData) {
        ..
    }
    override fun onFailure(tcOAuthError: TcOAuthError) {
        ..
    }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 202

202
override fun onActivityResult(requestCode: Int, resultCode: Int, data: 
Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == TcSdk.SHARE_PROFILE_REQUEST_CODE) {
             TcSdk.getInstance().onActivityResultObtained(this, 
requestCode, resultCode, data)
        }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 203

203
Initialisation
6.Create a TcSdkOptions object by using the tcOAuthCallback from the previous
step and provide the context. Supply the appropriate customization settings to
the relevant methods of TcSdkOptions and use the instance of tcSdkOptions to
initialize the TcSdk in the next step.
In case you do not wish to provide any customization settings and fall back to the
default SDK settings, you may simply call -
7.Initialize TcSdk using the tcSdkOptions from the previous step :
Note: Truecaller OAuth SDK needs to be initialized only once in the component and
the same instance can be accessed without the need to initialize it again, via 
TcSdk.getInstance()
Ideally, you should call the init() method when the component is getting
created/initialized to avoid calling it multiple times.
8.Once the SDK is initialized, check whether the OAuth functionality is usable or
not by calling :
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback)
.buttonColor(Color.parseColor("<<VALID_COLOR_HEX_CODE>>"))
          .buttonTextColor(Color.parseColor("
<<VALID_COLOR_HEX_CODE>>"))
            
.loginTextPrefix(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
            .ctaText(TcSdkOptions.CTA_TEXT_CONTINUE)
            .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
            .footerType(TcSdkOptions.FOOTER_TYPE_SKIP)
            .consentTitleOption(TcSdkOptions.SDK_CONSENT_TITLE_LOG_IN)
            .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
            .build();
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback).build()
TcSdk.init(tcSdkOptions)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 204

204
If isUsable is True, you can proceed with further steps, otherwise, youʼd have to fall
back to some other mechanism ( your fallback verification flow ). Calling other SDK
methods when isUsable is False would result in an exception, so please ensure to
call this soon after initializing the SDK, and proceed to further steps only if this
method returns True.
val isUsable = TcSdk.getInstance().isOAuthFlowUsable
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 205

205
Setting up OAuth parameters
9.Set a unique state parameter & store it in the current session to use it later in the
onSuccess() callback method of the TcOAuthCallback to match if the state
received from the authorization server is the same as set here to prevent
request forgery attacks.
One good choice for a state token is a string of around 32 characters constructed
using a high-quality random-number generator as we did above. Another approach
could be a hash generated by signing some of your session state variables with a
key that is kept secret on your back-end.
Truecaller OAuth SDK already verifies the request-response correlation before
forwarding it to the your app.
10.Set the list of scopes to be requested.
11.Generate a unique code verifier & store it in the current session since it would
be required later to generate the access token. It can be generated using the
utility class CodeVerifierUtil provided in the SDK.
stateRequested = BigInteger(130, SecureRandom()).toString(32)
TcSdk.getInstance().setOAuthState(stateRequested)
TcSdk.getInstance().setOAuthScopes(arrayOf("profile", "phone", ...))
// Currently available list of scopes :
- profile
- phone
- openid
- offline_access
- email
- address
Note : 
Please include the relevant scopes for your project. 
Make sure the scopes you’re requesting above are selected on the portal 
for your project
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 206

206
This utility method generates a random code verifier string using SecureRandom as
the source of entropy with 64 as the default entropy quantity.
12.Set the corresponding code challenge using the code verifier generated in the
previous step. This can be generated using the utility class CodeVerifierUtil
provided in the SDK.
This utility method produces a code challenge from the supplied code verifier using
SHA-256 as the challenge method and Base64 as encoding if the system supports
it (all Android devices should ideally support SHA-256 and Base64), but in rare
case if the device doesnʼt, then this method would return null meaning that you
canʼt proceed further. Please ensure to have a null safe check for such cases.
codeVerifier = CodeVerifierUtil.generateRandomCodeVerifier()
val codeChallenge = CodeVerifierUtil.getCodeChallenge(codeVerifier)
codeChallenge?.let {
                TcSdk.getInstance().setCodeChallenge(it)
} ?: print(“Code challenge is Null. Can’t proceed further”)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 207

207
Invocation
13.You can trigger the Truecaller profile verification dialog anywhere in your app
flow by calling the following method
In case isOAuthFlowUsable() method returns false, implying that Truecaller app is
not present on the device, you can take the user to your app screen and continue
with the verification flow for non-Truecaller users.
TcSdk.getInstance().getAuthorizationCode(this);
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 208

208
Customisation
Truecaller SDK provides you with capabilities to configure the following:
Refer to the below section for details on all the customization capabilities and the
possible values you may set:
Contextual header [ .heading() ] 
To provide the appropriate context of verification to the Truecaller user, use one of
the below mentioned TruecallerSdkScope values to show the corresponding
message to the user
TcSdkOptions.Builder(this, tcOAuthCallback)
       .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
       .footerType(TcSdkOptions.FOOTER_TYPE_ANOTHER_MOBILE_NO)
       .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
       .ctaText(TcSdkOptions.CTA_TEXT_ACCEPT)
       .heading(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
       .buttonColor(1111)
       .buttonTextColor(1111)
       .build()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 209

209
Log in to TcSdkOptions.SDK_CONSENT_HEADING_L
OG_IN_TO
Sign up with TcSdkOptions.SDK_CONSENT_HEADING_SI
GNUP_WITH
Sign in to TcSdkOptions.SDK_CONSENT_HEADING_SI
GN_IN_TO
Verify number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_NUMBER_WITH
Register with TcSdkOptions.SDK_CONSENT_HEADING_RE
GISTER_WITH
Get started with TcSdkOptions.SDK_CONSENT_HEADING_GE
T_STARTED_WITH
Proceed with TcSdkOptions.SDK_CONSENT_HEADING_PR
OCEED_WITH
Verify with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_WITH
Verify profile with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_PROFILE_WITH
Verify your profile with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_YOUR_PROFILE_WITH
Verify your phone number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_PHONE_NO_WITH
Verify your number with TcSdkOptions.SDK_CONSENT_HEADING_VE
RIFY_YOUR_NO_WITH
Continue with TcSdkOptions.SDK_CONSENT_HEADING_C
ONTINUE_WITH
Complete order with TcSdkOptions.SDK_CONSENT_HEADING_C
OMPLETE_ORDER_WITH
Place order with TcSdkOptions.SDK_CONSENT_HEADING_PL
ACE_ORDER_WITH
Complete booking with TcSdkOptions.SDK_CONSENT_HEADING_C
OMPLETE_BOOKING_WITH
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 210

210
Button text options [ .ctaTextPrefix() ] 
To set the prefix on the CTA button
Button shape [ .buttonShapeOptions() ] 
To chose the shape of the CTA button
Checkout with TcSdkOptions.SDK_CONSENT_HEADING_C
HECKOUT_WITH
Manage Details with TcSdkOptions.SDK_CONSENT_HEADING_M
ANAGE_DETAILS_WITH
Manage your details with TcSdkOptions.SDK_CONSENT_HEADING_M
ANAGE_YOUR_DETAILS_WITH
Login to <<APP_NAME>> with one tap TcSdkOptions.SDK_CONSENT_HEADING_L
OGIN_TO_WITH_ONE_TAP
Subscribe to TcSdkOptions.SDK_CONSENT_HEADING_S
UBSCRIBE_TO
Get updates from TcSdkOptions.SDK_CONSENT_HEADING_GE
T_UPDATES_FROM
Continue reading on TcSdkOptions.SDK_CONSENT_HEADING_C
ONTINUE_READING_ON
Get new updates from TcSdkOptions.SDK_CONSENT_HEADING_GE
T_NEW_UPDATES_FROM
Log in/ Signup with TcSdkOptions.SDK_CONSENT_HEADING_L
OGIN_SIGNUP_WITH
Continue TcSdkOptions.CTA_TEXT_CONTINUE
Proceed TcSdkOptions.CTA_TEXT_PROCEED
Accept TcSdkOptions.CTA_TEXT_ACCEPT
Confirm TcSdkOptions.CTA_TEXT_COFIRM
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 211

211
Footer CTA text [ .footerType() ] 
To configure the text of the additional footer CTA present at the bottom
Privacy policy : 
To add your privacy policy link on the verification screen, you can configure the
respective hyperlink from your developer account
Terms of service: To add your terms of service link on the verification screen, you
can configure the respective hyperlink from your developer account
Language You can optionally customize the consent screen in any of the supported
languages. To do so, add the following line :
Copy
Currently supported languages:
Round TcSdkOptions.BUTTON_SHAPE_ROUNDED
Rectangle TcSdkOptions.BUTTON_SHAPE_RECTANGL
E
Use another number TcSdkOptions.FOOTER_TYPE_CONTINUE
Use another method TcSdkOptions.FOOTER_TYPE_ANOTHER_M
ETHOD
Enter details manually TcSdkOptions.FOOTER_TYPE_MANUALLY
Later TcSdkOptions.FOOTER_TYPE_LATER
val locale = Locale("hi") // change language to Hindi
TcSdk.getInstance().setLocale(locale)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 212

212
english en
hindi hi
marathi mr
telugu te
malayalam ml
urdu ur
punjabi pa
tamil ta
bengali bn
kannada kn
swahili sw
arabic ar
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 213

213
Clearing SDK Instance
In order to clear the resources taken up by the SDK, you may use the following
method
TcSdk.clear()
Ideally, you should call this method when the component in which you initialized the
SDK is getting killed/destroyed.
For instance, if you have initialized the SDK in the onCreate() method of the activity
lifecycle, then you need to call clear it in the onDestroy() method of the activity
lifecycle.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 214

214
Handling Error Scenarios
Failure/ Error responses
The "onFailure" callback method that you just implemented in the previous step
helps you to handle all the possible failure cases when the user couldn't be verified
successfully via the Truecaller flow.
Below are some of the possible failure scenarios and the corresponding error
response that you receive for each of the cases :
Please note that when you encounter any of the error scenarios and get the control
in the "onFailure()" method, you should redirect the user to your alternate
verification flow.
Error Description Error Code
"Something went wrong" 0
"Device is not supported" 16
"Truecaller user has an invalid account
state" 10
"Invalid partner or partner information is
missing" 12
"Conflicting request code possible in
onActivityResult()" 6
"Truecaller app closed unexpectedly" 7
"Truecaller app is not installed/loggedin" 5
"User denied by pressing the footer button" 11
"User denied by dismissing consent
screen" 14
"User denied while loading" 2
"Truecaller sdk is old and not compatible" 6
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 215

215
Exceptions
In case you face any of the following run time exceptions, please follow the
recommended steps as mentioned below :
"No compatible client available. Please change your scope"
As the exception suggests, you are trying to call an SDK method even though no
client is available to handle it. This usually happens if you have initialized the SDK
using ONLY_TC_USERS scope option i.e to verify only the Truecaller users, and you
are not calling isOAuthFlowUsable() method before calling an SDK method. To
resolve this, call isOAuthFlowUsable() before calling any SDK method if you are
using VERIFY_TC_USERS scope option.
"Please call init() on TruecallerSDK first"
This exception suggests that you are trying to call an SDK method before the SDK
has been initialised. To resolve it, check for all possible user flows in your app
which could lead to calling an SDK method directly before it has been initialised.
"Add client id in your manifest"
This exception suggests that you are trying to call SDK initialization/build method
without having your clientID mentioned in your manifest as meta-data.
"OAuth scopes cannot be null or empty"
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the OAuth scopes.
"OAuth state cannot be null or empty"
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the OAuth state.
“Code challenge cannot be null or empty”
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 216

216
This exception suggests that you are trying to call SDK method -
getAuthorisationCode before setting up the Code challenge.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 217

217
Integrating with your Backend
Fetching User Token
Fetching User Profile
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 218

218
Fetching User Token
Using the “state” from step 10, “code verifier” from step 12, and the “authorization
code” from step 9, you need to make a network call to Truecallerʼs backend so as to
fetch the access token :
POST https://oauth-account-noneu.truecaller.com/v1/token
Headers
Request Body
200: OK Success 
{ 
"access_token": "some-access-token", 
"expires_in": 3600, 
"token_type": "Bearer" 
}
Name Type Description
Content-Type* application/x-www-form-
urlencoded
String
Name Type Description
grant_type "authorization_code" // hardcoded value
String
client_id <YOUR_CLIENT_ID>
code <USER_AUTHORISATION_C
ODE>
Authorisation code from
TcOAuthData callback from
step 9
code_verifier <YOUR_CODE_VERIFIER> From step 12
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 219

219
400: Bad Request -  If grant type is not supported
403: Forbidden - If client id is invalid
500: Internal Server Error - Unexpected error on the server side
400: Bad Request  - Some of the parameters are empty in the request
403: Forbidden Valid grant type but not allowed for the client
403: Forbidden Invalid auth code provided
403: Forbidden Invalid/expired auth code in provided
403: Forbidden Invalid/expired code verifier is provided
429: Too Many Requests If the number of requests exceeds the allowed limit
503: Service Unavailable Resource unavailable due to server-side issue
Sample cURL request :
curl --location --request POST 'https://oauth-account-
noneu.truecaller.com/v1/token' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'grant_type=authorization_code' \
--data-urlencode 'client_id=<<your-client-id>>' \
--data-urlencode 'code=<<authorization_code>>' \
--data-urlencode 'code_verifier=<<your-code-verifier>>'
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 220

220
Fetching User Profile
Make a network call to fetch the userInfo using access token from step 14. The
response would be corresponding to the scopes granted by the user.
GET https://oauth-account-noneu.truecaller.com/v1/userinfo
Headers
200: OK 
{
“sub”: “13627101294235520", 
“given_name”: “xyz”,  
“family_name”: “xyz”, 
“phone_number”: “91xxxxxxxxxx", 
“email”: “pqr@gmail.com”,
“picture”: “https://www.truecaller.com/xyz”, 
“gender”: “male/female”,
“phone_number_country_code”: “IN”,
“phone_number_verified”: true, 
ˇ “address”: { “locality”: “Bangalore”, “postal_code”: “5xxxxx" }
}
401: Unauthorized If authentication type is not bearer token
404: Not Found Profile information is not present for the user
500: Internal Server Error Failed to validate token due to server error
Name Type Description
Authorization* "Bearer
<ACCESS_TOKEN>"
Insert access token from
the previous step - fetching
user token
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 221

221
401: Unauthorized Token in invalid/ expired
422: Unprocessable Entity openid scope missing in initial request
500: Internal Server Error Unexpected error at server side
Sample cURL request :
curl --location --request GET 'https://oauth-account-
noneu.truecaller.com/v1/userinfo' \
--header 'Authorization: Bearer testtoken'
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 222

222
Non Truecaller User Verification
This section defines the steps that can be used to trigger verification of non
Truecaller app users which will be powered via Truecaller's drop call based
verification flow
In order to verify both the Truecaller users (via OAuth Flow) and the non-Truecaller
users (via manual verification), follow these steps :
1.Enable the Non Truecaller user verification capability for your app, by going to
your project on the Truecaller developer portal and navigating to the bottom
section.
2.Configure sdkOptions in the TcSdkOptions Builder and supply a value of 
TcSdkOptions.OPTION_VERIFY_ALL_USERS to it like below.
3.Configure permissions required by the SDK :
val tcSdkOptions = TcSdkOptions.Builder(this, tcOAuthCallback)
.sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
. // other customizations (if any)
.build()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 223

223
4.Once you receive a callback in the 
TcOAuthCallback#onVerificationRequired() , you can initiate the verification
for the user by calling the following method:
Here -
• the first parameter is the country code of the mobile number for which the
verification needs to be triggered
• the second parameter (PHONE_NUMBER_STRING) is the mobile number to be
verified. Please ensure proper validations are in place so as to send correct
phone number string to the above method, otherwise an exception would be
thrown
• the third parameter is an instance of VerificationCallback as defined here
• the fourth parameter is an instance of FragmentActivity
Please note that Truecaller OAuth SDK v3.0.0 currently supports the verification for
non-Truecaller users for Indian numbers only
For Android 8 and above :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.ANSWER_PHONE_CALLS"/>
For Android 7 and below :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.CALL_PHONE"/>
try{
  TcSdk.getInstance().requestVerification("IN", <PHONE_NUMBER>, 
verificationCallback, context);
}catch (RuntimeException e){
  Log.i(TAG, e.getMessage());
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 224

224
5.Once you initiate the verification via 
TcSdk.getInstance().requestVerification()  method, you will receive either a
callback in your VerificationCallback  instance with a specific requestType
as described below
onRequestSuccess() method is called under any of the following scenarios -
• When drop call is successfully initiated for the input mobile number. In this case,
you will get the callbackType as 
VerificationCallback.TYPE_MISSED_CALL_INITIATED
override fun onRequestSuccess(callbackType: Int,verificationDataBundle 
: VerificationDataBundle?) {
         when(callbackType){
   
   VerificationCallback.TYPE_MISSED_CALL_INITIATED)-> {
             //missed-call initiated
              if(verificationDataBundle != null){                  
              
verificationDataBundle.getString(VerificationDataBundle.KEY_TTL)          
              
verificationDataBundle.getString(VerificationDataBundle.KEY_REQUEST_NON
CE)
      }
       }
   VerificationCallback.TYPE_MISSED_CALL_RECEIVED)-> {
             //missed-call received
       }
   VerificationCallback.TYPE_VERIFICATION_COMPLETE)-> {
             //verification complete
       }
   VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE)-> {
             //user already verified 
       }
   }
}
override fun onRequestFailure(callbackType: Int, trueException : 
TrueException) {
//Exception
    }
   
};
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 225

225
• When drop call is successfully detected on that device by the SDK present in
your app. In this case, you will get the callbackType as 
VerificationCallback.TYPE_MISSED_CALL_RECEIVED
• When the verification is successful for a particular number. In this case, you will
get the callbackType as VerificationCallback.TYPE_VERIFICATION_COMPLETE
• When the user is already verified on that particular device before. In this case,
you will get the callbackType as 
VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE
When callbackType is VerificationCallback.TYPE_MISSED_CALL_INITIATED , you
will receive an additional parameter for the time to live i.e TTL (in seconds) which is
passed as String extra in the VerificationDataBundle  of onRequestSuccess() .
This value determines amount of time left to complete the verification. You can use
this value to show a waiting message to your user before they can try for another
attempt.
Once the TTL expires, you can either auto-retry the verification by calling the
requestVerification() method automatically with the same input parameters OR you
can also take the user back to the number input screen to enter a different number
for verification.
When the callbackType is VerificationCallback.TYPE_ALREADY_VERIFIED_BEFORE
or VerificationCallback.TYPE_VERIFICATION_COMPLETE , it means that the user
verification via Truecaller SDK is complete. In these cases, the SDK will share an
additional access token with your application, which you may then use to validate
the response at your server end. To fetch the access token, you may use the
following code snippet :
Post fetching the access token, you may perform the server side validation by
referring to the steps mentioned in the later part of the documentation here
//For when the control goes to TYPE_ALREADY_VERIFIED_BEFORE 
verificationDataBundle.getProfile().accessToken
//For when the control goes to TYPE_VERIFICATION_COMPLETE 
verificationDataBundle.getString(VerificationDataBundle.KEY_ACCESS_TOKE
N)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 226

226
onRequestFailure() method will be called when some error has occurred while
verifying the provided mobile number. You will receive the appropriate error
message from TrueException using TrueException#getExceptionMessage().For
details of different possible error types you may encounter, please refer to the 
TrueException
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 227

227
Completing Verification
Once you receive a callback in your VerificationCallback instance with the
callbackType TYPE_MISSED_CALL_RECEIVED , you can complete the verification
process by calling the following method from within your activity :
Copy
You need to create a TrueProfile instance by passing the user's first and last name
as defined above.
Please note that the first name and last name values to be passed in the above
method call need to follow below mentioned rules :
• The strings need to contains at least 1 alphabet, and cannot be completely
comprised of numbers or special characters.
• String length should be less than 128 characters.
• First name is a mandatory field, last name can be empty ( but non nullable ).
TrueProfile profile = new TrueProfile.Builder(firstName, 
lastName).build();
TcSdk.getInstance().verifyMissedCall(profile, verificationCallback)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 228

228
TrueException
Handling error responses for cases of verifying non-Truecaller users
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 229

229
Error Code Error Message Description
4 "Desired permissions are
missing"
When the requisite
permissions are missing or
not granted while making
the verification request
6 “Sim state is not ready” When the SIM state on the
device is not ready
7 “Airplane mode is ON”
When the device is on
airplane mode, hence
causing missed call to not
go through
2 "Phone number limit
reached”
When the used mobile
number has exceeded the
maximum number of
allowed verification
attempts within a span of
24 hours from the time the
first verification attempt
was made
2 “Request id limit reached”
When the used device
exceeds the maximum
number of allowed
verification attempts in a
span of 24h
2 “Invalid partner credentials.
When the partner key ( app
key ) you have configured in
your project is incorrect.
Visit here
 for more info
2 “Something went wrong:
Failed to create installation.”
In case of Truecaller
internal service error
2 “Invalid phone number”
When the input mobile
number is not a valid mobile
number
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 230

230
2 “Profile has not been
created yet”
When the user has been
successfully verified, but
for some reason their profile
is not created which could
be due to incorrect profile
data while creating
TrueProfile() in
verifyMissedCall method or
due to network issues
5 “Invalid Name”
When the string entered in
the profile builder method
doesnʼt follow the validation
checks :
{
min 1 char, max 128, at least
1 alphabet required with
optional numeric and
special chars,
cannot be all numeric or all
special characters, but can
be all alphabets
}
Refer here
 for more info
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 231

231
Server Side Validation
Once the SDK shares the accessToken for any user verified via drop call based
verification flow, you can verify the authenticity of the access token by making API
call from your server to Truecaller's server. The following endpoint will return phone
number and country code for the given access token.
API Endpoint:
REQUEST :
Method : GET
Header Parameters:
Request Path Parameters:
RESPONSE:
• 200 OK - If access token is valid
"https://sdk-otp-verification-
noneu.truecaller.com/v1/otp/client/installation/phoneNumberDetail/{acce
ssToken}"
Parameter Name Required Description Example
clientId yes Client ID
zHTqS70ca9d3e016
946f19a65b01dRR5
e56460
Parameter Name Required Description Example
accessToken yes
token granted for
the partner for the
respective user
number that
initiated login
"71d8367e-39f7-
4de5-a3a3-
2066431b9ca8"
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 232

232
• 404 Not Found - If your credentials are not valid
• 404 Not Found - If access token is invalid
• 500 Internal Error - for any other internal error
{
    "phoneNumber":919999XXXXX9
    "countryCode":"IN"
}
{
    "code":404
    "message":"Invalid partner credentials."
}
{
    "code":1404
    "message":"Invalid access token."
}
{
    "code":500
    "message":"error message"
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 233

233
Instrumentation
Quick guide on how to properly track and instrument funnel for the verification flow
of users via Truecaller on your app
For proper tracking of the verification funnel via Truecaller SDK on your app, we
recommend you to implement tracking events for the following states :
When you are using the SDK for verification of Truecaller users only:
1.Total users coming to your verification flow
2.Number of cases when the Truecaller app is present on your smartphone
3.Number of profile verification requests made by your app ( when 
TcSdk.getInstance().isOAuthFlowUsable  method is invoked )
4.Number of users who proceed with this flow and click Continue on the
Truecaller dialog [ for these cases, you receive a success callback with
TcOAuthData response in onSuccess() callback method ]
5.Number of cases where you received any error, where you receive an error
callback with TcOAuthError response in onFailure() callback method. For details
on specific error codes, please refer here
When you are using the SDK for verification of non-Truecaller users also ( via
drop call):
1.Total users coming to your verification flow.
2.Number of cases, when the Truecaller app is present on your smartphone and
users, get verified via the Truecaller 1-tap flow (as described in the above
section)
3.Number of verification requests made by your app for a non-Truecaller user (
when TruecallerSDK.getInstance().requestVerification()  method is
invoked ).
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 234

234
4.Number of cases where the user is getting verified for the very first time on the
current smartphone and you receive a success callback - onRequestSuccess()
method ( Please refer here
 ) - a.) When the callback type you receive is 
VerificationCallback.TYPE_MISSED_CALL_INITIATED . This implies that a drop
call has been triggered to the user's mobile number b.) When the callback type
you receive is VerificationCallback.TYPE_MISSED_CALL_RECEIVED . This implies
that a drop call has been received on the user's mobile number on that
smartphone c.) Further to the above step, you complete the user verification by
invoking TcSdk.getInstance().verifyMissedCall(profile, 
verificationCallback) When the callback type you receive is either 
VerificationCallback.TYPE_VERIFICATION_COMPLETE . This implies that the
verification is complete for the user d.) Number of cases where the user is
already verified previously on the current smartphone and gets verified directly.
In such cases, you receive the success callback - onRequestSuccess() method
with callback type as VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE .
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 235

235
Getting Release Ready
Testing your verification flow
Google play store app permission declaration form
Moving to Production
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 236

236
Testing your verification flow
Non Truecaller User Verification
Truecaller user verification flow
Test Setup
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 237

237
Non-Truecaller user verification flow
Common scenarios to check for in you app verification flow for non-Truecaller
users
If the user does not have the Truecaller app present on their device or they chose to
verify using a different number than the one already verified on Truecaller app
currently, they can be taken to this flow in which we provision the verification of the
user by sending missed call using our infrastructure.
User verifying via Truecaller's missed call mechanism for the very first time
Proceed to the flow where the user needs to input their mobile number. Give the
necessary permissions ( as described here
 ) and proceed with the verification.
You would receive a missed call on the device which gets automatically detected by
the SDK. Post this, you need to pass the user's first name and last name to the SDK
to complete the verification
User already verified with the same credentials previously on the smartphone
Once a user's verification is completed successfully on a particular device, and
they re-attempt to verify on the same app using the same credentials ( same
smartphone, same mobile number ), Truecaller SDK is able to identify the user and
we can tell you it's the same user. In this case, no additional missed call / OTP is
needed to re-verify the user. The SDK will directly tell the status of the repeat user,
and in this case returns the first name and last name of the user back to you in
response.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 238

238
Truecaller user verification flow
Common scenarios to check for in you app verification flow for existing Truecaller
users
Truecaller app present and registration completed on Truecaller app
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Open your app and initiate the Truecaller
verification flow. The user should see the Truecaller profile dialog. Click on continue
to complete the verification flow and ensure that the verification is completed.
Truecaller app present but registration not completed on Truecaller app
Ensure that the Truecaller app is present on your device but you have not
completed the profile creation step on Truecaller app. Open your app and initiate
the Truecaller verification flow. The user should not see the Truecaller profile
dialog, and you would receive the control in onFailureProfileShared() with the
specific error code.
Truecaller app not present on the device
Remove the Truecaller app from your device. Open your app and try to initiate the
Truecaller verification flow. The user should not see the Truecaller profile dialog
and should be taken to either your alternate verification flow or in case you are
using Truecaller SDK's functionality of verifying non-Truecaller users, user should
be redirected to that flow.
Network not available on device
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Turn off the mobile data and WiFi on
your device. Open your app and initiate the Truecaller verification flow. You would
see the Truecaller profile dialog. Click on continue button on the dialog, you would
receive control in onFailureProfileShared() method with a specific error code.
Client ID should be working fine ( onFailure() Error Type 12)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 239

239
For complete details on this part, please refer here.
User wishes to proceed with another number OR does not want to share their
Truecaller profile
Initiate the Truecaller verification flow in your app to invoke the Truecaller profile
dialog. Click on system back or Use another mobile number button on the dialog to
dismiss the dialog. In such a scenario, user should be taken to either your alternate
verification flow or in case you are using Truecaller SDK's functionality of verifying
non-Truecaller users, user should be redirected to that flow.
We also recommend that you go through the FAQ section to go through some of the
commonly asked questions.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 240

240
Test Setup
Quick guide on getting your test setup ready to test the common verification
scenarios as described in previous sections
Pre-Requisites
• We suggest you to keep handy at-least 2 android smartphones with active SIM
connections. Ensure that both the smartphones have your test app installed
(Integrated with Truecaller SDK)
• 2 different smartphones are required so that in case you get verified on one of
the smartphones, you can use the second smartphone to check for the fresh
verification scenarios.
Steps to follow for testing user scenarios :
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 241

241
User State App Scenario Steps
Existing Truecaller user
• Install Truecaller on
smartphone 'A'
• Complete profile
creation step on
Truecaller app
• Launch your application
and initiate the
Truecaller verification
flow
• Truecaller profile
consent screen should
appear
• Tapping on Continue
button should verify the
user
Non Truecaller User User getting verified for the
first time on smartphone
• Take smartphone 'A'
• Uninstall Truecaller app
from the smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs &
phone permissions are
asked ( if not already
granted )
• Allow the permissions
to enable receiving a
drop call
• User is manually asked
to enter name ( if it's a
new user on your app )
• On entering the name,
SDK verifies the user
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 242

242
Non Truecaller User
User already verified on the
smartphone and tried to re-
verify
( Please ensure that you try
this step only after you have
performed the above step )
• Take smartphone 'A'
• Launch your application
and logout from the app
• Initiate the verification
flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
Non Truecaller User
User already verified on the
smartphone, uninstalls and
re-installs the application
on the device
( Please ensure that you try
this step only after you have
performed the 2nd step )
• Take smartphone 'A'
• Uninstall your
application from the
smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 243

243
Wi-Fi or mobile internet should also be enabled on both the smartphones
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 244

244
Google play store app
permission declaration form
This section is only relevant for apps who are using the Truecaller SDK for verifying
non-Truecaller user as well and seek phone permissions from the users
If you are using the functionality of verifying non Truecaller users also via the SDK,
your app would need specific phone permissions as has been described in this 
section
. If you are using the Truecaller SDK for verification of existing Truecaller
users only ( 1-tap flow ), you can skip this section.
As you upload the new app build to PlayStore with user verification feature via
Truecaller SDK and the requisite permissions, you might be asked to fill an app
permission declaration form.
We are sharing some tips on how to appropriately justify the need for these
permissions for your verification flow :
#1: In one sentence, please describe the core functionality of your app. To be
defined by you as a publisher of your app
#2: What is the core functionality in your app requiring the Call Log and / or SMS
permissions? Mobile number verification to onboard users on <your_app>
This is in-line with Googleʼs allowed usage of this permission for account
verification via phone call, as stated here:
https://support.google.com/googleplay/android-developer/answer/9047303 Flow:
a)Enter mobile number b)Request READ_CALL_LOG permission c)Initiate drop call
from 3rd party service to respective number d)Drop call hits userʼs device and is
rejected automatically via above permission to complete verification
#3: Do any of the following disallowed use cases apply to your appʼs core
functionality request for Call Log or SMS permissions? NO
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 245

245
#4: Do any of the following other use cases apply to your appʼs core functionality
request for Call Log or SMS permissions? OTP & Account verification via Phone
Call (select this from the given list of options)
#5: Is your appʼs use of Call Log or SMS permissions to provide functionality
required by law or regulation? No
#6: Other We use drop call based verification of usersʼ mobile number for account
creation or logging into their <your app name> accounts. Such method of mobile
number verification results in better verification success rates in our key markets
like India, etc.
Android guidelines for asking app permissions from user 
https://developer.android.com/training/permissions/requesting
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 246

246
Moving to Production
Submitting your project for review post integration
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 247

247
SDK v2.8.0[Deprecating Soon ⚠ ]
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 248

248
Implementing user flow for your app
While you start integrating Truecaller SDK, as the very first step, it is important to
work on designing the right user flow, so that you can achieve desired results.
Truecaller SDK is a mobile number verification service, without the need for any
OTP whatsoever.
The right way to implement Truecaller SDK in your mobile app, is to invoke mobile
number verification via Truecaller at touch points, where you have your users to
sign-up/ login/ checkout by verifying their mobile numbers.
Let us now see an example to understand how to effectively use Truecaller SDK at
such touch points in your user journey.
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process. For example, one could address it as Get Started,
Join Us, Login, Sign up, etc., shown as a button to the users, clicking which leads to
the mobile number based identity verification of users.
Here is such an example from NoBrokerHood - Indiaʼs leading visitor management
platform:
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 249

249
Building for Various Touch points
a. Invoking user signup/ login/ verification via Truecaller at app onboarding 
Example : NoBroker - Indiaʼs leading realty app
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 250

250
When mobile apps onboard their users, there are multiple ways in which they
address the onboarding process. For example, one could address it as Get Started,
Join Us, Login, Sign up, etc., shown as a button to the users, clicking which leads to
the mobile number based identity verification of users. Here is such an example
from NoBroker:
b. Directly invoking verification via Truecaller Example : Vyapar - India's fastest
growing Invoice & Billing app for small businesses
Vyapar has mobile number as the primary identifier for its users. So as soon as
users lands on their mobile number login/ signup screen, it invokes Verification via
Truecaller, and onboards itʼs users within seconds in just 1-tap.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 251

251
c. Performing user verification at checkout Example : Chalo - available in 25+
cities, tracks buses live and tells you what time your bus will reach your stop
Chalo allows users to browse through itʼs app and check for bus ETAs, without
needing to sign-up or log-in. However, when users wish to purchase the ticket or
travel pass, it requires users to verify their mobile number.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 252

252
Now that we have gone through and understood how to implement Verification via
Truecaller, letʼs get started with the SDK integration.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 253

253
Scenarios for all user verifications :
Truecaller and Non Truecaller Users
Truecaller SDK enables you to verify your user's mobile number in a seamless way.
For users who have Truecaller app present on their smartphones and are already
registered Truecaller users, they get verified in a 1-tap flow (supported globally),
without the need of any manual input. For users who don't have Truecaller app
present on their smartphones, the SDK enables user verification by means of drop
call, which is triggered to the user's number in background to complete the
verification flow (currently supported only for India).
To understand various possible user scenarios in the user's verification flow, let's
try to take example of NoBrokerHood, India's leading realty app. NoBrokerHood is
using Truecaller SDK for verifying numbers of all their users.
Scenario 1 
a) New user on NoBrokerHood app, and 
b) Truecaller app present on user's smartphone.
Scenario 2 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 254

254
a) Existing user on NoBrokerHood app, and 
b) Truecaller app present on smartphone.
Scenario 3
a) New user on NoBrokerHood app, and 
b) Truecaller app NOT present on smartphone, and user's mobile number NOT 
alreadyverified on smartphone.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 255

255
Scenario 4 
a) Existing user on NoBrokerHood app, and 
b) Truecaller app NOT present on smartphone and user's mobile number NOT 
verified on smartphone.
Scenario 5 
a) Existing user on NoBrokerHood app, and 
b) Truecaller app NOT present on smartphone and user's mobile number ALREADY
verified on smartphone.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 256

256
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 257

257
Generating App Key
To ensure the authenticity of interactions between your app and Truecaller, you
need to generate an app key [ partner key ] from Truecaller developer account
 by
adding your app name, package name and app SHA-1.
To generate a new app key for your Android app, go to the 'MANAGE APPS' section
on the developer account dashboard and click on 'CREATE APP'. Select 'Android' in
the App type and continue to enter your app details.
You package name corresponds to the applicationId in your app level build.gradle
file.
You can get to know the SHA1 for your different app builds by following these steps
:
• Open your project in android studio
• Click on gradle menu on the right side and expand it
• Click on android and then signing report
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 258

258
You should be able to see the SHA1 fingerprint of your different build configurations
[ debug /release ] in the terminal window within android studio.
Once you input your app details and create the app, you will be able to see a unique
"appKey" for your app which you need to include in your project to authorise all
verification requests.
Different app builds ( debug / release ) have different SHA1 fingerprints and hence
would have different & unique app keys, as a single app key corresponds to a
particular combination of package name and SHA1. You need to manage your debug /
release builds by creating separate keys.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 259

259
Integrating with your App
Using the SDK with your Android Studio Project
Truecaller SDK does not require any additional app permissions if you are using the
SDK for verification of only Truecaller users.
To enable verification flow for non-Truecaller users as well, the SDK needs specific
android permissions to enable the drop call based background verification flow. For
details, please refer here.
If you haven't already completed User flow implementation guide for your app, we
recommend you to complete that first before proceeding with the integration and
also refer to the user scenarios for verification guide.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 260

260
Setup
1. Ensure that your Minimum SDK version is at least API level 22 or above ( Android
5.1 ). In case your android project compiles for API level below 22, you can include
the following line in your AndroidManifest.xml file to avoid any compilation issues :
Copy
Using this would ensure that the sdk works normally for API level 22 & above, and
would be disabled for API level < 22 Please make sure that you put the necessary
API level checks before accessing the SDK methods in case compiling for API level
< 22
2. Add the following dependency in your app level build.gradle file :
Copy
Also, add the following lines of code in your gradle file, if not already present
Copy
Add mavenCentral() in your project level build.gradle file :
<uses-sdk tools:overrideLibrary="com.truecaller.android.sdk"/> 
dependencies {
    ...
    implementation "com.truecaller.android.sdk:truecaller-sdk:2.8.0"
}
android{
    compileOptions{
         sourceCompatibility JavaVersion.VERSION_1_8
         targetCompatibility JavaVersion.VERSION_1_8
    }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 261

261
Copy
Please note that Truecaller SDK already contains consumer proguard rules,so it will be
appended automatically to your app's proguard rulesand you do not need to have any
additional proguard rules to be added for the SDK to function.
allprojects{ 
    repositories{ 
       ...
       mavenCentral()
       ... 
    } 
 }
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 262

262
App Key Configuration
4. Open your strings.xml file. Example path: /app/src/main/res/values/strings.xml
and add a new string with the name "partnerKey" and value as your "appKey"
5. Open your AndroidManifest.xml and add a meta-data element to the application
element
Copy
<application android:label="@string/app_name" ...>
...
<meta-data android:name="com.truecaller.android.sdk.PartnerKey" 
android:value="@string/partnerKey"/>
...
</application>
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 263

263
Initialisation
6. Create a TruecallerSdkScope object by using the appropriate configurational
settings and use it to initialise the TruecallerSDK in your android activity's onCreate
method :
Copy
You will find complete details on the configuration options in the
TruecallerSdkScope object as described above, and all the possible available
values in the immediate next section of this documentation here
.
TruecallerSdkScope trueScope = new TruecallerSdkScope.Builder(this, 
sdkCallback)
        .consentMode(TruecallerSdkScope.CONSENT_MODE_BOTTOMSHEET)
        
.buttonColor(Color.parseColor(colorSpinner.getSelectedItem().toString()
))
        
.buttonTextColor(Color.parseColor(colorTextSpinner.getSelectedItem().to
String()))
        
.loginTextPrefix(TruecallerSdkScope.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
        
.loginTextSuffix(TruecallerSdkScope.LOGIN_TEXT_SUFFIX_PLEASE_VERIFY_MOB
ILE_NO)
        .ctaTextPrefix(TruecallerSdkScope.CTA_TEXT_PREFIX_USE)
        .buttonShapeOptions(TruecallerSdkScope.BUTTON_SHAPE_ROUNDED)
        .privacyPolicyUrl("<<YOUR_PRIVACY_POLICY_LINK>>")
        .termsOfServiceUrl("<<YOUR_PRIVACY_POLICY_LINK>>")
        .footerType(TruecallerSdkScope.FOOTER_TYPE_NONE)
        
.consentTitleOption(TruecallerSdkScope.SDK_CONSENT_TITLE_LOG_IN)
        .sdkOptions(TruecallerSdkScope.SDK_OPTION_WITHOUT_OTP)
.build();          
TruecallerSDK.init(trueScope);
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 264

264
Here, sdkCallback is an interface that you need to define in your app where you would
get the success or failure callbacks. You will find details about the implementation in
this section.
Please note, sdkOptions enables you to configure the verification capability of
Truecaller SDK. If you want to use the SDK for verification of Truecaller users only, you
should provide the scope value as TruecallerSdkScope.SDK_OPTION_WITHOUT_OTP
If you want to use the SDK for verification of Truecaller users as well as non-Truecaller
users powered by Truecaller's drop call / OTP ( for implementation details, refer 
Verifying non-Truecaller users section ), you should provide the scope value as 
TruecallerSdkScope.SDK_OPTION_WITH_OTP
Truecaller SDK needs to be initialised only once and the same instance can be
accessed at any place within your app, without the need to initialise it again, via 
TruecallerSDK.getInstance()
Initialising the SDK at more than one place can lead to undesired behaviour
Once you initialise the TruecallerSDK using the init() method, if you are using the
SDK for verification of only Truecaller users ( by setting the sdkOptions scope as
TruecallerSdkScope.SDK_OPTION_WITHOUT_OTP ), you can check if the Truecaller
app is present on the user's device or not by using the following method
Copy
TruecallerSDK.getInstance().isUsable()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 265

265
You can trigger the Truecaller profile verification dialog anywhere in your app flow
by calling the following method
Copy
TruecallerSDK.getInstance().getUserProfile() 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 266

266
You can trigger the Truecaller profile verification dialog anywhere in your app flow
by calling the following method
Copy
In case isUsable() method returns false, implying that Truecaller app is not present
on the device, you can take the user to your app screen and continue with the 
verification flow for non-Truecaller users OR choose to use your own verification
flow [ Refer image below ].
TruecallerSDK.getInstance().getUserProfile() 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 267

267
Customisation
Truecaller SDK provides you with capabilities to configure the following :
If you are already using Truecaller SDK with pop-up variant of the verification screen,
you can upgrade to the bottom sheet layout by simply making changes to the
configuration options in your TruecallerSdkScope object. Refer to the below section
for details on all the customisation capabilities and the possible values you may set.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 268

268
Contextual text prefix [ .loginTextPrefix() ] To provide appropriate context of
verification to the Truecaller user, use one of the below mentioned
TruecallerSdkScope values to show the corresponding message to the user.
TruecallerSdkScope trueScope = new TruecallerSdkScope.Builder(this, 
sdkCallback)
        .consentMode(TruecallerSdkScope.CONSENT_MODE_BOTTOMSHEET)
        .buttonColor(Color.parseColor("
<<YOUR_DESIRED_COLOR_HEX_CODE>>"))
        .buttonTextColor(Color.parseColor("
<<YOUR_DESIRED_COLOR_HEX_CODE>>"))
        
.loginTextPrefix(TruecallerSdkScope.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
        
.loginTextSuffix(TruecallerSdkScope.LOGIN_TEXT_SUFFIX_PLEASE_VERIFY_MOB
ILE_NO)
        .ctaTextPrefix(TruecallerSdkScope.CTA_TEXT_PREFIX_USE)
        .buttonShapeOptions(TruecallerSdkScope.BUTTON_SHAPE_ROUNDED)
        .privacyPolicyUrl("<<YOUR_PRIVACY_POLICY_LINK>>")
        .termsOfServiceUrl("<<YOUR_PRIVACY_POLICY_LINK>>")
        .footerType(TruecallerSdkScope.FOOTER_TYPE_NONE)
        
.consentTitleOption(TruecallerSdkScope.SDK_CONSENT_TITLE_LOG_IN)
        .sdkOptions(TruecallerSdkScope.SDK_OPTION_WIHTOUT_OTP)
.build();          
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 269

269
Text to use TruecallerSdkScope value
To get started TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_GET_STARTED
To continue TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_CONTINUE
To place order TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_PLACE_ORDER
To complete your order TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_COMPLETE_YOUR_PURCHASE
To checkout TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_CHECKOUT
To complete your booking TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_COMPLETE_YOUR_BOOKING
To proceed with your booking TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_PROCEED_WITH_YOUR_BOOKING
To continue with your booking TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_CONTINUE_WITH_YOUR_BOOKING
To get details TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_GET_DETAILS
To view more TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_VIEW_MORE
To continue reading TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_CONTINUE_READING
To proceed TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_PROCEED
For new updates TruecallerSdkScope.LOGIN_TEXT_PREFIX_F
OR_NEW_UPDATES
To get updates TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_GET_UPDATES
To subscribe TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_SUBSCRIBE
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 270

270
Contextual text suffix [ .loginTextSuffix() ] To provide appropriate context of
verification to the Truecaller user and set the suffix string
Button text options [ .ctaTextPrefix() ] To set the prefix on the CTA button
Button shape [ .buttonShapeOptions() ] To chose the shape of the CTA button
To subscribe and get updates TruecallerSdkScope.LOGIN_TEXT_PREFIX_T
O_SUBSCRIBE_AND_GET_UPDATES
Suffix string TruecallerSdkScope value
please login TruecallerSdkScope.LOGIN_TEXT_SUFFIX_P
LEASE_LOGIN
please signup TruecallerSdkScope.LOGIN_TEXT_SUFFIX_P
LEASE_SIGNUP
please login/ signup TruecallerSdkScope.LOGIN_TEXT_SUFFIX_P
LEASE_LOGIN_SIGNUP
please register TruecallerSdkScope.LOGIN_TEXT_SUFFIX_P
LEASE_REGISTER
please sign in TruecallerSdkScope.LOGIN_TEXT_SUFFIX_P
LEASE_SIGN_IN
please verify mobile number TruecallerSdkScope.LOGIN_TEXT_SUFFIX_P
LEASE_VERIFY_MOBILE_NO
Button text to use TruecallerSdkScope value
Use TruecallerSdkScope.CTA_TEXT_PREFIX_USE
Continue with TruecallerSdkScope.CTA_TEXT_PREFIX_CO
NTINUE_WITH
Proceed with TruecallerSdkScope.CTA_TEXT_PREFIX_PR
OCEED_WITH
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 271

271
Footer CTA text [ .footerType() ] To configure the text of the additional footer CTA
present at the bottom
Privacy policy text [ .privacyPolicyUrl() ] To add your privacy policy link on the
verification screen ( optional ), you can configure the respective hyperlink as
mentioned below
Copy
Terms of service text [ .termsOfServiceUrl() ] To add your terms of service link on
the verification screen ( optional ), you can configure the respective hyperlink as
mentioned below
Copy
Button shape TruecallerSdkScope value
Round TruecallerSdkScope.BUTTON_SHAPE_ROU
NDED
Rectangle TruecallerSdkScope.BUTTON_SHAPE_RECT
ANGLE
Footer CTA string TruecallerSdkScope value
Use another number TruecallerSdkScope.FOOTER_TYPE_CONTI
NUE
Use another method TruecallerSdkScope.FOOTER_TYPE_ANOTH
ER_METHOD
Enter details manually TruecallerSdkScope.FOOTER_TYPE_MANU
ALLY
Later TruecallerSdkScope.FOOTER_TYPE_LATER
.privacyPolicyUrl("<<YOUR_PRIVACY_POLICY_LINK>>")
.termsOfServiceUrl("<<YOUR_TERMS_OF_SERVICE_LINK>>")
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 272

272
Language To customise the profile dialog in any of the supported Indian languages
To do so, add the following lines before calling the "getUserProfile()" method as
mentioned in the previous step
Copy
Currently supported languages :
NOTE : In case the input locale is not supported, the profile will by default be shown in
English language.
Locale locale = new Locale("ru");
TruecallerSDK.getInstance().setLocale(locale);
Language locale value to use
english en
hindi hi
marathi mr
telugu te
malayalam ml
urdu ur
punjabi pa
tamil ta
bengali bn
kannada kn
swahili sw
arabic ar
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 273

273
Implement Callbacks
7. Add the following condition in the onActivityResult method 
TruecallerSDK.getInstance().onActivityResultObtained( this,requestCode, 
resultCode, data)
Copy
Note : In case you passed Fragment in the getUserProfile() method [ point #6 ],
override the onActivityResult() method in your corresponding Fragment
8. In your selected Activity/Fragment, either make the component implement
ITrueCallback or create an instance of it :
Copy
@Override
protected void onActivityResult(int requestCode, int resultCode, 
@Nullable Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == TruecallerSDK.SHARE_PROFILE_REQUEST_CODE) {
       TruecallerSDK.getInstance().onActivityResultObtained(this, 
requestCode, resultCode, data);
    }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 274

274
onSuccessProfileShared() method will be called in either of the following two
scenarios : a.) When the user has agreed to share his profile information with your
app by clicking on the "Continue" button on the Truecaller dialog b.) When a non
Truecaller user is already verified previously on the same device. This would only
happen when the TruecallerSdkScope#SDK_OPTION_WITH_OTP  is selected while
initialising the SDK to provision for the verification of non-Truecaller users also.
onFailureProfileShared() method will be called when some error occurs or if an
invalid request for verification is made. You'll get the respective error code as per
the details mentioned here.
onVerificationRequired() method will only be called
whenTruecallerSdkScope#SDK_OPTION_WITH_OTP  is selected. This will be called
when the user is not a Truecaller app user. Also, you'll get a Nullable TrueError only
when TC app is installed and user is logged in. For other cases, it would be null.
This optional TrueError can be used to determine the user action that led to
initiating manual verification. So using this TrueError, you can get to whether the
user pressed on the footer CTA on the verification screen OR the system back
button.
private final ITrueCallback sdkCallback = new ITrueCallback() {
    
     @Override
     public void onSuccessProfileShared(@NonNull final TrueProfile 
trueProfile) {
     }
     @Override
     public void onFailureProfileShared(@NonNull final TrueError 
trueError) {
     }
     
     @Override
     public void onVerificationRequired(@Nullable final TrueError 
trueError) {
     }
     
 };
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 275

275
Write all the relevant logic in the above callback methods to handle the scenarios
appropriately.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 276

276
Clearing SDK instance
In order to clear the resources taken up by SDK, you can use the method 
TruecallerSDK.clear();  You can call this method when the activity/fragment in
which you have initialised the SDK is getting killed/destroyed.
For example :
Copy
@Override
protected void onDestroy() {
   super.onDestroy();
   TruecallerSDK.clear();
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 277

277
Handling Error Scenarios
Failure/ Error responses
The "onFailureProfileShared" callback method that you just implemented in the
previous step helps you to handle all the possible failure cases when the user
couldn't be verified successfully via the Truecaller flow.
Below are some of the possible failure scenarios and the corresponding error
response that you receive for each of the cases :
*Error Type 4 and Error Type 10 could arise in different conditions depending on
whether the user has not registered on Truecaller app on their smartphone or if the
user has deactivated their Truecaller profile at any point of time from the app.
Apart from the above mentioned error cases, there are few other error scenarios
that you may encounter under rare circumstances. For complete and exhaustive list
of all the error cases, you can refer to TrueError.class within the SDK.
Error Code What it means
1 Network Failure
2 User pressed back
3 Incorrect Partner Key
4 & 10 User not Verified on Truecaller*
5 Truecaller App Internal Error
13 User pressed back while verification in
process
14 User pressed footer CTA (" USE ANOTHER
NUMBER")
15 To handle ActivityNotFound Exception, in
case Truecaller app fails to initiate
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 278

278
Please note that when you encounter any of the error scenarios and get the control
in the "onFailureProfileShared()" method, you should redirect the user to your
alternate verification flow.
Exceptions
In case you face any of the following run time exceptions, please follow the
recommended steps as mentioned below :
"No compatible client available. Please change your scope"
As the exception suggests, you are trying to call an SDK method even though no
client is available to handle it. This usually happens if you have initialised the SDK
using WITHOUT_OTP scope option i.e to verify only the Truecaller users, and you
are not calling isUsable()  method before calling an SDK method. To resolve this,
call isUsable()  before calling any SDK method if you are using WITHOUT_OTP
scope option
"Please call init() on TruecallerSDK first"
This exception suggests that you are trying to call an SDK method before the SDK
has been initialised. To resolve it, check for all possible user flows in your app
which could lead to calling an SDK method directly before it has been initialised.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 279

279
Verifying non Truecaller users
This section defines the steps that can be used to trigger verification of non
Truecaller app users which will be powered via Truecaller's drop call based
verification flow
In order to verify non Truecaller users, the SDK requires the below mentioned
permissions -
Copy
Once you receive a callback in the ITrueCallback#onVerificationRequired(),
you can initiate the verification for the user by calling the following method:
Copy
Here -
• the first parameter is the country code of the mobile number for which the
verification needs to be triggered
For Android 8 and above :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.ANSWER_PHONE_CALLS"/>
For Android 7 and below :
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.READ_CALL_LOG"/>
<uses-permission android:name="android.permission.CALL_PHONE"/>
try{
   TruecallerSDK.getInstance().requestVerification("IN", 
PHONE_NUMBER_STRING, apiCallback, ExampleActivity.this);
}catch (RuntimeException e){
   Log.i(TAG, e.getMessage());
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 280

280
• the second parameter (PHONE_NUMBER_STRING) is the mobile number to be
verified. Please ensure proper validations are in place so as to send correct
phone number string to the above method, otherwise an exception would be
thrown
• the third parameter is an instance of VerificationCallback  as defined here
• the fourth parameter is an instance of FragmentActivity
Please note that Truecaller SDK v2.8.0 currently supports the verification for
non-Truecaller users for Indian numbers only.
Once you initiate the verification via 
TruecallerSDK.getInstance().requestVerification()  method, you will receive
either a callback in your VerificationCallback  instance with a
specificrequestType  as described below
Copy
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 281

281
onRequestSuccess() method is called under any of the following scenarios -
static final VerificationCallback apiCallback = new 
VerificationCallback() {
     @Override
     public void onRequestSuccess(int requestCode, @Nullable 
VerificationDataBundle extras) {
     
        if (requestCode == 
VerificationCallback.TYPE_MISSED_CALL_INITIATED) {
               if(extras != null){
                      extras.getString(VerificationDataBundle.KEY_TTL)
                      
extras.getString(VerificationDataBundle.KEY_REQUEST_NONCE)
       }
        }
 
        if (requestCode == 
VerificationCallback.TYPE_MISSED_CALL_RECEIVED) {
 }
 
        if (requestCode == 
VerificationCallback.TYPE_VERIFICATION_COMPLETE) {
               if(extras != null) 
                      
extras.getString(VerificationDataBundle.KEY_REQUEST_NONCE)
}
 
        if (requestCode == 
VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE) {
               if(extras!=null)
                      extras.getProfile().requestNonce
 }
 
     }
     @Override
     public void onRequestFailure(final int requestCode, @NonNull final 
TrueException e) {
     }
     
 };
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 282

282
• When drop call is successfully initiated for the input mobile number. In this case,
you will get the requestCode as 
VerificationCallback.TYPE_MISSED_CALL_INITIATED
• When drop call is successfully detected on that device by the SDK present in
your app. In this case, you will get the requestCode as 
VerificationCallback.TYPE_MISSED_CALL_RECEIVED
• When the verification is successful for a particular number. In this case, you will
get the requestCode as VerificationCallback.TYPE_VERIFICATION_COMPLETE
• When the user is already verified on that particular device before. In this case,
you will get the requestCode as 
VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE
When requestCode is VerificationCallback.TYPE_MISSED_CALL_INITIATED , you
will receive anadditional parameter for the time to live i.e TTL (in seconds) which is
passed as String extra in the VerificationDataBundle  of onRequestSuccess() .
This value determines amount of time left to complete the verification. You can use
this value to show a waiting message to your user before they can try for another
attempt. Once the TTL expires, you can either auto-retry the verification by calling
the requestVerification() method automatically with the same input parameters OR
you can also take the user back to the number input screen to enter a different
number for verification.
NOTE: Truecaller SDK v2.5.0 & above won't throw timeout exceptions for missed
call, so please use the TTL as stated above to control the time out scenario.
When the requestCode is VerificationCallback.TYPE_ALREADY_VERIFIED_BEFORE
or VerificationCallback.TYPE_VERIFICATION_COMPLETE, it means that the user
verification via Truecaller SDK is complete. In these cases, the SDK will share an
additional access token with your application, which you may then use to validate
the response at your server end. To fetch the access token, you may use the
following code snippet :
//For when the control goes to TYPE_ALREADY_VERIFIED_BEFORE 
extras.getProfile().accessToken
//For when the control goes to TYPE_VERIFICATION_COMPLETE 
extras.getString(VerificationDataBundle.KEY_ACCESS_TOKEN)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 283

283
Post fetching the access token, you may perform the server side validation by
referring to the steps mentioned in the later part of the documentation here.
onRequestFailure() method will be called when some error has occurred while
verifying the provided mobile number. You will receive the appropriate error
message from TrueException using TrueException#getExceptionMessage(). For
details of different possible error types you may encounter, please refer to the next
section.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 284

284
TrueException
Handling error responses for cases of verifying non-Truecaller users
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 285

285
Error Code Error Message Description
4 "Desired permissions are
missing"
When the requisite
permissions are missing or
not granted while making
the verification request
6 “Sim state is not ready” When the SIM state on the
device is not ready
7 “Airplane mode is ON”
When the device is on
airplane mode, hence
causing missed call to not
go through
2 "Phone number limit
reached”
When the used mobile
number has exceeded the
maximum number of
allowed verification
attempts within a span of
24 hours from the time the
first verification attempt
was made
2 “Request id limit reached”
When the used device
exceeds the maximum
number of allowed
verification attempts in a
span of 24h
2 “Invalid partner
credentials.”
When the partner key ( app
key ) you have configured in
your project is incorrect.
Visit here or here basis the
build in which you are
facing the issue on
2 “Something went wrong:
Failed to create installation.”
In case of Truecaller
internal service error
2 “Invalid phone number”
When the input mobile
number is not a valid mobile
number
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 286

286
2 “Profile has not been
created yet”
When the user has been
successfully verified, but
for some reason their profile
is not created which could
be due to incorrect profile
data while creating
TrueProfile() in
verifyMissedCall method or
due to network issues
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 287

287
Completing Verification
Once you receive a callback in your VerificationCallback  instance with the
requestCode TYPE_MISSED_CALL_RECEIVED or TYPE_OTP_RECEIVED , you can
complete the verification process by calling the following method from within your
activity :
Copy
You need to create a TrueProfile instance by passing the user's first and last name
as defined above.
Please note that the first name and last name values to be passed in the above method
call need to follow below mentioned rules :
• The strings need to contains at least 1 alphabet, and cannot be completely
comprised of numbers or special characters
• String length should be less than 128 characters
• First name is a mandatory field, last name can be empty ( but non nullable )
Depending on whether the verification medium is drop call or OTP, you need to call
one of the following methods respectively:
DropcallOTPCopy
You need to call this method once you have received callback with requestCode as 
TYPE_MISSED_CALL_RECEIVED  in your VerificationCallback  instance
After you call the above method, you will receive a callback in your 
VerificationCallback  instance with requestCode as 
TYPE_VERIFICATION_COMPLETE,  which completes your verification process.
TrueProfile profile = new TrueProfile.Builder(firstName, 
lastName).build();
TruecallerSDK.getInstance().verifyMissedCall(profile, apiCallback)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 288

288
Whenever you get the verification callback with requestType as 
TYPE_VERIFICATION_COMPLETE,  you would get an accessToken as a parameter in
the verificationDataBundle. You can use this access token to validate the
authenticity of the verification flow by making an API call from your server to
Truecaller's server. For details on this part, please refer here.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 289

289
Advanced Steps
Advanced steps for validating the request-response correlation:
Every request sent via a Truecaller app that supports Truecaller SDK has a unique
identifier. This identifier is bundled into the response for assuring a correlation
between a request and a response. If you want you can check this correlation
yourself by:
1. You can use your own custom request identifier via the TrueClient with 
TruecallerSDK.getInstance().setRequestNonce(customHash);
Note : The customHash must be a base64 URL safe string with a minimum
character length of 8 and maximum of 64 characters
2. In ITrueCallback.onSuccesProfileShared(TrueProfile)  verify that the
previously generated identifier matches the one in TrueProfile.requestNonce.
IMPORTANT: Truecaller SDK already verifies the request-response correlation
before forwarding it to the your app.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 290

290
Server Side Response Validation
For Truecaller users verification flow
For Non-Truecaller users verification flow
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 291

291
For Truecaller users verification flow
Recommended Steps for validating the authenticity of SDK response at your
server side:
Truecaller SDK already verifies the authenticity of the response before forwarding it
to your app. However, if you wish to additionally check the authenticity of the
response at your end, you can do so.
In the response for TrueProfile we return -
• Payload, which is a Base64 encoding of the json object containing all profile
info
• Signature, which contains the payload's signature . Signature is generated by
applying signing algorithm with our private key
• Signature Algorithm in the response header
To verify the payload, our public key for a given algorithm can be fetched using this
API: https://api4.truecaller.com/v1/key
.
Using the payload, the signature and the public key, you can verify that the content
sent is authentic through the following flow:
a. Apply verification, which means apply our public key to the signature (with given
algorithm) and comparing result with payload
b. If verified, you would know that response comes from Truecaller's backend and
is authentic. The profile can then be used as base64 decoding of the payload.
For details on the verification flow and sample code snippets in different
programming languages, please refer this link
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 292

292
In order to add another layer of security, you can also put a check to identify if the
payload that is passed on to your server was initially generated for your app
(package name) itself. The payload that you receive in the success response has a
field with a key as “verifier”. Here, you need to generate HMAC SHA256 of your
package name, using your appKey (partner key) as a secret. (The appKey
mentioned here is the one that you generate from our developer portal). The output
that you get from above should match the verifier value received in the payload. In
case it doesn't, which means that the payload that was generated was tampered.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 293

293
For Non-Truecaller
users verification flow
Once the SDK shares the accessToken for any user verified via drop call / OTP
based verificaiton flow, you can verify the authenticity of the access token by
making API call from your server to Truecaller's server. The following endpoint will
return phone number and country code for the given access token.
API Endpoint:
Copy
REQUEST :
Method : GET
Header Parameters:
Request Path Parameters:
"https://sdk-otp-verification-
noneu.truecaller.com/v1/otp/installation/phoneNumberDetail/{accessToken
}"
Parameter Name Required Description Example
appKey yes App Key ( Partner
Key )
zHTqS70ca9d3e98
8946f19a65a01dRR
5e56460
Parameter Name Required Description Example
accessToken yes
token granted for
the partner for the
respective user
number that
initiated login
"71d8367e-39f7-
4de5-a3a3-
2066431b9ca8"
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 294

294
RESPONSE:
• 200 OK - If access token is valid
Copy
• 404 Not Found - If your credentials are not valid
Copy
• 404 Not Found - If access token is invalid
Copy
• 500 Internal Error - for any other internal error
Copy
{
    "phoneNumber":919999XXXXX9
    "countryCode":"IN"
}
{
    "code":404
    "message":"Invalid partner credentials."
}
{
    "code":1404
    "message":"Invalid access token."
}
{
    "code":500
    "message":"error message"
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 295

295
Instrumentation
Quick guide on how to properly track and instrument funnel for the verification
flow of users via Truecaller on your app:
For proper tracking of the verification funnel via Truecaller SDK on your app, we
recommend you to implement tracking events for the following states :
When you are using the SDK for verification of Truecaller users only ( 1-tap
Verification without OTP ) :
1.Total users coming to your verification flow
2.Number of cases when the Truecaller app is present on your smartphone
3.Number of profile verification requests made by your app ( when 
TruecallerSDK.getInstance().getUserProfile() method is invoked )
4.Number of users who proceed with this flow and click Continue on the
Truecaller dialog [ for these cases, you receive a success callback with
TrueProfile response in onSuccessProfileShared() callback method ]
5.Number of cases where you received any error, where you receive an error
callback with TrueError response in onFailureProfileShared() callback method.
For details on specific error codes, please refer here.
When you are using the SDK for verification of non-Truecaller users also ( via
drop call / fallback OTP ) :
1.Total users coming to your verification flow
2.Number of cases when the Truecaller app is present on your smartphone and
users get verified via the Truecaller 1-tap flow ( as described in the above
section )
3.Number of verification requests made by your app for a non-Truecaller user (
when TruecallerSDK.getInstance().requestVerification() method is invoked )
4.Number of cases where the user is getting verified for the very first time on the
current smartphone and you receive a success callback - onRequestSuccess()
method ( Please refer here ) -
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 296

296
a.When the callback type you receive is either 
VerificationCallback.TYPE_MISSED_CALL_INITIATED or 
VerificationCallback.TYPE_OTP_INITIATED. This implies that a drop call /
SMS has been triggered to the user's mobile number.
b.When the callback type you receive is either 
VerificationCallback.TYPE_MISSED_CALL_RECEIVED or 
VerificationCallback.TYPE_OTP_RECEIVED. This implies that a drop call /
SMS has been received on the user's mobile number on that smartphone.
Please note that for getting the TYPE_OTP_RECEIVED callback, your app
needs to have the Google SMS retriever hash code configured on
Truecaller's developer portal ( while creating your partner key ) so that the
SDK can auto read the incoming SMS and share the OTP with you in this
particular callback method.
c.Further to the above step, when you complete the user verification by
invoking either TruecallerSDK.getInstance().verifyOtp() or 
TruecallerSDK.getInstance().verifyMissedCall() corresponding to the
verification medium being used
d.When the callback type you receive is either 
VerificationCallback.TYPE_VERIFICATION_COMPLETE. This implies that the
verification in complete for the user
5.Number of cases where the user is already verified previously on the current
smartphone and gets verified directly. In such cases, you receive the success
callback - onRequestSuccess() method with callback type as 
VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 297

297
Getting Release Ready
Testing your verification flow
Google Play App Signing
Google Play Store app permissions declaration
Google Play Policy Change for Device Identifiers
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 298

298
Testing your verification flow
Truecaller user verification flow
Non-Truecaller User Verification Flow
Test Setup
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 299

299
Truecaller user verification flow
Common scenarios to check for in you app verification flow for existing
Truecaller users:
Truecaller app present and registration completed on Truecaller app
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Open your app and initiate the Truecaller
verification flow. The user should see the Truecaller profile dialog. Click on continue
to complete the verification flow and ensure that the verification is completed.
Truecaller app present but registration not completed on Truecaller app
Ensure that the Truecaller app is present on your device but you have not
completed the profile creation step on Truecaller app. Open your app and initiate
the Truecaller verification flow. The user should not see the Truecaller profile
dialog, and you would receive the control in onFailureProfileShared() with the
specific error code.
Truecaller app not present on the device
Remove the Truecaller app from your device. Open your app and try to initiate the
Truecaller verification flow. The user should not see the Truecaller profile dialog
and should be taken to either your alternate verification flow or in case you are
using Truecaller SDK's functionality of verifying non-Truecaller users, user should
be redirected to that flow.
Network not available on device
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Turn off the mobile data and WiFi on
your device. Open your app and initiate the Truecaller verification flow. You would
see the Truecaller profile dialog. Click on continue button on the dialog, you would
receive control in onFailureProfileShared() method with a specific error code.
Partner key should be working fine ( onFailureProfileShared() Error Type 3 )
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 300

300
For complete details on this part, please refer here
User wishes to proceed with another number OR does not want to share their
Truecaller profile
Initiate the Truecaller verification flow in your app to invoke the Truecaller profile
dialog. Click on system back or Use another mobile number button on the dialog to
dismiss the dialog. In such a scenario, user should be taken to either your alternate
verification flow or in case you are using Truecaller SDK's functionality of verifying
non-Truecaller users, user should be redirected to that flow.
We also recommend that you go through the FAQ section to go through some of the
commonly asked questions
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 301

301
Non-Truecaller User Verification Flow
Common scenarios to check for in you app verification flow for non-Truecaller
users
If the user does not have the Truecaller app present on their device or they chose to
verify using a different number than the one already verified on Truecaller app
currently, they can be taken to this flow in which we provision the verification of the
user by sending missed call using our infrastructure.
User verifying via Truecaller's missed call mechanism for the very first time
Proceed to the flow where the user needs to input their mobile number. Give the
necessary permissions ( as described here
 ) and proceed with the verification.
You would receive a missed call on the device which gets automatically detected by
the SDK. Post this, you need to pass the user's first name and last name to the SDK
to complete the verification
User verifying via OTP mechanism ( if users deny phone permissions, as
described here )
In case the user denies the needed permission in the above step, the means of
verification would fallback to SMS based OTP instead of missed call. In that case,
you can chose to implement your own fallback OTP infrastructure or opt for
Truecaller's fallback SMS based OTP infrastructure. If you have opted for your own
SMS infrastructure, you can chose to proceed as per your own flow. In case you
have opted for Truecaller's SMS based OTP infrastructure, when you request for a
verification for the user's number, Truecaller sends an SMS to the user containing
the OTP. Once the OTP is keyed in by the user or automatically read ( using the
SDKs SMS retriever functionality ), you need to pass the user's first name and last
name along with the OTP to the Truecaller SDK method to complete the verification
flow.
User already verified with the same credentials previously on the smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 302

302
Once a user's verification is completed successfully on a particular device, and
they re-attempt to verify on the same app using the same credentials ( same
smartphone, same mobile number ), Truecaller SDK is able to identify the user and
we can tell you it's the same user. In this case, no additional missed call / OTP is
needed to re-verify the user. The SDK will directly tell the status of the repeat user,
and in this case returns the first name and last name of the user back to you in
response.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 303

303
Test Setup
Quick guide on getting your test setup ready to test the common verification
scenarios as described in previous sections:
Pre-Requisites
• We suggest you to keep handy at-least 2 android smartphones with active SIM
connections. Ensure that both the smartphones have your test app installed
(Integrated with Truecaller SDK)
• 2 different smartphones are required so that in case you get verified on one of
the smartphones, you can use the second smartphone to check for the fresh
verification scenarios.
Wi-Fi or mobile internet should also be enabled on both the smartphones
Steps to follow for testing user scenarios :
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 304

304
User State App Scenario Steps
Existing Truecaller user
• Install Truecaller on
smartphone 'A'
• Complete profile
creation step on
Truecaller app
• Launch your application
and initiate the
Truecaller verification
flow
• Truecaller profile
consent screen should
appear
• Tapping on Continue
button should verify the
user
Non Truecaller User User getting verified for the
first time on smartphone
• Take smartphone 'A'
• Uninstall Truecaller app
from the smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs &
phone permissions are
asked ( if not already
granted )
• Allow the permissions
to enable receiving a
drop call
• User is manually asked
to enter name ( if it's a
new user on your app )
• On entering the name,
SDK verifies the user
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 305

305
Non Truecaller User
User already verified on the
smartphone and tried to re-
verify
( Please ensure that you try
this step only after you have
performed the above step )
• Take smartphone 'A'
• Launch your application
and logout from the app
• Initiate the verification
flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
Non Truecaller User
User already verified on the
smartphone, uninstalls and
re-installs the application
on the device
( Please ensure that you try
this step only after you have
performed the 2nd step )
• Take smartphone 'A'
• Uninstall your
application from the
smartphone
• Launch your application
and initiate the
verification flow
• User is asked for phone
number in your
application
• On entering the phone
number, call logs and
phone permissions are
asked ( if not already
granted )
• User should get verified
directly without any
drop call being initiated
and received on the
smartphone
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 306

306
Google Play App Signing
In case you are using the app signing feature of google play store, when you upload
your release build to the google play store, it assigns a new SHA1 fingerprint to your
app - which might lead to UNAUTHORISED_PARTNER_KEY error for your app, since
the appKey used by you in your app config was generated for a different SHA1, and
hence won't work for the new SHA1.
In this scenario, you need to go to the "app integrity section" of the Google play
console, where you would see 2 SHA1 keys (a) Upload Certificate SHA1 and (b) App
Signing Certificate SHA1.
You need to note down the "App Signing Certificate SHA1" from the console, and
generate a new Truecaller partner key ( app key ) for your play store build.
Configure this key for your play store build in your project, and upload the build on
play store for your users.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 307

307
Google Play Store app
permissions declaration
This section is only relevant for apps who are using the Truecaller SDK for verifying
non-Truecaller user as well and seek phone permissions from the users
If you are using the functionality of verifying non Truecaller users also via the SDK,
your app would need specific phone permissions as has been described in this 
section. If you are using the Truecaller SDK for verification of existing Truecaller
users only ( 1-tap flow ), you can skip this section.
As you upload the new app build to PlayStore with user verification feature via
Truecaller SDK and the requisite permissions, you might be asked to fill an app
permission declaration form.
We are sharing some tips on how to appropriately justify the need for these
permissions for your verification flow :
#1: In one sentence, please describe the core functionality of your app. To be
defined by you as a publisher of your app
#2: What is the core functionality in your app requiring the Call Log and / or SMS
permissions? Mobile number verification to onboard users on <your_app>
This is in-line with Googleʼs allowed usage of this permission for account
verification via phone call, as stated here:
https://support.google.com/googleplay/android-developer/answer/9047303 Flow:
a)Enter mobile number b)Request READ_CALL_LOG permission c)Initiate drop call
from 3rd party service to respective number d)Drop call hits userʼs device and is
rejected automatically via above permission to complete verification
#3: Do any of the following disallowed use cases apply to your appʼs core
functionality request for Call Log or SMS permissions? NO
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 308

308
#4: Do any of the following other use cases apply to your appʼs core functionality
request for Call Log or SMS permissions? OTP & Account verification via Phone
Call (select this from the given list of options)
#5: Is your appʼs use of Call Log or SMS permissions to provide functionality
required by law or regulation? No
#6: Other We use drop call based verification of usersʼ mobile number for account
creation or logging into their <your app name> accounts. Such method of mobile
number verification results in better verification success rates in our key markets
like India, etc.
Android guidelines for asking app permissions from user 
https://developer.android.com/training/permissions/requesting
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 309

309
Google Play Policy Change
for Device Identifiers
Truecaller SDK versions lower than v2.7.0 use device ID and SIM serial identifiers
for the non-Truecaller user verification flow ( drop callbased verification ). With the
v2.7.0 release, we have removed dependency on these attributes. As per the recent
Google play store app policy changes, apps shouldnʼt use these identifiers in
conjunction with the phone number. Google Play sends your app a warning in case
your app ( including any integrated 3rd party libraries ) is using these identifiers.
If you are using Truecaller SDK version less than v2.7.0, we recommend you to
update the same to 2.70 and above. Once you upgrade the SDK version, the
above mentioned issue around play store publishing would be resolved.
The latest SDK version is completely in line to google playʼs new data privacy
policies and hence has been listed on the google play SDK index as well. Only
policy compliant SDKs are listed on the SDK index.
Note : For the primary 1-tap flow to function via the Truecaller SDK, users need to have
the Truecaller app installed and logged in on their devices. As the Truecaller app is
supported only for android API level 22 (Android 5.1) and above, the SDK has also been
upgraded to support the same.
For you to upgrade to the latest SDK version, you may refer to the change log here.
Google Play SDK Index
play.google.com
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 310

310
Changelog
Changelog for Truecaller android SDK versions 2.8.0 and below : 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 311

311
SDK Version Changelog ( if applicable )
2.8.0
1.New errors codes introduced in
TrueException for "simState",
"airplaneMode" and "permissions".
Details here
2.Developers need to take care of the
required permissions requesting logic
at their own end since SDK won't be
making permissions any longer from
this version onwards
3.Default verification medium would be
Drop Call for all verification attempts
made
4.Developers can set a request nonce to
the non-tc flow using the existing SDK
method - 
TruecallerSDK.getInstance().setReque
stNonce("SOME_REQUEST_NONCE"). 
The partners will receive this request
nonce from the callback interface for
different callback types :
a.TYPE_MISSED_CALL_INITIATED,
TYPE_VERIFICATION_COMPLETE -
Can be received from
VerificationDataBundle as
bundle?.getString(VerificationDataB
undle.KEY_REQUEST_NONCE)
2. TYPE_PROFILE_VERIFIED_BEFORE -
Can be received from
VerificationDataBundle as
bundle?.profile?.requestNonce
2.7.0
• Minimum supported version updated to
5.1 Android version
• Minimum kotlin version supported 1.6.10
• Removed all the sensitive checks
colliding with google playʼs data privacy
policies
• Project moved to MavenCentral
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 312

312
2.6.0
• To handle requestCode collision new
check on the client side
onActivityResult method is introduced.
• Handled request code collision in SDK
• Fix SDK Android 11 compatibility
• Added business profile indicator
2.5.0
• Provided new SDK clear() method on
client side
• Fixed memory leaks.
• Handle ActivityNotFoundException by
providing a try-catch block and
throwing a new TrueError code with
Type = 15.
2.4.0
• Passing TrueError in
onVerificationRequired() method of the
SDK
• Exposed verification TTL to verification
callback on client side
• Fixing default values for CTA color/text
color
• Ellipsize text input fields in SDK
2.3.0
• Updated proguard rule
• Fixed phone number caching in non
Truecaller user verification flow
• Minor bug fixes
2.2.0 • Added support for Arabic and
Assamese
2.1.0 • Ability to set Dark/Light theme from
SDK introduced.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 313

313
Change Log
SDK Version Changelog ( if applicable )
3.2.1 1.Added Sim and Device Parameters 
3.2.0
1.Update OnActivityResult deprecated
method with androidx
ActivityResultLauncher API.
2.Added Dark Mode for OAuth SDK
PopUp and BottomSheet flow.
3.Added Center Popup Ui for OAuth flow.
4.Adjusted isOauthFlowUsable method
logic to solve for sequence of
installation
3.1.0
1.Added support for IM-OTP as a mode
of verification in the non-tc flow with
auto-read functionality. (This
functionality is under EAP currently)
2.Updated AGP to 8.3
3.Minor bug fixes 
3.0.0 1.The first public version of Truecaller
OAuth SDK 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 314

314
Mobile Websites
Implementing user flow for your Mobile Website
Generating App Key
Integrating with your mobile website
Getting Release Ready
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 315

315
Implementing user flow
for your Mobile Website
While you start integrating Truecaller SDK, as the very first step, it is important to
work on designing the right user flow, so that you can achieve desired results.
Truecaller SDK is a mobile number verification service, without the need for any
OTP whatsoever.
The right way to implement Truecaller SDK on your mobile web, is to invoke mobile
number verification via Truecaller at touch points, where you have your users to
sign-up/ login/ checkout by verifying their mobile numbers.
Let us now see an example to understand how to effectively use Truecaller SDK at
such touch points in your user journey
Users on CarDekho - Indiaʼs largest online auto discovery and classifieds platform,
can browse for new cars, access details and more on CarDekho mSite. However,
when users wish to take a test ride, get more details, request for car loan offers,
and more, it requires users to verify their mobile number to ensure valid users are
accessing such details.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 316

316
From the above flow, we can see that for Truecaller users, signup is mere 1-step
process without needing any OTP; while for non-Truecaller users the signup
process is tedious, and involves many steps, and thus more possibilities of drop-
offs.
Building for various touch points
a. User signup/ login via mobile number Example : Intrcity - Indiaʼs first SmartBus
for safe inter-city travel
In order to complete your ticket booking on Intrcityʼs mobile website, users need to
verify their number in order to signup/ login into their accounts. Mobile number
being an important part of the user profile, Intrcity uses Truecaller to quickly verify
mobile number, and auto-fill certain parts of the user profile to reduce user effort
and save time.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 317

317
Generating App Key
To ensure the authenticity of interactions between your web app and Truecaller,
you need to generate an app key [ partner key ] from Truecaller developer account
( https://developer.truecaller.com/login
 ) by adding your app name, domain and a
callback URL.
To generate a new app key for your mobile website, go to the 'MANAGE APPS'
section on the developer account dashboard and click on 'CREATE APP'. Select
'Web' in the App type and continue to enter your app details.
App domain corresponds to the domain link of your website
Callback URL corresponds to an endpoint on your backend where we will post the
access token for you to fetch the user's profile. Every access token can be used to
fetch the profile only of the related user granting the authorization to your app.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 318

318
When setting up the callback URL, please consider the following:
Method: All access token requests will be submitted as POST request. Make sure your
service is async, since we only expect that the message is accepted from your side.
The service should respond within maximum 3 seconds upon receiving the request.
Each access token has a time-to-live (10 minutes) and if not used within the TTL, the
user needs to re-trigger the authorization process from the beginning.
Security: To ensure security and privacy, HTTPS should be used. Make sure your
certificate is always valid.
Request Params:
Expected Response Codes:
• 2** OK
Once you input your app details and create the app, you will be able to see a unique
"appKey" for your app which you need to include in your project to authorise all
verification requests.
Param [String] Mandatory Description Example value
requestId [String] yes vXbyFPwqiCAHZyx
AldA9M9DDXKk=
accessToken
[String] yes
a3sAB0KnGANg4V
ZwIXfhUyFmPbzoO
Nofl4FjIItac0JQSOD
p6niW8oBr33uOI-
u7
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 319

319
Integrating with your mobile website
If you haven't already completed User flow implementation guide for your app,
we recommend you to complete that first before proceeding with the integration.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 320

320
Initialisation
You can perform user verification via Truecaller at any touchpoint in your journey
(for example - login, registration, checkout, verification, etc.).
To initiate the user verification, you need to trigger a deep link upon any user
action, in the format mentioned below :
Here, requestNonce should be a unique request ID that you need to associate with
every verification request you trigger, so as to do the requisite mapping of the
access token which we post to your callback URL once users share their consent.
window.location = "truecallersdk://truesdk/web_verify?
                           type=btmsheet
                           requestNonce=UNIQUE_REQUEST_ID
                           &partnerKey=YOUR_APP_KEY
                           &partnerName=YOUR_APP_NAME
                           &lang=LANGUAGE_LOCALE
                           &privacyUrl=LINK_TO_YOUR_PRIVACY_PAGE
                           &termsUrl=LINK_TO_YOUR_TERMS_PAGE
                           &loginPrefix=TITLE_STRING_PREFIX
                           &loginSuffix=TITLE_STRING_SUFFIX
                           &ctaPrefix=BUTTON_TEXT_PREFIX
                           &ctaColor=BUTTON_FILL_COLOR
                           &ctaTextColor=BUTTON_TEXT_COLOR
                           &btnShape=BUTTON_SHAPE
                           &skipOption=FOOTER_CTA_STRING
                           &ttl=TIME_IN_MILLISECONDS";
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 321

321
NOTE : The minimum length of the request ID parameter should be 8 characters and
maximum length can be 64 characters
Add the app key which you generated from your developer portal account in the 
partnerKey parameter, and the app name that you want users to see in the
Truecaller profile dialog in the partnerName parameter.
The lang parameter refers to the language locale string corresponding to the
language that you wish the user to see the profile dialog in ( For example - 'en' for
English ). For complete list of supported languages in which you can show the
profile dialog to the users, please refer below :
Truecaller SDK verification dialog customisation options
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 322

322
NOTE : In case the input locale is not supported, the profile will by default be
shown in English language
The loginPrefix string option can be any one of the following parameters depending
on what contextual title string prefix ( context/ goal ) you want to show to the user :
Language locale value to use
english en
hindi hi
marathi mr
telugu te
malayalam ml
urdu ur
punjabi pa
tamil ta
bengali bn
kannada kn
swahili sw
arabic ar
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 323

323
The loginSuffix string option can be any one of the following parameters
depending on what contextual title string suffix ( action ) you want to show to the
user :
string to use "loginPrefix" parameter value
To get started getstarted
To continue continue
To place order placeorder
To complete your order completepurchase
To checkout checkout
To complete your booking completebooking
To proceed with your booking proceedwithbooking
To continue with your booking continuewith
To get details getdetails
To view more viewmore
To continue reading continuereading
To proceed proceed
For new updates newupdates
To get updates getupdates
To subscribe subscribe
To subscribe and get updates subscribeforupdates
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 324

324
The skipOption parameter enables you to add an optional footer string on the
verification screen, which on being clicked by users, allows you to take them to
your alternate verification flow. It can take any one of the following values:
The ctaPrefix parameter lets you choose the prefix string for the contextual text on
the CTA button you want to show
The btnShape parameter lets you choose the shape of the CTA button you want to
show
string "loginSuffix" parameter value
please login login
please signup signup
please login/ signup loginsignup
please register register
please sign in signin
please verify mobile number verifymobile
Footer CTA string to use "skipOption" parameter value
Use another number useanothernum
Use another method useanothermethod
Enter details manually manualdetails
Later later
Button text to use "ctaPrefix" parameter value
Use use
Continue with continuewith
Proceed with proceedwith
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 325

325
To customise the color of the CTA button on the verification screen, you need to
configure the respective hex code in the "ctaColor" parameter as mentioned below
:
Similarly, in order to customise the color of the text on the CTA button on the
verification screen, you need to configure the respective hex code in the
"ctaTextColor" parameter as mentioned below :
Please note that for using the hex codes of any color in the deep link parameter, you
need to add %23 before your hexcode. For example: if you are using hex code for 
#F75D34, then in the deep link you need to configure the value %23f75d34
To add your privacy policy link on the verification screen ( optional ), you can
configure the hyperlink string ( URL safe ) to your privacy policy page in the
"privacyUrl" parameter as mentioned below :
To add your terms of service link on the verification screen ( optional ), you can
configure the hyperlink string ( URL safe ) to your terms of service page in the
"termsUrl" parameter as mentioned below :
Button shape "btnShape" parameter value
Round round
Rectangle rect
ctaColor=%23f75d34
ctaTextColor=%23f75d34
privacyUrl="<<YOUR_PRIVACY_POLICY_LINK>>"
termsUrl="<<YOUR_TERMS_OF_SERVICE_LINK>>"
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 326

326
"Timeout" (ttl) parameter allows you to automatically dismiss the consent screen by
adding the "ttl" value to the deeplink. The TTL feature enhances user flexibility and
streamlines the verification process.
Here's how the TTL feature works:
• The default minimum value for the TTL is set to 8000ms (8s), ensuring a
smooth user experience. If the "ttl" parameter is defined with a value less than
8000ms, it will automatically default to 8000ms. This means that if the user
does not proceed with the flow within 8000ms, the consent screen will be
automatically dismissed.
• There is no maximum value for the "ttl" parameter, giving you the freedom to set
longer durations, if required. The timer value should be specified in
milliseconds, allowing precise control over the consent screen duration.
• In cases where you do not specify the "ttl" parameter in the deeplink, the
consent dialog will persist indefinitely, providing users with ample time to
interact and proceed with the verification flow.
TTL based auto dismiss functionality would work if the end-user is 
having Truecaller app
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 327

327
Invoking verification
Once you have set the deep link parameters, you are ready to invoke the Truecaller
verification on your mobile web page. You need to invoke the deep link using
Javascript on your webpage. This will show the Truecaller verification dialog to the
user if the Truecaller app is present on the user's mobile device. Please note that in
case Truecaller app is not present on the user's device, the deep link won't trigger
anything. To effectively handle this case, you should use the deep as suggested in
the example below :
window.location = "truecallersdk://truesdk/web_verify?
                           type=btmsheet
                           requestNonce=UNIQUE_REQUEST_ID
                           &partnerKey=YOUR_APP_KEY
                           &partnerName=YOUR_APP_NAME
                           &lang=LANGUAGE_LOCALE
                           &privacyUrl=LINK_TO_YOUR_PRIVACY_PAGE
                           &termsUrl=LINK_TO_YOUR_TERMS_PAGE
                           &loginPrefix=TITLE_STRING_PREFIX
                           &loginSuffix=TITLE_STRING_SUFFIX
                           &ctaPrefix=BUTTON_TEXT_PREFIX
                           &ctaColor=BUTTON_FILL_COLOR
                           &ctaTextColor=BUTTON_TEXT_COLOR
                           &btnShape=BUTTON_SHAPE
                           &skipOption=FOOTER_CTA_STRING
                           &ttl=TIME_IN_MILLISECONDS";
setTimeout(function() {
  if( document.hasFocus() ){
     // Truecaller app not present on the device and you redirect the 
user 
     // to your alternate verification page
  }else{
     // Truecaller app present on the device and the profile overlay 
opens
     // The user clicks on verify & you'll receive the user's access 
token to fetch the profile on your 
     // callback URL - post which, you can refresh the session at your 
frontend and complete the user  verification
  }
}, 600);
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 328

328
This would trigger the deep link, and open the user's Truecaller profile dialog if the
app is present on the device. And in case the app is not present, nothing opens. So
now, using javascript, you can check for the document focus: a. If the truecaller
dialog opened, the document would have lost focus and you'll be taken to the else
condition in the above check. b. While in case the Truecaller app is not present on
the device, the focus would always remain with the document and hence, you'll
have the control in the 'if' condition. Accordingly, you can map the next action on
your page based on the two conditions.
When you trigger the Truecaller verification flow, you would receive a prompt
confirmation that the flow has been initiated successfully. When the Truecaller
deeplink is invoked, and the user has the Truecaller application installed and logged
in, a callback is sent to your configured URL. This callback includes the configured
request nonce and status as "flow_invoked." Here is the sample of how the
handshake callback looks like :
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 329

329
Upon receiving the "flow_invoked" request notification, it is imperative for you to
promptly reciprocate with an acknowledgment. This acknowledgment should be
accompanied by a response code falling within the 2XX range, signifying
successful communication.
This approach minimises reliance on "document.hasFocus". By leveraging the
Handshake feature and receiving real-time callbacks, partners gain greater
confidence and control in the user verification process, leading to a smoother user
experience overall.
Please note that the Truecaller verification flow for mobile websites is currently
supported for browsers on Android OS only. You can gracefully handle invoking
Truecaller SDK only on Android and not iOS, by using either of the below to detect the
iOS platform:
1) Looking for User Agent
var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
2) Another way is relying on navigator.platform:
var iOS = !!navigator.platform && 
/iPad|iPhone|iPod/.test(navigator.platform);
iOS will be either true or false
{
  "requestId": "<<Request_Nonce Value>>",
  "status": "flow_invoked"
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 330

330
Fetch User Profile
Once the user approves the verification on your app with their Truecaller profile ( by
clicking the 'Continue' button on the dialog ), we will immediately post the user's
accessToken and the requestID to your Callback endpoint. The sample response
format would look like below :
Here, the request ID is the same string which you had earlier passed on in the deep
link 'requestNonce' parameter. This parameter acts as a request-response
correlation identifier and can be used by you to identify the correct source of the
request. Once you receive the user's access token at your backend, you can fetch
the respective user profile by making an API call to the endpoint that you receive in
the above response in the following format :
Header Authorisation Parameters:
Get User Profile
Sample User Profile Response
{"requestId":"RL8YZ41FQMt5Jiak2sc_Ys0OgQA=","accessToken":"a1asX--8_yw-
OF--E6Gj_DPyKelJIGUUeYB9U9MJhyeu4hOCbrl","endpoint":"https://profile4-
noneu.truecaller.com/v1/default"}
Parameter [Type] Required Description Example
Authorization yes Bearer {token}
Bearer
WcBaSJYbCr5yla5z
0CdAGfyj3Rruk8
curl -X GET -H "Authorization: Bearer 
a3sAB0KnGANg4VZwIXfhUyFmPbzoONofl4FjIItac0JQSODp6niW8oBr33uOI-u7" -H 
"Cache-Control: no-cache" "https://profile4-
noneu.truecaller.com/v1/default"
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 331

331
Please note that the optional attributes in the user profile as defined above, wouldn't
exist in the response if not updated by user
Response Codes
{
  "phoneNumbers": ["919999999999"],
  "addresses": [
    {
       "countryCode": "in",
       "city": "city_field_value",
       "street": "street_field_value",
       "zipcode": "1234567"
    }
  ], 
  "avatarUrl": "https://s3-eu-west-
1.amazonaws.com/images1.truecaller.com/myview/1/15a999e9806gh73834c87aa
a0498020d/3", 
  "aboutMe":"About me",
  "jobTitle": "CEO", 
  "companyName": "ABC",  
  "history": {
    "name": 
    {
      "updateTime": "1508089888000"
    }
  }, 
  "isActive": "True", 
  "gender": "Male", 
  "createdTime": "1379314068000", 
  "onlineIdentities": {
    "url": "https://www.truecaller.com", 
    "email": "y.s@truecaller.com",
    "facebookId":"105056625245",
  }, 
  "type": "Personal", 
  "id": "655574719", 
  "userId":"1319413476",
  "badges": ["verified", "premium"], 
  "name": {
    "last": "Kapoor", 
    "first": "Rajat"
  }
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 332

332
• 200 OK
• 401 Unauthorised - If your credentials are not valid
• 5xx Server error - Any other error
Please note, in case users do not wish to share their Truecaller profile ( by
dismissing Truecaller profile dialog ), you'll receive a user reject error response on
your callback endpoint. The sample format for the same would look as below :
{"requestId":"WZqlS6PqY0ycO3mKlEuI=","status":"user_rejected"}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 333

333
Completing User Verification
Once you have received the user profile details at your backend, you need to
complete the verification flow at your frontend. This requires you to essentially
setup a proper communication mechanism in place between your frontend client
and your backend. You can implement any of the below suggested methods to
achieve the same :
Long Polling :As soon as you initiate the user verification flow at your frontend and
get a successful check that Truecaller is present on the device, you can make a
long polling request to your backend to check if the user's profile data has reached
your backend or not. This kind of request can hold until a particular threshold time
so that it waits for the profile response from your server Periodic Polling : Unlike
long polling, you could also make a specific number of periodic requests [ say
every 3 seconds ] to check if your backend has received the profile response or not
and accordingly stop the polling as soon as you receive the response.
As a good practice, we recommend you to implement periodic polling with 5 polling
cycles at an interval of 3 seconds each.
WebSocket Connection : With this approach, you establish a two-way, persistent
connection between your client and the server to push the data back to the client
as soon as the server receives the profile response. Unlike polling, this does not
require the client to request or wait for the data. As soon as you receive the
callback from Truecaller and fetch the user's profile, you can send the
corresponding data to your frontend via the web socket connection. (In simpler
terms, it's similar to a publish-subscribe system).
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 334

334
Please note that once users click 'Continue' on the Truecaller profile dialog, the entire
verification process might take a few seconds to complete. This includes the time
taken for your backend to receive the access token callback and then fetch the user's
profile info and then finally send it to your client. As a good practice, we recommend
you to show proper wait message (and a loader) to your users so that they are aware
on the progress and ensure that they don't feel stuck.
For example, you may refer to some implementations here.
Also, for a scenario when a user sees the Truecaller verification screen, but doesn't
takes any action before the configured timeout has elapsed, your implementation may
treat this UX behaviour in the same way as you would treat the absence of Truecaller
app on the device, and invoke an alternate custom flow.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 335

335
Handling Error Scenarios
There can be certain cases where users might not wish to share their Truecaller
profile information with your mobile website, and may dismiss the profile dialog
when invoked. For such cases, we pass appropriate error message to your callback
URL so that you can accordingly take the next steps.
Other error scenarios might include cases where your backend fails to fetch user
profile information from Truecaller probably due to some internal or network failure.
These cases can be identified by having a threshold timeout ( recommended 30
seconds ) implemented with your client-server communication mechanism. In
scenarios like above, where the user verification via Truecaller could not be
completed, you should ideally show a proper error message to the users and take
them to your alternate verification flow.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 336

336
Getting Release Ready
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 337

337
Instrumentation
Quick guide on how to properly track and instrument funnel for the verification flow
of users via Truecaller on your mobile website
For proper tracking of the verification funnel via Truecaller on your app, you should
implement tracking events for the following states :
1.Total users coming to your verification flow.
2.Number of cases when the Truecaller app is present on your device - can be
appropriately known using the javascript condition as described in the invoking
verification
 section.
3.Number of users who proceed with this flow and click Continue on the
Truecaller dialog [ for these cases, you receive a success response with user's
access token on the callback URL configured by you ]. For details, refer here
.
4.Number of cases where you received any error, where you receive an error
response with 'user_rejected' message on the callback URL configured by you.
For details, please refer here
.
5.Number of successful profiles fetched by your backend post receiving the
access token from Truecaller's backend on your callback URL. For details, refer 
here
.
6.Number of successful communications between your backend and frontend
post fetching the user's profile information to complete the verification flow.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 338

338
Testing your verification flow
Truecaller app present and registration completed on Truecaller app
Ensure that the Truecaller app is present on your device and you have completed
the profile creation step on Truecaller app. Open your mobile website and initiate
the Truecaller verification flow. The user should see the Truecaller profile dialog.
Click on continue to complete the verification flow and ensure that the verification
is completed.
Truecaller app present but registration not completed on Truecaller app
Ensure that the Truecaller app is present on your device but you have not
completed the profile creation step on Truecaller app. Open your mobile website
and initiate the Truecaller verification flow. The user should see not the Truecaller
profile dialog, and the user should ideally be redirected to your alternate verification
flow.
Truecaller app not present on the device
Remove the Truecaller app from your device. Open your mobile website and try to
initiate the Truecaller verification flow. The user should see not the Truecaller
profile dialog and should be taken to either your alternate verification flow.
Ensure that you receive proper responses on your callback URL
Initiate the Truecaller verification flow in your mobile website ( Truecaller app
should be present on device ) to invoke the Truecaller profile dialog. One by one, try
the following scenarios and ensure that you should receive the appropriate
response from Truecaller's backend stating the corresponding message as
described below : - Click on 'Continue' button.
{"requestId":"RL8YZ41FQMt5Jiak2sc_Ys0OgQA=","accessToken":"a1asX--8_yw-
OF--E6Gj_DPyKelJIGUUeYB9U9MJhyeu4hOCbrl","endpoint":"https://profile4-
noneu.truecaller.com/v1/default"}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 339

339
- Press the system back button - Click on 'Use another mobile number' OR 'Skip' on
the truecaller dialog
We also recommend that you go through the FAQ section
 to go through some of
the commonly asked questions.
{"requestId":"WZqlS6PqY0ycO3mKlEuI=","status":"user_rejected"}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 340

340
iOS
Generating App Key
Integrating with your iOS App
Server Side Response Validation
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 341

341
Generating App Key
To ensure the authenticity of interactions between your app and Truecaller, you
need to generate an app key [ partner key ] and app link from Truecaller developer
account ( https://developer.truecaller.com/login
 ) by adding your App Name,
Bundle Id and prefix.
To generate a new app key for your iOS app, go to the 'MANAGE APPS' section on
the developer account dashboard and click on 'CREATE APP'. Select 'iOS' in the
App type and continue to enter your app details.
You can find your App Id in the "Apple Development Portal". If you do not have App
Id yet, then open Project -> Capabilities -> Enable Associated Domains. New app id
will be automatically created by Xcode.
To find the Prefix, go to the member center on https://developer.apple.com
 and
look at "Certificates, Identifiers & Profiles", click "Identifiers", then "App IDs" in the
section under "Identifiers". Find your app, click on it, and there you will be able to
see the Prefix value ( Refer image below ).
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 342

342
Once you input your app details and create the app, you will be able to see the "App
Key" and "App Link" values for your app. You need to include these values in your
project to authorise all the verification requests.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 343

343
Integrating with your iOS App
To ensure the authenticity of interactions between your app and Truecaller, you
need to generate an app key [ partner key ] and app link from Truecaller developer
account ( https://developer.truecaller.com/login
 ) by adding your App Name,
Bundle Id and prefix.
To generate a new app key for your iOS app, go to the 'MANAGE APPS' section on
the developer account dashboard and click on 'CREATE APP'. Select 'iOS' in the
App type and continue to enter your app details.
You can find your App Id in the "Apple Development Portal". If you do not have App
Id yet, then open Project -> Capabilities -> Enable Associated Domains. New app id
will be automatically created by Xcode.
To find the Prefix, go to the member center on https://developer.apple.com
 and
look at "Certificates, Identifiers & Profiles", click "Identifiers", then "App IDs" in the
section under "Identifiers". Find your app, click on it, and there you will be able to
see the Prefix value ( Refer image below ).
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 344

344
Once you input your app details and create the app, you will be able to see the "App
Key" and "App Link" values for your app. You need to include these values in your
project to authorise all the verification requests.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 345

345
Setup
Manual Installation
1.Download the project zip file from the release section
2.Unzip the file
3.Copy the TruecallerSDK project files into your project ( TrueSDK directory,
TrueSDKTests directory and TrueSDK.xcodeproj )
4.Drag and drop TrueSDK.xcodeproj into your project ( i.e. add it as a subproject
to your main project ). Embedding it this way will not require any additional
script to be run.
5.Add the TruecallerSDK framework ( from Products output of TrueSDK.xcodeproj
) into the Embedded Binaries section of the General tab of your target.
NOTE: We recommend using the Swift Package Manager.
Installation with Swift Package Manager (Recommended)
1.Integrate your Swift package with Xcode by selecting “File” from the Xcode
menu, then select “Add Packages” or use the keyboard shortcut
Shift+Command+K
2.Search for truecaller SDK, use URL - https://github.com/truecaller/ios-sdk
3.Choose the package and select the latest version 
4.Click "Add Package" to confirm 
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 346

346
5.Select the target
6.Click "Add Package" to confirm. 
7.Use the package in your Xcode project by importing it into your swift files.  
Installation with CocoaPods
CocoaPods
 is a dependency manager which automates and simplifies the
process of using 3rd party libraries.
You can install it with the following command:
You can create your Podfile using the command ( in case you do not already have it
):
To integrate TruecallerSDK into your Xcode project using CocoaPods, specify it in
your Podfile  :
Then, run the following command:
$ gem install cocoapods
$ pod init
platform :ios, '8.0'
use_frameworks!
target 'TargetName' do
pod 'TrueSDK'
end
$ pod install
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 347

347
Configuration
Add the entry truesdk under LSApplicationQueriesSchemes in into your Info.plist
file
Add the associated domain provided by Truecaller (for example
applinks:si44524554ef8e45b5aa83ced4e96d5xxx.truecallerdevs.com) in Your
project -> Capabilities > Associated Domains. The prefix 'applinks:' is needed for
universal links to function properly.
Important: Replace the 'https://' part from the provided app link with "applinks:". ie 
https://si44524554ef8e45b5aa83ced4e96d5xxx.truecallerdevs.com  should become 
applinks:si44524554ef8e45b5aa83ced4e96d5xxx.truecallerdevs.com  while adding to
entitlements.
(Note that there is nohttp:// or https:// prefix when setting up the applinks:)
Starting with SDK version 0.1.7, when redirection from Truecaller app to partner app
fails (due to Universal Link failure) an error message is passed from Truecaller app
using url scheme with following error details:
<key>LSApplicationQueriesSchemes</key>
<array>
<string>truesdk</string>
</array>
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 348

348
error code: 19 error description: "Cannot open app because Universal Link 
failed".
Starting with SDK version 0.1.7, It is mandatory to register urlScheme in your project,
in the below format: truecallersdk-<#YOUR_APP_KEY> e.g if your app key is 
I7ViZ490028736bba408881687123b4cec49f, url scheme to be registered is 
truecallersdk-I7ViZ490028736bba408881687123b4cec49f
Please note that if you are using an older version of Truecaller SDK, an error
message will be shown in the Truecaller app asking the user to manually navigate
back to the partner app.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 349

349
Usage
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 350

350
Swift
1. Import the TruecallerSDK framework in the class where you want to initialize it
(for example AppDelegate) and in the class that you want to receive the profile
response. Usually, this will be the ViewController responsible for displaying the True
Profile info.
Swift 2.3 :
Swift 3+ :
2. Check if the current device supports the use of TruecallerSDK and (if so) setup
TruecallerSDK. We recommend this to be done in the
application:didFinishLaunchingWithOptions:
Swift 2.3 :
Swift 3+ :
import TrueSDK
import TrueSDK
//Setup TruecallerSDK
if TCTrueSDK.sharedManager().isSupported() {
    TCTrueSDK.sharedManager().setupWithAppKey(<#YOUR_APP_KEY#>, 
appLink:  <#YOUR_APP_LINK#>)
}
//Setup TruecallerSDK
if TCTrueSDK.sharedManager().isSupported() {
    TCTrueSDK.sharedManager().setup(withAppKey: <#YOUR_APP_KEY#>, 
appLink: <#YOUR_APP_LINK#>)
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 351

351
Use the entire associated domain link provided by Truecaller for YOUR_APP_LINK.
For example: https://si44524554ef8e45b5aa83ced4e96d5xxx.truecallerdevs.com
(including https://).
Important: Make sure you type the YOUR_APP_KEY and YOUR_APP_LINK fields
correctly. If you mistype the YOUR_APP_LINK field, the permission screen in Truecaller
will be shown and immediatelly dismissed. In this case, the SDK will not be able to
send a corresponding error back to your app.
3. In AppDelegate implement the method application(application: continue
userActivity: restorationHandler:) -> Bool and call the corresponding method of
TCTrueSDK.sharedManager(). If the method returns false that means the activity
need not be addressed by TruecallerSDK and you can handle it as desired.
Swift 2.3 :
Swift 3+ :
Swift 5 :
func application(application: UIApplication, continueUserActivity 
userActivity: NSUserActivity, restorationHandler: ([AnyObject]?) -> 
Void) -> Bool {
    return TCTrueSDK.sharedManager().application(application, 
continueUserActivity: userActivity, restorationHandler: 
restorationHandler)
}
func application(_ application: UIApplication, continue userActivity: 
NSUserActivity, restorationHandler: @escaping ([Any]?) -> Swift.Void) -
> Bool {
    return TCTrueSDK.sharedManager().application(application, continue: 
userActivity, restorationHandler: restorationHandler)
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 352

352
For apps using SceneDelegate instead of AppDelegate :
4. Set the class where you want to receive TruecallerSDK events (the profile or
errors) a TCTrueSDKDelegate
Swift 2.3 :
Swift 3+ :
5. Implement the two TCTrueSDKDelegate methods
Swift 2.3 :
Swift 3+ :
func application(_ application: UIApplication, continue userActivity: 
NSUserActivity, restorationHandler: @escaping 
([UIUserActivityRestoring]?) -> Void) -> Bool {
    return TCTrueSDK.sharedManager().application(application, continue: 
userActivity, restorationHandler: restorationHandler as? ([Any]?) -> 
Void)
}
func scene(_ scene: UIScene,
                        continue userActivity: NSUserActivity) {
        TCTrueSDK.sharedManager().scene(scene, continue: userActivity)
    }
class HostViewController: UIViewController, TCTrueSDKDelegate {
class HostViewController: UIViewController, TCTrueSDKDelegate {
func didFailToReceiveTrueProfileWithError(error: TCError) {
    //Custom code here
}
func didReceiveTrueProfile(profile: TCTrueProfile) {
    //Custom code here
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 353

353
The profile object is of type TCTrueProfile (written in Objective C) which offers the
following user data:
func didFailToReceiveTrueProfileWithError(_ error: TCError) {
    //Custom code here
}
func didReceive(_ profile: TCTrueProfile) {
    //Custom code here
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 354

354
typedef NS_ENUM(NSUInteger, TCTrueSDKGender) {
    TCTrueSDKGenderNotSpecified = 0, //
    TCTrueSDKGenderMale, //
    TCTrueSDKGenderFemale, //
};
/*!
 * @class TCTrueProfile
 * @brief The True Profile info returned.
 */
@interface TCTrueProfile : NSObject <NSCoding>
/*! @property firstName @brief User's first name */
@property (nonatomic, strong, nullable, readonly) NSString *firstName;
/*! @property lastName @brief User's last name */
@property (nonatomic, strong, nullable, readonly) NSString *lastName;
/*! @property phoneNumber @brief User's phone number */
@property (nonatomic, strong, nullable, readonly) NSString 
*phoneNumber;
/*! @property countryCode @brief User's country code */
@property (nonatomic, strong, nullable, readonly) NSString 
*countryCode;
/*! @property street @brief User's street address */
@property (nonatomic, strong, nullable, readonly) NSString *street;
/*! @property city @brief User's city */
@property (nonatomic, strong, nullable, readonly) NSString *city;
/*! @property zipCode @brief User's zip code */
@property (nonatomic, strong, nullable, readonly) NSString *zipCode;
/*! @property facebookID @brief User's facebook id */
@property (nonatomic, strong, nullable, readonly) NSString *facebookID;
/*! @property twitterID @brief User's twitter id */
@property (nonatomic, strong, nullable, readonly) NSString *twitterID;
/*! @property email @brief User's email */
@property (nonatomic, strong, nullable, readonly) NSString *email;
/*! @property url @brief User's Truecaller profile url */
@property (nonatomic, strong, nullable, readonly) NSString *url;
/*! @property avatarURL @brief User's avatar url */
@property (nonatomic, strong, nullable, readonly) NSString *avatarURL;
/*! @property jobTitle @brief User's job title */
@property (nonatomic, strong, nullable, readonly) NSString *jobTitle;
/*! @property companyName @brief User's company name */
@property (nonatomic, strong, nullable, readonly) NSString 
*companyName;
/*! @property gender @brief User's gender */
@property (nonatomic, assign, readonly) TCTrueSDKGender gender;
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 355

355
6. Set the delegate property of the TCTrueSDK.sharedManager(). Make sure you do
this before you request the True Profile.
Swift 2.3 :
Swift 3+ :
7. Requesting the True Profile data can be done automatically or manually (either in
code or in the Interface Builder):
a. The TCProfileRequestButton does the True Profile Request automatically. To use
the predefined buttons you need to set the Button Type to Custom and set auto-
layout constraints for the button. You can then choose the True button style and
corners style of the button in code or in Interface Builder using
TCProfileRequestButton property buttonStyle and buttonCornersStyle:
Swift 2.3 :
Swift 3+ :
b. If you prefer to do it yourself, you can use the method requestTrueProfile.
/*! @property isVerified @brief User's account special verification 
status */
@property (nonatomic, assign, readonly) BOOL isVerified;
/*! @property isAmbassador @brief Is the user a Truecaller ambasador */
@property (nonatomic, assign, readonly) BOOL isAmbassador;
TCTrueSDK.sharedManager().delegate = self
TCTrueSDK.sharedManager().delegate = self
self.button.buttonStyle = TCButtonStyleBlue
self.button.buttonCornersStyle = TCButtonCornersStyleRounded
self.button.buttonStyle = TCButtonStyle.blue.rawValue
self.button.buttonCornersStyle = TCButtonCornersStyle.rounded.rawValue
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 356

356
Swift 2.3 :
Swift 3+ :
Important: Do not use both approaches a. and b. at the same time. Doing so will
request the Truecaller profile 2 times in a row. You do not need to call
requestTrueProfile if you use TCProfileRequestButton. This button includes the request
in itself.
TCTrueSDK.sharedManager().requestTrueProfile()
TCTrueSDK.sharedManager().requestTrueProfile()
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 357

357
Objective-C
1. Import the TruecallerSDK framework in the class where you want to initialize it
(for example AppDelegate) and in the class that you want to receive the profile
response. Usually, this will be the ViewController responsible for displaying the True
Profile info.
2. Check if the current device supports the use of TruecallerSDK and (if so) setup
TruecallerSDK. We recommend this to be done in the
application:didFinishLaunchingWithOptions:
Use the entire associated domain link provided by Truecaller for YOUR_APP_LINK.
For example: https://si44524554ef8e45b5aa83ced4e96d5xxx.truecallerdevs.com
(including https://).
Important: Make sure you type the YOUR_APP_KEY and YOUR_APP_LINK fields
correctly. If you mistype the YOUR_APP_LINK field, the permission screen in Truecaller
will be shown and immediatelly dismissed. In this case, the SDK will not be able to
send a corresponding error back to your app.
3. In AppDelegate implement the method
application:continueUserActivity:restorationHandler: and call the corresponding
method of the [TCTrueSDK sharedManager]. If the method returns false that means
the activity need not be addressed by TruecallerSDK and you can handle it as
desired.
#import <TrueSDK/TrueSDK.h>
if ([[TCTrueSDK sharedManager] isSupported]) {
    [[TCTrueSDK sharedManager] setupWithAppKey:<#YOUR_APP_KEY#> 
appLink:<#YOUR_APP_LINK#>];
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 358

358
4. Set the class where you want to receive TruecallerSDK events (the profile or
errors) a TCTrueSDKDelegate
5. Implement the two TCTrueSDKDelegate methods
The profile object is of type TCTrueProfile (written in Objective C) which offers the
following user data:
- (BOOL)application:(UIApplication *)application continueUserActivity:
(NSUserActivity *)userActivity restorationHandler:(void (^)(NSArray 
*restorableObjects))restorationHandler {
    return [[TCTrueSDK sharedManager] application:application 
continueUserActivity:userActivity 
restorationHandler:restorationHandler];
}
#import <UIKit/UIKit.h>
#import <TrueSDK/TrueSDK.h>
@interface ViewController : UIViewController <TCTrueSDKDelegate>
@end
- (void)didReceiveTrueProfile:(nonnull TCTrueProfile *)profile {
    //Custom code
}
- (void)didFailToReceiveTrueProfileWithError:(nonnull TCError *)error {
    //Custom code
}
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 359

359
typedef NS_ENUM(NSUInteger, TCTrueSDKGender) {
    TCTrueSDKGenderNotSpecified = 0, //
    TCTrueSDKGenderMale, //
    TCTrueSDKGenderFemale, //
};
/*!
 * @class TCTrueProfile
 * @brief The True Profile info returned.
 */
@interface TCTrueProfile : NSObject <NSCoding>
/*! @property firstName @brief User's first name */
@property (nonatomic, strong, nullable, readonly) NSString *firstName;
/*! @property lastName @brief User's last name */
@property (nonatomic, strong, nullable, readonly) NSString *lastName;
/*! @property phoneNumber @brief User's phone number */
@property (nonatomic, strong, nullable, readonly) NSString 
*phoneNumber;
/*! @property countryCode @brief User's country code */
@property (nonatomic, strong, nullable, readonly) NSString 
*countryCode;
/*! @property street @brief User's street address */
@property (nonatomic, strong, nullable, readonly) NSString *street;
/*! @property city @brief User's city */
@property (nonatomic, strong, nullable, readonly) NSString *city;
/*! @property zipCode @brief User's zip code */
@property (nonatomic, strong, nullable, readonly) NSString *zipCode;
/*! @property facebookID @brief User's facebook id */
@property (nonatomic, strong, nullable, readonly) NSString *facebookID;
/*! @property twitterID @brief User's twitter id */
@property (nonatomic, strong, nullable, readonly) NSString *twitterID;
/*! @property email @brief User's email */
@property (nonatomic, strong, nullable, readonly) NSString *email;
/*! @property url @brief User's Truecaller profile url */
@property (nonatomic, strong, nullable, readonly) NSString *url;
/*! @property avatarURL @brief User's avatar url */
@property (nonatomic, strong, nullable, readonly) NSString *avatarURL;
/*! @property jobTitle @brief User's job title */
@property (nonatomic, strong, nullable, readonly) NSString *jobTitle;
/*! @property companyName @brief User's company name */
@property (nonatomic, strong, nullable, readonly) NSString 
*companyName;
/*! @property gender @brief User's gender */
@property (nonatomic, assign, readonly) TCTrueSDKGender gender;
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 360

360
6. Set the delegate property of the [TCTrueSDK sharedManager]. Make sure you do
this before you request the True Profile.
7. Requesting the True Profile data can be done automatically or manually (either in
code or in the Interface Builder):
a. The TCProfileRequestButton does the True Profile Request automatically. To use
the predefined buttons you need to set the Button Type to Custom and set auto-
layout constraints for the button. You can then choose the True button style and
corners style of the button in code or in Interface Builder using
TCProfileRequestButton property buttonStyle and buttonCornersStyle:
b. If you prefer to do it yourself, you can use the method requestTrueProfile.
Important: Do not use both approaches a. and b. at the same time. Doing so will
request the Truecaller profile 2 times in a row. You do not need to call
requestTrueProfile if you use TCProfileRequestButton. This button includes the request
in itself.
/*! @property isVerified @brief User's account special verification 
status */
@property (nonatomic, assign, readonly) BOOL isVerified;
/*! @property isAmbassador @brief Is the user a Truecaller ambasador */
@property (nonatomic, assign, readonly) BOOL isAmbassador;
[TCTrueSDK sharedManager].delegate = self;
self.button.buttonStyle = TCButtonStyleBlue;
self.button.buttonCornersStyle = TCButtonCornersStyleRounded;
[[TCTrueSDK sharedManager] requestTrueProfile];
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 361

361
Verifying Non-Truecaller app users
This section defines the steps that can be used to trigger verification of non
Truecaller app users which will be powered via Truecaller's SMS based OTP (
Currently available only for India )
On the Mobile number entry screen set the below delegates :
Swift:
TCTrueSDK.sharedManager().delegate = self 
TCTrueSDK.sharedManager().viewDelegate = self
Objective C:
[TCTrueSDK sharedManager].delegate = self; [TCTrueSDK 
sharedManager].viewDelegate = self;
viewDelegate needs to be set on the mobile number entry screen i.e. OTP flow (not
required for Truecaller one tap flow for Truecaller users verification).
Initiate the verification for the user by calling the following method:
Swift:
TCTrueSDK.sharedManager().requestVerification(forPhone: 
<#PHONE_NUMBER_STRING>,countryCode: <#DEFAULT_COUNTRY_CODE>)
Objective C: [[TCTrueSDK sharedManager] requestVerificationForPhone:
<#PHONE_NUMBER_STRING> countryCode:<#DEFAULT_COUNTRY_CODE>];
• the first parameter (PHONE_NUMBER_STRING) is the 10-digit mobile number
• the second parameter is the country code (DEFAULT_COUNTRY_CODE) of the
mobile number for which the verification needs to be triggered(“IN” for India)
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 362

362
Once you initiate the verification using the above requestVerification() method, the
below delegate method will be called along with the verification state.
Swift: func verificationStatusChanged(to verificationState: 
TCVerificationState)
Objective C: (void)verificationStatusChangedTo:
(TCVerificationState)verificationState;
verificationStatusChanged() delegate method is called under any of the following
scenarios :
• When OTP is successfully triggered for the input mobile number. In this case,
you will get the verificationState as TCVerificationState.otpInitiated
• When the verification is successful for a particular number. In this case, you will
get the verificationState as TCVerificationState.verificationComplete
• When the user is already verified on that particular device. In this case, you will
get the verificationState as TCVerificationState.verifiedBefore
Possible Verification states (TCVerificationState) :
When verificationState is TCVerificationState.otpInitiated, you will also receive an
additional parameter for the time to live i.e TTL (in seconds) which can be fetched
using:- SwiftTCTrueSDK.sharedManager().tokenTtl() Objective C [[TCTrueSDK 
sharedManager] tokenTtl];
State Description
TCVerificationStateOTPInitiated Returned when OTP is successfully initiated
by Truecaller
TCVerificationStateOTPReceived Returned when OTP is successfully
registered by the partner to Truecaller.
TCVerificationStateVerificationComplete OTP verification successful at Truecaller
TCVerificationStateVerifiedBefore The user has already been signed in from
this device
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 363

363
This value determines the amount of time left to complete the verification. You can
use this value to show a waiting message to your user before they can try for
another attempt. Once the TTL expires, you can either auto-retry the verification by
calling the requestVerification() method automatically with the same input
parameters OR you can also take the user back to the number input screen to enter
a different number for verification.
Once the OTP is initiated, allow the user to enter the OTP, first name and last name.
When the verification status is TCVerificationStateVerifiedBefore or 
TCVerificationStateVerificationComplete, it means that the user verification via
Truecaller SDK is complete. In these cases, the SDK will share an additional access
token with your application, which you may then use to validate the response at
your server end. To fetch the access token, you may use the following code
snippet:
SwiftTCTrueSDK.sharedManager().accessTokenForOTPVerification()
Objective C [[TCTrueSDK sharedManager] accessTokenForOTPVerification];
After fetching the access token, you may perform the server side validation by
referring to the steps mentioned in the later part of the documentation here. Below
mentioned didFailToReceiveTrueProfileWithError() method will be called when some
error has occurred while verifying the provided mobile number. You will receive the
appropriate error message from TCError using TCError.getErrorCode(). For details
of different possible error types you may encounter, please refer to the next section
Swift
func didFailToReceiveTrueProfileWithError(_ error: TCError)
Objective C
- (void)didFailToReceiveTrueProfileWithError:(nonnull TCError *)error
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 364

364
Completing Verification
Once verificationState is TCVerificationState.otpInitiated and the user has entered
the OTP, first name and last name(optional), you can complete the verification
process by calling the following method :
Swift:TCTrueSDK.sharedManager().verifySecurityCode(<#OTP>, 
andUpdateFirstname: <#FIRST_NAME>, lastName:<#LAST_NAME>)
Objective C
[[TCTrueSDK sharedManager] verifySecurityCode:<#OTP> andUpdateFirstname:
<#FIRST_NAME> lastName:<#LAST_NAME>];
Please note that the first name and last name values to be passed in the above
method call need to follow the below mentioned rules :
• The strings need to contain at least 1 alphabet, and cannot be completely
comprised of numbers or special characters
• String length should be less than 128 characters
• First name is a mandatory field, last name can be empty ( but non null )
After you call the above method, your delegate method verificationStatusChanged()
with verification status as TCVerificationState.verificationComplete is called and the
user profile is received in delegate method
Objective C: - (void)didReceiveTrueProfile:(nonnull TCTrueProfile *)profile
Swift: func didReceive(_ profile: TCTrueProfile)
Whenever you get verification status as TCVerificationState.verificationComplete,
SDK will share an additional access token with your application which can be
accessed using the accessTokenForOTPVerification() method. You can use this
access token to validate the authenticity of the verification flow by making an API
call from your server to Truecaller's server. For details on this part, please refer
here.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 365

365
Swift:TCTrueSDK.sharedManager().accessTokenForOTPVerification()
Objective C : [[TCTrueSDK sharedManager] accessTokenForOTPVerification];
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 366

366
Handling Error Scenarios
In case of error, didFailToReceiveTrueProfileWithError: will return an object of type
TCError (a subclass of NSError). You can get the error code by invoking the method
getErrorCode on the TCError object. The list of possible TCTrueSDKErrorCode
values can be found in the API documentation.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 367

367
Error Code Description
1
App Key is Missing. The App Key is a
mandatory field. It is provided to you by
Truecaller.
2
App Link is Missing. The App Link is a
mandatory field. It is provided to you by
Truecaller.
3
The user has decided to cancel (abort) the
operation of providing TrueProfile info to
your app.
4 The user has not signed in using the
Truecaller app yet.
5 The SDK version is old and not compatible
with the Truecaller app.
6 The Truecaller app version is old and not
compatible with the SDK version.
7 Current version of iOS is not supported.
8 Truecaller App is Not Installed. The
Truecaller app is not installed.
9 Network Error occurred in network
communication or no network connectivity
10 Truecaller internal error.
11 The user has not been authorized by
Truecaller servers.
12 The credentials cannot be verified. Internal
error.
13 The Profile content is not valid. Internal
error.
14 Bad request. Internal error.
15
Verification Failed because the response
signature could not be verified. Internal
error.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 368

368
16 The request's nonce does not match the
nonce in response. Internal error.
17 View delegate is Nil or not set.
18 Invalid first name or last name.
19 Cannot open app because Universal Link
failed
20 Please add Url Scheme to plist
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 369

369
Safari Redirection
Please refer to this section in case you face issues during the app redirection from
your app to Truecaller app or vice versa, during the verification flow.
Truecaller SDK uses universal links
 to handle the redirection between Truecaller
app and your app. The process involves 4 steps, as defined below :
1.User taps the “Sign up with Truecaller” option on your app
2.Universal link opens Truecaller app
3.User taps “Continue” button on the Truecaller verification screenD. Universal
links opens your app
How Universal Links works
Associated domains are used to notify the OS that these are the universal links
supported by Truecaller SDK.
On tapping a URL or when the app calls openURL request, the OS will check if any
of those apps have an associated domain related to the URL which is being opened.
If there is one, the OS tries to check for AASA ( apple-app-site-association ) files
related to the domain and if the file consists of the path, it opens the app and
transfers control to the app.
If any of the above is missing ( the AASA or the path), it will redirect the url to Safari.
What are associated domains
We need to host a file named AASA ( apple-app-site-association ), which has all the
URLs or URL extensions, which can be used to open the app.
For example: If you have your app named "xyz" and you need to open your app on
tapping a url https://xyz.com/register
 , you need to host an AASA file under the url
https://xyz.com/apple-app-site-association
.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 370

370
Example of a sample AASA File to open your app for URL: https://xyz.com/register
We already cover the steps for creating and hosting the AASA file for you on
registering your app in truecallerdevs.com.
You can check if the AASA for your app is available at: YOUR_APPLINK( provided by
Truecaller )/.well-known/apple-app-site-association
It should look like: 
https://si44524554ef8e45b5aa83ced4e96d5xxx.truecallerdevs.com/.well-
known/apple-app-site-association
P.S : change the italic part to your app link.
How is the OS is notified about Associated Domains
Apple documentation on associated domains can be found here
. Once you enable
the associated domain capability for your app id, you can add associated domains
entitlements with the necessary app links and web credentials. This is one of the
steps in TruecallerSDK integration.
The OS on first installation of your app will try hitting these URLs for ./well-
known/apple-app-site-association endpoints and if there is a file at the endpoint, it
is downloaded to the OS. If the file is downloaded without any error, all the urls you
specified will take the user to the app and if not, you will be redirected to Safari
browser as if trying to open a normal URL. If there is an error in downloading the
AASA file, we as the SDK or your app will not be manually able to download the file
and hence it will keep on redirecting to safari. There is a three hour window of retry
for AASA files depending on different status codes, that is the OS will retry
downloading the AASA file after 3 hours and if it succeeds, all the redirections to
your app works properly.
What to do if you face the safari redirection issue while testing the Truecaller iOS
SDK integration with your app ?
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 371

371
If you encounter the safari redirection issue while integrating the Truecaller SDK
with your iOS app, that probably means thereʼs some issue in downloading the
AASA file for either your application or for the Truecaller app on your device. In
such a scenario, you should try uninstalling and reinstalling your app build as well
as Truecaller app from the device you are testing on, and re-try the flow after
sometime. Usually, it may take a few hours ( as mentioned in the above section ) for
the retry mechanism to kick in and download the updated AASA file on the device.
Once that is successful, the flow should work absolutely fine.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 372

372
Server Side Response Validation
TruecallerSDK provides two optional delegate methods to check the authenticity of
the profile you receive. Note that TruecallerSDK readily offers a simplified way to
request and receive a user profile via required delegate methods and verifies the
content before forwarding it your app.
Server side Truecaller Profile authenticity check
The delegate method didReceiveTrueProfileResponse: will return a
TCTrueProfileResponse instance. Inside TCTrueProfileResponse class there are 3
important fields, payload, signature and signatureAlgorithm. Payload is a Base64
encoding of the json object containing all profile info of the user. Signature contains
the payload's signature. You can forward these fields along with the signing
algorithm back to your backend and verify the authenticity of the information by
doing the following:
1.Fetch Truecaller public keys using this api: https://api4.truecaller.com/v1/key
(we recommend you cache these keys for future use and refresh the cache only
if you cannot verify the signature);
2.Loop through the public keys and try to verify the signature and payload.
Request-Response correlation check
Every request created with TruecallerSDK has a unique identifier namely
'requestNonce'. This identifier is bundled into the response for assuring a
correlation between a request and a response. If you want you can check this
correlation yourself by:
1.Get the request nonce at willRequestProfileWithNonce: method
2.In didReceiveTrueProfileResponse: verify that the previously retrieved identifier
matches the one in TCTrueProfileResponse.requestNonce.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 373

373
Shopify App
Generating App Key
App Configuration
Deactivating App Block
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 374

374
Generating App Key
*Currently under early access
Youʼll be required to generate a “partner key” from the Truecaller developer console
to make the Truecaller Number Verification app work with your Shopify store. You
can do so very easily and for free by registering here
 ( in case you donʼt already
have an existing account ).
1.Once you have created you account and log in, click on “Add Application” and
select the “Shopify” radio button.
2.Input your Store name (e.g. examplestore.myshopify.com) and Shopify Store id
to generate the partner key.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 375

375
3) Click continue, and copy your newly generated partner key from the Truecaller
console.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 376

376
App Configuration
*Currently under early access
Search for “Truecaller Number Verification” app on Shopify app store
 and install
it. Proceed by allowing access for app installation
Youʼll be taken to the app configuration screen where you need to input your
“partner key” ( generated in above steps ) and also select the options on how you
want to customise the Truecaller verification dialog for your users. You can know
more about all the possible customisation options in our documentation here
.
Please select the appropriate options as per your use case and proceed.
Once you save the configuration, youʼll be shown redirect links to go to your store
product page and cart checkout page to add the Truecaller Number Verification app
into the respective places
1) Click on “Home” in the left hand navigation panel.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 377

377
Click on “Customise” in the theme settings section.
2) Go to the “Catalog” section and click on any product to open the product
customisation page
Click on “Add Block” from the left hand navigation panel.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 378

378
3.Select “Verify and Buy ( Products )” from the dropdown.
4) Once you add the Truecaller button, you would need to disable the default
dynamic checkout button for your store. To do so, click on the “Buy Buttons” option
in the left hand navigation panel.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 379

379
5.Uncheck the “Show dynamic checkout buttons” option and click on Save button
and navigation to the main panel on the left hand side.
6.Drag and position the “Verify and Buy (Products)” widget just below the “Buy
Buttons” widget. Click on save.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 380

380
7.You can customise the CTA and text colour on the button. To do so, click on the
“Verify and Buy ( Products )” and you would see the options to customise the
CTA colour as well as the button text colour. Please select your desired value to
match the store them.
8.To enable the Truecaller flow on the cart page also, click on the link just below
the “Customise your button” text in the left hand navigation panel.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 381

381
9) Click on save
Thatʼs it. Truecaller instant verification flow is now enabled for your online store.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 382

382
Deactivating App Block
This step is only needed when you are required to deactivate the app block from
your shopify web store
To deactivate from the product page
Click on the "Verify and Buy ( Product )" app from the product information section
on your product page
Click on "Remove Block" at the bottom part of the left hand navigation panel
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 383

383
To disable from the cart page
Turn off the toggle from the "Cart Page (Truecaller) " app from the left hand side
navigation panel
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 384

384
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 385

385
FAQS
Get detailed answers to all your queries around Truecaller SDK here.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 386

386
General
What is Truecaller SDK ?
Truecaller SDK is a user consent based, instant, mobile number verification service,
which you can use at any touch point in your user journey where you look to verify
your users. To know more, read here
Why should I use Truecaller SDK ?
Leading products like 1mg, Gaana, OYO, Grofers, Myntra, and more, leverage
Truecaller SDK to increase user growth and reduce user abandonment. To know
more, read here
For which use cases can I use Truecaller SDK to verify mobile number of my app
users ?
Number verification use cases can be around user on-boarding, login, registration,
number verification at checkout etc. You may refer to this section
 to see some of
the examples use cases of mobile number verification via Truecaller SDK
Which platforms can I use Truecaller SDK on ?
Truecaller SDK is available for :
• Android apps [ learn more
 ]
• iOS apps [ learn more
 ]
• Mobile websites and interfaces [ learn more
 ]
Can I use Truecaller SDK to verify mobile numbers for all my app users globally ?
Truecaller SDK v2.0 has 2 key functionalities.
• With the 1-tap verification functionality, you can verify mobile number of any
active Truecaller app user (globally) on your app ( For native android & iOS
apps, react native and mobile websites, PWAs on android )
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 387

387
• With the missed call based functionality, you can verify mobile number of any
user who may not be an active Truecaller app user. The missed call functionality
is currently available for India market and on native android and react native
platform only
Is Truecaller SDK free to use ?
No - The Truecaller SDK is metered basis number of successful attempts done
against a project in production environment. Once moved to production and
charged there are no limits to number of verification requests, whatsoever.
Do users need to type / provide their mobile number to complete verification via
Truecaller SDK on my app ?
If the user has Truecaller app present on their device with a verified profile,
Truecaller SDK facilitates zero effort user flow - which does not require users to
type / provide their mobile numbers. This also helps in avoiding any typos.
In case the Truecaller app is not present on the user's device, the android SDK will
facilitate the verification via drop call based background verification / SMS based
OTP. For this, the user will have to input their mobile number on your android app
interface to trigger the verification
What information does my app receive when users consent to verify via
Truecaller SDK on my app ?
Once users consent to verify via Truecaller SDK on your platform, you shall receive
verified mobile number and name for all users, and other profile information such as
email, city etc.
Does Truecaller SDK receive any information from my app ?
Truecaller SDK does not capture any information from 3rd party platforms, and
neither has any visibility to any user activities. The entire process of verification for
Truecaller users is completely 1-way in nature, meaning that there is absolutely no
data handshake involved.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 388

388
For verifying non-Truecaller users in your android app, the SDK needs the mobile
number and name of the user to complete the verification process.
How do I get started integrating Truecaller SDK / next steps for integration ?
• For Android : Refer here
• For Mobile Websites ( Currently for Android Browsers only ) : Refer here
• for iOS : Refer here
For any queries, feel free to reach out to us via 
https://developer.truecaller.com/contact
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 389

389
Developer Account
How can I access my Truecaller developer account ?
• You can create your Truecaller developer account by signing up here : 
https://developer.truecaller.com/sign-up
• If you already have a Truecaller developer account, you can simply login to your
account here : https://developer.truecaller.com/login
What can I do with my Truecaller developer account ?
Once you setup your Truecaller developer account you can:
• create new applications and get respective app keys for using Truecaller SDK
• edit an existing app
• reset your account password
How can I add an app in my account ?
• For Android apps, you need a valid app name, package name, SHA1 fingerprint
and Google app hash code ( optional ) for your app build
• For iOS apps, you need a valid app name, bundle Id and a teamId
• For mobile web apps, you need a valid name, public url [ domain name ] for the
web app and a publicly accessible callback URL [ an endpoint on your server
where Truecallerʼs server will post a userʼs access token once they give consent
to share their Truecaller profile with your app ]
Things that I need to keep in mind -
While creating a new app, you cannot have :
• more than one active android app with the same combination of package name
and SHA1 fingerprint
• more than one active iOS app with the same bundle Id and teamId
• more than one active mobile web app with the same public url and callback URL
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 390

390
• If you want a new key for the same combination of params, you will need to
deactivate the existing app first and then create a new one with the same
identifiers
While editing an already existing app, you can only edit the following :
• App name in case of android / iOS apps
• Callback URL in case of web apps [ Please note that once you change the
callback URL, it might take up to 30 minutes for the caching to clear out and
reflect in our systems ]
You will not be able to edit main identifiers of apps such as package name,
fingerprint, bundleId, teamId In case you need to have an app with the same
package name but a different fingerprint, you should create a new app. You can
also activate and deactivate your application. You cannot activate an application
with identifiers that are already used by any of your existing apps.
I have more than one developer account. I wish to have only one account through
which I should be able to manage all my apps
If you have more than one account and wish to use only one, please contact us 
here
 by sending :
• your existing account's email id
• existing app details
• email id of the new account which you wish to continue using
We will make sure we map your existing apps to the single account you wish to use.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 391

391
Android App SDK
How does Truecaller SDK work for android apps?
Please refer here
 for details.
Can I use Truecaller SDK to verify mobile numbers for all my app users globally?
Truecaller SDK v2.0 has 2 key functionalities:
• With the 1-tap verification functionality, you can verify mobile number of any
active Truecaller app user (globally) on your app.
• With the missed call based functionality, you can verify mobile number of any
user who may not be an active Truecaller app user. The missed call functionality
is currently available for India market and on android platform only.
Where can I find the technical documentation for integration on my android app?
Please refer to the technical documentation here
.
What is the right way / How do I implement the user flow in my app using
Truecaller SDK?
Please refer here
 for details.
Why do I get "Partner Unauthorised [ ERROR_TYPE : 3 ] " error?
One app key can be used only for a particular combination of package name and
SHA1. Different partner key needs to be used for any different combination of the
two parameters.
You might be getting this error because you're either:
• using a wrong app key
• using the right key with either or both wrong package name and fingerprint
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 392

392
For details on generating and managing app keys for different app builds. Please
refer here
.
How can I find the SHA1 of my android app build?
Please refer here
 for details.
What is the TruecallerSDK.getInstance().isUsable() method used for?
The isUsable() method, helps you check if the Truecaller SDK can be used for user
verification or not. Depending on the "sdkOptions" scope you have defined while
initialising the Truecaller SDK ( WITH_OTP or WITHOUT_OTP ), below are the
expected results:
WITH_OTP: In this case, Truecaller SDK can be used to verify existing Truecaller
users as well as non-Truecaller app users ( via missed call/ OTP flow ), hence
isUsable() method would always return "true".
WITHOUT_OTP: In this case, Truecaller SDK can be used to verify only existing
Truecaller users, hence isUsable() method would return "true" only if the users
have Truecaller SDK on their devices. It would return false otherwise.
How do I verify the authenticity of Truecaller SDK response?
Please refer here
.
Does Truecaller SDK need any app permission?
For the verification of existing Truecaller users who have the app present on their
smartphones, the SDK does not require any android system permissions,
whatsoever.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 393

393
For the automatic verification of users who don't have the Truecaller app on their
devices, the SDK can facilitate the verification by sending a drop call in background
/ fallback SMS based OTP. If you choose to use this service for the verification of
non-Truecaller users as well, the SDK will require you to ask for READ_CALL_LOG
and READ_PHONE_STATE permissions. You can read more about the usage of
these permissions here
.
How can I test my application with Truecaller SDK integration to make it release
ready?
For details on test scenarios and setup, please refer here
.
Do I need to submit an app permissions declaration form while uploading my app
on google play store?
If you are also using the missed call based non Truecaller user verification
functionality of the SDK ( currently supported for India only ), you need specific
phone permissions as described here
. For submitting your application on Google
play store, please refer to our recommended guidelines here
.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 394

394
Android OAuth SDK
(Specific to Android OAuth SDK - under early access currently)
How does Truecaller SDK work for android apps?
Please refer here
 for details.
Can I use Truecaller SDK to verify mobile numbers for all my app users globally?
Truecaller SDK v3.0 has 2 key functionalities:
• With the 1-tap verification functionality, you can verify mobile number of any
active Truecaller app user (globally) on your app.
• With the missed call based functionality, you can verify mobile number of any
user who may not be an active Truecaller app user. The missed call functionality
is currently available for India market and on android platform only.
Where can I find the technical documentation for integration on my android app?
Please refer to the technical documentation here.
What is the right way / How do I implement the user flow in my app using
Truecaller SDK?
Please refer here
 for details.
Why do I not get any callback after clicking any CTA on the consent screen. 
In this case please check the instance that you pass in the method  below: 
TcSdk.getInstance().getAuthorizationCode(this);
It  should be of the activity/fragment where you have initialized the SDK.
How can I find the SHA1 of my android app build?
Please refer here for details.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 395

395
What is the TcSdk.getInstance().isOAuthFlowUsable() method used for?
The isOAuthFlowUsable method, helps you check if the Truecaller SDK can be used
for user verification or not. Depending on the "sdkOptions" scope you have defined
while initialising the Truecaller SDK ( OPTION_VERIFY_ONLY_TC_USERS or
OPTION_VERIFY_ALL_USERS ), below are the expected results:
OPTION_VERIFY_ALL_USERS: In this case, Truecaller SDK can be used to verify
existing Truecaller users as well as non-Truecaller app users ( via missed call/ OTP
flow ), hence isUsable() method would always return "true".
OPTION_VERIFY_ONLY_TC_USERS: In this case, Truecaller SDK can be used to
verify only existing Truecaller users, hence isUsable() method would return "true"
only if the users have Truecaller SDK on their devices. It would return "false"
otherwise.
How do I fetch the Truecaller user profile after receiving the success callback ?
Please refer here
.
Does Truecaller OAuth one tap SDK need any app permission?
For the verification of existing Truecaller users who have the app present on their
smartphones, the SDK does not require any android system permissions,
whatsoever.
How can I test my application with Truecaller SDK integration to make it release
ready?
For details on test scenarios and setup, please refer here
.
Do I need to submit an app permissions declaration form while uploading my app
on google play store?
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 396

396
If you are also using the missed call based non Truecaller user verification
functionality of the SDK ( currently supported for India only ), you need specific
phone permissions as described here
. For submitting your application on Google
play store, please refer to our recommended guidelines here
.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 397

397
Mobile Web SDK
“Mobile Web SDK is currently supported only for browsers running on Android OS”
How does Truecaller SDK work for mobile websites and interfaces ?
Please refer here
.
Where can I find the technical documentation for integration on my mobile web
app / PWA ?
Please refer to the technical documentation here
.
What is the right way / How do I implement the user flow in my app using
Truecaller SDK ?
Please refer here
.
How much time does it take for Truecaller to send the access token callback once
a user approves the verification request ?
• As soon as a user clicks ‘Continueʼ on the Truecaller profile dialog, our backend
makes a POST request to the callback URL configured by you while creating the
app from your developer account
• In case users deny sharing their information, we immediately send you an error
response on the same callback URL
• The entire process normally takes a few milliseconds
What should I do once I receive userʼs access token on my callback endpoint ?
Please refer here
I am unable to add the callback URL to my developer account
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 398

398
The callback URL you add has to be an ‘httpsʼ endpoint, and you wonʼt be able to
add an ‘httpʼ endpoint. Please ensure that you have SSL setup before adding the
callback URL For guidelines on properly setting up your callback URL, please refer 
here
.
What is request ID parameter in the deep link schema ?
Request ID corresponds to a unique identifier that you can set from your end while
initiating any verification request. Once users give their consent for sharing the
profile information with your mobile web app, we share the same request ID to you
along with the access token on your callback URL. This can be used as a request
correlation for mapping.
The request ID parameter needs to be a URL safe string with a length of minimum 8
characters and a maximum of 64 characters
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 399

399
Number Verification Plugin
"Number Verification App" for Shopify web stores
What is the “Truecaller Number Verification ” app ?
This app helps you verify your userʼs mobile number identity anywhere during the
checkout flow and also lets you capture mapped user profile details such as name,
email, city etc. which can be auto-filled in your form to make the process simpler
for your users and reduce checkout time.
Does the user need to do any manual efforts or share any information to go
through the number verification flow ?
Truecaller verification flow is a totally effortless and no-OTP flow. The users donʼt
even need to type in their mobile number or wait for an OTP. The users simply need
to give their consent to share their basic Truecaller profile details like verified
mobile number, name, city etc.
Is there any technical integration or coding required to set up the app with my
Shopify store ?
No, there is no need for any technical integration. You simply need to install the app
and configure a few options to get started. The entire setup can be done within a
matter of a few minutes.
What are the supported platforms for this app ?
This app is currently supported on Mobile websites on Android platform only
How can I know the details about all the configuration options available in the app
?
To know what each of the configuration option means, and what are the possible
value options, please refer to this section of our documentation :
https://docs.truecaller.com/truecaller-sdk/mobile-websites/integrating-with-your-
mobile-website/initialisation
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 400

400
What happens if I change my store theme ?
When you change theme, you need to follow steps in Installation tab again, to
install/customise the flow on product and/or checkout flows.
What is the pricing for this app ?
This app is completely free to use and has no commercials and verifications limits
involved. You can verify any number of users on your website for free.
Can I use the number verification flow on "Product Page" ?
Yes, the app works with "Buy it Now" button on the "Product Page". To enable this,
you need to disable the "Dynamic Checkout Button" from theme settings.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 401

401
Product Updates
Get to know all about the updates we keep doing for Truecaller SDK!
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 402

402
App Review Process
To ensure that your users get the best onboarding experience, and at the same time
help you realise the true potential of Truecaller SDK, we are now coming up with a
developer app review process. You can now share your apps/ mobile sites
integrated with Truecaller SDK with the Truecaller developer platform team to get
feedback, and recommendations on best practices before you actually make your
app/ website live for your users. Our team comes with years of experience on
design, UX and learnings on minimising user drop offs.
You can submit your apps/ website for review at any point once you have
successfully integrated Truecaller SDK, but we recommend that you proceed with
the submission only after you have thoroughly tested your app in development
mode.
To submit the application for review, please raise a ticket by going to our support
section here
, and navigate to the “App Review” section. Submit your details along
with a link to your app file/ website link in the message body.
Once you have submitted your app/ mobile site for review, our team will get back to
you within 3-5 working days.
P.S. : Apps and mobile websites with best implementations of the verification flow
after being submitted for the app review process and quality certified from our end,
stand a chance to be showcased in our monthly developer newsletter and case
studies in our global developer portal.
5/13/26, 8:23 PM Truecaller for Developers

---

## Page 403

403
Introducing dark theme
We have recently added support for dark mode to our verification consent screen.
You can now customise the look and feel of the verification consent screen as per
your app theme, and provide a rich experience to your users. Additionally, dark
mode also reduces the strain on end users eyes in low lighting conditions.
The support for customising the verification dialog in dark mode is being rolled out
with the latest version of Truecaller app for users. Refer to our updated SDK
documentation to know more on how this works.
5/13/26, 8:23 PM Truecaller for Developers