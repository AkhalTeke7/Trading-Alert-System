package com.pricealert.sound

import android.app.NotificationManager
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

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
        try {
            val path = intent.getStringExtra("imagePath")
            if (!path.isNullOrEmpty()) {
                val bmp = BitmapFactory.decodeFile(path)
                if (bmp != null) {
                    imageView.setImageBitmap(bmp)
                    imageHint.visibility = View.VISIBLE
                } else {
                    imageView.visibility = View.GONE
                    imageHint.text = "◇ IMAGE FAILED TO LOAD — OPEN /api/alert-image IN BROWSER TO DIAGNOSE"
                    imageHint.visibility = View.VISIBLE
                }
            } else {
                imageView.visibility = View.GONE
                imageHint.text = "◇ NO IMAGE — SERVER /api/alert-image UNREACHABLE?"
                imageHint.visibility = View.VISIBLE
            }
        } catch (_: Exception) {
            imageView.visibility = View.GONE
        }

        findViewById<Button>(R.id.stopBtn).setOnClickListener {
            AlarmPlayer.stop(this)
            getSystemService(NotificationManager::class.java).cancelAll()
            finish()
        }
    }

    override fun onDestroy() {
        // Keep ringing until the user presses Stop (service keeps the loop).
        super.onDestroy()
    }
}
