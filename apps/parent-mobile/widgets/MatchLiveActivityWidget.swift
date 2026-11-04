import ActivityKit
import SwiftUI
import WidgetKit
import UIKit

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
      EmptyView()
    }
  }
}

@available(iOS 16.2, *)
private struct MatchBadge: View {
  let data: Data?
  let muted: Bool

  var body: some View {
    if let data, let image = UIImage(data: data) {
      Image(uiImage: image).resizable().scaledToFit().frame(width: 24, height: 24)
        .accessibilityLabel("Club badge")
    } else {
      Image("FootballPlayerFallback").resizable().scaledToFit().frame(width: 24, height: 24)
        .saturation(0).opacity(0.55)
        .accessibilityLabel(muted ? "Opponent Football Player fallback badge" : "Club Football Player fallback badge")
    }
  }
}

@available(iOS 16.2, *)
private struct MatchCards: View {
  let yellow: Int
  let red: Int

  var body: some View {
    HStack(spacing: 5) {
      if yellow > 0 {
        HStack(spacing: 2) {
          RoundedRectangle(cornerRadius: 1).fill(.yellow).frame(width: 7, height: 10)
          Text("\(yellow)")
        }.accessibilityLabel("\(yellow) yellow cards")
      }
      if red > 0 {
        HStack(spacing: 2) {
          RoundedRectangle(cornerRadius: 1).fill(.red).frame(width: 7, height: 10)
          Text("\(red)")
        }.accessibilityLabel("\(red) red cards")
      }
    }.font(.caption2).monospacedDigit()
  }
}

@available(iOS 16.2, *)
private struct MatchTeam: View {
  let name: String
  let badgeData: Data?
  let muted: Bool
  let yellow: Int
  let red: Int
  let trailing: Bool

  var body: some View {
    HStack(spacing: 5) {
      if !trailing { MatchBadge(data: badgeData, muted: muted) }
      VStack(alignment: trailing ? .trailing : .leading, spacing: 2) {
        Text(name).font(.subheadline).lineLimit(2).minimumScaleFactor(0.75)
          .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
        if yellow > 0 || red > 0 { MatchCards(yellow: yellow, red: red) }
      }
      if trailing { MatchBadge(data: badgeData, muted: muted) }
    }.frame(maxWidth: .infinity)
  }
}

@available(iOS 16.2, *)
struct MatchLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MatchActivityAttributes.self) { context in
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 7) {
          MatchTeam(name: context.state.homeName,
            badgeData: context.attributes.clubIsHome ? context.attributes.badgeData : nil,
            muted: !context.attributes.clubIsHome,
            yellow: context.state.homeYellowCards ?? 0, red: context.state.homeRedCards ?? 0, trailing: false)
          Text("\(context.state.homeScore) - \(context.state.awayScore)")
            .font(.headline).bold().monospacedDigit().fixedSize()
          MatchTeam(name: context.state.awayName,
            badgeData: context.attributes.clubIsHome ? nil : context.attributes.badgeData,
            muted: context.attributes.clubIsHome,
            yellow: context.state.awayYellowCards ?? 0, red: context.state.awayRedCards ?? 0, trailing: true)
        }
        VStack(spacing: 3) {
          HStack {
            Text(context.state.phase).frame(maxWidth: .infinity, alignment: .leading)
            Group {
              if context.isStale { Text("Update delayed") }
              else if let home = context.state.homeShootoutScore, let away = context.state.awayShootoutScore {
                Text("Penalties \(home) - \(away)")
              } else { Text("") }
            }.frame(maxWidth: .infinity, alignment: .trailing)
          }
          MatchClock(state: context.state).frame(maxWidth: .infinity, alignment: .center)
        }.font(.caption)
      }.padding().foregroundStyle(.white).activityBackgroundTint(Color(red: 0, green: 76.0 / 255.0, blue: 140.0 / 255.0))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          MatchTeam(name: context.state.homeName,
            badgeData: context.attributes.clubIsHome ? context.attributes.badgeData : nil,
            muted: !context.attributes.clubIsHome,
            yellow: context.state.homeYellowCards ?? 0, red: context.state.homeRedCards ?? 0, trailing: false)
        }
        DynamicIslandExpandedRegion(.trailing) {
          MatchTeam(name: context.state.awayName,
            badgeData: context.attributes.clubIsHome ? nil : context.attributes.badgeData,
            muted: context.attributes.clubIsHome,
            yellow: context.state.awayYellowCards ?? 0, red: context.state.awayRedCards ?? 0, trailing: true)
        }
        DynamicIslandExpandedRegion(.center) { Text("\(context.state.homeScore) - \(context.state.awayScore)").bold() }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 3) {
            HStack {
              Text(context.state.phase).frame(maxWidth: .infinity, alignment: .leading)
              Text(context.isStale ? "Update delayed" : "").frame(maxWidth: .infinity, alignment: .trailing)
            }
            MatchClock(state: context.state).frame(maxWidth: .infinity, alignment: .center)
          }
        }
      } compactLeading: {
        Text("\(context.state.homeScore)-\(context.state.awayScore)").monospacedDigit()
      } compactTrailing: {
        if context.state.elapsedSeconds == nil { Text(context.state.phase) }
        else { MatchClock(state: context.state) }
      } minimal: {
        Text("\(context.state.homeScore)-\(context.state.awayScore)").monospacedDigit()
      }.keylineTint(Color(red: 0, green: 76.0 / 255.0, blue: 140.0 / 255.0))
    }
  }
}
