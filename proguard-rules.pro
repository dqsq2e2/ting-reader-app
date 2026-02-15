# Capacitor ProGuard Rules
-keep public class * extends com.getcapacitor.Plugin
-keep public class * extends com.getcapacitor.BridgeActivity
-keep class com.getcapacitor.Plugin
-keep class com.getcapacitor.BridgeActivity
-keep class com.getcapacitor.Bridge
-keep class com.getcapacitor.BridgeWebViewClient
-keep class com.getcapacitor.BridgeWebChromeClient

# Cordova Plugins
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin
-keep public class * extends org.apache.cordova.CordovaInterface
-keep public class * extends org.apache.cordova.CordovaWebView
-keep public class * extends org.apache.cordova.CordovaWebViewEngine

# Keep all classes in the app package
-keep class com.tingreader.app.** { *; }

# Keep R class members
-keepclassmembers class **.R$* {
    public static <fields>;
}

# Keep Capacitor Annotation
-keep @interface com.getcapacitor.annotation.CapacitorPlugin
-keepclasseswithmembers class * {
    @com.getcapacitor.annotation.CapacitorPlugin <methods>;
}

# Keep javascript interface methods
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Allow obfuscation of other libraries but keep line numbers for stack traces
-keepattributes SourceFile,LineNumberTable
