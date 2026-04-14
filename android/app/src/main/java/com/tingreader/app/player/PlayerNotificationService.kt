package com.tingreader.app.player

import android.annotation.SuppressLint
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.media.AudioManager
import android.os.*
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.session.MediaButtonReceiver
import com.bumptech.glide.Glide
import com.bumptech.glide.request.target.CustomTarget
import com.bumptech.glide.request.transition.Transition
import com.google.android.exoplayer2.*
import com.google.android.exoplayer2.audio.AudioAttributes
import com.google.android.exoplayer2.ext.mediasession.MediaSessionConnector
import com.google.android.exoplayer2.ext.mediasession.TimelineQueueNavigator
import com.google.android.exoplayer2.source.MediaSource
import com.google.android.exoplayer2.source.ProgressiveMediaSource
import com.google.android.exoplayer2.ui.PlayerNotificationManager
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource
import com.tingreader.app.R
import kotlin.concurrent.schedule
import java.util.*

class PlayerNotificationService : Service() {

    companion object {
        var isStarted = false
        const val ACTION_PLAY = "com.tingreader.app.ACTION_PLAY"
        const val ACTION_PAUSE = "com.tingreader.app.ACTION_PAUSE"
        const val ACTION_NEXT = "com.tingreader.app.ACTION_NEXT"
        const val ACTION_PREV = "com.tingreader.app.ACTION_PREV"
        const val ACTION_SEEK = "com.tingreader.app.ACTION_SEEK"
        const val ACTION_STOP = "com.tingreader.app.ACTION_STOP"
    }

    private val tag = "PlayerNotificationServ"
    private val binder = LocalBinder()

    interface ClientEventEmitter {
        fun onPlayingUpdate(isPlaying: Boolean)
        fun onPositionUpdate(position: Long, duration: Long)
        fun onPlaybackEnded()
        fun onPlaybackError(error: String)
        fun onChapterChanged(index: Int)
    }

    var clientEventEmitter: ClientEventEmitter? = null

    private lateinit var ctx: Context
    private lateinit var mediaSessionConnector: MediaSessionConnector
    private lateinit var playerNotificationManager: PlayerNotificationManager
    lateinit var mediaSession: MediaSessionCompat
    private lateinit var transportControls: MediaControllerCompat.TransportControls

    lateinit var mPlayer: ExoPlayer

    private var notificationId = 10
    private var channelId = "tingreader_channel"
    private var channelName = "TingReader Channel"

    internal var currentPlaylist: List<ChapterInfo> = emptyList()
    var currentBookTitle: String = ""
    private var currentBookAuthor: String = ""
    private var currentCoverUrl: String = ""
    var coverBitmap: Bitmap? = null
    
    private var positionUpdateTimer: Timer? = null
    private var skipIntro: Int = 0
    private var skipOutro: Int = 0
    private var sleepTimerEndTime: Long = 0
    private var sleepTimerRemainingWhenPaused: Long = 0
    private var hasSkippedIntro: Boolean = false
    
    // 进度保存相关 - 改为 internal 以便 Listener 访问
    private var lastSavedPosition: Long = 0
    private var lastSavedTime: Long = 0
    private val SAVE_INTERVAL_MS = 5000L // 5秒保存一次
    internal var currentBookId: String = ""
    internal var currentChapterId: String = ""
    private var apiBaseUrl: String = ""
    private var authToken: String = ""

    data class ChapterInfo(
        val id: String,
        val title: String,
        val url: String,
        val duration: Double
    )

    inner class LocalBinder : Binder() {
        fun getService(): PlayerNotificationService = this@PlayerNotificationService
    }

