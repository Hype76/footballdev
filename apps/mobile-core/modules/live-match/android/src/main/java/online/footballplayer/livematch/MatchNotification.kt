package online.footballplayer.livematch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

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
)

internal object MatchNotification {
  private const val channelId = "live_match_v1"

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
      .setContentTitle("${state.homeName} ${state.homeScore} - ${state.awayScore} ${state.awayName}")
      .setContentText("${state.phase}$shootout")
      .setContentIntent(intent)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
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
}
