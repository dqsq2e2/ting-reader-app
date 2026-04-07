package com.tingreader.app;

import android.content.Context;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.tingreader.app.plugins.TingAudioPlayer;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // IMPORTANT: Register plugins BEFORE super.onCreate()
        registerPlugin(AudioConfigPlugin.class);
        registerPlugin(TingAudioPlayer.class);
        
        super.onCreate(savedInstanceState);
        
        // Log plugin registration for debugging
        android.util.Log.d("MainActivity", "TingAudioPlayer plugin registered");
    }
}
