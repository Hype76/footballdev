import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct MatchActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let homeName: String
    let awayName: String
    let homeScore: Int
    let awayScore: Int
    let phase: String
    let running: Bool
    let elapsedSeconds: Int?
    let sampledAtMs: Double
    let homeShootoutScore: Int?
    let awayShootoutScore: Int?
  }

  // An opaque activity identifier does not expose a child or account identity.
  let activityKey: String
}
