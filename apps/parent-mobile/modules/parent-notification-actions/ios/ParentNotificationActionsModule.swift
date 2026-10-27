import ExpoModulesCore
import EXNotifications
import UIKit
import UserNotifications

public class ParentNotificationActionsModule: Module {
  private var taskManager: EXTaskManagerInterface?

  public func definition() -> ModuleDefinition {
    Name("ParentNotificationActions")
    OnCreate {
      self.taskManager = self.appContext?.legacyModule(implementing: EXTaskManagerInterface.self)
    }
    AsyncFunction("registerTaskAsync") { (name: String, promise: Promise) in
      guard name == "fp.parent.invitation-actions.v1", let manager = self.taskManager else {
        promise.reject("E_INVITATION_ACTION_TASK", "Invitation actions are unavailable in this build.")
        return
      }
      manager.registerTask(withName: name, consumer: ParentInvitationActionConsumer.self, options: [:])
      promise.resolve(nil)
    }.runOnQueue(.main)
  }
}

// TaskManager restores this consumer at native startup before React screens load.
@objc(ParentInvitationActionConsumer)
public class ParentInvitationActionConsumer: NSObject, EXTaskConsumerInterface, NotificationDelegate {
  public var task: EXTaskInterface?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var pendingCount = 0

  public static func supportsLaunchReason(_ reason: EXTaskLaunchReason) -> Bool { false }
  public func taskType() -> String { "parent-invitation-action" }
  public func didRegisterTask(_ task: EXTaskInterface) {
    self.task = task
    NotificationCenterManager.shared.addDelegate(self)
  }
  public func didUnregister() {
    NotificationCenterManager.shared.removeDelegate(self)
    self.task = nil
    finishBackgroundTask()
  }
  public func didFinish() {
    DispatchQueue.main.async {
      self.pendingCount = max(0, self.pendingCount - 1)
      if self.pendingCount == 0 { self.finishBackgroundTask() }
    }
  }
  public func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    guard ["parent_accept", "parent_decline"].contains(response.actionIdentifier), let task else { return false }
    let info = response.notification.request.content.userInfo
    guard let data = info["body"] as? [String: Any], data["app"] as? String == "parent" else { return false }
    if backgroundTask == .invalid {
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Parent invitation response") { [weak self] in
        self?.finishBackgroundTask()
      }
    }
    pendingCount += 1
    task.execute(withData: [
      "actionIdentifier": response.actionIdentifier,
      "notification": ["request": ["identifier": response.notification.request.identifier, "content": ["data": data]]]
    ], withError: nil)
    return true
  }
  private func finishBackgroundTask() {
    if backgroundTask != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundTask)
      backgroundTask = .invalid
    }
  }
}
