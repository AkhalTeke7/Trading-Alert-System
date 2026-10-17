package com.pricealert.sound

import android.app.NotificationManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import kotlin.concurrent.thread

class AlertAlarmActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_alarm)

        val pair = intent.getStringExtra("pair") ?: "Price Alert"
        val target = intent.getStringExtra("target") ?: ""
        val note = intent.getStringExtra("note") ?: ""

        findViewById<TextView>(R.id.alarmTitle).text = "Price Alert: $pair"
        findViewById<TextView>(R.id.alarmBody).text = "$target — ${note.ifEmpty { "triggered" }}"

        // Exact same PNG that Telegram/Bale receive, saved by the monitor service.
        val imageView = findViewById<ImageView>(R.id.alarmImage)
        val imageHint = findViewById<TextView>(R.id.imageHint)
        val path = intent.getStringExtra("imagePath")
        val existingBmp = try {
            if (!path.isNullOrEmpty()) BitmapFactory.decodeFile(path) else null
        } catch (_: Exception) {
            null
        }

        if (existingBmp != null) {
            imageView.setImageBitmap(existingBmp)
            imageView.visibility = View.VISIBLE
            imageHint.text = "◇ SAME CARD AS TELEGRAM / BALE"
            imageHint.visibility = View.VISIBLE
        } else {
            // Show a local dossier card immediately so the alarm screen is never blank,
            // and retry fetching /api/alert-image in the background.
            imageView.setImageBitmap(renderLocalAlertCard(pair, target, note))
            imageView.visibility = View.VISIBLE
            imageHint.text = "◇ LOADING CHART CARD FROM /api/alert-image…"
            imageHint.visibility = View.VISIBLE

            thread {
                try {
                    val p = Prefs.prefs(this)
                    val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
                    val u = p.getString("basic_user", "") ?: ""
                    val pw = p.getString("basic_pass", "") ?: ""
                    if (url.isNotEmpty()) {
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
                        val reason = Api.lastImageError.ifEmpty { "SERVER /api/alert-image UNREACHABLE" }
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

        // Outer card
        paint.style = Paint.Style.FILL
        paint.color = panel
        c.drawRect(24f, 64f, w - 24f, h - 54f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = line
        c.drawRect(24f, 64f, w - 24f, h - 54f, paint)

        // Header text
        paint.style = Paint.Style.FILL
        paint.typeface = Typeface.MONOSPACE
        paint.textSize = 20f
        paint.color = bone
        c.drawText("PRICE-ALERT · MARKETS · ALERT", 28f, 42f, paint)

        // Card header
        paint.textSize = 18f
        paint.color = muted
        val safeTarget = target.ifEmpty { "TRIGGERED" }
        c.drawText("01 // ${pair.uppercase()} · TARGET $safeTarget", 48f, 104f, paint)

        // Inner chart box
        paint.color = bg
        c.drawRect(48f, 124f, w - 48f, h - 140f, paint)
        paint.style = Paint.Style.STROKE
        paint.color = line
        c.drawRect(48f, 124f, w - 48f, h - 140f, paint)

        // Accent bar & pair/target callout
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

        // Bottom pill bar
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
        // Keep ringing until the user presses Stop (service keeps the loop).
        super.onDestroy()
    }
}
