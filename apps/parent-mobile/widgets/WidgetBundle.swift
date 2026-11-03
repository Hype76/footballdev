import SwiftUI
import WidgetKit

@main
struct FootballPlayerMatchWidgetBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      MatchLiveActivityWidget()
    }
  }
}
