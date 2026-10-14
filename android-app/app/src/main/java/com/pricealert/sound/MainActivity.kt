package com.pricealert.sound

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var urlInput: EditText
    private lateinit var userInput: EditText
    private lateinit var passInput: EditText
    private lateinit var intervalInput: EditText
    private lateinit var statusText: TextView
    private lateinit var statusPill: TextView
    private lateinit var statusDot: View
    private lateinit var priceGold: TextView
    private lateinit var priceEur: TextView
    private lateinit var priceBtc: TextView
    private lateinit var priceGbp: TextView
    private lateinit var triggeredList: LinearLayout
    private lateinit var triggeredCount: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        urlInput = findViewById(R.id.urlInput)
        userInput = findViewById(R.id.userInput)
        passInput = findViewById(R.id.passInput)
        intervalInput = findViewById(R.id.intervalInput)
        statusText = findViewById(R.id.statusText)
        statusPill = findViewById(R.id.statusPill)
        statusDot = findViewById(R.id.statusDot)
        priceGold = findViewById(R.id.priceGold)
        priceEur = findViewById(R.id.priceEur)
        priceBtc = findViewById(R.id.priceBtc)
        priceGbp = findViewById(R.id.priceGbp)
        triggeredList = findViewById(R.id.triggeredList)
        triggeredCount = findViewById(R.id.triggeredCount)

        val p = Prefs.prefs(this)
        urlInput.setText(p.getString("server_url", ""))
        userInput.setText(p.getString("basic_user", ""))
        passInput.setText(p.getString("basic_pass", ""))
        intervalInput.setText((p.getInt("poll_seconds", 30)).toString())

        findViewById<Button>(R.id.saveBtn).setOnClickListener { save(); refreshMarketData(); registerPushToken() }
        findViewById<Button>(R.id.startBtn).setOnClickListener { save(); startMonitor(); registerPushToken() }
        findViewById<Button>(R.id.stopBtn).setOnClickListener { stopMonitor() }
        findViewById<Button>(R.id.testBtn).setOnClickListener { sendTest() }
        findViewById<Button>(R.id.refreshBtn).setOnClickListener { refreshMarketData() }

        askNotificationPermission()
        refreshStatus()
        registerPushToken()
        refreshMarketData()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        refreshMarketData()
        registerPushToken()
    }

    private fun save() {
        val url = urlInput.text.toString().trim().trimEnd('/')
        Prefs.prefs(this).edit()
            .putString("server_url", url)
            .putString("basic_user", userInput.text.toString().trim())
            .putString("basic_pass", passInput.text.toString())
            .putInt("poll_seconds", intervalInput.text.toString().toIntOrNull()?.coerceIn(15, 300) ?: 30)
            .apply()
        Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        refreshStatus()
    }

    private fun startMonitor() {
        val intent = Intent(this, AlertMonitorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        Prefs.prefs(this).edit().putBoolean("monitoring", true).apply()
        refreshStatus()
    }

    private fun stopMonitor() {
        stopService(Intent(this, AlertMonitorService::class.java))
        AlarmPlayer.stop(this)
        Prefs.prefs(this).edit().putBoolean("monitoring", false).apply()
        refreshStatus()
    }

    private fun sendTest() {
        save()
        val p = Prefs.prefs(this)
        val url = p.getString("server_url", "") ?: ""
        val u = p.getString("basic_user", "") ?: ""
        val pw = p.getString("basic_pass", "") ?: ""
        if (url.isEmpty()) {
            Toast.makeText(this, "Enter server URL first", Toast.LENGTH_LONG).show()
            return
        }
        statusText.text = "STATUS · SENDING TEST…"
        thread {
            try {
                Api.postTest(url, u, pw)
                runOnUiThread {
                    Toast.makeText(this, "Test sent, listen for alarm", Toast.LENGTH_LONG).show()
                }
                Thread.sleep(5000)
                refreshMarketData()
            } catch (e: Exception) {
                runOnUiThread {
                    statusText.text = "STATUS · TEST FAILED"
                    Toast.makeText(this, "Test failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /** Live prices + triggered history, same data the website shows. */
    private fun refreshMarketData() {
        thread {
            val p = Prefs.prefs(this)
            val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
            val u = p.getString("basic_user", "") ?: ""
            val pw = p.getString("basic_pass", "") ?: ""
            if (url.isEmpty()) {
                runOnUiThread {
                    priceGold.text = "— · SET URL"
                    priceEur.text = "— · SET URL"
                    priceBtc.text = "BTC — · SET URL"
                    priceGbp.text = "GBP — · SET URL"
                }
                return@thread
            }
            try {
                val prices = Api.fetchPrices(url, u, pw)
                runOnUiThread {
                    priceGold.text = "${prices["OANDA:XAUUSD"] ?: "—"} · LIVE"
                    priceEur.text = "${prices["FX_IDC:EURUSD"] ?: "—"} · LIVE"
                    priceBtc.text = "BTC ${prices["BITSTAMP:BTCUSD"] ?: "—"} · LIVE"
                    priceGbp.text = "GBP ${prices["FX_IDC:GBPUSD"] ?: "—"} · LIVE"
                    statusPill.text = "ONLINE"
                    statusDot.setBackgroundResource(R.drawable.dot_green)
                }
            } catch (_: Exception) {
                runOnUiThread {
                    priceGold.text = "— · OFFLINE"
                    priceEur.text = "— · OFFLINE"
                    priceBtc.text = "BTC — · OFFLINE"
                    priceGbp.text = "GBP — · OFFLINE"
                    statusPill.text = "OFFLINE"
                    statusDot.setBackgroundResource(R.drawable.dot_red)
                }
            }
            try {
                val events = Api.fetchTriggered(url, u, pw, "")
                runOnUiThread { renderHistory(events) }
            } catch (_: Exception) {
                runOnUiThread { renderHistory(emptyList()) }
            }
            runOnUiThread { refreshStatus() }
        }
    }

    private fun renderHistory(events: List<TriggeredEvent>) {
        triggeredList.removeAllViews()
        val recent = events.takeLast(3).reversed()
        triggeredCount.text = "${events.size} EVENTS"
        if (recent.isEmpty()) {
            val empty = TextView(this).apply {
                text = "NO EVENTS YET"
                setTextColor(getColor(R.color.pa_dim))
                typeface = android.graphics.Typeface.MONOSPACE
                textSize = 11f
            }
            triggeredList.addView(empty)
            return
        }
        val inflater = LayoutInflater.from(this)
        for (e in recent) {
            val row = inflater.inflate(R.layout.item_triggered, triggeredList, false)
            row.findViewById<TextView>(R.id.rowPair).text = e.pair.ifEmpty { "PRICE ALERT" }
            row.findViewById<TextView>(R.id.rowDetail).text =
                "${e.target} — ${e.note.ifEmpty { "triggered" }}"
            row.findViewById<TextView>(R.id.rowTime).text =
                e.triggeredAt.replace("T", " ").take(16).ifEmpty { e.id.take(8) }
            triggeredList.addView(row)
        }
    }

    /** Best-effort FCM registration: instant push, so polling becomes a cheap fallback. */
    private fun registerPushToken() {
        thread {
            // Name the exact Play Services problem first: without Play, FCM is
            // impossible on this device and polling is the only path.
            try {
                val gms = com.google.android.gms.common.GoogleApiAvailability.getInstance()
                    .isGooglePlayServicesAvailable(this)
                if (gms != com.google.android.gms.common.ConnectionResult.SUCCESS) {
                    val reason = when (gms) {
                        com.google.android.gms.common.ConnectionResult.SERVICE_MISSING -> "NO PLAY ON DEVICE"
                        com.google.android.gms.common.ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED -> "UPDATE PLAY SERVICES"
                        com.google.android.gms.common.ConnectionResult.SERVICE_DISABLED -> "PLAY SERVICES DISABLED"
                        com.google.android.gms.common.ConnectionResult.SERVICE_INVALID -> "PLAY SERVICES BROKEN"
                        else -> "NO PLAY SERVICES ($gms)"
                    }
                    savePushState(false, reason)
                    return@thread
                }
            } catch (_: Exception) {
                savePushState(false, "NO PLAY SERVICES")
                return@thread
            }
            try {
                val token = com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                    .let { task -> try { com.google.android.gms.tasks.Tasks.await(task) } catch (_: Exception) { null } }
                if (token.isNullOrEmpty()) {
                    savePushState(false, "TOKEN FAILED — RETRY")
                    return@thread
                }
                val p = Prefs.prefs(this)
                val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
                if (url.isEmpty()) {
                    savePushState(false, "NO URL")
                    return@thread
                }
                try {
                    Api.registerDevice(url, p.getString("basic_user", "") ?: "", p.getString("basic_pass", "") ?: "", token)
                } catch (e: Exception) {
                    savePushState(false, pushFailReason(e))
                    return@thread
                }
                savePushState(true, "")
            } catch (_: Exception) {
                // No Play Services / no Firebase: polling fallback covers this.
                savePushState(false, "NO PLAY SERVICES")
            }
        }
    }

    private fun savePushState(active: Boolean, error: String) {
        try {
            Prefs.prefs(this).edit().putBoolean("fcm_active", active).putString("fcm_error", error).apply()
        } catch (_: Exception) {}
        runOnUiThread { refreshStatus() }
    }

    private fun pushFailReason(e: Exception): String {
        val m = e.message ?: ""
        return when {
            "401" in m -> "HTTP 401 — CHECK USER/PASS"
            "403" in m -> "HTTP 403"
            "404" in m -> "HTTP 404 — UPDATE SERVER CODE"
            m.contains("UnknownHost", true) || m.contains("Unable to resolve", true) -> "NET — CHECK URL"
            m.contains("timed out", true) || m.contains("timeout", true) -> "TIMEOUT — CHECK URL"
            m.contains("CLEARTEXT", true) -> "HTTP BLOCKED — USE HTTPS"
            else -> "REGISTER FAILED"
        }
    }

    private fun refreshStatus() {
        val p = Prefs.prefs(this)
        val on = p.getBoolean("monitoring", false)
        val push = p.getBoolean("fcm_active", false)
        val secs = p.getInt("poll_seconds", 30)
        val pushLine = if (push) "PUSH v1.2 · ON"
        else "PUSH v1.2 · ${(p.getString("fcm_error", "") ?: "").ifEmpty { "POLLING ONLY" }}"
        statusText.text = if (on) "STATUS · MONITORING ON — EVERY ${secs}S\n$pushLine"
        else "STATUS · MONITORING OFF\n$pushLine"
        if (!::statusPill.isInitialized) return
        if (on && statusPill.text != "OFFLINE") {
            statusPill.text = "ARMED"
            statusDot.setBackgroundResource(R.drawable.dot_green)
        }
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }
}
