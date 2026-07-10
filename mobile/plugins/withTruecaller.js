/**
 * Expo Config Plugin — Truecaller OAuth SDK 3.x Integration
 *
 * Automates the native Android setup for Truecaller OAuth SDK 3.x:
 * 1. Adds the SDK dependency to app/build.gradle
 * 2. Adds ClientId to AndroidManifest.xml and Drop Call permissions
 * 3. Creates TruecallerOAuthModule.java (React Native bridge for OAuth + Drop Call flow)
 * 4. Creates TruecallerOAuthPackage.java (package registration)
 * 5. Patches MainApplication.java to register the native package
 */

const {
  withAppBuildGradle,
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const TRUECALLER_SDK_VERSION = "3.2.1";

// ─────────────────────────────────────────────────────────────────────
// Step 1: Add Truecaller SDK dependency to app/build.gradle
// ─────────────────────────────────────────────────────────────────────
function withTruecallerGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    const dep = `    implementation "com.truecaller.android.sdk:truecaller-sdk:${TRUECALLER_SDK_VERSION}"`;
    if (!cfg.modResults.contents.includes("truecaller-sdk")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*{/,
        `dependencies {\n${dep}`
      );
    }
    return cfg;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Step 2: Add ClientId and Permissions to AndroidManifest.xml
// ─────────────────────────────────────────────────────────────────────
function withTruecallerManifest(config, clientId) {
  return withAndroidManifest(config, (cfg) => {
    const mainApp = cfg.modResults.manifest.application?.[0];
    if (!mainApp) return cfg;

    if (!mainApp["meta-data"]) mainApp["meta-data"] = [];

    const existingClientId = mainApp["meta-data"].find(
      (m) => m.$?.["android:name"] === "com.truecaller.android.sdk.ClientId"
    );

    if (!existingClientId) {
      mainApp["meta-data"].push({
        $: {
          "android:name": "com.truecaller.android.sdk.ClientId",
          "android:value": clientId,
        },
      });
    }

    // Required for Android 11+ App Visibility
    if (!cfg.modResults.manifest.queries) cfg.modResults.manifest.queries = [];
    const queriesExist = cfg.modResults.manifest.queries.some(
      (q) => q.package?.some((p) => p.$?.["android:name"] === "com.truecaller")
    );
    if (!queriesExist) {
      cfg.modResults.manifest.queries.push({
        package: [{ $: { "android:name": "com.truecaller" } }],
      });
    }

    // Add Drop Call Permissions (REMOVED due to Google Play Store Policy on Sensitive API access)
    // We only use the standard OAuth App flow, not the missed call fallback
    const permissionsToAdd = [];

    if (!cfg.modResults.manifest["uses-permission"]) {
        cfg.modResults.manifest["uses-permission"] = [];
    }

    permissionsToAdd.forEach(perm => {
        const hasPerm = cfg.modResults.manifest["uses-permission"].find(
            p => p.$["android:name"] === perm
        );
        if (!hasPerm) {
            cfg.modResults.manifest["uses-permission"].push({
                $: { "android:name": perm }
            });
        }
    });

    return cfg;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Step 3: Create native Java files for React Native bridge (SDK 3.x)
// ─────────────────────────────────────────────────────────────────────
function withTruecallerNativeFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const pkg = cfg.android?.package || "com.unitefix.app";
      const pkgPath = pkg.replace(/\./g, "/");
      const javaDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        pkgPath
      );

      fs.mkdirSync(javaDir, { recursive: true });

      const moduleFile = path.join(javaDir, "TruecallerOAuthModule.java");
      fs.writeFileSync(
        moduleFile,
        `package ${pkg};

import android.app.Activity;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.FragmentActivity;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.content.Intent;

import com.truecaller.android.sdk.oAuth.TcOAuthCallback;
import com.truecaller.android.sdk.oAuth.TcOAuthData;
import com.truecaller.android.sdk.oAuth.TcOAuthError;
import com.truecaller.android.sdk.oAuth.TcSdk;
import com.truecaller.android.sdk.oAuth.TcSdkOptions;
import com.truecaller.android.sdk.common.TrueException;
import com.truecaller.android.sdk.common.VerificationCallback;
import com.truecaller.android.sdk.common.VerificationDataBundle;
import com.truecaller.android.sdk.common.models.TrueProfile;

import androidx.activity.result.ActivityResultLauncher;
import java.util.UUID;
import java.util.concurrent.Executors;

public class TruecallerOAuthModule extends ReactContextBaseJavaModule implements ActivityEventListener {

    private static final String TAG = "TruecallerOAuth";
    private Promise mPromise;

    TruecallerOAuthModule(ReactApplicationContext context) {
        super(context);
        context.addActivityEventListener(this);
    }

    @NonNull
    @Override
    public String getName() {
        return "TruecallerOAuth";
    }

    private void sendEvent(String eventName, @Nullable WritableMap params) {
        getReactApplicationContext()
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);
    }

    /**
     * Initialize the Truecaller SDK (building options on UI thread, and executing init on background thread)
     */
    @ReactMethod
    public void initialize(Promise promise) {
        UiThreadUtil.runOnUiThread(() -> {
            try {
                Activity activity = getCurrentActivity();
                if (activity == null) {
                    promise.reject("NO_ACTIVITY", "No current activity available");
                    return;
                }

                TcSdkOptions options = new TcSdkOptions.Builder(activity, tcOAuthCallback)
                        .sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS) // Required for Drop Call fallback
                        .build();

                Executors.newSingleThreadExecutor().execute(() -> {
                    try {
                        TcSdk.init(options);
                        Log.d(TAG, "Truecaller OAuth SDK initialized on background thread");
                        promise.resolve(true);
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to initialize SDK on background thread", e);
                        promise.reject("INIT_ERROR", e.getMessage());
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "Failed to build options on UI thread", e);
                promise.reject("INIT_ERROR", e.getMessage());
            }
        });
    }

    @ReactMethod
    public void isUsable(Promise promise) {
        try {
            TcSdk instance = TcSdk.getInstance();
            boolean usable = instance != null && instance.isOAuthFlowUsable();
            promise.resolve(usable);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    /**
     * Set Dark Mode or Light Mode theme (SDK 3.2.1+)
     */
    @ReactMethod
    public void setTheme(String theme, Promise promise) {
        UiThreadUtil.runOnUiThread(() -> {
            try {
                TcSdk instance = TcSdk.getInstance();
                if (instance != null) {
                    if ("dark".equalsIgnoreCase(theme)) {
                        instance.setTheme(com.truecaller.android.sdk.oAuth.OAuthThemeOptions.DARK);
                    } else {
                        instance.setTheme(com.truecaller.android.sdk.oAuth.OAuthThemeOptions.LIGHT);
                    }
                    promise.resolve(true);
                } else {
                    promise.reject("NOT_INITIALIZED", "SDK not initialized");
                }
            } catch (Exception e) {
                promise.reject("THEME_ERROR", e.getMessage());
            }
        });
    }

    /**
     * Trigger OAuth consent flow on UI thread (PKCE)
     */
    @ReactMethod
    public void getAuthorizationCode(String state, String codeChallenge, Promise promise) {
        mPromise = promise;
        UiThreadUtil.runOnUiThread(() -> {
            try {
                Activity activity = getCurrentActivity();
                if (activity == null) {
                    promise.reject("NO_ACTIVITY", "No current activity");
                    mPromise = null;
                    return;
                }

                TcSdk instance = TcSdk.getInstance();
                if (instance != null) {
                    // Set custom PKCE State and Challenge from React Native
                    instance.setOAuthState(state);
                    instance.setCodeChallenge(codeChallenge);
                    instance.setOAuthScopes(new String[]{"openid", "profile", "phone", "email"});
                    if (activity instanceof MainActivity) {
                        MainActivity mainActivity = (MainActivity) activity;
                        if (mainActivity.truecallerLauncher != null) {
                            instance.getAuthorizationCode(mainActivity, mainActivity.truecallerLauncher);
                        } else {
                            promise.reject("LAUNCHER_NULL", "Truecaller launcher not initialized");
                            mPromise = null;
                        }
                    } else {
                        promise.reject("INVALID_ACTIVITY", "Activity is not MainActivity");
                        mPromise = null;
                    }
                } else {
                    promise.reject("NOT_INITIALIZED", "SDK not initialized");
                    mPromise = null;
                }
            } catch (Exception e) {
                promise.reject("AUTH_ERROR", e.getMessage());
                mPromise = null;
            }
        });
    }

    /**
     * Complete the missed call profile verification
     */
    @ReactMethod
    public void verifyMissedCall(String firstName, String lastName, Promise promise) {
        UiThreadUtil.runOnUiThread(() -> {
            try {
                TcSdk instance = TcSdk.getInstance();
                if (instance != null) {
                    TrueProfile profile = new TrueProfile();
                    profile.firstName = firstName;
                    profile.lastName = lastName;
                    instance.verifyMissedCall(profile, verificationCallback);
                    promise.resolve(true);
                } else {
                    promise.reject("NOT_INITIALIZED", "SDK not initialized");
                }
            } catch (Exception e) {
                promise.reject("VERIFY_ERROR", e.getMessage());
            }
        });
    }

    @ReactMethod
    public void requestVerification(String phoneNumber, String countryCode, Promise promise) {
        UiThreadUtil.runOnUiThread(() -> {
            try {
                Activity activity = getCurrentActivity();
                TcSdk instance = TcSdk.getInstance();
                if (activity != null && instance != null) {
                    instance.requestVerification(countryCode, phoneNumber, verificationCallback, (FragmentActivity) activity);
                    promise.resolve(true);
                } else {
                    promise.reject("ERROR", "Initialization error");
                }
            } catch (Exception e) {
                promise.reject("REQ_ERROR", e.getMessage());
            }
        });
    }

    @ReactMethod
    public void clear() {
        try {
            TcSdk instance = TcSdk.getInstance();
            if (instance != null) instance.clear();
        } catch (Exception e) {}
    }

    // ── OAUTH CALLBACK ──
    private final TcOAuthCallback tcOAuthCallback = new TcOAuthCallback() {
        @Override
        public void onSuccess(@NonNull TcOAuthData tcOAuthData) {
            if (mPromise != null) {
                WritableMap result = Arguments.createMap();
                result.putString("authorizationCode", tcOAuthData.getAuthorizationCode());
                result.putString("state", tcOAuthData.getState());
                mPromise.resolve(result);
                mPromise = null;
            }
        }

        @Override
        public void onFailure(@NonNull TcOAuthError tcOAuthError) {
            if (mPromise != null) {
                mPromise.reject("TC_OAUTH_ERROR", tcOAuthError.getErrorMessage());
                mPromise = null;
            }
        }

        @Override
        public void onVerificationRequired(@Nullable TcOAuthError tcOAuthError) {
            // Emitted when user does not have Truecaller installed (Triggers Drop Call Flow via UI)
            if (mPromise != null) {
                WritableMap result = Arguments.createMap();
                result.putBoolean("verificationRequired", true);
                mPromise.resolve(result);
                mPromise = null;
            }
        }
    };

    // ── DROP CALL VERIFICATION CALLBACK ──
    private final VerificationCallback verificationCallback = new VerificationCallback() {
        @Override
        public void onRequestSuccess(int requestCode, @Nullable VerificationDataBundle bundle) {
            WritableMap params = Arguments.createMap();
            params.putInt("requestCode", requestCode);

            if (requestCode == VerificationCallback.TYPE_MISSED_CALL_INITIATED && bundle != null) {
                params.putString("ttl", bundle.getString(VerificationDataBundle.KEY_TTL));
                sendEvent("TruecallerVerificationEvent", params);
            } 
            else if (requestCode == VerificationCallback.TYPE_MISSED_CALL_RECEIVED) {
                sendEvent("TruecallerVerificationEvent", params);
            } 
            else if (requestCode == VerificationCallback.TYPE_VERIFICATION_COMPLETE || 
                     requestCode == VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE) {
                if (bundle != null) {
                    params.putString("accessToken", bundle.getString(VerificationDataBundle.KEY_ACCESS_TOKEN));
                }
                sendEvent("TruecallerVerificationEvent", params);
            }
        }

        @Override
        public void onRequestFailure(int requestCode, @NonNull TrueException e) {
            WritableMap params = Arguments.createMap();
            params.putString("error", e.getExceptionMessage());
            sendEvent("TruecallerVerificationError", params);
        }
    };

    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
        try {
            TcSdk instance = TcSdk.getInstance();
            if (instance != null) {
                instance.onActivityResultObtained((FragmentActivity) activity, resultCode, data);
            }
        } catch (Exception e) {}
    }

    @Override
    public void onNewIntent(Intent intent) {}
}
`
      );

      const packageFile = path.join(javaDir, "TruecallerOAuthPackage.java");
      fs.writeFileSync(
        packageFile,
        `package ${pkg};

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class TruecallerOAuthPackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext context) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new TruecallerOAuthModule(context));
        return modules;
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext context) {
        return Collections.emptyList();
    }
}
`
      );

      return cfg;
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────
// Step 4: Register the package in MainApplication (Java or Kotlin)
// ─────────────────────────────────────────────────────────────────────
function withTruecallerMainApp(config) {
  return withMainApplication(config, (cfg) => {
    const pkg = cfg.android?.package || "com.unitefix.app";
    const contents = cfg.modResults.contents;
    // Robust detection: check language property OR file extension
    const isKotlin = cfg.modResults.language === "kotlin" || cfg.modResults.path?.endsWith('.kt');

    if (isKotlin) {
      const importLine = `import ${pkg}.TruecallerOAuthPackage`;
      const packageLine = `              add(TruecallerOAuthPackage())`;

      if (!contents.includes("TruecallerOAuthPackage")) {
        // Add Import (flexible regex)
        cfg.modResults.contents = contents.replace(
          /^(package [^\s;]+)/m,
          `$1\n\n${importLine}`
        );
        // Add to getPackages() apply block (flexible regex for comments/spaces)
        cfg.modResults.contents = cfg.modResults.contents.replace(
          /(\/\/\s*add\(MyReactNativePackage\(\)\))/,
          `$1\n${packageLine}`
        );
      }
    } else {
      // Legacy Java Support
      const importLine = `import ${pkg}.TruecallerOAuthPackage;`;
      const packageLine = `      packages.add(new TruecallerOAuthPackage());`;

      if (!contents.includes("TruecallerOAuthPackage")) {
        cfg.modResults.contents = contents.replace(
          /^(package [^\s;]+;)/m,
          `$1\n\n${importLine}`
        );
        cfg.modResults.contents = cfg.modResults.contents.replace(
          /(List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);)/,
          `$1\n${packageLine}`
        );
      }
    }

    return cfg;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Step 5: Patch MainActivity.kt to add ActivityResultLauncher for SDK 3.x
// ─────────────────────────────────────────────────────────────────────
function withTruecallerMainActivity(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const pkg = cfg.android?.package || "com.unitefix.app";
      const pkgPath = pkg.replace(/\./g, "/");
      const mainActivityPath = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        pkgPath,
        "MainActivity.kt"
      );

      if (!fs.existsSync(mainActivityPath)) {
        console.warn("[withTruecaller] MainActivity.kt not found, skipping launcher injection");
        return cfg;
      }

      let contents = fs.readFileSync(mainActivityPath, "utf-8");

      // Skip if already patched
      if (contents.includes("truecallerLauncher")) {
        return cfg;
      }

      // Add imports after existing imports
      const launcherImports = [
        "import android.content.Intent",
        "import androidx.activity.result.ActivityResultLauncher",
        "import androidx.activity.result.contract.ActivityResultContracts",
        "import com.truecaller.android.sdk.oAuth.TcSdk",
      ];

      for (const imp of launcherImports) {
        if (!contents.includes(imp)) {
          contents = contents.replace(
            /^(package [^\n]+\n)/m,
            `$1${imp}\n`
          );
        }
      }

      // Add the launcher field and registration inside onCreate
      // Field declaration just inside the class body
      contents = contents.replace(
        /(class MainActivity[^{]*\{)/,
        `$1\n    @JvmField var truecallerLauncher: ActivityResultLauncher<Intent>? = null\n`
      );

      // Register the launcher inside onCreate, before super.onCreate
      contents = contents.replace(
        /(override fun onCreate\(savedInstanceState: Bundle\?\)\s*\{)/,
        `$1\n        truecallerLauncher = registerForActivityResult(\n            ActivityResultContracts.StartActivityForResult()\n        ) { result ->\n            try {\n                TcSdk.getInstance()?.onActivityResultObtained(this, result.resultCode, result.data)\n            } catch (e: Exception) { /* ignore */ }\n        }\n`
      );

      fs.writeFileSync(mainActivityPath, contents, "utf-8");
      return cfg;
    },
  ]);
}

function withTruecaller(config, props = {}) {
  const clientId = props.clientId || "4gniidv8yotvmqym7nwgcfven6mk36mqep70ikeq8qs";
  config = withTruecallerGradle(config);
  config = withTruecallerManifest(config, clientId);
  config = withTruecallerNativeFiles(config);
  config = withTruecallerMainApp(config);
  config = withTruecallerMainActivity(config);
  return config;
}

module.exports = withTruecaller;
