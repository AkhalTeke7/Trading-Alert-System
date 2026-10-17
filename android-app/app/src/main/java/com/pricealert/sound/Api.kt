package com.pricealert.sound

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class TriggeredEvent(
    val id: String,
    val pair: String,
    val target: String,
    val note: String,
    val triggeredAt: String,
    val channel: String = "",
)

object Api {
    @Volatile var lastImageError: String = ""

    fun authHeader(user: String, pass: String): String? {
        if (user.isEmpty() && pass.isEmpty()) return null
        return "Basic " + Base64.encodeToString("$user:$pass".toByteArray(), Base64.NO_WRAP)
    }

    fun fetchTriggered(serverUrl: String, user: String, pass: String, since: String): List<TriggeredEvent> {
        var url = "$serverUrl/api/triggered"
        if (since.isNotEmpty()) url += "?since=" + java.net.URLEncoder.encode(since, "UTF-8")
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            authHeader(user, pass)?.let { setRequestProperty("Authorization", it) }
        }
        val code = conn.responseCode
        if (code != 200) throw IllegalStateException("Server returned $code")
        val text = conn.inputStream.bufferedReader().readText()
        val arr = JSONArray(text)
        val out = mutableListOf<TriggeredEvent>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out += TriggeredEvent(
                id = o.optString("id"),
                pair = o.optString("pair"),
                target = o.opt("target")?.toString() ?: "",
                note = o.optString("note"),
                triggeredAt = o.optString("triggeredAt"),
                channel = o.optString("channel"),
            )
        }
        return out
    }

    fun alertImageUrl(serverUrl: String, pair: String, target: String, note: String): String {
        fun enc(v: String) = java.net.URLEncoder.encode(v, "UTF-8")
        return "$serverUrl/api/alert-image?pair=${enc(pair)}&target=${enc(target)}&note=${enc(note)}"
    }

    /** Downloads the exact Telegram/Bale card PNG. Returns null on any failure (text fallback). */
    fun downloadImage(url: String, user: String, pass: String): ByteArray? {
        return try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 20_000
                readTimeout = 30_000
                setRequestProperty("Accept", "image/png")
                authHeader(user, pass)?.let { setRequestProperty("Authorization", it) }
            }
            val code = conn.responseCode
            if (code != 200) {
                lastImageError = when (code) {
                    401, 403 -> "HTTP $code — CHECK USER/PASS"
                    404 -> "HTTP 404 — REDEPLOY SERVER FOR /api/alert-image"
                    502, 503, 504 -> "HTTP $code — SERVER RENDER FAILED (REDEPLOY WORKER)"
                    else -> "HTTP $code FROM /api/alert-image"
                }
                return null
            }
            val bytes = conn.inputStream.use { it.readBytes().takeIf { b -> b.isNotEmpty() } }
            if (bytes != null) lastImageError = "" else lastImageError = "EMPTY IMAGE RESPONSE"
            bytes
        } catch (e: Exception) {
            val msg = e.message ?: ""
            lastImageError = when {
                msg.contains("timed out", true) || msg.contains("timeout", true) -> "TIMEOUT — /api/alert-image TOO SLOW"
                msg.contains("CLEARTEXT", true) -> "HTTP BLOCKED — USE HTTPS"
                else -> "UNREACHABLE — CHECK SERVER URL"
            }
            null
        }
    }
    /** Registers this phone's FCM token so the server can push instantly (less battery than polling). */
    fun registerDevice(serverUrl: String, user: String, pass: String, pushToken: String) {
        val conn = (URL("$serverUrl/api/devices").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("Content-Type", "application/json")
            authHeader(user, pass)?.let { setRequestProperty("Authorization", it) }
        }
        val body = JSONObject().put("pushToken", pushToken).put("platform", "android").toString()
        conn.outputStream.bufferedWriter().use { it.write(body) }
        val code = conn.responseCode
        if (code !in 200..299) throw IllegalStateException("Device register returned $code")
    }

    fun fetchPrices(serverUrl: String, user: String, pass: String): Map<String, String> {
        val conn = (URL("$serverUrl/api/prices").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            authHeader(user, pass)?.let { setRequestProperty("Authorization", it) }
        }
        if (conn.responseCode != 200) throw IllegalStateException("Prices returned ${conn.responseCode}")
        val json = JSONObject(conn.inputStream.bufferedReader().readText())
        return json.keys().asSequence().associateWith { key ->
            json.optJSONObject(key)?.opt("price")?.toString() ?: "—"
        }
    }

    fun postTest(serverUrl: String, user: String, pass: String, pair: String = "Gold / USD"): JSONObject {        val conn = (URL("$serverUrl/api/test-alert").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("Content-Type", "application/json")
            authHeader(user, pass)?.let { setRequestProperty("Authorization", it) }
        }
        val body = JSONObject().put("pair", pair).put("note", "Test sound from website").toString()
        conn.outputStream.bufferedWriter().use { it.write(body) }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream).bufferedReader().readText()
        if (code !in 200..299) throw IllegalStateException("Server $code: $text")
        return JSONObject(text)
    }
}