    override fun onBind(intent: Intent): IBinder {
        Log.d(tag, "onBind")
        return binder
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        isStarted = true
        Log.d(tag, "onStartCommand $startId")
        
        // Handle media button events
        MediaButtonReceiver.handleIntent(mediaSession, intent)
        
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(tag, "onDestroy - Service is being destroyed")
        isStarted = false
        
        // 在服务销毁前，通知前端保存进度（如果正在播放）
        if (mPlayer.isPlaying || mPlayer.currentPosition > 0) {
            val position = mPlayer.currentPosition
            val duration = mPlayer.duration
            Log.d(tag, "Service destroying, notifying position: $position")
            clientEventEmitter?.onPositionUpdate(position, duration)
            
            // 给前端一点时间保存进度
            try {
                Thread.sleep(500)
            } catch (e: InterruptedException) {
                Log.w(tag, "Sleep interrupted during destroy")
            }
        }
        
        positionUpdateTimer?.cancel()
        positionUpdateTimer = null
        
        playerNotificationManager.setPlayer(null)
        mPlayer.release()
        mediaSession.release()
        
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.d(tag, "onTaskRemoved")
        stopSelf()
    }

    override fun onCreate() {
        Log.d(tag, "onCreate")
        super.onCreate()
        ctx = this

        channelId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            createNotificationChannel(channelId, channelName)
        } else ""

        val sessionActivityPendingIntent =
            packageManager?.getLaunchIntentForPackage(packageName)?.let { sessionIntent ->
                PendingIntent.getActivity(this, 0, sessionIntent, PendingIntent.FLAG_IMMUTABLE)
            }

        mediaSession = MediaSessionCompat(this, tag).apply {
            setSessionActivity(sessionActivityPendingIntent)
            isActive = true
        }

        val mediaController = MediaControllerCompat(ctx, mediaSession.sessionToken)
        transportControls = mediaController.transportControls

        val builder = PlayerNotificationManager.Builder(ctx, notificationId, channelId)
        builder.setMediaDescriptionAdapter(TingMediaDescriptionAdapter(mediaController, this))
        builder.setNotificationListener(TingNotificationListener(this))

        playerNotificationManager = builder.build()
        playerNotificationManager.setMediaSessionToken(mediaSession.sessionToken)
        playerNotificationManager.setUsePlayPauseActions(true)
        playerNotificationManager.setUseNextAction(true)
        playerNotificationManager.setUsePreviousAction(true)
        playerNotificationManager.setUseChronometer(false)
        playerNotificationManager.setUseStopAction(false)
        playerNotificationManager.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        playerNotificationManager.setPriority(NotificationCompat.PRIORITY_MAX)
        playerNotificationManager.setUseFastForwardActionInCompactView(true)
        playerNotificationManager.setUseRewindActionInCompactView(true)
        playerNotificationManager.setSmallIcon(R.drawable.ic_launcher_foreground)

        mediaSessionConnector = MediaSessionConnector(mediaSession)
        
        val queueNavigator: TimelineQueueNavigator = object : TimelineQueueNavigator(mediaSession) {
            override fun getMediaDescription(player: Player, windowIndex: Int): MediaDescriptionCompat {
                val chapter = currentPlaylist.getOrNull(windowIndex)
                return MediaDescriptionCompat.Builder()
                    .setTitle(chapter?.title ?: "")
                    .setSubtitle(currentBookTitle)
                    .build()
            }
        }

        mediaSessionConnector.setQueueNavigator(queueNavigator)
        mediaSessionConnector.setEnabledPlaybackActions(
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_FAST_FORWARD or
            PlaybackStateCompat.ACTION_REWIND or
            PlaybackStateCompat.ACTION_STOP
        )

