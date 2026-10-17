package com.pricealert.sound

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.graphics.BitmapFactory
import androidx.core.app.NotificationCompat

object AlarmPlayer {
    @Volatile private var player: MediaPlayer? = null

    fun ring(ctx: Context, event: TriggeredEvent, imageBytes: ByteArray? = null, imagePath: String? = null, htmlPath: String? = null) {
        stop()
        // Vibrate in a repeating pattern.
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= 31) {
                (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION") ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            val pattern = longArrayOf(0, 500, 500, 500, 500, 1000)
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION") vibrator.vibrate(pattern, 0)
            }
        } catch (_: Exception) {}

        // Loud alarm sound: system alarm tone, looping.
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(ctx, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (_: Exception) {}

        showNotification(ctx, event, imageBytes, imagePath, htmlPath)
    }

    fun stop(ctx: Context? = null) {
        try { player?.stop() } catch (_: Exception) {}
        try { player?.release() } catch (_: Exception) {}
        player = null
        try {
            ctx?.let {
                val v = if (Build.VERSION.SDK_INT >= 31) {
                    (it.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
                } else {
                    @Suppress("DEPRECATION") it.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                }
                v.cancel()
            }
        } catch (_: Exception) {}
    }

    private fun showNotification(ctx: Context, event: TriggeredEvent, imageBytes: ByteArray? = null, imagePath: String? = null, htmlPath: String? = null) {
        val intent = Intent(ctx, AlertAlarmActivity::class.java).apply {
            putExtra("pair", event.pair)
            putExtra("target", event.target)
            putExtra("note", event.note)
            putExtra("imagePath", imagePath)
            putExtra("htmlPath", htmlPath)
            putExtra("htmlB64", event.htmlB64)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            ctx, event.id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Dedicated stop action: silences the alarm instead of just opening the app.
        val stopPi = PendingIntent.getBroadcast(
            ctx, event.id.hashCode() + 1, Intent(ctx, StopReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val nm = ctx.getSystemService(NotificationManager::class.java)
        // Same PNG Telegram/Bale receive, shown big in the notification when available.
        val bigPicture = try {
            imageBytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
        } catch (_: Exception) { null }
        val builder = NotificationCompat.Builder(ctx, PriceAlertApp.CHANNEL_ALARM)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Price Alert: ${event.pair}")
            .setContentText("${event.target} — ${event.note.ifEmpty { "triggered" }}")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(pi, true)
            .setAutoCancel(false)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi)
        if (bigPicture != null) {
            builder.setStyle(NotificationCompat.BigPictureStyle().bigPicture(bigPicture).bigLargeIcon(null as android.graphics.Bitmap?))
        }
        nm.notify(event.id.hashCode(), builder.build())
    }
}
