package com.tingreader.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(AudioConfigPlugin.class);
    }
}

@CapacitorPlugin(name = "AudioConfig")
class AudioConfigPlugin extends Plugin {
    private AudioFocusRequest focusRequest;
    private AudioManager audioManager;
    private AudioManager.OnAudioFocusChangeListener focusChangeListener = focusChange -> {};

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void setIgnoreAudioFocus(PluginCall call) {
        boolean ignore = Boolean.TRUE.equals(call.getBoolean("ignore", false));
        if (ignore) {
            // Android 8.0+ AUDIOFOCUS_NONE doesn't exist for requestAudioFocus, 
            // but we can request focus and not abandon it? No, WebView has its own listener.
            // A common workaround for WebView audio focus in Cordova/Capacitor is to set the AudioManager mode
            // or abandon the focus immediately after WebView requests it, but WebView listens to focus changes.
            // We will rely on the JS fallback to force play, which at least prevents the app from staying paused.
            // To prevent the other app from being paused when we force play, we can request a transient focus 
            // and immediately abandon it, or just let JS handle it.
            
            // To genuinely mix audio in WebView without pausing other apps, it's virtually impossible 
            // because Chromium's AudioManagerAndroid always requests AUDIOFOCUS_GAIN. 
            // But we can try to use MODE_IN_COMMUNICATION which bypasses the media focus policy.
            try {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                audioManager.setSpeakerphoneOn(true);
            } catch (Exception e) {
                e.printStackTrace();
            }
        } else {
            try {
                audioManager.setMode(AudioManager.MODE_NORMAL);
                audioManager.setSpeakerphoneOn(false);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        call.resolve();
    }
}