        initializePlayer()
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun createNotificationChannel(channelId: String, channelName: String): String {
        val chan = NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_LOW)
        chan.lightColor = Color.DKGRAY
        chan.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        val service = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        service.createNotificationChannel(chan)
        return channelId
    }

    private fun initializePlayer() {
        val customLoadControl: LoadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                20000,  // 20s min buffer
                45000,  // 45s max buffer
                5000,   // 5s playback start
                20000   // 20s playback rebuffer
            )
            .build()

        mPlayer = ExoPlayer.Builder(this)
            .setLoadControl(customLoadControl)
            .setSeekBackIncrementMs(15000)
            .setSeekForwardIncrementMs(30000)
            .build()

        mPlayer.setHandleAudioBecomingNoisy(true)
        mPlayer.addListener(TingPlayerListener(this))

        // 初始化时不设置音频属性，等待 preparePlaylist 时根据用户设置来配置
        
        playerNotificationManager.setPlayer(mPlayer)
        mediaSessionConnector.setPlayer(mPlayer)
        
        // Start position update timer
        startPositionUpdateTimer()
    }

    private fun startPositionUpdateTimer() {
        positionUpdateTimer?.cancel()
        positionUpdateTimer = Timer()
        positionUpdateTimer?.schedule(0, 1000) {
            // IMPORTANT: Access ExoPlayer on main thread
            Handler(Looper.getMainLooper()).post {
                if (mPlayer.isPlaying) {
                    val position = mPlayer.currentPosition
                    val duration = mPlayer.duration
                    
                    // 跳过片头：在章节开始时跳过一次（检查前10秒，给足够的缓冲时间）
                    if (skipIntro > 0 && !hasSkippedIntro && position < skipIntro * 1000L && position < 10000L) {
                        Log.d(tag, "Skipping intro: ${skipIntro}s (current position: ${position}ms)")
                        mPlayer.seekTo(skipIntro * 1000L)
                        hasSkippedIntro = true
                    }
                    
                    // 跳过片尾：自动播放下一章
                    if (skipOutro > 0 && duration > 0) {
                        val skipOutroPosition = duration - skipOutro * 1000L
                        if (position >= skipOutroPosition) {
                            Log.d(tag, "Skipping outro: ${skipOutro}s, moving to next chapter")
                            val currentIndex = mPlayer.currentMediaItemIndex
                            if (currentIndex < mPlayer.mediaItemCount - 1) {
                                mPlayer.seekToNext()
                                hasSkippedIntro = false // 重置标记，下一章可以再次跳过片头
                            }
                        }
                    }
                    
                    // 睡眠定时器：播放时检查是否到时间
                    if (sleepTimerEndTime > 0) {
                        if (System.currentTimeMillis() >= sleepTimerEndTime) {
                            Log.d(tag, "Sleep timer expired, pausing playback")
                            mPlayer.pause()
                            sleepTimerEndTime = 0
                            sleepTimerRemainingWhenPaused = 0
                        }
                    }
                    
                    // ⭐ 关键修复：Android 端直接保存进度到服务器（不依赖前端）
                    saveProgressToServer(position, false)
                    
                    // 仍然通知前端（如果前端在前台，可以更新UI）
                    clientEventEmitter?.onPositionUpdate(position, duration)
                } else {
                    // 暂停时：保存剩余时间
                    if (sleepTimerEndTime > 0 && sleepTimerRemainingWhenPaused == 0L) {
                        sleepTimerRemainingWhenPaused = sleepTimerEndTime - System.currentTimeMillis()
                        Log.d(tag, "Paused: saved sleep timer remaining ${sleepTimerRemainingWhenPaused}ms")
                    }
                }
            }
        }
    }

    fun preparePlaylist(
        playlist: List<ChapterInfo>,
        bookTitle: String,
        bookAuthor: String,
        coverUrl: String,
        startChapterIndex: Int,
        startPosition: Long,
        playWhenReady: Boolean,
        skipIntro: Int,
        skipOutro: Int,
        ignoreAudioFocus: Boolean,
        bookId: String,
        apiBaseUrl: String,
        authToken: String
    ) {
        if (!isStarted) {
            Log.i(tag, "preparePlaylist: foreground service not started - Starting service")
            Intent(ctx, PlayerNotificationService::class.java).also { intent ->
                ContextCompat.startForegroundService(ctx, intent)
            }
        }

        // 设置音频属性，根据用户设置决定是否处理音频焦点
        val audioAttributes: AudioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
            .build()
        mPlayer.setAudioAttributes(audioAttributes, !ignoreAudioFocus)
        
        Log.d(tag, "Audio focus handling: ${if (ignoreAudioFocus) "DISABLED (allow simultaneous playback)" else "ENABLED"}")

        currentPlaylist = playlist
        currentBookTitle = bookTitle
        this.skipIntro = skipIntro
        this.skipOutro = skipOutro
        this.hasSkippedIntro = false
        currentBookAuthor = bookAuthor
        currentCoverUrl = coverUrl
        
        // 保存进度相关信息
        this.currentBookId = bookId
        this.apiBaseUrl = apiBaseUrl
        this.authToken = authToken
        this.lastSavedPosition = 0
        this.lastSavedTime = 0
        
        // 如果有章节，设置当前章节ID
        if (startChapterIndex >= 0 && startChapterIndex < playlist.size) {
            this.currentChapterId = playlist[startChapterIndex].id
        }
        
        // Load cover image asynchronously
        loadCoverImage(coverUrl)

        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, bookTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, bookAuthor)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, coverUrl)
            .build()
        mediaSession.setMetadata(metadata)

        val mediaItems = playlist.map { chapter ->
            MediaItem.Builder()
                .setUri(chapter.url)
                .setMediaId(chapter.id)
                .setMediaMetadata(
                    com.google.android.exoplayer2.MediaMetadata.Builder()
                        .setTitle(chapter.title)
                        .build()
                )
                .build()
        }

        val dataSourceFactory = DefaultHttpDataSource.Factory()
        val mediaSources = mediaItems.map { mediaItem ->
            ProgressiveMediaSource.Factory(dataSourceFactory)
                .createMediaSource(mediaItem)
        }

        mPlayer.setMediaSources(mediaSources)
        mPlayer.seekTo(startChapterIndex, startPosition)
        mPlayer.playWhenReady = playWhenReady
        mPlayer.prepare()

        Log.d(tag, "Prepared playlist with ${playlist.size} chapters, starting at chapter $startChapterIndex, position $startPosition")
    }
    
    private fun loadCoverImage(url: String) {
        if (url.isEmpty()) return
        
        try {
            Glide.with(applicationContext)
                .asBitmap()
                .load(url)
                .into(object : CustomTarget<Bitmap>() {
                    override fun onResourceReady(resource: Bitmap, transition: Transition<in Bitmap>?) {
                        coverBitmap = resource
                        // Invalidate notification to update cover
                        Handler(Looper.getMainLooper()).post {
                            playerNotificationManager.invalidate()
                        }
                        Log.d(tag, "Cover image loaded successfully")
                    }
                    
                    override fun onLoadCleared(placeholder: Drawable?) {
                        // Optional: handle cleanup
                    }
                    
                    override fun onLoadFailed(errorDrawable: Drawable?) {
                        Log.w(tag, "Failed to load cover image")
                    }
                })
        } catch (e: Exception) {
            Log.e(tag, "Error loading cover image: ${e.message}")
        }
    }

    fun play() {
        // 恢复睡眠定时器
        if (sleepTimerRemainingWhenPaused > 0) {
            sleepTimerEndTime = System.currentTimeMillis() + sleepTimerRemainingWhenPaused
            sleepTimerRemainingWhenPaused = 0
            Log.d(tag, "Resumed: restored sleep timer")
        }
        mPlayer.play()
    }

    fun pause() {
        val position = mPlayer.currentPosition
        mPlayer.pause()
        
        Log.d(tag, "⏸️ Paused at position: $position")
        
        // ⭐ 暂停时强制立即保存进度到服务器
        saveProgressToServer(position, true)
        
        // 仍然通知前端（如果前端在前台，可以更新UI）
        clientEventEmitter?.onPositionUpdate(position, mPlayer.duration)
    }

    fun seekTo(position: Long) {
        mPlayer.seekTo(position)
    }

    fun seekToChapter(chapterIndex: Int, position: Long) {
        if (chapterIndex >= 0 && chapterIndex < mPlayer.mediaItemCount) {
            mPlayer.seekTo(chapterIndex, position)
            hasSkippedIntro = false // 重置标记，新章节可以跳过片头
        }
    }

    fun setPlaybackSpeed(speed: Float) {
        mPlayer.setPlaybackSpeed(speed)
    }
    
    fun setVolume(volume: Float) {
        // ExoPlayer 的音量范围是 0.0 到 1.0
        mPlayer.volume = volume.coerceIn(0f, 1f)
        Log.d(tag, "Volume set to: $volume")
    }

    fun setSleepTimer(minutes: Int) {
        if (minutes > 0) {
            sleepTimerEndTime = System.currentTimeMillis() + minutes * 60 * 1000L
            sleepTimerRemainingWhenPaused = 0
            Log.d(tag, "Sleep timer set for $minutes minutes")
        } else {
            sleepTimerEndTime = 0
            sleepTimerRemainingWhenPaused = 0
            Log.d(tag, "Sleep timer cancelled")
        }
    }

    fun getSleepTimerRemaining(): Int {
        // 如果暂停中，返回保存的剩余时间
        if (sleepTimerRemainingWhenPaused > 0) {
            return (sleepTimerRemainingWhenPaused / 1000).toInt()
        }
        
        // 如果播放中，计算实时剩余时间
        if (sleepTimerEndTime <= 0) return 0
        val remaining = (sleepTimerEndTime - System.currentTimeMillis()) / 1000
        return if (remaining > 0) remaining.toInt() else 0
    }
    
    // 保存进度到服务器（Android 端直接保存，不依赖前端）
    // internal 以便 Listener 可以调用
    internal fun saveProgressToServer(position: Long, force: Boolean = false) {
        if (currentBookId.isEmpty() || currentChapterId.isEmpty() || apiBaseUrl.isEmpty() || authToken.isEmpty()) {
            return
        }
        
        val currentTime = System.currentTimeMillis()
        val positionSeconds = position / 1000
        
        // 节流：位置变化小于3秒且不是强制保存，跳过
        if (!force) {
            if (Math.abs(positionSeconds - lastSavedPosition / 1000) < 3) {
                return
            }
            // 时间间隔小于5秒，跳过
            if (currentTime - lastSavedTime < SAVE_INTERVAL_MS) {
                return
            }
        }
        
        // 在后台线程执行网络请求
        Thread {
            try {
                val url = java.net.URL("$apiBaseUrl/api/progress")
                val connection = url.openConnection() as java.net.HttpURLConnection
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Authorization", "Bearer $authToken")
                connection.doOutput = true
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                
                val jsonBody = """
                    {
                        "bookId": "$currentBookId",
                        "chapterId": "$currentChapterId",
                        "position": $positionSeconds
                    }
                """.trimIndent()
                
                connection.outputStream.use { os ->
                    os.write(jsonBody.toByteArray())
                }
                
                val responseCode = connection.responseCode
                if (responseCode == 200 || responseCode == 201) {
                    lastSavedPosition = position
                    lastSavedTime = currentTime
                    Log.d(tag, "✓ Progress saved to server: ${positionSeconds}s (chapter: $currentChapterId)")
                } else {
                    Log.w(tag, "✗ Failed to save progress: HTTP $responseCode")
                }
                
                connection.disconnect()
            } catch (e: Exception) {
                Log.e(tag, "✗ Error saving progress to server: ${e.message}")
            }
        }.start()
    }

    fun getCurrentPosition(): Long {
        return mPlayer.currentPosition
    }

    fun getDuration(): Long {
        return mPlayer.duration
    }

    fun getCurrentChapterIndex(): Int {
        return mPlayer.currentMediaItemIndex
    }

    fun isPlaying(): Boolean {
        return mPlayer.isPlaying
    }

    fun closePlayback() {
        mPlayer.stop()
        mPlayer.clearMediaItems()
        currentPlaylist = emptyList()
        stopForeground(true)
        stopSelf()
    }
}

