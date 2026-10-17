package com.pricealert.sound

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Bundle
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import kotlin.concurrent.thread

class AlertAlarmActivity : AppCompatActivity() {
    private var alarmWebView: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_alarm)

        val pair = intent.getStringExtra("pair") ?: "Price Alert"
        val target = intent.getStringExtra("target") ?: ""
        val note = intent.getStringExtra("note") ?: ""

        findViewById<TextView>(R.id.alarmTitle).text = "Price Alert: $pair"
        findViewById<TextView>(R.id.alarmBody).text = "$target — ${note.ifEmpty { "triggered" }}"

        val imageView = findViewById<ImageView>(R.id.alarmImage)
        val webView = findViewById<WebView>(R.id.alarmWebView)
        val imageHint = findViewById<TextView>(R.id.imageHint)
        alarmWebView = webView

        // Phone path: htmlB64 rendered on-device (avoids Cloudflare Browser limits).
        // Telegram/Bale still use Cloudflare-rendered PNG (imagePath).
        val htmlPath = intent.getStringExtra("htmlPath")
        val htmlB64 = intent.getStringExtra("htmlB64")
        val htmlBytes: ByteArray? = when {
            !htmlPath.isNullOrEmpty() -> try { File(htmlPath).readBytes() } catch (_: Exception) { null }
            !htmlB64.isNullOrEmpty() -> try { android.util.Base64.decode(htmlB64, android.util.Base64.DEFAULT) } catch (_: Exception) { null }
            else -> null
        }

        if (htmlBytes != null && htmlBytes.isNotEmpty()) {
            // Device-side HTML render — same source Telegram/Bale get as PNG on Cloudflare,
            // but rendered locally so Phone never touches Cloudflare Browser.
            val html = try { String(htmlBytes, Charsets.UTF_8) } catch (_: Exception) { null }
            if (html != null && html.contains("<html", ignoreCase = true)) {
                imageView.visibility = View.GONE
                webView.visibility = View.VISIBLE
                imageHint.text = "◇ LIVE 15m CHART · RENDERED ON DEVICE"
                imageHint.visibility = View.VISIBLE
                webView.settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowFileAccess = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                    useWideViewPort = true
                    loadWithOverviewMode = true
                    builtInZoomControls = false
                }
                webView.webViewClient = object : WebViewClient() {}
                // Use base URL so TradingView widget (s3.tradingview.com) loads correctly
                webView.loadDataWithBaseURL("https://price-alert.local/", html, "text/html", "utf-8", null)
                findViewById<Button>(R.id.stopBtn).setOnClickListener {
                    try { webView.stopLoading() } catch (_: Exception) {}
                    AlarmPlayer.stop(this)
                    getSystemService(NotificationManager::class.java).cancelAll()
                    finish()
                }
                return
            }
        }

        // Fallback: PNG (Telegram/Bale card) or local canvas card
        webView.visibility = View.GONE
        val path = intent.getStringExtra("imagePath")
        val existingBmp = try {
            if (!path.isNullOrEmpty()) BitmapFactory.decodeFile(path) else null
        } catch (_: Exception) { null }

        if (existingBmp != null) {
            imageView.setImageBitmap(existingBmp)
            imageView.visibility = View.VISIBLE
            imageHint.text = "◇ SAME CARD AS TELEGRAM / BALE"
            imageHint.visibility = View.VISIBLE
        } else {
            imageView.setImageBitmap(renderLocalAlertCard(pair, target, note))
            imageView.visibility = View.VISIBLE
            imageHint.text = "◇ LOADING CHART CARD…"
            imageHint.visibility = View.VISIBLE

            thread {
                try {
                    val p = Prefs.prefs(this)
                    val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
                    val u = p.getString("basic_user", "") ?: ""
                    val pw = p.getString("basic_pass", "") ?: ""
                    if (url.isNotEmpty()) {
                        // Try htmlB64 polling first (device render), then PNG
                        try {
                            val events = Api.fetchTriggered(url, u, pw, "")
                            val match = events.find { it.pair == pair && it.target == target && it.htmlB64.isNotEmpty() }
                            if (match != null && match.htmlB64.isNotEmpty()) {
                                val hb = android.util.Base64.decode(match.htmlB64, android.util.Base64.DEFAULT)
                                val h = String(hb, Charsets.UTF_8)
                                if (h.contains("<html", ignoreCase = true)) {
                                    runOnUiThread {
                                        if (!isDestroyed && !isFinishing) {
                                            imageView.visibility = View.GONE
                                            webView.visibility = View.VISIBLE
                                            imageHint.text = "◇ LIVE 15m CHART · RENDERED ON DEVICE"
                                            webView.settings.javaScriptEnabled = true
                                            webView.settings.domStorageEnabled = true
                                            webView.loadDataWithBaseURL("https://price-alert.local/", h, "text/html", "utf-8", null)
                                        }
                                    }
                                    return@thread
                                }
                            }
                        } catch (_: Exception) {}
                        val imgUrl = Api.alertImageUrl(url, pair, target, note)
                        val bytes = Api.downloadImage(imgUrl, u, pw)
                        if (bytes != null) {
                            val f = File(cacheDir, "alert_retry_${System.currentTimeMillis()}.png")
                            f.writeBytes(bytes)
                            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                            if (bmp != null) {
                                runOnUiThread {
                                    if (!isDestroyed && !isFinishing) {
                                        imageView.setImageBitmap(bmp)
                                        imageView.visibility = View.VISIBLE
                                        webView.visibility = View.GONE
                                        imageHint.text = "◇ SAME CARD AS TELEGRAM / BALE"
                                    }
                                }
                                return@thread
                            }
                        }
                    }
                } catch (_: Exception) {}
                runOnUiThread {
                    if (!isDestroyed && !isFinishing) {
                        val reason = Api.lastImageError.ifEmpty { "OFFLINE · LOCAL CARD" }
                        imageHint.text = "◇ LOCAL CARD — $reason"
                    }
                }
            }
        }

        findViewById<Button>(R.id.stopBtn).setOnClickListener {
            AlarmPlayer.stop(this)
            getSystemService(NotificationManager::class.java).cancelAll()
            finish()
        }
    }

    private fun renderLocalAlertCard(pair: String, target: String, note: String): Bitmap {
        val w = 900
        val h = 600
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        val bg = Color.rgb(10, 10, 10)
        val panel = Color.rgb(16, 16, 16)
        val bone = Color.rgb(233, 228, 214)
        val muted = Color.rgb(139, 135, 123)
        val line = Color.rgb(46, 45, 42)
        val red = Color.rgb(209, 59, 47)
        val green = Color.rgb(59, 196, 122)

        c.drawColor(bg)
        paint.style = Paint.Style.FILL
        paint.color = panel
        c.drawRect(24f, 64f, w - 24f, h - 54f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = line
        c.drawRect(24f, 64f, w - 24f, h - 54f, paint)
        paint.style = Paint.Style.FILL
        paint.typeface = Typeface.MONOSPACE
        paint.textSize = 20f
        paint.color = bone
        c.drawText("PRICE-ALERT · MARKETS · ALERT", 28f, 42f, paint)
        paint.textSize = 18f
        paint.color = muted
        val safeTarget = target.ifEmpty { "TRIGGERED" }
        c.drawText("01 // ${pair.uppercase()} · TARGET $safeTarget", 48f, 104f, paint)
        paint.color = bg
        c.drawRect(48f, 124f, w - 48f, h - 140f, paint)
        paint.style = Paint.Style.STROKE
        paint.color = line
        c.drawRect(48f, 124f, w - 48f, h - 140f, paint)
        paint.style = Paint.Style.FILL
        paint.color = red
        c.drawRect(76f, 164f, 84f, 320f, paint)
        paint.color = bone
        paint.typeface = Typeface.SERIF
        paint.textSize = 54f
        c.drawText(pair, 108f, 226f, paint)
        paint.typeface = Typeface.MONOSPACE
        paint.color = green
        paint.textSize = 36f
        c.drawText("TARGET  $safeTarget", 108f, 286f, paint)
        paint.color = muted
        paint.textSize = 22f
        val safeNote = note.ifEmpty { "Triggered" }.take(46)
        c.drawText(safeNote, 108f, 346f, paint)
        paint.color = bone
        c.drawRect(48f, h - 116f, 310f, h - 74f, paint)
        paint.color = bg
        paint.textSize = 18f
        c.drawText("TARGET ${safeTarget.take(14)}", 66f, h - 89f, paint)
        paint.color = muted
        paint.textSize = 16f
        c.drawText("MARKET PULSE / ALERTS / LIVE DATA", 28f, h - 20f, paint)
        return bmp
    }

    override fun onDestroy() {
        try { alarmWebView?.stopLoading() } catch (_: Exception) {}
        try { alarmWebView?.destroy() } catch (_: Exception) {}
        super.onDestroy()
    }
}
