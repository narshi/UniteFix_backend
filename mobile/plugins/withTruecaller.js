/**
 * Expo Config Plugin — Truecaller SDK Integration
 *
 * Automates the native Android setup for Truecaller SDK v2.6.0:
 * 1. Adds the SDK dependency to app/build.gradle
 * 2. Creates TruecallerAuthModule.java (React Native bridge)
 * 3. Creates TruecallerAuthPackage.java (package registration)
 * 4. Patches MainApplication.java to register the native package
 *
 * Usage in app.json:
 *   "plugins": ["./plugins/withTruecaller"]
 *
 * Requires: npx expo prebuild + npx expo run:android (NOT Expo Go)
 */

const {
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const TRUECALLER_SDK_VERSION = "2.6.0";

/**
 * Step 1: Add Truecaller SDK dependency to app/build.gradle
 */
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

/**
 * Step 2: Create native Java files for the React Native bridge
 */
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

      // TruecallerAuthModule.java
      const moduleFile = path.join(javaDir, "TruecallerAuthModule.java");
      if (!fs.existsSync(moduleFile)) {
        fs.writeFileSync(
          moduleFile,
          `package ${pkg};

import android.app.Activity;
import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.FragmentActivity;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import com.truecaller.android.sdk.ITrueCallback;
import com.truecaller.android.sdk.TrueError;
import com.truecaller.android.sdk.TrueProfile;
import com.truecaller.android.sdk.TruecallerSDK;
import com.truecaller.android.sdk.TruecallerSdkScope;

public class TruecallerAuthModule extends ReactContextBaseJavaModule implements ActivityEventListener {

    private Promise mPromise;

    TruecallerAuthModule(ReactApplicationContext context) {
        super(context);
        context.addActivityEventListener(this);
    }

    @NonNull
    @Override
    public String getName() {
        return "TruecallerAuth";
    }

    @ReactMethod
    public void initialize() {
        Activity activity = getCurrentActivity();
        if (activity == null) return;

        TruecallerSdkScope scope = new TruecallerSdkScope.Builder(activity, sdkCallback)
                .consentMode(TruecallerSdkScope.CONSENT_MODE_BOTTOMSHEET)
                .loginTextPrefix(TruecallerSdkScope.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
                .ctaTextPrefix(TruecallerSdkScope.CTA_TEXT_PREFIX_USE)
                .privacyPolicyUrl("https://unitefix.com/privacy")
                .termsOfServiceUrl("https://unitefix.com/terms")
                .build();

        TruecallerSDK.init(scope);
    }

    @ReactMethod
    public void isUsable(Promise promise) {
        try {
            boolean usable = TruecallerSDK.getInstance() != null
                    && TruecallerSDK.getInstance().isUsable();
            promise.resolve(usable);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void authenticate(Promise promise) {
        mPromise = promise;
        Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity");
            return;
        }

        try {
            if (TruecallerSDK.getInstance() != null && TruecallerSDK.getInstance().isUsable()) {
                TruecallerSDK.getInstance().getUserProfile((FragmentActivity) activity);
            } else {
                promise.reject("NOT_USABLE", "Truecaller is not installed or not usable");
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    private final ITrueCallback sdkCallback = new ITrueCallback() {
        @Override
        public void onSuccessProfileShared(@NonNull TrueProfile trueProfile) {
            if (mPromise != null) {
                WritableMap map = Arguments.createMap();
                map.putString("firstName", trueProfile.firstName);
                map.putString("lastName", trueProfile.lastName);
                map.putString("phoneNumber", trueProfile.phoneNumber);
                map.putString("email", trueProfile.email);
                map.putBoolean("isVerified", trueProfile.isTrueName);
                mPromise.resolve(map);
                mPromise = null;
            }
        }

        @Override
        public void onFailureProfileShared(@NonNull TrueError trueError) {
            if (mPromise != null) {
                mPromise.reject("TC_ERROR", "Truecaller verification failed: " + trueError.getErrorType());
                mPromise = null;
            }
        }

        @Override
        public void onVerificationRequired(@Nullable TrueError trueError) {
            if (mPromise != null) {
                mPromise.reject("VERIFICATION_REQUIRED", "Manual verification required");
                mPromise = null;
            }
        }
    };

    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
        if (TruecallerSDK.getInstance() != null) {
            TruecallerSDK.getInstance().onActivityResultObtained(
                    (FragmentActivity) activity, requestCode, resultCode, data
            );
        }
    }

    @Override
    public void onNewIntent(Intent intent) {}
}
`
        );
      }

      // TruecallerAuthPackage.java
      const packageFile = path.join(javaDir, "TruecallerAuthPackage.java");
      if (!fs.existsSync(packageFile)) {
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

public class TruecallerAuthPackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext context) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new TruecallerAuthModule(context));
        return modules;
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext context) {
        return Collections.emptyList();
    }
}
`
        );
      }

      return cfg;
    },
  ]);
}

/**
 * Step 3: Register the package in MainApplication.java
 */
function withTruecallerMainApp(config) {
  return withMainApplication(config, (cfg) => {
    const importLine = `import ${cfg.android?.package || "com.unitefix.app"}.TruecallerAuthPackage;`;
    const packageLine = `      packages.add(new TruecallerAuthPackage());`;

    // Add import
    if (!cfg.modResults.contents.includes("TruecallerAuthPackage")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /^(package .+;)/m,
        `$1\n\n${importLine}`
      );

      // Add package registration
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);)/,
        `$1\n${packageLine}`
      );
    }

    return cfg;
  });
}

/**
 * Main plugin — chains all three modifications
 */
function withTruecaller(config) {
  config = withTruecallerGradle(config);
  config = withTruecallerNativeFiles(config);
  config = withTruecallerMainApp(config);
  return config;
}

module.exports = withTruecaller;