// Player Listener
class TingPlayerListener(private val service: PlayerNotificationService) : Player.Listener {
    private val tag = "TingPlayerListener"
    private var lastPlayingState: Boolean? = null
    private val handler = Handler(Looper.getMainLooper())
    private var pendingPlayingUpdate: Runnable? = null

    override fun onPlaybackStateChanged(playbackState: Int) {
        Log.d(tag, "onPlaybackStateChanged: $playbackState")
        when (playbackState) {
            Player.STATE_ENDED -> {
                Log.d(tag, "Playback ended")
                service.clientEventEmitter?.onPlaybackEnded()
            }
            Player.STATE_READY -> {
                Log.d(tag, "Player ready")
            }
            Player.STATE_BUFFERING -> {
                Log.d(tag, "Player buffering")
            }
            Player.STATE_IDLE -> {
                Log.d(tag, "Player idle")
            }
        }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        Log.d(tag, "onIsPlayingChanged: $isPlaying")
        
        // Cancel any pending update
        pendingPlayingUpdate?.let { handler.removeCallbacks(it) }
        
        // Debounce: delay update by 100ms to avoid rapid state changes during buffering
        pendingPlayingUpdate = Runnable {
            if (lastPlayingState != isPlaying) {
                lastPlayingState = isPlaying
                service.clientEventEmitter?.onPlayingUpdate(isPlaying)
                Log.d(tag, "Playing state updated (debounced): $isPlaying")
            }
        }
        handler.postDelayed(pendingPlayingUpdate!!, 100)
    }

