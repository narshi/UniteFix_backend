# R8 / ProGuard keep rules for the UniteFix Android release build.
#
# R8 is enabled via android.enableMinifyInReleaseBuilds in gradle.properties,
# to clear Google Play's obfuscation threshold.
#
# WHY THIS FILE MATTERS: R8 renames and deletes code it believes is unreachable.
# It reads the bytecode, so anything reached by REFLECTION — by class name at
# runtime — looks unreachable and gets removed or renamed. React Native is built
# on exactly that: native modules are looked up by name from JavaScript. Without
# these rules the app compiles, installs, and then crashes the first time it
# opens a payment sheet or a map.
#
# Nothing here shows up in a typecheck or a debug build. Only a real release
# build on a real device proves it.
#
# Most modern AARs ship their own consumer rules, which R8 applies
# automatically. The entries below are the ones that are either not shipped, or
# not reliably shipped, by the libraries this app depends on.

# ---------------------------------------------------------------------------
# Crash reports must stay readable.
#
# Without these, every stack trace in Play Console becomes unnumbered and
# unnamed, and a production crash goes from a location to a guess. The mapping
# file is bundled into the AAB automatically, so Play can still de-obfuscate —
# but keeping line numbers means the de-obfuscated trace actually points at a
# line.
# ---------------------------------------------------------------------------
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepattributes Signature,*Annotation*,InnerClasses,EnclosingMethod,Exceptions

# JNI entry points: renaming either side breaks the binding silently.
-keepclasseswithmembernames class * {
    native <methods>;
}

# ---------------------------------------------------------------------------
# React Native + Hermes
# ---------------------------------------------------------------------------
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.proguard.annotations.** { *; }
-keepclassmembers class * {
    @com.facebook.react.uimanager.annotations.ReactProp <methods>;
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-dontwarn com.facebook.react.**

# Expo resolves its modules through a registry keyed by class name.
-keep class expo.modules.** { *; }
-keep class expo.core.** { *; }
-dontwarn expo.modules.**

# ---------------------------------------------------------------------------
# Razorpay — the one most likely to break, and the most expensive when it does.
#
# The SDK drives its checkout through a WebView JavaScript bridge and finds the
# payment callbacks reflectively. These rules are from Razorpay's own Android
# integration guide. A stripped callback means the customer pays and the app
# never hears about it — money moves and the booking does not.
# ---------------------------------------------------------------------------
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.razorpay.** { *; }
-dontwarn com.razorpay.**
-keepclasseswithmembers class * {
    public void onPayment*(...);
}
# Razorpay's guide asks for this specifically; inlining breaks its callback
# dispatch.
-optimizations !method/inlining/*

# ---------------------------------------------------------------------------
# Firebase (auth + messaging). Push registration is reflection-driven.
# ---------------------------------------------------------------------------
-keep class com.google.firebase.** { *; }
-keep class io.invertase.firebase.** { *; }
-dontwarn com.google.firebase.**
-dontwarn io.invertase.firebase.**

# ---------------------------------------------------------------------------
# Maps, SVG, screens, gesture handling, image picking
# ---------------------------------------------------------------------------
-keep class com.google.android.gms.maps.** { *; }
-keep class com.airbnb.android.react.maps.** { *; }
-dontwarn com.google.android.gms.**
-keep class com.horcrux.svg.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# ---------------------------------------------------------------------------
# OkHttp / Okio — used by the networking stack underneath axios.
# ---------------------------------------------------------------------------
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Enum values are commonly resolved by name across the JS bridge.
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Parcelables and Serializables lose their contract if renamed.
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}
