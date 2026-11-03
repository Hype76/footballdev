import ActivityKit
import ExpoModulesCore
import Foundation

public class ReactNativeWidgetExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReactNativeWidgetExtension")

    Function("activitiesEnabled") { () -> Bool in
      if #available(iOS 16.2, *) { return ActivityAuthorizationInfo().areActivitiesEnabled }
      return false
    }

    Function("startMatchActivity") { (key: String, input: [String: Any]) -> String in
      guard #available(iOS 16.2, *) else { throw NSError(domain: "LiveMatch", code: 1) }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { throw NSError(domain: "LiveMatch", code: 2) }
      guard let state = Self.parse(input) else { throw NSError(domain: "LiveMatch", code: 3) }
      let attributes = MatchActivityAttributes(activityKey: key)
      let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(4 * 60 * 60))
      let activity = try Activity.request(attributes: attributes, content: content, pushType: .token)
      return activity.id
    }

    Function("getMatchActivityToken") { (id: String) -> String? in
      guard #available(iOS 16.2, *) else { return nil }
      guard let activity = Activity<MatchActivityAttributes>.activities.first(where: { $0.id == id }),
            let token = activity.pushToken else { return nil }
      return token.map { String(format: "%02x", $0) }.joined()
    }

    AsyncFunction("endMatchActivity") { (id: String) async in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = Activity<MatchActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
      await activity.end(nil, dismissalPolicy: .immediate)
    }

    AsyncFunction("endAllMatchActivities") { () async in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<MatchActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  @available(iOS 16.2, *)
  private static func parse(_ input: [String: Any]) -> MatchActivityAttributes.ContentState? {
    guard let homeName = input["homeName"] as? String, homeName.count <= 60,
          let awayName = input["awayName"] as? String, awayName.count <= 60,
          let homeScore = input["homeScore"] as? Int, homeScore >= 0,
          let awayScore = input["awayScore"] as? Int, awayScore >= 0,
          let phase = input["phase"] as? String, phase.count <= 60,
          let running = input["running"] as? Bool,
          let sampledAtMs = input["sampledAtMs"] as? Double else { return nil }
    let elapsedSeconds = input["elapsedSeconds"] as? Int
    return MatchActivityAttributes.ContentState(homeName: homeName, awayName: awayName,
      homeScore: homeScore, awayScore: awayScore, phase: phase, running: running,
      elapsedSeconds: elapsedSeconds, sampledAtMs: sampledAtMs,
      homeShootoutScore: input["homeShootoutScore"] as? Int,
      awayShootoutScore: input["awayShootoutScore"] as? Int)
  }
}
