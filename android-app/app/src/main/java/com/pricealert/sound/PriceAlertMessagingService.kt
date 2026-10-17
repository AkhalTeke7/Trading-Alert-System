package com.pricealert.sound

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Optional FCM path. Works only if you add google-services.json and the
 * google-services Gradle plugin. Polling via AlertMonitorService works without it.
 * FCM payload is small (no htmlB64 — 4KB limit); full card HTML is fetched via /api/triggered polling.
 */
class PriceAlertMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val channel = data["channel"] ?: ""
        if (channel.isNotEmpty() && channel != "Phone" && channel != "App") return
        val eventId = data["eventId"] ?: message.messageId ?: System.currentTimeMillis().toString()
        var pair = data["pair"] ?: data["title"] ?: "Price Alert"
        var target = data["target"] ?: ""
        var note = data["note"] ?: (data["body"] ?: "")
        var htmlB64 = data["htmlB64"] ?: ""
        // If FCM didn't carry html (size limit), try to fetch the full event via polling endpoint
        if (htmlB64.isEmpty()) {
            try {
                val p = Prefs.prefs(this)
                val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
                val u = p.getString("basic_user", "") ?: ""
                val pw = p.getString("basic_pass", "") ?: ""
                if (url.isNotEmpty()) {
                    val events = Api.fetchTriggered(url, u, pw, "")
                    events.find { it.id == eventId }?.let {
                        pair = it.pair.ifEmpty { pair }
                        target = it.target.ifEmpty { target }
                        note = it.note.ifEmpty { note }
                        htmlB64 = it.htmlB64
                    }
                }
            } catch (_: Exception) {}
        }
        val event = TriggeredEvent(
            id = eventId,
            pair = pair,
            target = target,
            note = note,
            triggeredAt = "",
            channel = channel,
            htmlB64 = htmlB64,
        )
        val p = Prefs.prefs(this)
        val seen = (p.getStringSet("seen_ids", emptySet()) ?: emptySet()).toMutableSet()
        if (seen.contains(event.id)) return
        var bytes: ByteArray? = null
        var path: String? = null
        var htmlPath: String? = null
        if (htmlB64.isNotEmpty()) {
            try {
                val htmlBytes = android.util.Base64.decode(htmlB64, android.util.Base64.DEFAULT)
                val f = java.io.File(cacheDir, "alert_fcm_${event.id}.html")
                f.writeBytes(htmlBytes)
                htmlPath = f.absolutePath
            } catch (_: Exception) {}
        }
        if (htmlPath == null) {
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
        }
        seen.add(event.id)
        p.edit().putStringSet("seen_ids", seen.toList().takeLast(100).toSet()).apply()
        android.os.Handler(mainLooper).post {
            AlarmPlayer.ring(this, event, bytes, path, htmlPath)
        }
    }

    override fun onNewToken(token: String) {
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