    override fun onPlayerError(error: PlaybackException) {
        Log.e(tag, "onPlayerError: ${error.message}")
        service.clientEventEmitter?.onPlaybackError(error.message ?: "Unknown error")
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        Log.d(tag, "📖 onMediaItemTransition: ${mediaItem?.mediaId}, reason: $reason")
        
        // ⭐ 章节切换时，先保存旧章节的进度
        val position = service.mPlayer.currentPosition
        service.saveProgressToServer(position, true)
        
        // 更新当前章节ID
        val index = service.getCurrentChapterIndex()
        if (index >= 0 && index < service.currentPlaylist.size) {
            service.currentChapterId = service.currentPlaylist[index].id
            Log.d(tag, "Chapter changed to: ${service.currentChapterId}")
        }
        
        // 通知前端
        service.clientEventEmitter?.onChapterChanged(index)
    }
}

// Notification Listener
class TingNotificationListener(private val service: PlayerNotificationService) : PlayerNotificationManager.NotificationListener {
    private val tag = "TingNotificationListener"
    private var isForegroundService = false

    override fun onNotificationPosted(
        notificationId: Int,
        notification: Notification,
        onGoing: Boolean
    ) {
        if (onGoing && !isForegroundService) {
            Log.d(tag, "Starting foreground service")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                service.startForeground(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                service.startForeground(notificationId, notification)
            }
            isForegroundService = true
        }
    }

