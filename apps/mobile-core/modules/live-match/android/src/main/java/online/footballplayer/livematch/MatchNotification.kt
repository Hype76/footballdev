package online.footballplayer.livematch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import java.io.ByteArrayOutputStream
import java.net.URL
import javax.net.ssl.HttpsURLConnection

internal data class MatchNotificationState(
  val homeName: String,
  val awayName: String,
  val homeScore: Int,
  val awayScore: Int,
  val phase: String,
  val running: Boolean,
  val elapsedSeconds: Int?,
  val sampledAtMs: Long,
  val homeShootoutScore: Int? = null,
  val awayShootoutScore: Int? = null,
  val appRole: String,
  val badgeUrl: String?,
)

internal object MatchNotification {
  private const val channelId = "live_match_v1"
  private var cachedBadgeUrl: String? = null
  private var cachedBadge: Bitmap? = null

  fun render(context: Context, state: MatchNotificationState, intent: PendingIntent): Notification {
    require(state.homeName.length <= 60 && state.awayName.length <= 60 && state.phase.length <= 60)
    require(state.homeScore >= 0 && state.awayScore >= 0 && (state.elapsedSeconds == null || state.elapsedSeconds >= 0))
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(channelId, "Live match", NotificationManager.IMPORTANCE_LOW))
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, channelId) else Notification.Builder(context)
    val shootout = if (state.homeShootoutScore != null && state.awayShootoutScore != null) {
      " | Penalties ${state.homeShootoutScore} - ${state.awayShootoutScore}"
    } else ""
    builder.setSmallIcon(context.applicationInfo.icon)
      .setColor(if (state.appRole == "parent") Color.rgb(0, 76, 140) else Color.BLACK)
      .setContentTitle("${state.homeName} ${state.homeScore} - ${state.awayScore} ${state.awayName}")
      .setContentText("${state.phase}$shootout")
      .setContentIntent(intent)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
    loadBadge(state.badgeUrl)?.let { builder.setLargeIcon(it) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) builder.setTimeoutAfter(300000L)
    if (state.running && state.elapsedSeconds != null) {
      builder.setWhen(state.sampledAtMs - state.elapsedSeconds * 1000L).setShowWhen(true).setUsesChronometer(true)
    } else {
      builder.setShowWhen(false)
      if (state.elapsedSeconds != null) {
        val minutes = state.elapsedSeconds / 60
        val seconds = state.elapsedSeconds % 60
        builder.setContentText("${state.phase}$shootout | $minutes:${seconds.toString().padStart(2, '0')}")
      }
    }
    return builder.build()
  }

  @Synchronized private fun loadBadge(value: String?): Bitmap? {
    if (value.isNullOrBlank()) return null
    if (value == cachedBadgeUrl) return cachedBadge
    val url = try { URL(value) } catch (_: Exception) { return null }
    if (url.protocol != "https") return null
    return try {
      val connection = url.openConnection() as HttpsURLConnection
      connection.connectTimeout = 3000
      connection.readTimeout = 3000
      try {
        if (connection.responseCode != 200 || connection.contentLength > 1_000_000) return null
        val output = ByteArrayOutputStream()
        connection.inputStream.use { stream ->
          val chunk = ByteArray(8192)
          while (true) {
            val count = stream.read(chunk)
            if (count < 0) break
            if (output.size() + count > 1_000_000) return null
            output.write(chunk, 0, count)
          }
        }
        val bytes = output.toByteArray()
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 4096 || bounds.outHeight > 4096) return null
        val sample = (maxOf(bounds.outWidth, bounds.outHeight) / 64).coerceAtLeast(1)
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
        Bitmap.createScaledBitmap(bitmap, 64, 64, true).also {
          cachedBadgeUrl = value
          cachedBadge = it
        }
      } finally { connection.disconnect() }
    } catch (_: Exception) { null }
  }
}
