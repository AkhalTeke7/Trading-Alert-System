package com.pricealert.sound

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class PriceAlertApp : Application() {
    companion object {
        const val CHANNEL_MONITOR = "monitor"
        const val CHANNEL_ALARM = "alarm"
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_MONITOR, "Price monitoring", NotificationManager.IMPORTANCE_LOW)
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ALARM, "Price alarms", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Loud sound when a website alert triggers"
                    enableVibration(true)
                }
            )
        }
    }
}
