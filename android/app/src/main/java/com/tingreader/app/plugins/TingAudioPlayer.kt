package com.tingreader.app.plugins

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.tingreader.app.player.PlayerNotificationService
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "TingAudioPlayer")
class TingAudioPlayer : Plugin() {
    private val tag = "TingAudioPlayer"
    
    private var playerService: PlayerNotificationService? = null
    private var isBound = false
    
    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            Log.d(tag, "Service connected")
            val binder = service as PlayerNotificationService.LocalBinder
            playerService = binder.getService()
            isBound = true
            
            // Setup event listeners
            playerService?.clientEventEmitter = object : PlayerNotificationService.ClientEventEmitter {
                override fun onPlayingUpdate(isPlaying: Boolean) {
                    val ret = JSObject()
                    ret.put("isPlaying", isPlaying)
                    notifyListeners("onPlayingUpdate", ret)
                }
                
                override fun onPositionUpdate(position: Long, duration: Long) {
                    val ret = JSObject()
                    ret.put("position", position / 1000.0) // Convert to seconds
                    ret.put("duration", duration / 1000.0)
                    notifyListeners("onPositionUpdate", ret)
                }
                
                override fun onPlaybackEnded() {
                    notifyListeners("onPlaybackEnded", JSObject())
                }
                
                override fun onPlaybackError(error: String) {
                    val ret = JSObject()
                    ret.put("error", error)
                    notifyListeners("onPlaybackError", ret)
                }
                
                override fun onChapterChanged(index: Int) {
                    val ret = JSObject()
                    ret.put("chapterIndex", index)
                    notifyListeners("onChapterChanged", ret)
                }
            }
        }
        
        override fun onServiceDisconnected(name: ComponentName?) {
            Log.d(tag, "Service disconnected")
            playerService = null
            isBound = false
        }
    }
    
    override fun load() {
        super.load()
        Log.d(tag, "Plugin loaded")
        
        // Bind to service
        val intent = Intent(context, PlayerNotificationService::class.java)
        context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }
    
    override fun handleOnDestroy() {
        super.handleOnDestroy()
        if (isBound) {
            context.unbindService(serviceConnection)
            isBound = false
        }
    }
    
    @PluginMethod
    fun preparePlaylist(call: PluginCall) {
        try {
            val playlistJson = call.getArray("playlist") ?: run {
                call.reject("Missing playlist parameter")
                return
            }
            
            val bookTitle = call.getString("bookTitle") ?: ""
            val bookAuthor = call.getString("bookAuthor") ?: ""
            val coverUrl = call.getString("coverUrl") ?: ""
            val startChapterIndex = call.getInt("startChapterIndex") ?: 0
            val startPosition = call.getDouble("startPosition") ?: 0.0
            val playWhenReady = call.getBoolean("playWhenReady") ?: true
            val skipIntro = call.getInt("skipIntro") ?: 0
            val skipOutro = call.getInt("skipOutro") ?: 0
            val ignoreAudioFocus = call.getBoolean("ignoreAudioFocus") ?: false
            
            val playlist = mutableListOf<PlayerNotificationService.ChapterInfo>()
            for (i in 0 until playlistJson.length()) {
                val chapterJson = playlistJson.getJSONObject(i)
                playlist.add(
                    PlayerNotificationService.ChapterInfo(
                        id = chapterJson.getString("id"),
                        title = chapterJson.getString("title"),
                        url = chapterJson.getString("url"),
                        duration = chapterJson.getDouble("duration")
                    )
                )
            }
            
            Handler(Looper.getMainLooper()).post {
                if (playerService == null) {
                    // Start service if not bound yet
                    val intent = Intent(context, PlayerNotificationService::class.java)
                    ContextCompat.startForegroundService(context, intent)
                    
                    // Wait a bit for service to start
                    Handler(Looper.getMainLooper()).postDelayed({
                        playerService?.preparePlaylist(
                            playlist,
                            bookTitle,
                            bookAuthor,
                            coverUrl,
                            startChapterIndex,
                            (startPosition * 1000).toLong(),
                            playWhenReady,
                            skipIntro,
                            skipOutro,
                            ignoreAudioFocus
                        )
                        call.resolve()
                    }, 500)
                } else {
                    playerService?.preparePlaylist(
                        playlist,
                        bookTitle,
                        bookAuthor,
                        coverUrl,
                        startChapterIndex,
                        (startPosition * 1000).toLong(),
                        playWhenReady,
                        skipIntro,
                        skipOutro,
                        ignoreAudioFocus
                    )
                    call.resolve()
                }
            }
        } catch (e: Exception) {
            Log.e(tag, "Error preparing playlist", e)
            call.reject("Error preparing playlist: ${e.message}")
        }
    }
    
    @PluginMethod
    fun play(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            playerService?.play()
            call.resolve()
        }
    }
    
    @PluginMethod
    fun pause(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            playerService?.pause()
            call.resolve()
        }
    }
    
    @PluginMethod
    fun seekTo(call: PluginCall) {
        val position = call.getDouble("position") ?: run {
            call.reject("Missing position parameter")
            return
        }
        
        Handler(Looper.getMainLooper()).post {
            playerService?.seekTo((position * 1000).toLong())
            call.resolve()
        }
    }
    
    @PluginMethod
    fun seekToChapter(call: PluginCall) {
        val chapterIndex = call.getInt("chapterIndex") ?: run {
            call.reject("Missing chapterIndex parameter")
            return
        }
        val position = call.getDouble("position") ?: 0.0
        
        Handler(Looper.getMainLooper()).post {
            playerService?.seekToChapter(chapterIndex, (position * 1000).toLong())
            call.resolve()
        }
    }
    
    @PluginMethod
    fun setPlaybackSpeed(call: PluginCall) {
        val speed = call.getFloat("speed") ?: run {
            call.reject("Missing speed parameter")
            return
        }
        
        Handler(Looper.getMainLooper()).post {
            playerService?.setPlaybackSpeed(speed)
            call.resolve()
        }
    }
    
    @PluginMethod
    fun getCurrentPosition(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            val position = playerService?.getCurrentPosition() ?: 0
            val ret = JSObject()
            ret.put("position", position / 1000.0)
            call.resolve(ret)
        }
    }
    
    @PluginMethod
    fun getDuration(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            val duration = playerService?.getDuration() ?: 0
            val ret = JSObject()
            ret.put("duration", duration / 1000.0)
            call.resolve(ret)
        }
    }
    
    @PluginMethod
    fun getCurrentChapterIndex(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            val index = playerService?.getCurrentChapterIndex() ?: 0
            val ret = JSObject()
            ret.put("chapterIndex", index)
            call.resolve(ret)
        }
    }
    
    @PluginMethod
    fun isPlaying(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            val playing = playerService?.isPlaying() ?: false
            val ret = JSObject()
            ret.put("isPlaying", playing)
            call.resolve(ret)
        }
    }
    
    @PluginMethod
    fun setSleepTimer(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            val minutes = call.getInt("minutes") ?: 0
            playerService?.setSleepTimer(minutes)
            call.resolve()
        }
    }
    
    @PluginMethod
    fun getSleepTimer(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            val remaining = playerService?.getSleepTimerRemaining() ?: 0
            val ret = JSObject()
            ret.put("remaining", remaining)
            call.resolve(ret)
        }
    }
    
    @PluginMethod
    fun closePlayback(call: PluginCall) {
        Handler(Looper.getMainLooper()).post {
            playerService?.closePlayback()
            call.resolve()
        }
    }
}
