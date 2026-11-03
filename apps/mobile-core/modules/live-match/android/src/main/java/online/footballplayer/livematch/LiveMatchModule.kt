package online.footballplayer.livematch

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LiveMatchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FootballPlayerLiveMatch")

    AsyncFunction("showAsync") { matchId: String, value: Map<String, Any?> ->
      require(matchId.matches(Regex("^[0-9a-fA-F-]{36}$")))
      val context = appContext.reactContext ?: throw IllegalStateException("Live match context unavailable")
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: throw IllegalStateException("App launch unavailable")
      intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
      val pending = PendingIntent.getActivity(context, matchId.hashCode(), intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val elapsed = (value["elapsedSeconds"] as? Number)?.toInt()
      val state = MatchNotificationState(
        homeName = value["homeName"] as? String ?: throw IllegalArgumentException("Home name missing"),
        awayName = value["awayName"] as? String ?: throw IllegalArgumentException("Away name missing"),
        homeScore = (value["homeScore"] as? Number)?.toInt() ?: throw IllegalArgumentException("Home score missing"),
        awayScore = (value["awayScore"] as? Number)?.toInt() ?: throw IllegalArgumentException("Away score missing"),
        phase = value["phase"] as? String ?: throw IllegalArgumentException("Phase missing"),
        running = value["running"] == true,
        elapsedSeconds = elapsed,
        sampledAtMs = System.currentTimeMillis(),
        homeShootoutScore = (value["homeShootoutScore"] as? Number)?.toInt(),
        awayShootoutScore = (value["awayShootoutScore"] as? Number)?.toInt(),
        homeYellowCards = (value["homeYellowCards"] as? Number)?.toInt() ?: 0,
        homeRedCards = (value["homeRedCards"] as? Number)?.toInt() ?: 0,
        awayYellowCards = (value["awayYellowCards"] as? Number)?.toInt() ?: 0,
        awayRedCards = (value["awayRedCards"] as? Number)?.toInt() ?: 0,
        appRole = value["appRole"] as? String ?: "coach",
        badgeUrl = value["badgeUrl"] as? String,
        clubIsHome = value["clubIsHome"] != false,
        ended = value["ended"] == true,
      )
      val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
      if (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
        manager.notify(matchId.hashCode(), MatchNotification.render(context, state, pending))
      }
    }

    AsyncFunction("hideAsync") { matchId: String ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
      manager.cancel(matchId.hashCode())
    }
  }
}
