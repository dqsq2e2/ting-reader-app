package com.tingreader.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AudioConfig")
public class AudioConfigPlugin extends Plugin {

    @PluginMethod
    public void setIgnoreAudioFocus(PluginCall call) {
        // This method is kept for compatibility but the actual implementation
        // is now in PlayerNotificationService.preparePlaylist()
        // The ignoreAudioFocus setting is passed when preparing the playlist
        call.resolve();
    }
}
