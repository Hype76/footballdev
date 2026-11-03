import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
private struct MatchClock: View {
  let state: MatchActivityAttributes.ContentState

  var body: some View {
    if state.running, let seconds = state.elapsedSeconds {
      Text(Date(timeIntervalSince1970: (state.sampledAtMs / 1000) - Double(seconds)), style: .timer)
        .monospacedDigit()
    } else if let seconds = state.elapsedSeconds {
      Text("\(seconds / 60):\(String(format: "%02d", seconds % 60))")
        .monospacedDigit()
    } else {
      Text(state.phase)
    }
  }
}

@available(iOS 16.2, *)
struct MatchLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MatchActivityAttributes.self) { context in
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Text(context.state.homeName).lineLimit(1)
          Spacer()
          Text("\(context.state.homeScore) - \(context.state.awayScore)").bold().monospacedDigit()
          Spacer()
          Text(context.state.awayName).lineLimit(1)
        }
        HStack {
          Text(context.state.phase)
          if let home = context.state.homeShootoutScore, let away = context.state.awayShootoutScore {
            Text("Penalties \(home) - \(away)")
          }
          Spacer()
          if context.isStale { Text("Update delayed") } else { MatchClock(state: context.state) }
        }.font(.caption)
      }.padding()
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Text(context.state.homeName).lineLimit(1) }
        DynamicIslandExpandedRegion(.trailing) { Text(context.state.awayName).lineLimit(1) }
        DynamicIslandExpandedRegion(.center) { Text("\(context.state.homeScore) - \(context.state.awayScore)").bold() }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Text(context.state.phase)
            Spacer()
            if context.isStale { Text("Update delayed") } else { MatchClock(state: context.state) }
          }
        }
      } compactLeading: {
        Text("\(context.state.homeScore)-\(context.state.awayScore)").monospacedDigit()
      } compactTrailing: {
        if context.isStale { Text("!") } else { MatchClock(state: context.state) }
      } minimal: {
        Text("\(context.state.homeScore)-\(context.state.awayScore)").monospacedDigit()
      }
    }
  }
}
