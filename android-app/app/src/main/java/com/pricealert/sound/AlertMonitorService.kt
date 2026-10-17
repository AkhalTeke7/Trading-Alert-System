package com.pricealert.sound

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.pricealert.sound.Prefs.monitoring
import com.pricealert.sound.Prefs.pollSeconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class AlertMonitorService : Service() {
    private var job: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(1, monitorNotification("Watching for price triggers…"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            applicationContext.monitoring = false
            stopSelf()
            return START_NOT_STICKY
        }
        applicationContext.monitoring = true
        job?.cancel()
        job = scope.launch {
            var failures = 0
            while (isActive) {
                try {
                    pollOnce()
                    failures = 0
                } catch (_: Exception) {
                    failures++
                }
                delay((applicationContext.pollSeconds.coerceIn(15, 300) * 1000L))
            }
        }
        return START_STICKY
    }

    private fun pollOnce() {
        val ctx = applicationContext
        val p = Prefs.prefs(ctx)
        val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
        val u = p.getString("basic_user", "") ?: ""
        val pw = p.getString("basic_pass", "") ?: ""
        if (url.isEmpty()) return
        val since = p.getString("last_seen", "") ?: ""
        val events = Api.fetchTriggered(url, u, pw, since)
        if (events.isEmpty()) return
        val seen = (p.getStringSet("seen_ids", emptySet()) ?: emptySet()).toMutableSet()
        val fresh = events.filter { it.id.isNotEmpty() && !seen.contains(it.id) }
        // Advance the cursor even if all were seen (server may prune old events).
        val newest = events.maxByOrNull { it.triggeredAt }?.triggeredAt
        if (!newest.isNullOrEmpty()) p.edit().putString("last_seen", newest).apply()
        if (since.isEmpty()) {
            // First sync: adopt the existing history silently. Ringing for every
            // old event at once is an alarm storm, not an alert.
            for (e in events) if (e.id.isNotEmpty()) seen.add(e.id)
            p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
            return
        }
        if (fresh.isEmpty()) {
            p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
            return
        }
        // Only ring for Phone (distinct channel) — ignore Telegram/Bale events
        val phoneFresh = fresh.filter { it.channel == "Phone" || it.channel == "App" || it.channel.isEmpty() }
        if (phoneFresh.isEmpty()) {
            // mark Telegram/Bale as seen so we don't check them again every poll
            for (e in fresh) seen.add(e.id)
            p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
            return
        }
        // One alarm per poll: ring only the latest Phone event
        val ordered = phoneFresh.sortedBy { it.triggeredAt }
        for (e in ordered) seen.add(e.id)
        p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
        val latest = ordered.maxByOrNull { it.triggeredAt } ?: return
        val p2 = Prefs.prefs(ctx)
        val url2 = p2.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
        val u2 = p2.getString("basic_user", "") ?: ""
        val pw2 = p2.getString("basic_pass", "") ?: ""
        // Download the exact Telegram/Bale card PNG, then ring with it.
        // Still on IO thread here; image fetch has its own timeouts.
        var bytes: ByteArray? = null
        var path: String? = null
        try {
            val imgUrl = Api.alertImageUrl(url2, latest.pair, latest.target, latest.note)
            bytes = Api.downloadImage(imgUrl, u2, pw2)
            if (bytes != null) {
                val f = java.io.File(ctx.cacheDir, "alert_${latest.id}.png")
                f.writeBytes(bytes)
                path = f.absolutePath
            }
        } catch (_: Exception) {}
        // Ring on the main thread's context: AlarmPlayer handles its own threading.
        launchOnMain(latest, bytes, path)
    }

    private fun launchOnMain(event: TriggeredEvent, imageBytes: ByteArray? = null, imagePath: String? = null) {
        // MediaPlayer must be touched carefully; post to main via handler.
        android.os.Handler(mainLooper).post {
            AlarmPlayer.ring(this, event, imageBytes, imagePath)
            val alarmIntent = Intent(this, AlertAlarmActivity::class.java).apply {
                putExtra("pair", event.pair)
                putExtra("target", event.target)
                putExtra("note", event.note)
                putExtra("imagePath", imagePath)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            startActivity(alarmIntent)
        }
    }

    private fun monitorNotification(text: String): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, PriceAlertApp.CHANNEL_MONITOR)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Price Alert monitor running")
            .setContentText(text)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        job?.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.pricealert.sound.STOP"
    }
}
