import Foundation
import UserNotifications

// ──────────────────────────────────────────────────────────
// Delegate — handles both the process that *posted* and any
// fresh instance macOS relaunches to *deliver* a response.
// promptId / respondCmd are read from userInfo so they
// survive a relaunch.
// ──────────────────────────────────────────────────────────
final class Delegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info     = response.notification.request.content.userInfo
        let promptId = info["promptId"]   as? String ?? ""
        let respCmd  = info["respondCmd"] as? String ?? ""

        let actionId = response.actionIdentifier
        let action: String
        switch actionId {
        case "YES":     action = "yes"
        case "YES_ALL": action = "yes-all"
        case "NO":      action = "no"
        default:        action = "open"
        }

        if !respCmd.isEmpty && !promptId.isEmpty {
            runRespond(respondCmd: respCmd, promptId: promptId, action: action)
        }
        completionHandler()
        exit(0)
    }

    private func runRespond(respondCmd: String, promptId: String, action: String) {
        let nodePath = resolveNode()
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments     = [respondCmd, "respond", promptId, action]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = (env["PATH"] ?? "") + ":/usr/local/bin:/opt/homebrew/bin"
        proc.environment = env
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            fputs("knowtify: respond failed: \(error)\n", stderr)
        }
    }

    private func resolveNode() -> String {
        for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
            if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
        }
        // fall back to env lookup
        return "/usr/bin/env"
    }
}

// ──────────────────────────────────────────────────────────
// Argument parsing
// ──────────────────────────────────────────────────────────
struct Args {
    var id         = ""
    var title      = "Knowtify"
    var subtitle   = ""
    var body       = ""
    var respondCmd = ""
    var actionYes    = "Yes"
    var actionYesAll = "Allow All"
    var actionNo     = "No"
}

func parseArgs() -> Args {
    var a = Args()
    var i = 1
    let argv = CommandLine.arguments
    while i < argv.count {
        let flag = argv[i]
        let next = (i + 1 < argv.count) ? argv[i + 1] : ""
        switch flag {
        case "--id":          a.id         = next; i += 2
        case "--title":       a.title      = next; i += 2
        case "--subtitle":    a.subtitle   = next; i += 2
        case "--body":        a.body       = next; i += 2
        case "--respond-cmd": a.respondCmd = next; i += 2
        case "--action-yes":     a.actionYes    = next; i += 2
        case "--action-yes-all": a.actionYesAll = next; i += 2
        case "--action-no":      a.actionNo     = next; i += 2
        default: i += 1
        }
    }
    return a
}

func cap(_ s: String, _ n: Int) -> String {
    guard s.count > n else { return s }
    return String(s.prefix(n - 1)) + "…"
}

// ──────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────
let center = UNUserNotificationCenter.current()
let delegate = Delegate()
center.delegate = delegate

// Register categories (needed in both post and response modes)
func registerCategories(yes: String, yesAll: String, no: String) {
    let aYes    = UNNotificationAction(identifier: "YES",     title: cap(yes,    40), options: [])
    let aYesAll = UNNotificationAction(identifier: "YES_ALL", title: cap(yesAll, 40), options: [])
    let aNo     = UNNotificationAction(identifier: "NO",      title: cap(no,     40), options: [.destructive])
    let category = UNNotificationCategory(
        identifier: "KNOWTIFY_PROMPT",
        actions: [aYes, aYesAll, aNo],
        intentIdentifiers: [],
        options: [.customDismissAction]
    )
    center.setNotificationCategories([category])
}

let args = parseArgs()
let isPostMode = !args.id.isEmpty && !args.respondCmd.isEmpty

if isPostMode {
    // ── Post mode: called from the Node daemon ────────────
    registerCategories(yes: args.actionYes, yesAll: args.actionYesAll, no: args.actionNo)

    let sema = DispatchSemaphore(value: 0)
    center.requestAuthorization(options: [.alert, .sound]) { granted, err in
        guard granted else {
            fputs("Notification permission denied.\n", stderr)
            fputs("Fix: System Settings → Notifications → Knowtify Notify → Allow Notifications → set style to Alerts\n", stderr)
            exit(1)
        }

        let content = UNMutableNotificationContent()
        content.title              = args.title
        content.subtitle           = args.subtitle
        content.body               = cap(args.body, 800)
        content.categoryIdentifier = "KNOWTIFY_PROMPT"
        content.sound              = .default
        content.threadIdentifier   = args.id
        // Store response context so a relaunched instance can use it
        content.userInfo = [
            "promptId":   args.id,
            "respondCmd": args.respondCmd
        ]

        let req = UNNotificationRequest(identifier: args.id, content: content, trigger: nil)
        center.add(req) { addErr in
            if let e = addErr {
                fputs("Failed to post notification: \(e)\n", stderr)
                exit(1)
            }
            sema.signal()
        }
    }
    sema.wait()
    // Keep alive up to 5 min for the delegate callback
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 300))

} else {
    // ── Response mode: macOS relaunched us to deliver a tap ─
    // Categories must be registered before macOS delivers the response
    registerCategories(yes: "Yes", yesAll: "Allow All", no: "No")
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    // Wait indefinitely; delegate will exit(0) after handling
    RunLoop.main.run()
}
