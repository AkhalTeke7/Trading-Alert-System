package com.pricealert.sound

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Notification "Stop" action: actually silences the alarm, unlike opening the app. */
class StopReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        AlarmPlayer.stop(context)
        try {
            context.getSystemService(NotificationManager::class.java).cancelAll()
        } catch (_: Exception) {}
    }
}
