import ActivityKit
import ExpoModulesCore
import Foundation
import UIKit

public class ReactNativeWidgetExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReactNativeWidgetExtension")

    OnCreate {
      guard #available(iOS 17.2, *) else { return }
      Task {
        for activity in Activity<MatchActivityAttributes>.activities {
          Task { await Self.observeRemoteActivity(activity) }
        }
        for await activity in Activity<MatchActivityAttributes>.activityUpdates {
          Task { await Self.observeRemoteActivity(activity) }
        }
      }
    }

    Function("activitiesEnabled") { () -> Bool in
      if #available(iOS 16.2, *) { return ActivityAuthorizationInfo().areActivitiesEnabled }
      return false
    }

    Function("getPushToStartToken") { () -> String? in
      guard #available(iOS 17.2, *), ActivityAuthorizationInfo().areActivitiesEnabled,
            let token = Activity<MatchActivityAttributes>.pushToStartToken else { return nil }
      return token.map { String(format: "%02x", $0) }.joined()
    }

    AsyncFunction("getMatchBadgeData") { (url: String) async -> String? in
      return await Self.badgeData(url)?.base64EncodedString()
    }

    Function("getMatchActivityTokens") { () -> [[String: String]] in
      guard #available(iOS 16.2, *) else { return [] }
      return Activity<MatchActivityAttributes>.activities.map { activity in
        let token = activity.pushToken.map { $0.map { String(format: "%02x", $0) }.joined() } ?? ""
        return ["key": activity.attributes.activityKey, "id": activity.id, "token": token,
          "followId": activity.attributes.followId ?? ""]
      }
    }

    AsyncFunction("startMatchActivity") { (key: String, input: [String: Any]) async throws -> String in
      guard #available(iOS 16.2, *) else { throw NSError(domain: "LiveMatch", code: 1) }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { throw NSError(domain: "LiveMatch", code: 2) }
      guard let state = Self.parse(input) else { throw NSError(domain: "LiveMatch", code: 3) }
      let badgeData = await Self.badgeData(input["badgeUrl"] as? String)
      let attributes = MatchActivityAttributes(activityKey: key, followId: nil, handoffToken: nil, badgeData: badgeData,
        clubIsHome: input["clubIsHome"] as? Bool ?? true)
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

  @available(iOS 17.2, *)
  private static func observeRemoteActivity(_ activity: Activity<MatchActivityAttributes>) async {
    guard let followId = activity.attributes.followId,
          let handoffToken = activity.attributes.handoffToken else { return }
    if let token = activity.pushToken {
      await sendRemoteToken(followId, handoffToken, token)
    }
    for await token in activity.pushTokenUpdates {
      await sendRemoteToken(followId, handoffToken, token)
    }
  }

  private static func sendRemoteToken(_ followId: String, _ handoffToken: String, _ token: Data) async {
    guard let url = URL(string: "https://footballplayer.online/.netlify/functions/live-activity-token-handoff") else { return }
    let payload = ["followId": followId, "handoffToken": handoffToken,
      "activityToken": token.map { String(format: "%02x", $0) }.joined()]
    guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
    for attempt in 0..<3 {
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.httpBody = body
      request.timeoutInterval = 6
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      if let (_, response) = try? await URLSession.shared.data(for: request),
         (response as? HTTPURLResponse)?.statusCode == 200 { return }
      if attempt < 2 { try? await Task.sleep(nanoseconds: UInt64(attempt + 1) * 1_000_000_000) }
    }
  }

  private static func badgeData(_ value: String?) async -> Data? {
    guard let value, let url = URL(string: value), url.scheme == "https" else { return nil }
    do {
      var request = URLRequest(url: url)
      request.timeoutInterval = 5
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse, http.statusCode == 200,
            http.url?.scheme == "https", data.count <= 2_000_000,
            let image = UIImage(data: data), image.size.width <= 4096, image.size.height <= 4096 else { return nil }
      let target = CGSize(width: 32, height: 32)
      let small = UIGraphicsImageRenderer(size: target).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: target))
        image.draw(in: CGRect(origin: .zero, size: target))
      }
      guard let encoded = small.jpegData(compressionQuality: 0.55), encoded.count <= 2_000 else { return nil }
      return encoded
    } catch { return nil }
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
      awayShootoutScore: input["awayShootoutScore"] as? Int,
      homeYellowCards: input["homeYellowCards"] as? Int,
      homeRedCards: input["homeRedCards"] as? Int,
      awayYellowCards: input["awayYellowCards"] as? Int,
      awayRedCards: input["awayRedCards"] as? Int)
  }
}
