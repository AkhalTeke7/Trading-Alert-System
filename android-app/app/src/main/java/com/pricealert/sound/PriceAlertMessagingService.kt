package com.pricealert.sound

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Optional FCM path. Works only if you add google-services.json and the
 * google-services Gradle plugin. Polling via AlertMonitorService works without it.
 */
class PriceAlertMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val channel = data["channel"] ?: ""
        if (channel.isNotEmpty() && channel != "Phone" && channel != "App") return
        val event = TriggeredEvent(
            id = data["eventId"] ?: message.messageId ?: System.currentTimeMillis().toString(),
            pair = data["pair"] ?: data["title"] ?: "Price Alert",
            target = data["target"] ?: "",
            note = data["note"] ?: (data["body"] ?: ""),
            triggeredAt = "",
            channel = channel,
        )
        // Dedupe with the polling path: without this, push rings now and the
        // poller rings again for the same event ~30s later ("stop does nothing").
        val p = Prefs.prefs(this)
        val seen = (p.getStringSet("seen_ids", emptySet()) ?: emptySet()).toMutableSet()
        if (seen.contains(event.id)) return
        // Try the exact card PNG too; falls back to text-only on failure.
        var bytes: ByteArray? = null
        var path: String? = null
        try {
            val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
            val u = p.getString("basic_user", "") ?: ""
            val pw = p.getString("basic_pass", "") ?: ""
            if (url.isNotEmpty()) {
                bytes = Api.downloadImage(Api.alertImageUrl(url, event.pair, event.target, event.note), u, pw)
                if (bytes != null) {
                    val f = java.io.File(cacheDir, "alert_${event.id}.png")
                    f.writeBytes(bytes)
                    path = f.absolutePath
                }
            }
        } catch (_: Exception) {}
        seen.add(event.id)
        p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
        android.os.Handler(mainLooper).post {
            AlarmPlayer.ring(this, event, bytes, path)
        }
    }

    override fun onNewToken(token: String) {
        // Push path: upload the fresh token so the server can reach this phone instantly.
        // Polling keeps working as fallback if this fails or Play Services is absent.
        try {
            val p = Prefs.prefs(this)
            val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
            if (url.isEmpty()) return
            val u = p.getString("basic_user", "") ?: ""
            val pw = p.getString("basic_pass", "") ?: ""
            Thread { try { Api.registerDevice(url, u, pw, token) } catch (_: Exception) {} }.start()
        } catch (_: Exception) {}
    }
}