    override fun onNotificationCancelled(notificationId: Int, dismissedByUser: Boolean) {
        Log.d(tag, "onNotificationCancelled: dismissedByUser=$dismissedByUser")
        if (dismissedByUser) {
            service.stopForeground(true)
            service.stopSelf()
        }
        isForegroundService = false
    }
}

// Media Description Adapter
class TingMediaDescriptionAdapter(
    private val controller: MediaControllerCompat,
    private val service: PlayerNotificationService
) : PlayerNotificationManager.MediaDescriptionAdapter {
    
    override fun getCurrentContentTitle(player: Player): CharSequence {
        val index = player.currentMediaItemIndex
        return player.currentMediaItem?.mediaMetadata?.title ?: "Unknown Chapter"
    }

    override fun createCurrentContentIntent(player: Player): PendingIntent? {
        return controller.sessionActivity
    }

    override fun getCurrentContentText(player: Player): CharSequence {
        // 直接返回书名，而不是从 controller.metadata 获取
        // 因为 MediaSessionConnector 会在章节切换时更新 metadata，导致 METADATA_KEY_TITLE 被覆盖为章节标题
        return service.currentBookTitle
    }

    override fun getCurrentLargeIcon(
        player: Player,
        callback: PlayerNotificationManager.BitmapCallback
    ): Bitmap? {
        // Return cached cover bitmap
        return service.coverBitmap
    }
}
