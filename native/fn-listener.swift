// fn-listener: tiny macOS helper for the Electron app.
//
// 1) Watches the modifier keys system-wide and prints one line per change to stdout:
//      mods fn,control,option,shift,command   the modifiers held right now ("mods" alone = none)
//      key                                    a normal key was pressed WHILE a modifier is held
//                                             (no key code — we never learn what you type)
//    plus: ready | permission-needed | permission-granted | error: …
//    The app decides which keys are the dictation key (Fn, or two modifiers like ⌃⌥).
//    The key watching is LISTEN-ONLY: it can't block or change any keys.
//
// 2) Pastes text when the app writes a command line to our stdin:
//      paste <base64 text>      → save clipboard, set text, press ⌘V, restore clipboard
//      paste-dry <base64 text>  → same but without pressing ⌘V (for testing)
//    Replies: pasted | pasted (clipboard changed, not restored) | paste-error: …
//      status                   → status input=0|1 accessibility=0|1
//      ask-accessibility        → show macOS's Accessibility prompt (first-run setup)
//
// Build: swiftc -O native/fn-listener.swift -o bin/fn-listener
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IOLBF, 0) // flush each line immediately

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

// ---------- paste ----------

let restoreDelay = 0.5 // seconds to wait before restoring the clipboard (apps read it async)

/// Press ⌘V in whatever app has focus.
func pressCommandV() {
    let source = CGEventSource(stateID: .combinedSessionState)
    let vKey: CGKeyCode = 9 // "V" on QWERTY layouts
    for keyDown in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: keyDown)
        event?.flags = .maskCommand // only Command — ignore any modifier still held
        event?.post(tap: .cghidEventTap)
    }
}

func paste(_ text: String, dry: Bool) {
    if !dry && !AXIsProcessTrusted() {
        // Pressing keys for the user needs Accessibility permission; this shows the prompt.
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        emit("paste-error: accessibility permission needed")
        return
    }

    let pasteboard = NSPasteboard.general

    // 1. Save everything currently on the clipboard (all items, all formats).
    let saved: [[NSPasteboard.PasteboardType: Data]] = (pasteboard.pasteboardItems ?? []).map { item in
        var formats = [NSPasteboard.PasteboardType: Data]()
        for type in item.types {
            if let data = item.data(forType: type) { formats[type] = data }
        }
        return formats
    }

    // 2. Put our text on it, marked transient so clipboard managers skip it.
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
    pasteboard.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
    let ourChangeCount = pasteboard.changeCount

    // 3. Paste.
    if !dry { pressCommandV() }

    // 4. Restore the original clipboard — unless the user copied something new meanwhile.
    DispatchQueue.main.asyncAfter(deadline: .now() + restoreDelay) {
        guard pasteboard.changeCount == ourChangeCount else {
            emit("pasted (clipboard changed, not restored)")
            return
        }
        pasteboard.clearContents()
        let items: [NSPasteboardItem] = saved.map { formats in
            let item = NSPasteboardItem()
            for (type, data) in formats { item.setData(data, forType: type) }
            return item
        }
        if !items.isEmpty { pasteboard.writeObjects(items) }
        emit("pasted")
    }
}

func handleCommand(_ line: String) {
    let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
    guard let command = parts.first else { return }
    switch command {
    case "paste", "paste-dry":
        guard parts.count == 2,
              let data = Data(base64Encoded: parts[1]),
              let text = String(data: data, encoding: .utf8)
        else {
            emit("paste-error: bad text")
            return
        }
        DispatchQueue.main.async { paste(text, dry: command == "paste-dry") }
    case "status":
        // Which macOS permissions this helper has (1 = allowed).
        let input = CGPreflightListenEventAccess() ? 1 : 0
        let accessibility = AXIsProcessTrusted() ? 1 : 0
        emit("status input=\(input) accessibility=\(accessibility)")
    case "ask-accessibility":
        // First-run setup: show macOS's Accessibility prompt now (it also adds the app to the
        // list in System Settings), instead of waiting for the first paste.
        DispatchQueue.main.async {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }
    default:
        emit("error: unknown command \(command)")
    }
}

// Read commands from stdin; exit when the parent app closes it (so we never linger).
Thread.detachNewThread {
    while let line = readLine() {
        handleCommand(line.trimmingCharacters(in: .whitespaces))
    }
    exit(0)
}

// ---------- modifier keys ----------

var heldMods = "" // last reported set, e.g. "fn" or "control,option"
var tapRef: CFMachPort?

/// The modifiers in an event's flags, in a fixed order. (Caps Lock is ignored.)
func modifierNames(_ flags: CGEventFlags) -> String {
    var names: [String] = []
    if flags.contains(.maskSecondaryFn) { names.append("fn") }
    if flags.contains(.maskControl) { names.append("control") }
    if flags.contains(.maskAlternate) { names.append("option") }
    if flags.contains(.maskShift) { names.append("shift") }
    if flags.contains(.maskCommand) { names.append("command") }
    return names.joined(separator: ",")
}

let callback: CGEventTapCallBack = { _, type, event, _ in
    // macOS disables slow/idle taps sometimes; just turn it back on.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = tapRef { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }

    if type == .flagsChanged {
        let now = modifierNames(event.flags)
        if now != heldMods {
            heldMods = now
            emit(now.isEmpty ? "mods" : "mods \(now)")
        }
    } else if type == .keyDown && !heldMods.isEmpty {
        // A shortcut like ⌃⌥T or Fn+F1: tells the app "this was not a dictation".
        // Typing without modifiers is never reported.
        emit("key")
    }
    return Unmanaged.passUnretained(event)
}

func startKeyTap() {
    let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: CGEventMask(mask),
        callback: callback,
        userInfo: nil
    ) else {
        emit("error: could not create event tap (Input Monitoring permission missing?)")
        return
    }
    tapRef = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    emit("ready")
}

// Input Monitoring permission is needed to see key events from other apps.
// If missing: ask, then check once a second WITHOUT blocking (paste keeps working meanwhile).
if CGPreflightListenEventAccess() {
    startKeyTap()
} else {
    emit("permission-needed")
    CGRequestListenEventAccess() // shows the macOS prompt / adds us to the list
    Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
        if CGPreflightListenEventAccess() {
            timer.invalidate()
            emit("permission-granted")
            startKeyTap()
        }
    }
}

CFRunLoopRun()
