package com.pricealert.sound

import android.content.Context
import android.content.SharedPreferences

object Prefs {
    private const val FILE = "price_alert_prefs"

    fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    var Context.serverUrl: String
        get() = prefs(this).getString("server_url", "https://your-worker.workers.dev") ?: ""
        set(v) = prefs(this).edit().putString("server_url", v.trim().trimEnd('/')).apply()

    var Context.basicUser: String
        get() = prefs(this).getString("basic_user", "") ?: ""
        set(v) = prefs(this).edit().putString("basic_user", v).apply()

    var Context.basicPass: String
        get() = prefs(this).getString("basic_pass", "") ?: ""
        set(v) = prefs(this).edit().putString("basic_pass", v).apply()

    var Context.pollSeconds: Int
        get() = prefs(this).getInt("poll_seconds", 30).coerceIn(15, 300)
        set(v) = prefs(this).edit().putInt("poll_seconds", v).apply()

    var Context.monitoring: Boolean
        get() = prefs(this).getBoolean("monitoring", false)
        set(v) = prefs(this).edit().putBoolean("monitoring", v).apply()

    var Context.lastSeen: String
        get() = prefs(this).getString("last_seen", "") ?: ""
        set(v) = prefs(this).edit().putString("last_seen", v).apply()

    var Context.seenIds: MutableSet<String>
        get() = prefs(this).getStringSet("seen_ids", emptySet())?.toMutableSet() ?: mutableSetOf()
        set(v) {
            // Keep only the latest 100 ids.
            prefs(this).edit().putStringSet("seen_ids", v.toList().takeLast(100).toSet()).apply()
        }
}
