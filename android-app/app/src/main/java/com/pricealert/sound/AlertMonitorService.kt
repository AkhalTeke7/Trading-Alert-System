package com.pricealert.sound

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.pricealert.sound.Prefs.monitoring
import com.pricealert.sound.Prefs.pollSeconds
import android.os.PowerManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class AlertMonitorService : Service() {
    private var job: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(1, monitorNotification("Watching for price triggers…"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            applicationContext.monitoring = false
            job?.cancel()
            stopSelf()
            return START_NOT_STICKY
        }
        applicationContext.monitoring = true
        // Don't leak multiple loops — restart cleanly
        if (job?.isActive == true) return START_STICKY
        job?.cancel()
        job = scope.launch {
            while (isActive) {
                var woke: PowerManager.WakeLock? = null
                try {
                    try {
                        val pm = getSystemService(POWER_SERVICE) as PowerManager
                        woke = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PriceAlert:poll")
                        woke.acquire(20_000L)
                    } catch (_: Exception) {}
                    pollOnce()
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    android.util.Log.w("PriceAlert", "pollOnce failed: ${e.message}")
                } finally {
                    try { if (woke?.isHeld == true) woke.release() } catch (_: Exception) {}
                }
                // Always sleep — even after failures — so the loop never dies.
                // Coerce here (Prefs default 30s) and clamp Doze drift to 15-300s.
                val secs = try { applicationContext.pollSeconds } catch (_: Exception) { 30 }
                delay(secs.coerceIn(15, 300) * 1000L)
            }
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // OEM task killers swipe-away the app — restart polling after 5s if still armed
        try {
            if (Prefs.prefs(this).getBoolean("monitoring", false)) {
                val pi = android.app.PendingIntent.getService(
                    this, 2,
                    Intent(this, AlertMonitorService::class.java),
                    android.app.PendingIntent.FLAG_ONE_SHOT or android.app.PendingIntent.FLAG_IMMUTABLE
                )
                val am = getSystemService(ALARM_SERVICE) as android.app.AlarmManager
                am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 5_000L, pi)
            }
        } catch (_: Exception) {}
        super.onTaskRemoved(rootIntent)
    }

    private fun pollOnce() {
        val ctx = applicationContext
        val p = Prefs.prefs(ctx)
        val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
        val u = p.getString("basic_user", "") ?: ""
        val pw = p.getString("basic_pass", "") ?: ""
        if (url.isEmpty()) return
        val since = p.getString("last_seen", "") ?: ""
        val events = try { Api.fetchTriggered(url, u, pw, since) } catch (_: Exception) { return }
        if (events.isEmpty()) return
        val seen = (p.getStringSet("seen_ids", emptySet()) ?: emptySet()).toMutableSet()
        val fresh = events.filter { it.id.isNotEmpty() && !seen.contains(it.id) }
        if (since.isEmpty()) {
            // first sync: adopt history silently, then set cursor
            for (e in events) if (e.id.isNotEmpty()) seen.add(e.id)
            p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
            events.maxByOrNull { it.triggeredAt }?.triggeredAt?.let { p.edit().putString("last_seen", it).apply() }
            return
        }
        if (fresh.isEmpty()) {
            // still advance cursor so server can prune old events
            events.maxByOrNull { it.triggeredAt }?.triggeredAt?.let { p.edit().putString("last_seen", it).apply() }
            return
        }
        val phoneFresh = fresh.filter { it.channel == "Phone" || it.channel == "App" || it.channel.isEmpty() }
        if (phoneFresh.isEmpty()) {
            for (e in fresh) seen.add(e.id)
            p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
            events.maxByOrNull { it.triggeredAt }?.triggeredAt?.let { p.edit().putString("last_seen", it).apply() }
            return
        }
        val ordered = phoneFresh.sortedBy { it.triggeredAt }
        for (e in ordered) seen.add(e.id)
        p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
        // advance cursor AFTER marking seen — fixes lost-event race (was set before processing)
        events.maxByOrNull { it.triggeredAt }?.triggeredAt?.let { p.edit().putString("last_seen", it).apply() }
        val latest = ordered.maxByOrNull { it.triggeredAt } ?: return
        // Ring immediately — don't block poll loop on the 50s image download.
        // Image is fetched async and swapped in AlarmActivity if it arrives later.
        launchOnMain(latest, null, null)
        // fetch PNG in background and update the already-ringing alarm
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            try {
                val imgUrl = Api.alertImageUrl(url, latest.pair, latest.target, latest.note)
                val bytes = Api.downloadImage(imgUrl, u, pw)
                if (bytes != null) {
                    val f = java.io.File(ctx.cacheDir, "alert_${latest.id}.png")
                    f.writeBytes(bytes)
                    // update notification with big picture once downloaded
                    AlarmPlayer.updateImage(ctx, latest, bytes, f.absolutePath)
                }
            } catch (_: Exception) {}
        }
    }

    private fun launchOnMain(event: TriggeredEvent, imageBytes: ByteArray? = null, imagePath: String? = null) {
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
