import ApplicationServices
import Carbon
import Foundation

let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
let commitKeyCodes = Set<Int64>([
  36, // Return
  76, // Keypad Enter
  49, // Space, used by many IMEs to commit the highlighted candidate
  18, 19, 20, 21, 23, 22, 26, 28, 25, 29 // Number row 1-0 candidate selection
])

guard let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .listenOnly,
  eventsOfInterest: mask,
  callback: { _, _, event, _ in
    if shouldCount(event: event) {
      print("commit")
      fflush(stdout)
    }
    return Unmanaged.passUnretained(event)
  },
  userInfo: nil
) else {
  fputs("Unable to create CGEvent tap. Grant Input Monitoring and Accessibility permissions to the app launching this process.\n", stderr)
  exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
CFRunLoopRun()

func shouldCount(event: CGEvent) -> Bool {
  if isLikelyInputMethodActive() {
    return commitKeyCodes.contains(event.getIntegerValueField(.keyboardEventKeycode))
  }

  guard let text = unicodeString(from: event), !text.isEmpty else {
    return false
  }

  return text.unicodeScalars.allSatisfy { scalar in
    scalar.value >= 0x21 && scalar.value <= 0x7E
  }
}

func unicodeString(from event: CGEvent) -> String? {
  var length = 0
  event.keyboardGetUnicodeString(maxStringLength: 0, actualStringLength: &length, unicodeString: nil)
  if length == 0 {
    return nil
  }

  var buffer = [UniChar](repeating: 0, count: length)
  event.keyboardGetUnicodeString(maxStringLength: length, actualStringLength: &length, unicodeString: &buffer)
  return String(utf16CodeUnits: buffer, count: length)
}

func isLikelyInputMethodActive() -> Bool {
  guard let source = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
        let sourceId = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) else {
    return false
  }

  let id = Unmanaged<CFString>.fromOpaque(sourceId).takeUnretainedValue() as String
  return id.contains(".inputmethod.") || id.lowercased().contains("pinyin") || id.lowercased().contains("imk")
}
